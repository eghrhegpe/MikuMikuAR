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

// ======== Env Observer Request Registry ========
// [doc:adr-269 补充] 控制反转（IoC）。
//
// 子系统（env-sky / env-clouds / env-particles / env-ground / env-time-of-day）在自己的
// 创建/应用函数末尾需要「确保 env 每帧 observer 已挂载」。此前它们直接
// `import { ensureEnvUpdateObserver } from './env'`，形成「子系统 → 调度器」的向上依赖，
// 让 scene/env 内部 9 个文件互相可达（一个 SCC）。
//
// 改为请求式：调度器（env-impl）在模块顶层把挂载函数注册进来，子系统只发请求。
// dispatcher 本身只依赖 @/core/config，是 env 内部的叶子，不引入任何回边。

const _envObserverHandlers = new Set<() => void>();

/** 调度器注册「确保 observer 已挂载」处理函数（env-impl 在模块顶层调用）。 */
export function registerEnvObserverHandler(fn: () => void): () => void {
    _envObserverHandlers.add(fn);
    return () => {
        _envObserverHandlers.delete(fn);
    };
}

/** 子系统请求确保 env 每帧 observer 已挂载。幂等由处理函数自身保证。
 *  未注册处理函数时静默跳过（例如测试环境只加载了子系统）。 */
export function requestEnvObserver(): void {
    for (const fn of _envObserverHandlers) {
        try {
            fn();
        } catch (e) {
            console.warn('[env-dispatcher] observer request error:', e);
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

/** 执行所有已注册的场景 tick 回调（由 ensureEnvUpdateObserver 的 scene observer 每帧调用）。
 *  单个回调抛错不应中断同帧其他回调——与 dispatchEnvChange 防护标准对齐。 */
export function runSceneTickCallbacks(): void {
    for (const cb of _sceneTickCallbacks) {
        try {
            cb();
        } catch (e) {
            console.warn('[env-dispatcher] tick callback error:', e);
        }
    }
}

// ======== Env Dt Tick Callback Registry ========
// 区别于上面无参的 sceneTick：本注册表带 dt（秒），用于焦散/水波等需要时间累积的子系统。

type EnvDtTickCallback = (dt: number) => void;
const _envDtTickCallbacks = new Set<EnvDtTickCallback>();

/** 注册每帧 dt 回调（env-impl 每帧推 dt）。 */
export function registerEnvDtTickCallback(cb: EnvDtTickCallback): () => void {
    _envDtTickCallbacks.add(cb);
    return () => {
        _envDtTickCallbacks.delete(cb);
    };
}

/** 清空所有 dt 回调（场景销毁 / HMR 重入时清理）。 */
export function clearEnvDtTickCallbacks(): void {
    _envDtTickCallbacks.clear();
}

/** 执行所有 dt tick 回调（由 ensureEnvUpdateObserver 推 dt）。 */
export function runEnvDtTickCallbacks(dt: number): void {
    for (const cb of _envDtTickCallbacks) {
        try {
            cb(dt);
        } catch (e) {
            console.warn('[env-dispatcher] dt tick callback error:', e);
        }
    }
}
