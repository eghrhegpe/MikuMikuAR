// [doc:adr-116] Hand Symmetry Module — 手腕对称模块
// 职责: 左手首设值 → 右手首自动镜像（pitch/yaw 保持+偏移，roll 取反）
// 镜像规则: 左手首 [p, y, r] → 右手首 [p, y+offset, -r]
// 骨骼: 左手首/右手首（MMD 手腕关节骨，非前臂骨）
// 注意: 本模块仅控制手腕旋转，不涉及肘关节/前臂
//
// [doc:adr-116 手部位置偏移] 位置偏移（handPosX/Y/Z）的实现:
//   标准 MMD 无手臂 IK 骨（仅腿部有足IK），手臂是纯 FK 链 左肩→左上腕→左ひじ→左手首。
//   直接偏移末端手腕骨（左手首）只浮起手、胳膊不动（早期 bug，已废弃）。
//   偏移大臂骨（左上腕）会让大臂相对父骨 左肩 平移 → 肩臂连接处蒙皮被拉长（上一版 bug，已废弃）。
//   正确做法（FK 父根骨平移主路径）: 把偏移写到手臂的【父根骨 左肩/右肩】的局部位置，
//   整条手臂（大臂→肘→腕）作为刚体随父根骨一起平移，且因 左肩 挂在躯干 上半身2 上，
//   肩臂/躯干连接处几乎无拉伸，视觉即"手臂从肩膀自然抬起"。
//   手腕旋转覆盖（setBoneOverride 写 左手首）仍经 slot 每帧叠加其上，互不冲突。
//   增强路径（少数含手臂 IK 骨的模型）: 偏移 IK 目标骨（左腕IK/右腕IK）后 ikSolver.solve 重解，
//   效果等效但更精确；无 IK 骨时一律走 FK 父根骨平移主路径。
//   帧钩子经 registerBoneOverrideFrameHook 注册（先于 bone-override 的 slot 应用运行）。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, ParamValue } from '@/core/types';
import { modelRegistry } from '@/core/state';
import {
    setBoneOverride,
    setBoneOverridePosition,
    clearBoneOverride,
    registerBoneOverrideFrameHook,
    FRAME_HOOK_ORDER,
} from '../bone-override';
import {
    matchBone,
    BONE_ARM_IK_L_CANDIDATES,
    BONE_ARM_IK_R_CANDIDATES,
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
} from '@/motion-algos/proc-motion-shared';
import { getModuleState } from './registry';
import type { MotionOverrideModule, ModuleMeta, ModuleDef } from './types';
import {
    createModuleBase,
    createFrameHookManager,
    createModuleShell,
    prepareBake,
} from './module-base';

const MODULE_ID = 'hand-symmetry';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    symmetry: true, // 同步镜像：true=右手镜像左手；false=左右手独立
    pitch: 0, // 左手首 pitch（屈腕）: -90~90
    yaw: 0, // 左手首 yaw（摆腕）: -90~90
    roll: 0, // 左手首 roll（转腕）: -90~90
    mirrorOffset: 0, // 右腕额外 yaw 偏移（仅镜像模式生效）: -45~45
    rightPitch: 0, // 右手首 pitch（独立模式）: -90~90
    rightYaw: 0, // 右手首 yaw（独立模式）: -90~90
    rightRoll: 0, // 右手首 roll（独立模式）: -90~90
    handPosX: 0, // 手位置 X 偏移（世界坐标，左右；对称模式右手 X 镜像）: -10~10
    handPosY: 0, // 手位置 Y 偏移（世界坐标，上下）: -10~10
    handPosZ: 0, // 手位置 Z 偏移（世界坐标，前后）: -10~10
};

/** 模块元信息 */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.handSymmetry',
    icon: 'lucide:hand',
    defaults: DEFAULTS,
};

/** 管理的骨骼：手腕骨（旋转覆盖所有权）+ 肩膀根骨（位置偏移所有权，disable 时一并清理） */
const MANAGED_BONES = ['左手首', '右手首', '左肩', '右肩'];

