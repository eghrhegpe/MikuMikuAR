// [doc:architecture] Formatting helpers — pure text formatting leaves.
// Extracted from @/core/utils as part of ADR-191 de-barreling.

/**
 * 格式化秒数为 `MM:SS.CC` 字符串（分:秒.百分秒）。
 * 不限制分钟位数，便于显示超长时长。
 */
export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * 将任意错误值转换为人类可读字符串，带截断保护。
 * 识别 `LibraryLoadError` 结构化对象并附加 `[loadId/phase]` 前缀（ADR-135）。
 */
export function formatError(err: unknown, maxLen = 120): string {
    if (err === null || err === undefined) {
        return 'unknown error';
    }
    // [doc:adr-135] P0.2: 识别 LibraryLoadError 结构化对象，加 [loadId/phase] 前缀。
    // 用 structural type 判断（不 import 类型），避免本叶模块 → load-manager 依赖。
    if (typeof err === 'object' && (err as { name?: string }).name === 'LibraryLoadError') {
        const e = err as {
            loadId: string;
            phase: string;
            cause: unknown;
        };
        // 递归 formatError 取内层 cause 文本，给前缀留 30 字符空间
        const causeStr = formatError(e.cause, Math.max(20, maxLen - 30));
        const prefix = `[${e.loadId}/${e.phase}] `;
        const full = prefix + causeStr;
        return full.length > maxLen ? full.slice(0, maxLen - 3) + '...' : full;
    }
    if (err instanceof Error) {
        const msg = err.message;
        return msg.length > maxLen ? msg.slice(0, maxLen - 3) + '...' : msg;
    }
    if (typeof err === 'string') {
        return err.length > maxLen ? err.slice(0, maxLen - 3) + '...' : err;
    }
    try {
        const s = String(err);
        return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
    } catch {
        return 'unknown error';
    }
}
