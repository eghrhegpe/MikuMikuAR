// [doc:adr-116 重构] Foot Modules — 左脚/右脚独立旋转+位置偏移控制模块
// 职责: 控制单侧足 IK 骨骼旋转（pitch/yaw/roll）+ 位置偏移（footPosX/Y/Z）。
// 与地面跟随引擎的关系: feet-adjustment.ts 每帧写 IK 目标骨骼的 position（Y 轴贴地），
// 本模块通过 bone-override 写 rotation + 帧钩子写 position offset。
// 帧管线顺序: 帧钩子(order=0) 先写偏移 → feet-adjustment(order=5) 再修正位置+重解 IK。

import type { ParamValue } from '@/core/types';
import {
    setBoneOverride,
    setBoneOverridePosition,
    clearBoneOverride,
    registerBoneOverrideFrameHook,
    FRAME_HOOK_ORDER,
} from '../bone-override';
import { getModuleState } from './registry';
import type { MotionOverrideModule, ModuleMeta, ModuleDef } from './types';
import {
    createModuleBase,
    createModuleShell,
    prepareBake,
    createFrameHookManager,
    createEnsureActive,
} from './module-base';

// ── 工厂函数 ──

interface FootSideConfig {
    moduleId: string;
    ikBone: string;
    labelKey: string;
    icon: string;
}