/**
 * 烘焙：仅写手腕旋转覆盖（位置偏移由每帧钩子驱动手臂 IK，见 ensureActive）。
 * 旋转覆盖经 bone-override slot 每帧应用，且帧钩子先于 slot 应用运行，
 * 故「重解 IK 定位手臂」与「叠加手腕旋转」顺序正确、互不覆盖。
 */
function bake(modelId: string): void {
    const prep = prepareBake(modelId, MODULE_ID, MANAGED_BONES);
    if (!prep) {
        return;
    }
    const { state, claimed } = prep;
    const symmetry = (state.params.symmetry as boolean) ?? true;
    const pitch = (state.params.pitch as number) ?? 0;
    const yaw = (state.params.yaw as number) ?? 0;
    const roll = (state.params.roll as number) ?? 0;
    const mirrorOffset = (state.params.mirrorOffset as number) ?? 0;
    const rightPitch = (state.params.rightPitch as number) ?? 0;
    const rightYaw = (state.params.rightYaw as number) ?? 0;
    const rightRoll = (state.params.rightRoll as number) ?? 0;

    // 左手：直接设值
    if (claimed.includes('左手首')) {
        setBoneOverride('左手首', [pitch, yaw, roll], 1, true, modelId);
    }

    if (symmetry) {
        // 右手首：镜像（pitch 保持, yaw 保持+偏移, roll 取反）
        if (claimed.includes('右手首')) {
            setBoneOverride('右手首', [pitch, yaw + mirrorOffset, -roll], 1, true, modelId);
        }
    } else {
        // 右手首：独立设值
        if (claimed.includes('右手首')) {
            setBoneOverride('右手首', [rightPitch, rightYaw, rightRoll], 1, true, modelId);
        }
    }
}

// ── 手部位置偏移：每帧驱动手臂 IK（与 sway/riding 同构的帧钩子）──

/** [doc:adr-116 P3] 每模型每帧钩子管理器 */
const _handFrameHooks = createFrameHookManager();

/** 手臂骨名缓存（按模型）：undefined=未解析，null=解析但无此骨，string=骨名 */
interface _ArmIkCache {
    l?: string | null; // 左臂 IK 目标骨（增强路径，无则 null）
    r?: string | null;
    lRoot?: string | null; // 左臂父根骨（肩膀，FK 主路径：偏移其局部位置带动整臂）
    rRoot?: string | null;
}
const _armIkCache = new Map<string, _ArmIkCache>();
function _getArmIkCache(modelId: string): _ArmIkCache {
    let c = _armIkCache.get(modelId);
    if (!c) {
        c = {};
        _armIkCache.set(modelId, c);
    }
    return c;
}

const _vOffset = new Vector3();

/**
 * 驱动单臂位置偏移。
 * 增强路径（少数含手臂 IK 骨的模型）：偏移 IK 目标骨世界坐标并 ikSolver.solve 重解 → 整臂跟随。
 * 主路径（标准 MMD，无 IK 骨）：偏移手臂根骨 rootName 的局部位置，
 *   子骨（ひじ/手首）经骨骼层级继承平移 → 整条手臂跟随，手腕旋转覆盖叠加其上。
 * @param ikName   手臂 IK 目标骨名（增强路径，可能 null）
 * @param rootName 手臂父根骨名（FK 主路径，如 左肩）
 * @param offset   世界坐标偏移 [x, y, z]
 */
function _driveArm(
    bones: readonly IMmdRuntimeBone[],
    ikName: string | null | undefined,
    rootName: string,
    offset: [number, number, number],
    modelId: string
): void {
    // 增强路径：有 IK 目标骨且确实存在 ikSolver 时才走 IK 重解
    if (ikName) {
        const ik = bones.find((b) => b.name === ikName);
        const solver = ik ? (ik as MmdRuntimeBoneExtended).ikSolver : undefined;
        if (ik && solver) {
            ik.getWorldTranslationToRef(_vOffset);
            _vOffset.x += offset[0];
            _vOffset.y += offset[1];
            _vOffset.z += offset[2];
            ik.setWorldTranslation(_vOffset);
            solver.solve(false);
            const lb = (
                ik as unknown as {
                    linkedBone?: { getSkeleton?: () => { _markAsDirty?: () => void } };
                }
            ).linkedBone;
            lb?.getSkeleton?.()._markAsDirty?.();
            return;
        }
    }
    // 主路径（FK 根骨平移）：偏移手臂根骨局部位置 → 子骨继承平移 → 整臂跟随
    setBoneOverridePosition(rootName, offset, 1, true, modelId);
}

