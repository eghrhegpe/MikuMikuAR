// [doc:architecture] 轻量日志工具 — 无依赖模块，不引入循环依赖。
//
// 从 utils.ts 拆分而来（ADR-141），消除 state ↔ utils 循环依赖。
// 所有模块都应通过此文件 import logWarn，而非从 utils.ts 导入。
//
// 日志缓冲区 + 调试面板决策（git commit ce02492d）尚未登记正式 ADR；
// 注意不要引用 ADR-248（该编号已被「派生缓存依赖引用键」决策占用，audit:round18）。

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
        // [audit:round18 P3] listener 异常隔离：面板渲染等订阅回调抛错不污染业务日志路径。
        // 不经 logWarn 记录（避免递归）；console 直出一次便于排查。
        for (const fn of this._listeners) {
            try {
                fn();
            } catch (err) {
                console.error('[logger] listener error:', err);
            }
        }
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

/** [audit:round18 P2] 读取 console 输出开关（调试面板初始文案须与实际状态一致） */
export function getConsoleOutput(): boolean {
    return _consoleOutput;
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