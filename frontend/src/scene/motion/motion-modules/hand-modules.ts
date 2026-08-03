// [doc:adr-116 重构] Hand Modules — 左手/右手独立控制模块
// 职责: 合并原 hand-symmetry（单侧手腕旋转+位置偏移）与 finger-pose（单侧手指预设），
//       使左右手完全独立可调（不再强制镜像）。
// 骨骼: 手腕旋转(手首) + 手臂位置(肩根骨 FK 平移 / 腕 IK 重解) + 手指姿势(5 指 × 3 节)
// 帧钩子: 手臂位置偏移需每帧驱动（与旧 hand-symmetry 同构），手指/手腕为静态 bake。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended, ParamValue } from '@/core/types';
import { modelRegistry } from '@/core/state';
import {
    setBoneOverride,
    setBoneOverridePosition,
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
    createEnsureActive,
} from './module-base';

// ── 手指预设（与原 finger-pose 一致）──

type FingerPreset = 'relax' | 'fist' | 'point' | 'peace' | 'rock';

const PRESETS: Record<FingerPreset, number[]> = {
    relax: [0.2, 0.3, 0.3, 0.3, 0.3],
    fist: [0.8, 1.0, 1.0, 1.0, 1.0],
    point: [0.2, 0.0, 1.0, 1.0, 1.0],
    peace: [0.2, 0.0, 0.0, 1.0, 1.0],
    rock: [0.2, 0.0, 1.0, 1.0, 0.0],
};

const FINGER_BASES = ['親指', '人差指', '中指', '薬指', '小指'];
const PHALANX_SUFFIXES = ['０', '１', '２', '第一', '第二', '第三'];
const PHALANX_WEIGHTS = [0.5, 0.3, 0.2];

// ── 共享帧钩子管理器（左右手共用一个 Map，按 modelId 注册一次）──

const _handFrameHooks = createFrameHookManager();

