// [doc:adr-116] Hand Symmetry Module — 手腕对称模块
// 职责: 左手首设值 → 右手首自动镜像（pitch/yaw 保持+偏移，roll 取反）
// 镜像规则: 左手首 [p, y, r] → 右手首 [p, y+offset, -r]
// 骨骼: 左手首/右手首（MMD 手腕关节骨，非前臂骨）
// 注意: 本模块仅控制手腕旋转，不涉及肘关节/前臂

import type { MenuNode } from '@/menus/menu-schema';
import type { ParamValue } from '@/core/types';
import { setBoneOverride } from '../bone-override';
import { registerModule, getModuleState, claimBones } from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';
import { createModuleBase } from './module-base';

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
};

/** 模块元信息 */
const META: ModuleMeta = {
    labelKey: 'motion.override.module.handSymmetry',
    icon: 'lucide:hand',
    defaults: DEFAULTS,
};

/** 管理的骨骼（仅手腕骨） */
const MANAGED_BONES = ['左手首', '右手首'];

/** 烘焙：左手设值；右手按 symmetry 决定镜像或独立 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const symmetry = (state.params.symmetry as boolean) ?? true;
    const pitch = (state.params.pitch as number) ?? 0;
    const yaw = (state.params.yaw as number) ?? 0;
    const roll = (state.params.roll as number) ?? 0;
    const mirrorOffset = (state.params.mirrorOffset as number) ?? 0;
    const rightPitch = (state.params.rightPitch as number) ?? 0;
    const rightYaw = (state.params.rightYaw as number) ?? 0;
    const rightRoll = (state.params.rightRoll as number) ?? 0;

    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);

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

/** 对外暴露的烘焙入口（供 UI 在 symmetry 切换后即时刷新） */
export function bakeHandSymmetry(modelId: string): void {
    bake(modelId);
}

/** 创建手腕对称模块实例 */
export function createHandSymmetryModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake);
    return {
        id: MODULE_ID,
        meta: META,
        priority: 1,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
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
            ];
        },

        getState: base.getState,
        setState: base.setState,
        setParam: base.setParam,
        enable: base.enable,
        disable: base.disable,
    };
}

/** 注册手腕对称模块 */
export function registerHandSymmetry(): void {
    registerModule(MODULE_ID, META, 1, createHandSymmetryModule);
}