/**
 * [doc:adr-116] 确保每帧钩子已注册（enable/setParam 均调用）。
 * 钩子每帧读取最新 handPosX/Y/Z，驱动手臂 IK；偏移为 0 时提前返回，不打扰 MMD 每帧 IK 复位。
 */
function ensureActive(modelId: string): void {
    if (_handFrameHooks.has(modelId)) {
        return;
    }
    bake(modelId); // 建立手腕旋转所有权 + 初始静态姿态
    const unregister = registerBoneOverrideFrameHook((_t, mid) => {
        if (mid !== modelId) {
            return;
        }
        const st = getModuleState(modelId, MODULE_ID);
        if (!st.enabled) {
            return;
        }
        const inst = modelRegistry.get(modelId);
        const bones = inst?.mmdModel?.runtimeBones;
        if (!bones || bones.length === 0) {
            return;
        }
        const symmetry = (st.params.symmetry as boolean) ?? true;
        const hx = (st.params.handPosX as number) ?? 0;
        const hy = (st.params.handPosY as number) ?? 0;
        const hz = (st.params.handPosZ as number) ?? 0;
        if (hx === 0 && hy === 0 && hz === 0) {
            return; // 无偏移则不打扰 IK（MMD 每帧自动复位 IK 目标骨）
        }

        const cache = _getArmIkCache(modelId);
        if (cache.l === undefined) {
            cache.l = matchBone(
                bones.map((b) => b.name),
                BONE_ARM_IK_L_CANDIDATES
            );
        }
        if (cache.r === undefined) {
            cache.r = matchBone(
                bones.map((b) => b.name),
                BONE_ARM_IK_R_CANDIDATES
            );
        }
        if (cache.lRoot === undefined) {
            cache.lRoot = matchBone(
                bones.map((b) => b.name),
                BONE_SHOULDER_L_CANDIDATES
            );
        }
        if (cache.rRoot === undefined) {
            cache.rRoot = matchBone(
                bones.map((b) => b.name),
                BONE_SHOULDER_R_CANDIDATES
            );
        }

        const lRoot = cache.lRoot ?? '左肩';
        const rRoot = cache.rRoot ?? '右肩';
        // 偏移归零：清除位置覆盖，让手臂回到动画/其他模块姿态（避免残留上次非零偏移）
        if (hx === 0 && hy === 0 && hz === 0) {
            clearBoneOverride(lRoot, modelId);
            clearBoneOverride(rRoot, modelId);
            return;
        }

        // 主路径 FK 父根骨平移（标准 MMD）；少数含 IK 骨的模型走 IK 重解增强
        _driveArm(bones, cache.l, lRoot, [hx, hy, hz], modelId);
        const rx = symmetry ? -hx : hx; // 对称模式右手 X 镜像
        _driveArm(bones, cache.r, rRoot, [rx, hy, hz], modelId);
    }, FRAME_HOOK_ORDER.HAND_SYMMETRY);
    _handFrameHooks.set(modelId, unregister);
}

/** 对外暴露的烘焙入口（供 UI 在 symmetry 切换后即时刷新） */
export function bakeHandSymmetry(modelId: string): void {
    bake(modelId);
}