/** 手臂骨名缓存（per-model） */
interface _ArmIkCache {
    lIk?: string | null;
    rIk?: string | null;
    lRoot?: string | null;
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

// ── 工厂函数 ──

interface HandSideConfig {
    side: 'L' | 'R';
    moduleId: string;
    wristBone: string;
    shoulderBone: string;
    fingerPrefix: string;
    labelKey: string;
    icon: string;
}

/** 构建单侧手指候选骨骼名 */
function buildFingerBones(prefix: string): string[] {
    const bones: string[] = [];
    for (const base of FINGER_BASES) {
        for (const suffix of PHALANX_SUFFIXES) {
            bones.push(`${prefix}${base}${suffix}`);
        }
    }
    return bones;
}

/** 创建左手或右手模块 */
function createHandModuleFactory(cfg: HandSideConfig) {
    return (modelId: string, actionId?: string): MotionOverrideModule => {
        const fingerBones = buildFingerBones(cfg.fingerPrefix);
        const managedBones = [cfg.wristBone, cfg.shoulderBone, ...fingerBones];

        const DEFAULTS: Record<string, ParamValue> = {
            pitch: 0,
            yaw: 0,
            roll: 0,
            handPosX: 0,
            handPosY: 0,
            handPosZ: 0,
            fingerPreset: 'relax',
            fingerIntensity: 1,
        };

        const META: ModuleMeta = {
            labelKey: cfg.labelKey,
            icon: cfg.icon,
            defaults: DEFAULTS,
        };

        // ── bake：手腕旋转 + 手指姿势 ──
        function bake(modelId: string): void {
            const prep = prepareBake(modelId, cfg.moduleId, managedBones);
            if (!prep) {
                return;
            }
            const { state, claimed } = prep;

            // 手腕旋转
            const pitch = (state.params.pitch as number) ?? 0;
            const yaw = (state.params.yaw as number) ?? 0;
            const roll = (state.params.roll as number) ?? 0;
            if (claimed.includes(cfg.wristBone)) {
                setBoneOverride(cfg.wristBone, [pitch, yaw, roll], 1, true, modelId);
            }

            // 手指姿势
            const presetName = (state.params.fingerPreset as string) ?? 'relax';
            const intensity = (state.params.fingerIntensity as number) ?? 1;
            const preset = PRESETS[presetName as FingerPreset] ?? PRESETS.relax;

            for (let fingerIdx = 0; fingerIdx < FINGER_BASES.length; fingerIdx++) {
                const base = FINGER_BASES[fingerIdx];
                const curl = preset[fingerIdx] * intensity;
                const phalanges: string[] = [];
                for (const suffix of PHALANX_SUFFIXES) {
                    const boneName = `${cfg.fingerPrefix}${base}${suffix}`;
                    if (claimed.includes(boneName)) {
                        phalanges.push(boneName);
                    }
                }
                phalanges.forEach((boneName, rank) => {
                    const w = PHALANX_WEIGHTS[Math.min(rank, PHALANX_WEIGHTS.length - 1)];
                    setBoneOverride(boneName, [curl * 90 * w, 0, 0], 1, true, modelId);
                });
            }
        }

        // ── 帧钩子：手臂位置偏移（FK 父根骨平移 / IK 重解）──
        const ensureActive = createEnsureActive(
            bake,
            _handFrameHooks,
            (mid) =>
                registerBoneOverrideFrameHook(
                    (_t, m) => {
                        if (m !== mid) {
                            return;
                        }
                        const st = getModuleState(mid, cfg.moduleId);
                        if (!st.enabled) {
                            return;
                        }
                        const inst = modelRegistry.get(mid);
                        const bones = inst?.mmdModel?.runtimeBones;
                        if (!bones?.length) {
                            return;
                        }

                        const hx = (st.params.handPosX as number) ?? 0;
                        const hy = (st.params.handPosY as number) ?? 0;
                        const hz = (st.params.handPosZ as number) ?? 0;
                        if (hx === 0 && hy === 0 && hz === 0) {
                            return;
                        }

                        const cache = _getArmIkCache(mid);
                        const ikCandidates =
                            cfg.side === 'L' ? BONE_ARM_IK_L_CANDIDATES : BONE_ARM_IK_R_CANDIDATES;
                        const shoulderCandidates =
                            cfg.side === 'L'
                                ? BONE_SHOULDER_L_CANDIDATES
                                : BONE_SHOULDER_R_CANDIDATES;

                        const ikKey = cfg.side === 'L' ? 'lIk' : 'rIk';
                        const rootKey = cfg.side === 'L' ? 'lRoot' : 'rRoot';

                        if (cache[ikKey] === undefined) {
                            cache[ikKey] = matchBone(
                                bones.map((b) => b.name),
                                ikCandidates
                            );
                        }
                        if (cache[rootKey] === undefined) {
                            cache[rootKey] = matchBone(
                                bones.map((b) => b.name),
                                shoulderCandidates
                            );
                        }

                        const rootName = cache[rootKey] ?? cfg.shoulderBone;
                        _driveArm(bones, cache[ikKey], rootName, [hx, hy, hz], mid);
                    },
                    FRAME_HOOK_ORDER.HAND_SYMMETRY,
                    cfg.moduleId
                )
        );

        /** 驱动单臂位置偏移（FK 父根骨平移主路径 + IK 重解增强路径） */
        function _driveArm(
            bones: readonly IMmdRuntimeBone[],
            ikName: string | null | undefined,
            rootName: string,
            offset: [number, number, number],
            modelId: string
        ): void {
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
            setBoneOverridePosition(rootName, offset, 1, true, modelId);
        }

        const base = createModuleBase(modelId, cfg.moduleId, DEFAULTS, bake, {
            action: ensureActive,
            onDisable: (mid) => {
                _handFrameHooks.unregister(mid);
            },
        }, actionId);

        return createModuleShell({
            id: cfg.moduleId,
            meta: META,
            priority: 1,
            managedBones,
            buildSchema: () => [
                // ── 手腕旋转 ──
                {
                    id: `${cfg.moduleId}:pitch`,
                    kind: 'slider',
                    label: 'param.pitch',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.pitch`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => base.setParam('pitch', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:yaw`,
                    kind: 'slider',
                    label: 'param.yaw',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.yaw`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => base.setParam('yaw', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:roll`,
                    kind: 'slider',
                    label: 'param.roll',
                    icon: 'lucide:rotate-cw',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.roll`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => base.setParam('roll', v as number),
                    },
                },
                // ── 手臂位置偏移 ──
                {
                    id: `${cfg.moduleId}:posSection`,
                    kind: 'sectionTitle',
                    label: 'section.handPosition',
                },
                {
                    id: `${cfg.moduleId}:handPosX`,
                    kind: 'slider',
                    label: 'param.handPosX',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.handPosX`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('handPosX', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:handPosY`,
                    kind: 'slider',
                    label: 'param.handPosY',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.handPosY`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('handPosY', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:handPosZ`,
                    kind: 'slider',
                    label: 'param.handPosZ',
                    icon: 'lucide:move',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.handPosZ`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('handPosZ', v as number),
                    },
                },
                // ── 手指姿势 ──
                {
                    id: `${cfg.moduleId}:fingerSection`,
                    kind: 'sectionTitle',
                    label: 'section.fingerPose',
                },
                {
                    id: `${cfg.moduleId}:fingerPreset`,
                    kind: 'modeSlider',
                    label: 'motion.preset',
                    icon: 'lucide:list',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.fingerPreset`,
                        options: [
                            { value: 'relax', label: 'motion.fingerPreset.relax' },
                            { value: 'fist', label: 'motion.fingerPreset.fist' },
                            { value: 'point', label: 'motion.fingerPreset.point' },
                            { value: 'peace', label: 'motion.fingerPreset.peace' },
                            { value: 'rock', label: 'motion.fingerPreset.rock' },
                        ],
                        onChange: (v) => base.setParam('fingerPreset', v as string),
                    },
                },
                {
                    id: `${cfg.moduleId}:fingerIntensity`,
                    kind: 'slider',
                    label: 'motion.intensity',
                    icon: 'lucide:gauge',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.fingerIntensity`,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => base.setParam('fingerIntensity', v as number),
                    },
                },
            ],
            base,
        });
    };
}

// ── 导出 ──

export const LEFT_HAND_DEF: ModuleDef = {
    id: 'left-hand',
    meta: {
        labelKey: 'motion.override.module.leftHand',
        icon: 'lucide:hand',
        defaults: {
            pitch: 0,
            yaw: 0,
            roll: 0,
            handPosX: 0,
            handPosY: 0,
            handPosZ: 0,
            fingerPreset: 'relax',
            fingerIntensity: 1,
        },
    },
    priority: 1,
    factory: createHandModuleFactory({
        side: 'L',
        moduleId: 'left-hand',
        wristBone: '左手首',
        shoulderBone: '左肩',
        fingerPrefix: '左',
        labelKey: 'motion.override.module.leftHand',
        icon: 'lucide:hand',
    }),
};

export const RIGHT_HAND_DEF: ModuleDef = {
    id: 'right-hand',
    meta: {
        labelKey: 'motion.override.module.rightHand',
        icon: 'lucide:hand',
        defaults: {
            pitch: 0,
            yaw: 0,
            roll: 0,
            handPosX: 0,
            handPosY: 0,
            handPosZ: 0,
            fingerPreset: 'relax',
            fingerIntensity: 1,
        },
    },
    priority: 1,
    factory: createHandModuleFactory({
        side: 'R',
        moduleId: 'right-hand',
        wristBone: '右手首',
        shoulderBone: '右肩',
        fingerPrefix: '右',
        labelKey: 'motion.override.module.rightHand',
        icon: 'lucide:hand',
    }),
};
