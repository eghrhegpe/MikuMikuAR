// [doc:architecture] 轻量日志工具 — 无依赖模块，不引入循环依赖。
//
// 从 utils.ts 拆分而来（ADR-141），消除 state ↔ utils 循环依赖。
// 所有模块都应通过此文件 import logWarn，而非从 utils.ts 导入。
//
// [ADR-248] 日志缓冲区：避免 console.warn 的 source map 展开导致卡顿。
// 使用环形缓冲区存储最近 N 条日志，通过 DOM 调试面板查看。

export interface LogEntry {
    tag: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    time: number;
}

/** 环形日志缓冲区（避免 console source map 卡顿） */
class LogBuffer {
    private buffer: LogEntry[] = [];
    private maxSize: number;
    private _listeners = new Set<() => void>();

    constructor(maxSize = 200) {
        this.maxSize = maxSize;
    }

    push(entry: LogEntry): void {
        this.buffer.push(entry);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
        this._listeners.forEach((fn) => fn());
    }

    getAll(): LogEntry[] {
        return this.buffer;
    }

    clear(): void {
        this.buffer = [];
        this._listeners.forEach((fn) => fn());
    }

    subscribe(fn: () => void): () => void {
        this._listeners.add(fn);
        return () => {
            this._listeners.delete(fn);
        };
    }
}

// 全局日志缓冲区（默认保留最近 200 条）
const _logBuffer = new LogBuffer(200);

/** 是否同时输出到 console（默认 true，面板打开后可切到 OFF 避免 source map 卡顿） */
let _consoleOutput = true;

/** 设置是否同时输出到 console */
export function setConsoleOutput(enabled: boolean): void {
    _consoleOutput = enabled;
}

/** 获取日志缓冲区（供调试面板使用） */
export function getLogBuffer(): LogBuffer {
    return _logBuffer;
}

/** 清空日志 */
export function clearLogs(): void {
    _logBuffer.clear();
}

/** 统一标签格式的 info 日志。 */
export function logInfo(tag: string, message: string, ...args: unknown[]): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    _logBuffer.push({ tag, level: 'info', message: prefix, time: Date.now() });
    if (_consoleOutput) {
        if (args.length > 0) {
            console.info(prefix, ...args);
        } else {
            console.info(prefix);
        }
    }
}

/** 统一标签格式的 warn 日志。 */
export function logWarn(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    _logBuffer.push({ tag, level: 'warn', message: prefix, time: Date.now() });
    if (_consoleOutput) {
        if (err !== undefined) {
            console.warn(prefix, err);
        } else {
            console.warn(prefix);
        }
    }
}

/** 统一标签格式的 error 日志。 */
export function logError(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    _logBuffer.push({ tag, level: 'error', message: prefix, time: Date.now() });
    if (_consoleOutput) {
        if (err !== undefined) {
            console.error(prefix, err);
        } else {
            console.error(prefix);
        }
    }
}