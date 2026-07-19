// [doc:architecture] 轻量日志工具 — 无依赖模块，不引入循环依赖。
//
// 从 utils.ts 拆分而来（ADR-141），消除 state ↔ utils 循环依赖。
// 所有模块都应通过此文件 import logWarn，而非从 utils.ts 导入。

/** 统一标签格式的 info 日志（走 console.info）。 */
export function logInfo(tag: string, message: string, ...args: unknown[]): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    if (args.length > 0) {
        console.info(prefix, ...args);
    } else {
        console.info(prefix);
    }
}

/** 统一标签格式的 warn 日志。message 为空时省略中间空格；err 为空时不传第二个参数。 */
export function logWarn(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    if (err !== undefined) {
        console.warn(prefix, err);
    } else {
        console.warn(prefix);
    }
}

/** 统一标签格式的 error 日志（走 console.error）。 */
export function logError(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    if (err !== undefined) {
        console.error(prefix, err);
    } else {
        console.error(prefix);
    }
}
