// [doc:adr-116] Module Base — 动作覆盖模块 boilerplate 工厂
// 职责: 抽取 7 个模块间重复的 getState/setState/setParam/enable/disable 模板代码
// 用法: 模块工厂内调用 createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, overrides?)
// 返回 { getState, setState, setParam, enable, disable }，spread 到模块对象即可

import type { MotionModuleState, ParamValue } from '@/core/types';
import { clearBoneOverride } from '../bone-override';
import {
    getModuleState,
    setModuleParam,
    releaseOwnedBones,
} from './registry';
import type { MotionOverrideModule } from './types';

/** createModuleBase 返回的方法子集（与 MotionOverrideModule 对应方法签名一致） */
export type ModuleBaseMethods = Pick<
    MotionOverrideModule,
    'getState' | 'setState' | 'setParam' | 'enable' | 'disable'
>;

/** 模块基础行为覆盖 */
export interface ModuleBaseOverrides {
    /**
     * 自定义动作（替代默认的 bake），用于 setParam 和 enable 的最终步骤。
     * 默认：bake(modelId)
     */
    action?: (modelId: string) => void;
    /**
     * 自定义 disable 前置钩子，在默认的 releaseOwnedBones + clearBoneOverride 之前调用。
     * 用于 sway/riding 注销每帧钩子。
     */
    onDisable?: (modelId: string) => void;
    /** 跳过默认的 releaseOwnedBones + clearBoneOverride（用于不写引擎的模块） */
    skipBonesCleanup?: boolean;
    /** 在 setParam 时自动启用模块（默认 true，VRChat 行为） */
    autoEnableOnParam?: boolean;
}

/**
 * 创建模块通用方法，减少 7 个模块间 ~105 行重复 boilerplate。
 *
 * @param modelId  目标模型 ID
 * @param moduleId 模块标识（与 registry 注册一致）
 * @param defaults 模块参数默认值
 * @param bake     烘焙函数（语义参数 → setBoneOverride）
 * @param overrides 可选行为覆盖
 */
export function createModuleBase(
    modelId: string,
    moduleId: string,
    defaults: Record<string, ParamValue>,
    bake: (modelId: string) => void,
    overrides?: ModuleBaseOverrides
): ModuleBaseMethods {
    const doAction = overrides?.action ?? bake;
    const autoEnable = overrides?.autoEnableOnParam ?? true;

    return {
        getState(): MotionModuleState {
            const state = getModuleState(modelId, moduleId);
            return {
                id: moduleId,
                enabled: state.enabled,
                params: { ...defaults, ...state.params },
            };
        },

        setState(s: MotionModuleState): void {
            const state = getModuleState(modelId, moduleId);
            state.enabled = s.enabled;
            state.params = { ...s.params };
        },

        setParam(name: string, value: ParamValue): void {
            setModuleParam(modelId, moduleId, name, value);
            if (autoEnable) {
                const st = getModuleState(modelId, moduleId);
                if (!st.enabled) {
                    st.enabled = true;
                }
            }
            doAction(modelId);
        },

        enable(): void {
            const state = getModuleState(modelId, moduleId);
            state.enabled = true;
            doAction(modelId);
        },

        disable(): void {
            const state = getModuleState(modelId, moduleId);
            state.enabled = false;
            overrides?.onDisable?.(modelId);
            if (!overrides?.skipBonesCleanup) {
                const bones = releaseOwnedBones(modelId, moduleId);
                for (const bone of bones) {
                    clearBoneOverride(bone, modelId);
                }
            }
        },
    };
}

/**
 * [doc:adr-116 P3] 帧钩子管理器 — 消除 sway/riding 的 _xxxFrameHooks Map 重复模式。
 * 封装 per-model 帧钩子注册/注销，确保 disable 时精准清除。
 *
 * 用法:
 *   const hooks = createFrameHookManager();
 *   // ensureActive: hooks.set(modelId, registerBoneOverrideFrameHook(...));
 *   // onDisable:    hooks.unregister(modelId);
 */
export function createFrameHookManager() {
    const _hooks = new Map<string, () => void>();

    return {
        /** 注册钩子并记录到 Map */
        set(modelId: string, unregister: () => void): void {
            _hooks.set(modelId, unregister);
        },
        /** 注销指定模型的钩子并清理 Map 条目 */
        unregister(modelId: string): void {
            const fn = _hooks.get(modelId);
            if (fn) {
                fn();
                _hooks.delete(modelId);
            }
        },
        /** 是否已注册 */
        has(modelId: string): boolean {
            return _hooks.has(modelId);
        },
    };
}