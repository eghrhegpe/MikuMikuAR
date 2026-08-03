// [doc:adr-116] Module Base — 动作覆盖模块 boilerplate 工厂
// 职责: 抽取 7 个模块间重复的 getState/setState/setParam/enable/disable 模板代码
// 用法: 模块工厂内调用 createModuleBase(modelId, MODULE_ID, DEFAULTS, bake, overrides?)
// 返回 { getState, setState, setParam, enable, disable }，spread 到模块对象即可

import type { MenuNode } from '@/scene/shared/menu-node-types';
import type { MotionModuleState, ParamValue } from '@/core/types';
import {
    getModuleState,
    setModuleParam,
    releaseOwnedBones,
    getRegisteredModules,
    createModule,
    claimBones,
} from './registry';
import { pushHistory } from './motion-history';
import type { MotionOverrideModule, ModuleMeta } from './types';
// [doc:adr-122 P2] 在 module-base 暴露 IK 辅助函数，供新模块复用
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
     * 自定义 disable 前置钩子，在默认的 releaseOwnedBones（会级联清引擎槽）之前调用。
     * 用于 sway/riding 注销每帧钩子。
     */
    onDisable?: (modelId: string) => void;
    /** 跳过默认的 releaseOwnedBones（其会级联清引擎槽，用于不写引擎的模块） */
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
    overrides?: ModuleBaseOverrides,
    /** [fix:P2] UI 查看指定动作时传入，模块读写落到该动作而非激活动作 */
    actionId?: string
): ModuleBaseMethods {
    const doAction = overrides?.action ?? bake;
    const autoEnable = overrides?.autoEnableOnParam ?? true;

    /** 构建当前全量快照（所有模块的 enabled + params） */
    function buildSnapshot() {
        const snap: Record<
            string,
            { enabled: boolean; params: Record<string, import('@/core/types').ParamValue> }
        > = {};
        for (const mod of getRegisteredModules()) {
            const ms = getModuleState(modelId, mod.id, actionId);
            snap[mod.id] = { enabled: ms.enabled, params: { ...ms.params } };
        }
        return snap;
    }

    return {
        getState(): MotionModuleState {
            const state = getModuleState(modelId, moduleId, actionId);
            return {
                id: moduleId,
                enabled: state.enabled,
                params: { ...defaults, ...state.params },
            };
        },

        setState(s: MotionModuleState): void {
            const state = getModuleState(modelId, moduleId, actionId);
            state.enabled = s.enabled;
            state.params = { ...s.params };
        },

        setParam(name: string, value: ParamValue): void {
            const st = getModuleState(modelId, moduleId, actionId);
            const prev = st.params[name] ?? defaults[name];
            if (prev !== value) {
                pushHistory(modelId, moduleId, name, prev, value, buildSnapshot);
            }
            setModuleParam(modelId, moduleId, name, value, actionId);
            if (autoEnable) {
                const cur = getModuleState(modelId, moduleId, actionId);
                if (!cur.enabled) {
                    cur.enabled = true;
                }
            }
            doAction(modelId);
        },

        enable(): void {
            const state = getModuleState(modelId, moduleId, actionId);
            state.enabled = true;
            doAction(modelId);
        },

        disable(): void {
            const state = getModuleState(modelId, moduleId, actionId);
            state.enabled = false;
            overrides?.onDisable?.(modelId);
            if (!overrides?.skipBonesCleanup) {
                // [doc:adr-147 Phase 2 step 2] store.releaseBones 已级联清引擎槽
                // （onClearEngineSlot → clearBoneOverride），此处不再双清，避免重复调用断言破。
                releaseOwnedBones(modelId, moduleId);
            }
        },
    };
}

/**
 * [doc:adr-125] 将快照应用到指定模型的所有模块。
 * 空对象 {} 表示恢复到初始状态（所有模块禁用 + 空 params）。
 */
