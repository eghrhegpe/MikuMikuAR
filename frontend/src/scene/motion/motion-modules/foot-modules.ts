// [doc:adr-116 重构] Foot Modules — 左脚/右脚独立旋转+位置偏移控制模块
// 职责: 控制单侧足 IK 骨骼旋转（pitch/yaw/roll）+ 位置偏移（footPosX/Y/Z）。
// 与地面跟随引擎的关系: feet-adjustment.ts 每帧写 IK 目标骨骼的 position（Y 轴贴地），
// 本模块通过 bone-override 写 rotation + 帧钩子写 position offset。
// 帧管线顺序: 帧钩子(order=0) 先写偏移 → feet-adjustment(order=5) 再修正位置+重解 IK。

import type { ParamValue } from '@/core/types';
import { setBoneOverride, setBoneOverridePosition, registerBoneOverrideFrameHook } from '../bone-override';
import { getModuleState } from './registry';
import type { MotionOverrideModule, ModuleMeta, ModuleDef } from './types';
import { createModuleBase, createModuleShell, prepareBake, createFrameHookManager } from './module-base';

// ── 共享帧钩子管理器（左右脚共用一个 Map，按 modelId 注册一次）──

const _footFrameHooks = createFrameHookManager();

// ── 工厂函数 ──

interface FootSideConfig {
    moduleId: string;
    ikBone: string;
    labelKey: string;
    icon: string;
}

/** 创建左脚或右脚模块 */
function createFootModuleFactory(cfg: FootSideConfig) {
    return (modelId: string): MotionOverrideModule => {
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
            if (!prep) return;
            const { state, claimed } = prep;

            if (claimed.includes(cfg.ikBone)) {
                const pitch = (state.params.pitch as number) ?? 0;
                const yaw = (state.params.yaw as number) ?? 0;
                const roll = (state.params.roll as number) ?? 0;
                setBoneOverride(cfg.ikBone, [pitch, yaw, roll], 1, true, modelId);
            }
        }

        /** 启用时注册帧钩子，每帧写入位置偏移（在 feet-adjustment 之前执行） */
        function ensureActive(modelId: string): void {
            if (_footFrameHooks.has(modelId)) return;
            bake(modelId);

            const unregister = registerBoneOverrideFrameHook((_t, mid) => {
                if (mid !== modelId) return;
                const st = getModuleState(modelId, cfg.moduleId);
                if (!st.enabled) return;

                const fx = (st.params.footPosX as number) ?? 0;
                const fy = (st.params.footPosY as number) ?? 0;
                const fz = (st.params.footPosZ as number) ?? 0;
                if (fx === 0 && fy === 0 && fz === 0) return;

                setBoneOverridePosition(cfg.ikBone, [fx, fy, fz], 1, true, modelId);
            });
            _footFrameHooks.set(modelId, unregister);
        }

        const base = createModuleBase(modelId, cfg.moduleId, DEFAULTS, bake, {
            action: ensureActive,
            onDisable: (mid) => {
                _footFrameHooks.unregister(mid);
            },
        });

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
