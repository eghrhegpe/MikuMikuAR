// env-dispatcher.ts — 纯调度层，无状态
//
// 目的：破除 env-bridge ↔ env-impl/env-water 的循环依赖。
// env-bridge 只 import dispatcher，不 import env-impl/env-water。
// 各子系统通过 registerEnvCallback 注册响应回调，变化发生时由 dispatchEnvChange 统一调度。
//
// [ADR-138] env-dispatcher 破循环依赖
//
// 使用方式：
//   子系统初始化时：registerEnvCallback((changed, state) => { ... })
//   env-bridge 在变化发生时：dispatchEnvChange(changedKeys, envState)
//
// 也包含场景 tick 回调注册表（从 env-context 迁入），供 time-of-day 等模块使用。

import { EnvState } from '@/core/config';

// ======== Env Change Callback Registry ========

type EnvCallback = (changed: Set<string> | null, state: EnvState) => void;

const _callbacks = new Set<EnvCallback>();

/** 子系统注册响应回调（延迟绑定，避免循环导入）。
 *  返回的清理函数在 dispose 时调用，避免泄漏。 */
export function registerEnvCallback(fn: EnvCallback): () => void {
    _callbacks.add(fn);
    return () => {
        _callbacks.delete(fn);
    };
}

/** 清空所有已注册的 env 回调（场景销毁 / HMR 重入时兜底清理）。 */
export function clearAllEnvCallbacks(): void {
    _callbacks.clear();
}

/** setEnvState 调用此函数分发变化。
 *  @param changed — 发生变化的 key 集合，null 表示全量分发
 *  @param state — 当前完整 envState */
export function dispatchEnvChange(changed: Set<string> | null, state: EnvState): void {
    for (const cb of _callbacks) {
        try {
            cb(changed, state);
        } catch (e) {
            console.warn('[env-dispatcher] callback error:', e);
        }
    }
}

// ======== Scene Tick Callback Registry ========
// 从 env-context 迁入，使 env-bridge 无需 import env-impl 即可注册 tick 回调。

const _sceneTickCallbacks = new Set<() => void>();

/** 注册场景每帧 tick 回调。返回的清理函数在 dispose 时调用。 */
export function registerSceneTickCallback(cb: () => void): () => void {
    _sceneTickCallbacks.add(cb);
    return () => _sceneTickCallbacks.delete(cb);
}

/** 清空所有场景 tick 回调（场景销毁 / HMR 重入时清理）。 */
export function clearSceneTickCallbacks(): void {
    _sceneTickCallbacks.clear();
}

/** 执行所有已注册的场景 tick 回调（由 ensureEnvUpdateObserver 的 scene observer 每帧调用）。 */
export function runSceneTickCallbacks(): void {
    for (const cb of _sceneTickCallbacks) {
        cb();
    }
}