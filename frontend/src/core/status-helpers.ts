// [doc:architecture] Status-bar / feedback wrappers for async operations.
// Extracted from @/core/utils as part of ADR-191 de-barreling.

import { setStatus } from './status-bar';
import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
import { logWarn } from './logger';
import { feedbackStatus, feedbackInfo, feedbackError } from './feedback';

/**
 * Execute a function with automatic error handling that shows errors in the status bar.
 * Returns the result of the function, or undefined if an error occurred.
 *
 * @param fn - The function to execute (can be async or sync)
 * @param context - Description of what was being attempted (e.g. "加载模型")
 * @param onError - Optional callback invoked when an error occurs (for recovery logic)
 * @returns The function result, or undefined on error
 */
export async function tryCatchStatus<T>(
    fn: () => T | Promise<T>,
    context: string,
    onError?: (err: unknown) => void
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        const msg = translateGoError(err);
        // 用户取消文件选择 — Wails 抛 "cancelled by user"，静默忽略
        if (/cancelled by user/i.test(msg)) {
            return undefined;
        }
        setStatus(`${context}: ${msg}`, false);
        logWarn(context, '', err);
        onError?.(err);
        return undefined;
    }
}

/**
 * 包装一个异步操作，自动管理 loading → success → error 三态状态栏。
 *
 * - 开始时：setStatus(t(loadingKey), false)
 * - 成功时：setStatus(t(successKey), true)，并返回结果
 * - 错误时：setStatus(t(loadingKey) + 错误信息, false)，静默忽略用户取消
 *
 * 不集成 LoadingGuard / AbortSignal —— 调用方按需自行处理。
 * [ADR-142]
 */
export async function withLoadingStatus<T>(
    loadingKey: string,
    successKey: string,
    fn: () => T | Promise<T>
): Promise<T | undefined> {
    setStatus(t(loadingKey), false);
    try {
        const result = await fn();
        setStatus(t(successKey), true);
        return result;
    } catch (err) {
        const msg = translateGoError(err);
        // 用户取消文件选择 — Wails 抛 "cancelled by user"，静默忽略
        if (/cancelled by user/i.test(msg)) {
            return undefined;
        }
        setStatus(`${t(loadingKey)}: ${msg}`, false);
        logWarn(loadingKey, '', err);
        return undefined;
    }
}

/**
 * 包装异步操作并附带目标名（target-aware 版本）。
 * 标题自动附加「— {target}」，让用户明确知道是哪个文件/模型。
 *
 * @param loadingKey   — 加载时的 i18n key
 * @param successKey   — 成功时的 i18n key
 * @param target       — 目标名（文件名/路径），undefined 则不附加
 * @param fn           — 实际操作函数
 */
export async function withLoadingStatusTargeted<T>(
    loadingKey: string,
    successKey: string,
    target: string | undefined,
    fn: () => T | Promise<T>
): Promise<T | undefined> {
    feedbackStatus(loadingKey, target);
    try {
        const result = await fn();
        feedbackInfo(successKey, target);
        return result;
    } catch (err) {
        const msg = translateGoError(err);
        if (/cancelled by user/i.test(msg)) {
            return undefined;
        }
        feedbackError(loadingKey + 'Failed', target, err);
        logWarn(loadingKey, '', err);
        return undefined;
    }
}
