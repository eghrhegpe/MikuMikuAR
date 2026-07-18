// [doc:adr-116] Sway Motion Module — 摇摆运动模块
// 职责: 全身根骨骼（センター）实时正弦驱动，产生周期性左右摇摆
// 优先级 P3=3（低于 body-posture/position-offset）
//
// 实时驱动（P3 已落地，经 bone-override 每帧钩子）:
//   yaw(t) = amplitude * (1 - decay) * sin(2π·frequency·t)
//   - amplitude: 摇摆幅度（度，0-15），峰值 yaw
//   - frequency: 摇摆频率（Hz，0.1-2），决定正弦周期（实时生效）
//   - decay: 幅度衰减系数（0-1），1=无摇摆（实时生效）
//
// 与 position-offset 共享 センター：若 position-offset 占用 センター（更高优先级），
// 本模块每帧钩子自动让位（见钩子内 getOwnedBones 判定），两者不互相踩踏。

import type { MenuNode } from '@/menus/menu-schema';
import type { ParamValue } from '@/core/types';
import { setBoneOverride, registerBoneOverrideFrameHook } from '../bone-override';
import {
    registerModule,
    getModuleState,
    claimBones,
    getOwnedBones,
    isBoneOwnedByOther,
} from './registry';
import type { MotionOverrideModule, ModuleMeta } from './types';
import { computeSwayYaw } from './motion-math';
import { createModuleBase, createFrameHookManager } from './module-base';

const MODULE_ID = 'sway-motion';

/** [doc:adr-116 P3] 每模型每帧正弦钩子管理器 */
const _swayFrameHooks = createFrameHookManager();

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
 * 烘焙：建立 センター 所有权（优先级低于 position-offset → 被其占用时让位）并写入初始静态峰值姿态。
 * 实时正弦由 ensureActive 注册的每帧钩子接管（frequency/decay 真正生效）。
 */
function bake(modelId: string): void {
    const state = getModuleState(modelId, MODULE_ID);
    if (!state.enabled) {
        return;
    }
    const claimed = claimBones(modelId, MODULE_ID, MANAGED_BONES);
    if (claimed.includes('センター')) {
        // 初始静态峰值姿态；帧钩子随后每帧覆盖为动态振荡值
        const amplitude = (state.params.amplitude as number) ?? 5;
        setBoneOverride('センター', [0, amplitude, 0], 1, true, modelId);
    }
}

/**
 * [doc:adr-116 P3] 确保每帧正弦钩子已注册。
 * enable / setParam 都必须调用：否则仅拖滑块（setParam 自动启用）却不注册钩子，
 * 会导致 frequency/decay 改了但画面不动。
 * 让位判定：センター 被其他模块（position-offset，优先级更高）占用时让出，不争抢；
 * 一旦其释放则重新认领，使摇摆在 position-offset 关闭后自动恢复。
 */
function ensureActive(modelId: string): void {
    // [doc:adr-116 P2] 钩子已注册即 ownership 已建立，高频 setParam（拖滑块）直接 return，
    // 避免每帧级 claimBones 冗余调用；新参数由帧钩子每帧读取 st.params 实时生效。
    if (_swayFrameHooks.has(modelId)) {
        return;
    }
    bake(modelId); // 仅在首次建立所有权 + 初始静态姿态
    const unregister = registerBoneOverrideFrameHook((t, mid) => {
        if (mid !== modelId) {
            return;
        }
        const st = getModuleState(modelId, MODULE_ID);
        if (!st.enabled) {
            return;
        }
        // 让位判定：未拥有 センター 时，若被其他模块占用则让出；否则重新认领
        if (!getOwnedBones(modelId, MODULE_ID).has('センター')) {
            if (isBoneOwnedByOther(modelId, MODULE_ID, 'センター')) {
                return;
            }
            claimBones(modelId, MODULE_ID, MANAGED_BONES);
            if (!getOwnedBones(modelId, MODULE_ID).has('センター')) {
                return;
            }
        }
        const amp = (st.params.amplitude as number) ?? 5;
        const freq = (st.params.frequency as number) ?? 0.5;
        const decay = (st.params.decay as number) ?? 0.3;
        // yaw(t) = amplitude * (1 - decay) * sin(2π·frequency·t)
        const yaw = computeSwayYaw(amp, decay, freq, t);
        setBoneOverride('センター', [0, yaw, 0], 1, true, modelId);
    });
    _swayFrameHooks.set(modelId, unregister);
}

/** 创建摇摆运动模块实例 */
export function createSwayMotionModule(modelId: string): MotionOverrideModule {
    const base = createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, {
        action: ensureActive,
        onDisable: (mid) => {
            _swayFrameHooks.unregister(mid);
        },
    });
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
                            base.setParam('amplitude', v as number);
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
                            base.setParam('frequency', v as number);
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
                            base.setParam('decay', v as number);
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

/** 注册摇摆运动模块 */
export function registerSwayMotion(): void {
    registerModule(MODULE_ID, META, 3, createSwayMotionModule);
}
