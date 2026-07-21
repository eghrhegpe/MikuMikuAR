// safe-call.ts — 统一「吞错并 logWarn」的散点模式（ADR-146 主题2）
//
// 替代项目中大量 `try { fn() } catch (err) { logWarn(tag, msg, err) }` 与
// `promise.catch((err) => logWarn(tag, msg, err))` 手写重复。
//
// 与 utils.ts 的 `swallowError` 区别：`swallowError` 固定 tag 'swallow' 且丢失
// 原始 tag/msg 上下文；本三件套保留调用方传入的 tag/msg，便于按模块聚合排查。
//
// 用法：
//   import { safeCall, safeCallVoid, safeCallAsync } from '@/core/safe-call';
//
//   const v = safeCall('audio', 'decode', () => decode(buf));        // 同步，返回 T | undefined
//   safeCallVoid('physics', 'step', () => step(dt));                  // 同步，无返回值
//   safeCallAsync('init', 'Library init', () => initLibrary());      // 异步，Promise<T | undefined>

import { logWarn } from './logger';

/**
 * 安全执行同步函数；异常时记录 logWarn(tag, msg, err) 并返回 undefined。
 * 仅用于 catch 块「只 logWarn、无其它副作用、无返回值依赖」的纯吞错场景。
 */
export function safeCall<T>(tag: string, msg: string, fn: () => T): T | undefined {
    try {
        return fn();
    } catch (err) {
        logWarn(tag, msg, err);
        return undefined;
    }
}

/** 同 safeCall，但 fn 无返回值。 */
export function safeCallVoid(tag: string, msg: string, fn: () => void): void {
    try {
        fn();
    } catch (err) {
        logWarn(tag, msg, err);
    }
}

/**
 * 安全执行异步函数；异常时记录 logWarn(tag, msg, err)，返回的 Promise 解析为
 * undefined（不 reject），等价于 `promise.catch((err) => logWarn(tag, msg, err))`。
 *
 * 注意：不传播 rejection，调用方不应再依赖其结果值；不保留 tag/msg 之外的上下文。
 */
export function safeCallAsync<T>(
    tag: string,
    msg: string,
    fn: () => Promise<T>
): Promise<T | undefined> {
    return fn().then(
        (v) => v,
        (err) => {
            logWarn(tag, msg, err);
            return undefined;
        }
    );
}
