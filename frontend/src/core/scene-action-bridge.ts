// scene-action-bridge.ts — [doc:adr-238] 场景动作注入桥（纯叶子，零依赖）。
// 切断 core/action-defs → scene/* 反向依赖：
//   - scene 侧（scene/actions-init.ts）启动时注册场景基础操作
//   - core/action-defs 的 execute 闭包经本桥调用，不静态 import scene
// 与 ui-action-bridge 同模式：core 持注入点，scene 层注册，方向单向。
// 分字段注册（registerSceneAction），支持各场景模块独立注册。

export interface SceneActions {
    /** 更新环境状态（env-actions 的 bind-* 纹理绑定） */
    setEnvState: (partial: Record<string, unknown>) => void;
}

const _sceneActions = new Map<keyof SceneActions, unknown>();

/** 注册单个场景操作（scene 侧启动时调用） */
export function registerSceneAction<K extends keyof SceneActions>(
    key: K,
    fn: SceneActions[K]
): void {
    _sceneActions.set(key, fn);
}

/** 读取单个场景操作（core/action-defs 侧调用；未注册返回 undefined） */
export function getSceneAction<K extends keyof SceneActions>(
    key: K
): SceneActions[K] | undefined {
    return _sceneActions.get(key) as SceneActions[K] | undefined;
}
