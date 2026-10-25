// [doc:architecture] Pure collection / cache / promise helpers.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Zero dependencies: 仅使用原生 JS 类型，禁止 import 应用层模块。
// [audit:fix 2026-09] 例外：core/logger（自身零依赖叶子，环形日志面板）为批量失败可观测性引入。

import { logWarn } from '@/core/logger';

/** 确保值为数组；非数组则包裹为单元素数组。 */
export function ensureArray<T>(x: T | T[]): T[] {
    return Array.isArray(x) ? x : [x];
}

/** 按谓词过滤对象键，返回仅含满足条件键值对的新对象。 */
export function filterKeys<T extends object>(obj: T, pred: (key: keyof T) => boolean): Partial<T> {
    const result: Partial<T> = {};
    // [audit:fix 2026-10] 删除 nullish 死分支：T extends object 在类型面不含 null/undefined，
    // 全仓 grep 无生产调用点向 filterKeys 透传 null/undefined（仅本模块单测曾有 any-cast 用例，已同步删除），
    // 保留的守卫永远不可达，故删除。
    for (const key of Object.keys(obj) as (keyof T)[]) {
        if (pred(key)) {
            // 使用 defineProperty 而非 result[key] = ...，避免 "__proto__" 等键触发原型 setter 造成原型污染。
            Object.defineProperty(result, key as PropertyKey, {
                value: obj[key],
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
    }
    return result;
}

/** 轻量泛型缓存——Map 封装，统一 get/set/has/delete/clear 接口。 */
export class Cache<K, V> {
    private _map = new Map<K, V>();

    get(key: K): V | undefined {
        return this._map.get(key);
    }
    set(key: K, value: V): void {
        this._map.set(key, value);
    }
    has(key: K): boolean {
        return this._map.has(key);
    }
    delete(key: K): boolean {
        return this._map.delete(key);
    }
    clear(): void {
        this._map.clear();
    }
    get size(): number {
        return this._map.size;
    }
}

/**
 * 等待全部 promise 结束，仅返回 fulfilled 结果（rejected 被丢弃，返回值形状不变）。
 * 非 Promise 值会被 Promise.allSettled 当作已 fulfilled 的普通值；同步 throw 的 thenable 也会被收进 rejected。
 * 适用于"批量加载、尽力而为"场景。
 * [audit:fix 2026-09] 可选 onRejected：传入则逐条回调 (err, index, value)；缺省时保留原静默过滤行为，
 * 但 rejected>0 时打一条批次 logWarn（数量 + 首个错误摘要），恢复可观测性。
 */
export async function allSettledFilter<T>(
    promises: ReadonlyArray<T | PromiseLike<T>>,
    onRejected?: (err: unknown, index: number, value: unknown) => void
): Promise<PromiseFulfilledResult<Awaited<T>>[]> {
    const results = await Promise.allSettled(promises);
    let rejectedCount = 0;
    let hasFirst = false;
    let firstErr: unknown;
    if (onRejected) {
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                onRejected(r.reason, i, promises[i]);
            }
        });
    } else {
        results.forEach((r) => {
            if (r.status !== 'rejected') {
                return;
            }
            rejectedCount++;
            if (!hasFirst) {
                firstErr = r.reason;
                hasFirst = true;
            }
        });
        if (rejectedCount > 0) {
            logWarn(
                'collections',
                `allSettledFilter: ${rejectedCount}/${results.length} rejected, first: ${String(firstErr)}`
            );
        }
    }
    return results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled');
}
