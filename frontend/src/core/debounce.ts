/**
 * 函数防抖：在等待指定时间后才执行函数，如果在等待期间再次调用则重置计时器。
 *
 * @param fn 要防抖的函数
 * @ms 延迟时间（毫秒）
 * @returns 防抖后的函数，带有 cancel() 方法取消 pending 调用
 */
export function debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    ms: number
): {
    (...args: A): void;
    cancel(): void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = (...args: A): void => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        // [audit:fix 2026-10] NaN 入口归一为 0：setTimeout 本会把 NaN 强转 0ms 立即执行（意外行为）；
        // 显式收口语义——仅 NaN 视为 0，Infinity 保留「永不执行」的合法语义（负数 setTimeout 本就按 0 处理，不动）。
        const delay = Number.isNaN(ms) ? 0 : ms;
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delay);
    };
    debounced.cancel = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return debounced;
}