export function applyModuleSnapshot(
    modelId: string,
    snapshot: Record<string, { enabled: boolean; params: Record<string, ParamValue> }>
): void {
    for (const [moduleId, state] of Object.entries(snapshot)) {
        const mod = createModule(moduleId, modelId);
        if (!mod) {
            continue;
        }
        mod.setState({ id: moduleId, ...state });
        if (state.enabled) {
            mod.enable();
        } else {
            mod.disable();
        }
    }
    for (const mod of getRegisteredModules()) {
        if (!(mod.id in snapshot)) {
            const inst = createModule(mod.id, modelId);
            const cur = getModuleState(modelId, mod.id);
            if (cur.enabled) {
                inst?.disable();
            }
        }
    }
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

/** 帧钩子管理器的返回类型（供 createEnsureActive 复用） */
export type FrameHookManager = ReturnType<typeof createFrameHookManager>;

/**
 * [doc:adr-146 P3] ensureActive 公共工厂 — 消除 body-posture/foot/hand 复制粘贴的
 * 「先 bake 重烤、再幂等注册帧钩子」模式。
 *
 * 该模式是 91dbe42a 同源 bug 的根因：早期实现把 `if (hooks.has) return;` 写在 `bake` 之前，
 * 导致首次启用后静态参数（旋转/预设）永远冻结、拖滑块无效果。本工厂把**正确顺序固化**：
 *   1. 每次 setParam / enable 都先 `bake(modelId)` 按当前参数重烤静态覆盖；
 *   2. 仅对帧钩子注册做幂等保护（已注册则跳过，避免重复注册）。
 *
 * 用法:
 *   const ensureActive = createEnsureActive(
 *     bake,                                       // 写静态骨骼覆盖（旋转/预设）
 *     _frameHooks,                                // 模块自身的 createFrameHookManager() 实例
 *     (modelId) => registerBoneOverrideFrameHook(hookFn, ORDER, SRC)  // 返回 unregister
 *   );
 *   // onDisable 仍由模块负责幂等清理：onDisable: (mid) => _frameHooks.unregister(mid)
 *
 * 注意：riding-model 因 autoPedal 需动态注册/注销钩子，逻辑特殊，不套用本工厂。
 */
export function createEnsureActive(
    bake: (modelId: string) => void,
    hookManager: FrameHookManager,
    registerHook: (modelId: string) => () => void
): (modelId: string) => void {
    return (modelId: string) => {
        const hadHook = hookManager.has(modelId);
        // 每次都按当前参数重烤静态覆盖（旋转/预设）；帧钩子注册才需幂等保护。
        bake(modelId);
        if (hadHook) {
            return;
        }
        hookManager.set(modelId, registerHook(modelId));
    };
}

/**
 * [doc:adr-146 P3 主题12] 模块实例外壳 — 消除 6 个工厂末尾重复的
 * `id/meta/priority/managedBones/buildSchema + getState/setState/setParam/enable/disable` spread。
 * 工厂只需提供 base（createModuleBase 返回值）+ buildSchema 闭包（捕获 modelId）。
 */
export interface ModuleShellConfig {
    id: string;
    meta: ModuleMeta;
    priority: number;
    managedBones: string[];
    /** buildSchema 闭包，捕获 modelId，返回该模型的 MenuNode[] */
    buildSchema: () => MenuNode[];
    base: ModuleBaseMethods;
}

export function createModuleShell(cfg: ModuleShellConfig): MotionOverrideModule {
    return {
        id: cfg.id,
        meta: cfg.meta,
        priority: cfg.priority,
        managedBones: cfg.managedBones,
        buildSchema: cfg.buildSchema,
        getState: cfg.base.getState,
        setState: cfg.base.setState,
        setParam: cfg.base.setParam,
        enable: cfg.base.enable,
        disable: cfg.base.disable,
    };
}

/**
 * [doc:adr-146 P3 主题13] bake 头部守卫 — 消除 6 个 bake 重复的
 * `getModuleState + enabled 守卫 + claimBones` 模板。
 * 返回 null 时调用方提前 return；否则返回 state（含 params）与 claimed 骨骼列表。
 */
export function prepareBake(
    modelId: string,
    moduleId: string,
    bones: readonly string[]
): { state: MotionModuleState; claimed: string[] } | null {
    const state = getModuleState(modelId, moduleId);
    if (!state.enabled) {
        return null;
    }
    const claimed = claimBones(modelId, moduleId, bones);
    return { state, claimed };
}

// [doc:adr-238] 注册模块快照应用供 core/快捷键层经 scene-action-bridge 调用
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('applyModuleSnapshot', (moduleId: string, snap: unknown) => {
    applyModuleSnapshot(moduleId, snap as Parameters<typeof applyModuleSnapshot>[1]);
});