/** 创建左脚或右脚模块 */
function createFootModuleFactory(cfg: FootSideConfig) {
    // 每侧独立帧钩子管理器（按 modelId 键控）：左右脚各持一个，避免共用同一 Map 时
    // createEnsureActive 的 has(modelId) 幂等检查误判，导致后启用一侧的位置偏移帧钩子
    // 永不注册（round-12 P1 修复）。
    const _footFrameHooks = createFrameHookManager();
    // [fix code_review P1] 本模块是否写过非零位置的 per-model 标志：
    // 归零时仅当本模块写入过才清整槽（clearBoneOverride 会删除含旋转覆盖的整个槽，
    // 无条件清除会误伤「只用旋转滑块」的用户——默认 footPos=(0,0,0) 时首帧即失效）。
    // 与 body-posture 的 _centerPosWritten 守卫模式一致（ADR-116 §4「仅清自有骨」）。
    const _footPosWritten = new Set<string>();
    return (modelId: string, actionId?: string): MotionOverrideModule => {
        const managedBones = [cfg.ikBone];

        const DEFAULTS: Record<string, ParamValue> = {
            pitch: 0,
            yaw: 0,
            roll: 0,
            footPosX: 0,
            footPosY: 0,
            footPosZ: 0,
        };

        const META: ModuleMeta = {
            labelKey: cfg.labelKey,
            icon: cfg.icon,
            defaults: DEFAULTS,
        };

        /** 烘焙：将旋转覆盖写入足 IK 骨骼 */
        function bake(modelId: string): void {
            const prep = prepareBake(modelId, cfg.moduleId, managedBones);
            if (!prep) {
                return;
            }
            const { state, claimed } = prep;

            if (claimed.includes(cfg.ikBone)) {
                const pitch = (state.params.pitch as number) ?? 0;
                const yaw = (state.params.yaw as number) ?? 0;
                const roll = (state.params.roll as number) ?? 0;
                setBoneOverride(cfg.ikBone, [pitch, yaw, roll], 1, true, modelId);
            }
        }

        /** 启用时：每帧按当前参数重烤脚旋转覆盖 + 幂等注册位置偏移帧钩子 */
        const ensureActive = createEnsureActive(
            bake,
            _footFrameHooks,
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

                        const fx = (st.params.footPosX as number) ?? 0;
                        const fy = (st.params.footPosY as number) ?? 0;
                        const fz = (st.params.footPosZ as number) ?? 0;
                        if (fx === 0 && fy === 0 && fz === 0) {
                            // [fix P2] 归零时清除残留位置覆盖：此前直接 return 导致上一帧
                            // setBoneOverridePosition 写入的 slot.pos 残留（与 body-posture
                            // 同模式，round-P2 修复对齐），用户把 footPos 拖回 0 后脚不归位。
                            // [fix code_review P1] 仅当本模块写过非零位置才清整槽（clearBoneOverride
                            // 删除含旋转覆盖的整个槽，无条件清除会误伤旋转-only 用户）；
                            // 清后重建仅旋转槽（保留 bake 的 pitch/yaw/roll 语义）。
                            if (_footPosWritten.has(mid)) {
                                _footPosWritten.delete(mid);
                                clearBoneOverride(cfg.ikBone, mid);
                                const pitch = (st.params.pitch as number) ?? 0;
                                const yaw = (st.params.yaw as number) ?? 0;
                                const roll = (st.params.roll as number) ?? 0;
                                setBoneOverride(cfg.ikBone, [pitch, yaw, roll], 1, true, mid);
                            }
                            return;
                        }

                        setBoneOverridePosition(cfg.ikBone, [fx, fy, fz], 1, true, mid);
                        _footPosWritten.add(mid);
                    },
                    FRAME_HOOK_ORDER.FEET,
                    cfg.moduleId
                )
        );

        const base = createModuleBase(modelId, cfg.moduleId, DEFAULTS, bake, {
            action: ensureActive,
            onDisable: (mid) => {
                _footFrameHooks.unregister(mid);
            },
        }, actionId);

        return createModuleShell({
            id: cfg.moduleId,
            meta: META,
            priority: 8,
            managedBones,
            buildSchema: () => [
                {
                    id: `${cfg.moduleId}:pitch`,
                    kind: 'slider',
                    label: 'motion.foot.pitch',
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
                    label: 'motion.foot.yaw',
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
                    label: 'motion.foot.roll',
                    icon: 'lucide:rotate-cw',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.roll`,
                        min: -90,
                        max: 90,
                        step: 1,
                        onChange: (v) => base.setParam('roll', v as number),
                    },
                },
                // ── 位置偏移 ──
                {
                    id: `${cfg.moduleId}:posSection`,
                    kind: 'sectionTitle',
                    label: 'section.footPosition',
                },
                {
                    id: `${cfg.moduleId}:footPosX`,
                    kind: 'slider',
                    label: 'param.footPosX',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.footPosX`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('footPosX', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:footPosY`,
                    kind: 'slider',
                    label: 'param.footPosY',
                    icon: 'lucide:move-vertical',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.footPosY`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('footPosY', v as number),
                    },
                },
                {
                    id: `${cfg.moduleId}:footPosZ`,
                    kind: 'slider',
                    label: 'param.footPosZ',
                    icon: 'lucide:move',
                    control: {
                        bind: `motionModule.${cfg.moduleId}.footPosZ`,
                        min: -10,
                        max: 10,
                        step: 0.1,
                        onChange: (v) => base.setParam('footPosZ', v as number),
                    },
                },
            ],
            base,
        });
    };
}

// ── 导出 ──

export const LEFT_FOOT_DEF: ModuleDef = {
    id: 'left-foot',
    meta: {
        labelKey: 'motion.override.module.leftFoot',
        icon: 'lucide:footprints',
        defaults: { pitch: 0, yaw: 0, roll: 0, footPosX: 0, footPosY: 0, footPosZ: 0 },
    },
    priority: 8,
    factory: createFootModuleFactory({
        moduleId: 'left-foot',
        ikBone: '左足IK',
        labelKey: 'motion.override.module.leftFoot',
        icon: 'lucide:footprints',
    }),
};

export const RIGHT_FOOT_DEF: ModuleDef = {
    id: 'right-foot',
    meta: {
        labelKey: 'motion.override.module.rightFoot',
        icon: 'lucide:footprints',
        defaults: { pitch: 0, yaw: 0, roll: 0, footPosX: 0, footPosY: 0, footPosZ: 0 },
    },
    priority: 8,
    factory: createFootModuleFactory({
        moduleId: 'right-foot',
        ikBone: '右足IK',
        labelKey: 'motion.override.module.rightFoot',
        icon: 'lucide:footprints',
    }),
};
