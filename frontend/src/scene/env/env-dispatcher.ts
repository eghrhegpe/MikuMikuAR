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

import { EnvState } from '@/core/config';

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