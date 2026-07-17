// [doc:adr-116] Sway Motion Module — 摇摆运动模块
// 职责: 全身根骨骼（センター）正弦驱动，产生周期性左右摇摆
// 优先级 P3=3（低于 body-posture/head-tracking）
//
// 烘焙策略:
//   - amplitude: 摇摆幅度（度，0-15），作用于 センター yaw
//   - frequency: 摇摆频率（Hz，0.1-2），决定正弦周期
//   - decay: 衰减系数（0-1），控制摇摆从中心向两端递减
//
// 注意: 本模块在 setParam 时写入静态角度采样（frequency=1Hz 时的峰值），
//   实时正弦驱动需 P3+ 引擎扩展（onBeforeRenderObservable 时间维度写入），
//   当前作为「姿态偏置」烘焙，与 body-posture 共享 センター 骨骼（claimBones 仲裁）

import type { MenuNode } from '@/menus/menu-schema';
import type { MotionModuleState, ParamValue } from '@/core/types';
import { setBoneOverride, clearBoneOverride } from '../bone-override';
import {
    registerModule,
    getModuleState,
    setModuleParam,
    claimBones,
    releaseOwnedBones,
} from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';

const MODULE_ID = 'sway-motion';

/** 默认参数 */
const DEFAULTS: Record<string, ParamValue> = {
    amplitude: 5, // 摇摆幅度（度）: 0-15
    frequency: 0.5, // 摇摆频率（Hz）: 0.1-2
    decay: 0.3, // 衰减系数: 0-1
};

const META: ModuleMeta = {
    labelKey: 'motion.override.module.swayMotion',
    icon: 'lucide:wind',
    defaults: DEFAULTS,
};

/** 管理的骨骼（センター yaw 摇摆） */
const MANAGED_BONES = ['センター'];

/**
 * 烘焙：将语义参数写入引擎。
 * 当前实现：写入 amplitude 作为静态 yaw 偏置（峰值姿态）。
 * 实时正弦驱动需引擎扩展，预留 P3+。
 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const amplitude = (state.params.amplitude as number) ?? 5;
    // frequency/decay 当前不参与静态烘焙，预留引擎扩展读取
    // 静态烘焙写入 amplitude 作为 yaw 偏置（正弦峰值）
    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.includes('センター')) {
        // [0, amplitude, 0] = pitch=0, yaw=amplitude, roll=0
        setBoneOverride('センター', [0, amplitude, 0], 1, true, modelId);
    }
}

/** 创建摇摆运动模块实例 */
export function createSwayMotionModule(modelId: string): MotionOverrideModule {
    return {
        id: MODULE_ID,
        meta: META,
        priority: 3,
        managedBones: MANAGED_BONES,

        buildSchema(): MenuNode[] {
            return [
                {
                    id: 'sway-motion:amplitude',
                    kind: 'slider',
                    label: 'motion.amplitude',
                    icon: 'lucide:move-horizontal',
                    control: {
                        bind: `motionModule.${MODULE_ID}.amplitude`,
                        min: 0,
                        max: 15,
                        step: 0.5,
                        onChange: (v) => {
                            createSwayMotionModule(modelId).setParam('amplitude', v as number);
                        },
                    },
                },
                {
                    id: 'sway-motion:frequency',
                    kind: 'slider',
                    label: 'motion.frequency',
                    icon: 'lucide:activity',
                    control: {
                        bind: `motionModule.${MODULE_ID}.frequency`,
                        min: 0.1,
                        max: 2,
                        step: 0.1,
                        onChange: (v) => {
                            createSwayMotionModule(modelId).setParam('frequency', v as number);
                        },
                    },
                },
                {
                    id: 'sway-motion:decay',
                    kind: 'slider',
                    label: 'motion.decay',
                    icon: 'lucide:trending-down',
                    control: {
                        bind: `motionModule.${MODULE_ID}.decay`,
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            createSwayMotionModule(modelId).setParam('decay', v as number);
                        },
                    },
                },
            ];
        },

        getState(): MotionModuleState {
            const state = getModuleState(modelId, MODULE_ID);
            return {
                id: MODULE_ID,
                enabled: state.enabled,
                params: { ...DEFAULTS, ...state.params },
            };
        },

        setState(s: MotionModuleState): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = s.enabled;
            state.params = { ...s.params };
        },

        setParam(name: string, value: ParamValue): void {
            setModuleParam(modelId, MODULE_ID, name, value);
            const st = getModuleState(modelId, MODULE_ID);
            if (!st.enabled) {
                st.enabled = true;
            }
            bake(modelId);
        },

        enable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = true;
            bake(modelId);
        },

        disable(): void {
            const state = getModuleState(modelId, MODULE_ID);
            state.enabled = false;
            const bones = releaseOwnedBones(modelId, MODULE_ID);
            for (const bone of bones) {
                clearBoneOverride(bone, modelId);
            }
        },
    };
}

/** 注册摇摆运动模块 */
export function registerSwayMotion(): void {
    registerModule(MODULE_ID, META, 3, createSwayMotionModule);
}