/** 创建手腕对称模块实例 */
export function createHandSymmetryModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, {
        action: ensureActive,
        onDisable: (mid) => {
            _handFrameHooks.unregister(mid);
        },
    });
    return createModuleShell({
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema: () => {
            const isSymmetry = (): boolean =>
                (getModuleState(modelId, MODULE_ID).params.symmetry as boolean) ?? true;
            return [
                // 镜像开关
                {
                    id: 'hand-symmetry:symmetry',
                    kind: 'toggle',
                    label: 'param.symmetry',
                    icon: 'lucide:link',
                    control: {
                        bind: `motionModule.${MODULE_ID}.symmetry`,
                        onChange: () => {
                            bakeHandSymmetry(modelId);
                            void import('@/menus/motion-popup').then((m) =>
                                m.getMotionMenu()?.reRender()
                            );
                        },
                    },
                },
                // ── 左手腕 ──
                {
                    id: 'hand-symmetry:pitch',
                    kind: 'slider',
                    label: 'param.pitch',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${MODULE_ID}.pitch`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('pitch', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:yaw',
                    kind: 'slider',
                    label: 'param.yaw',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.yaw`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('yaw', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:roll',
                    kind: 'slider',
                    label: 'param.roll',
                    icon: 'lucide:rotate-cw',
                    control: {
                        bind: `motionModule.${MODULE_ID}.roll`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('roll', v as number);
                        },
                    },
                },
                // ── 镜像偏移：仅镜像模式可见 ──
                {
                    id: 'hand-symmetry:mirrorOffset',
                    kind: 'slider',
                    label: 'param.mirrorOffset',
                    icon: 'lucide:flip-horizontal',
                    visibleWhen: isSymmetry,
                    control: {
                        bind: `motionModule.${MODULE_ID}.mirrorOffset`,
                        min: -45,
                        max: 45,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('mirrorOffset', v as number);
                        },
                    },
                },
                // ── 右手腕（独立）：仅非镜像模式可见 ──
                {
                    id: 'hand-symmetry:rightSection',
                    kind: 'sectionTitle',
                    label: 'section.handRightIndependent',
                    visibleWhen: () => !isSymmetry(),
                },
                {
                    id: 'hand-symmetry:rightPitch',
                    kind: 'slider',
                    label: 'param.rightPitch',
                    icon: 'lucide:move-vertical',
                    visibleWhen: () => !isSymmetry(),
                    control: {
                        bind: `motionModule.${MODULE_ID}.rightPitch`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('rightPitch', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:rightYaw',
                    kind: 'slider',
                    label: 'param.rightYaw',
                    icon: 'lucide:move-horizontal',
                    visibleWhen: () => !isSymmetry(),
                    control: {
                        bind: `motionModule.${MODULE_ID}.rightYaw`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('rightYaw', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:rightRoll',
                    kind: 'slider',
                    label: 'param.rightRoll',
                    icon: 'lucide:rotate-cw',
                    visibleWhen: () => !isSymmetry(),
                    control: {
                        bind: `motionModule.${MODULE_ID}.rightRoll`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => {
                            base.setParam('rightRoll', v as number);
                        },
                    },
                },
                // ── 手位置偏移（左右手共享，对称模式右手 X 镜像；驱动手臂 IK 带动整臂）──
                {
                    id: 'hand-symmetry:handPosSection',
                    kind: 'sectionTitle',
                    label: 'section.handPosition',
                },
                {
                    id: 'hand-symmetry:handPosX',
                    kind: 'slider',
                    label: 'param.handPosX',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.handPosX`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('handPosX', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:handPosY',
                    kind: 'slider',
                    label: 'param.handPosY',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${MODULE_ID}.handPosY`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('handPosY', v as number);
                        },
                    },
                },
                {
                    id: 'hand-symmetry:handPosZ',
                    kind: 'slider',
                    label: 'param.handPosZ',
                    icon: 'lucide:move',
                    control: {
                        bind: `motionModule.${MODULE_ID}.handPosZ`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => {
                            base.setParam('handPosZ', v as number);
                        },
                    },
                },
            ];
        },

        base,
    });
}

/** 手腕对称模块注册定义（供 registry BUILTIN_MODULE_DEFS 批量注册） */
export const HAND_SYMMETRY_DEF: ModuleDef = {
    id: MODULE_ID,
    meta: META,
    priority: 1,
    factory: createHandSymmetryModule,
};
