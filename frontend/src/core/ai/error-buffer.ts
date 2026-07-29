// [doc:adr-196] 错误环形缓冲 — 全局错误捕获 + 缓冲队列
// 供 AI 诊断助手读取上下文。测试契约见 __tests__/error-buffer.test.ts

export interface ErrorEntry {
    kind: 'log' | 'uncaught' | 'unhandledrejection';
    tag: string;
    message: string;
    name?: string;
    stack?: string;
    timestamp: number;
    severity: 'error' | 'warn' | 'info';
}

export interface GlobalErrorTarget {
    addEventListener(type: string, fn: (ev: unknown) => void): void;
    removeEventListener(type: string, fn: (ev: unknown) => void): void;
}

/** 根据 ErrorEntry 的 kind + tag 推导严重级别。 */
export function inferSeverity(kind: ErrorEntry['kind'], tag: string): ErrorEntry['severity'] {
    // 运行时全局异常（未捕获/未处理 rejection）视为最严重
    if (kind === 'uncaught' || kind === 'unhandledrejection') {
        return 'error';
    }
    // AI 流式/连接错误视为 error
    if (tag === 'ai-stream' || tag === 'ai-connection') {
        return 'error';
    }
    // 配置问题视为 warn
    if (tag === 'ai-config') {
        return 'warn';
    }
    return 'warn';
}

// ======== ErrorRingBuffer 类 ========

export class ErrorRingBuffer {
    readonly capacity: number;
    private _buffer: ErrorEntry[] = [];
    private _head = 0;
    private _count = 0;

    constructor(capacity: number) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError('ErrorRingBuffer 容量必须为正整数');
        }
        this.capacity = capacity;
        this._buffer = new Array(capacity);
    }

    get size(): number {
        return this._count;
    }

    get full(): boolean {
        return this._count === this.capacity;
    }

    get oldest(): ErrorEntry | undefined {
        return this._count > 0 ? this._buffer[this._head] : undefined;
    }

    get newest(): ErrorEntry | undefined {
        if (this._count === 0) {
            return undefined;
        }
        const tail = (this._head + this._count - 1) % this.capacity;
        return this._buffer[tail];
    }

    push(entry: ErrorEntry): void {
        const idx = (this._head + this._count) % this.capacity;
        this._buffer[idx] = entry;
        if (this._count === this.capacity) {
            this._head = (this._head + 1) % this.capacity;
        } else {
            this._count++;
        }
    }

    toArray(): ErrorEntry[] {
        const result: ErrorEntry[] = [];
        for (let i = 0; i < this._count; i++) {
            result.push(this._buffer[(this._head + i) % this.capacity]);
        }
        return result;
    }

    clear(): void {
        this._head = 0;
        this._count = 0;
    }
}

// ======== 全局单例 ========

export const errorBuffer = new ErrorRingBuffer(50);

// ======== captureError 归一化 ========

export function captureError(
    tag: string,
    message: string,
    err: unknown,
    kind: ErrorEntry['kind'] = 'log',
    options?: { buffer?: ErrorRingBuffer; maxStack?: number }
): ErrorEntry {
    const entry: ErrorEntry = {
        kind,
        tag,
        message,
        timestamp: Date.now(),
        severity: inferSeverity(kind, tag),
    };

    if (err instanceof Error) {
        entry.name = err.name;
        entry.stack = err.stack;
    } else if (err && typeof err === 'object') {
        const obj = err as Record<string, unknown>;
        if (typeof obj.name === 'string') {
            entry.name = obj.name;
        }
        if (typeof obj.stack === 'string') {
            entry.stack = obj.stack;
        }
    }

    // stack 截断
    if (entry.stack && options?.maxStack != null) {
        entry.stack = entry.stack.slice(0, options.maxStack);
    }

    const buf = options?.buffer ?? errorBuffer;
    buf.push(entry);
    return entry;
}

// ======== console.error 补丁（零业务文件改动的入环方案）========
//
// [doc:adr-196] 替代原导出的 logError：业务文件从 @/core/logger 导入 logError，
// 仅打 console.error 不会自动入环。改用 patch console.error 后，所有 console.error
// 调用（含 logger.ts 的 logError）自动入环，零业务文件改动（满足 AC-10）。
// patch 幂等（_loggingPatched 守卫），重复调用不双重包装。

let _origConsoleError: typeof console.error | null = null;
let _loggingPatched = false;

function _stringifyArg(a: unknown): string {
    if (typeof a === 'string') {
        return a;
    }
    if (a instanceof Error) {
        return `${a.name}: ${a.message}`;
    }
    try {
        return JSON.stringify(a);
    } catch {
        return String(a);
    }
}

/** 把 console.error(...args) 归一化为一条环形缓冲条目。 */
function _captureConsoleError(args: unknown[]): void {
    const first = typeof args[0] === 'string' ? (args[0] as string) : '';
    // 末位若为 Error 对象，作为 err 传入以便提取 name/stack，且不重复计入 message
    const last = args[args.length - 1];
    const err = last instanceof Error ? last : undefined;
    const bodyArgs = err ? args.slice(0, -1) : args;

    let tag = 'console';
    let message = bodyArgs.map((a) => _stringifyArg(a)).join(' ');

    // 兼容 logger.ts 形态：[tag] message —— 提取 tag，剩余归入 message
    const m = /^\s*\[([^\]]+)\]\s*([\s\S]*)$/.exec(first);
    if (m) {
        tag = m[1];
        const rest = bodyArgs
            .slice(1)
            .map((a) => _stringifyArg(a))
            .join(' ');
        message = m[2] ? (rest ? `${m[2]} ${rest}` : m[2]) : rest;
    }

    captureError(tag, message, err, 'log');
}

/**
 * 幂等地 patch console.error，使其所有输出自动入环（保留原始 console.error 行为）。
 * 重复调用不双重包装（_loggingPatched 守卫）。
 */
export function installLoggingPatch(): void {
    if (_loggingPatched) {
        return;
    }
    _loggingPatched = true;
    _origConsoleError = console.error.bind(console);
    const patched: typeof console.error = (...args: unknown[]) => {
        // 原始行为必须保留（即便捕获抛错也不影响业务日志）
        try {
            _origConsoleError?.(...args);
        } catch {
            // 原始 console.error 不应失败；极端情况下忽略
        }
        try {
            _captureConsoleError(args);
        } catch {
            // 捕获逻辑异常绝不应影响业务
        }
    };
    console.error = patched;
}

/** 卸载 console.error 补丁，恢复原始实现。 */
export function uninstallLoggingPatch(): void {
    if (!_loggingPatched) {
        return;
    }
    if (_origConsoleError) {
        console.error = _origConsoleError;
    }
    _origConsoleError = null;
    _loggingPatched = false;
}

// ======== 便捷存取 ========

export function getErrors(): ErrorEntry[] {
    return errorBuffer.toArray();
}

export function clearErrors(): void {
    errorBuffer.clear();
}

// ======== 全局捕获 ========

let _globalDisposer: (() => void) | null = null;

export function installErrorCaptureOn(
    target: GlobalErrorTarget,
    buffer: ErrorRingBuffer
): () => void {
    const onError = (ev: unknown) => {
        const event = ev as { message?: string; error?: unknown };
        captureError(
            event.error instanceof Error ? event.error.name : 'window',
            event.message ?? '未知错误',
            event.error,
            'uncaught',
            { buffer }
        );
    };
    const onRejection = (ev: unknown) => {
        const event = ev as { reason?: unknown };
        const reason = event.reason;
        captureError(
            reason instanceof Error ? reason.name : 'unhandled',
            reason instanceof Error ? reason.message : String(reason),
            reason,
            'unhandledrejection',
            { buffer }
        );
    };

    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);

    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}

export function installGlobalErrorCapture(): () => void {
    if (_globalDisposer) {
        return _globalDisposer;
    }

    let originalDisposer: () => void;
    if (typeof globalThis !== 'undefined') {
        originalDisposer = installErrorCaptureOn(
            globalThis as unknown as GlobalErrorTarget,
            errorBuffer
        );
    } else {
        originalDisposer = () => {};
    }

    _globalDisposer = () => {
        originalDisposer();
        _globalDisposer = null;
    };

    return _globalDisposer;
}

// ======== 诊断上下文序列化 ========

export function toDiagnosticContext(options?: { maxBytes?: number }): string {
    const entries = errorBuffer.toArray();
    if (entries.length === 0) {
        return '(无捕获错误)';
    }

    const maxBytes = options?.maxBytes ?? 4096;
    const lines: string[] = [];

    for (const e of entries) {
        const line = `${e.kind} <${e.tag}> ${e.message}${e.name ? ` [${e.name}]` : ''}${e.stack ? `\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}` : ''}`;
        lines.push(line);
    }

    // 从最新开始拼接，截断到 maxBytes
    let result = '';
    for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = result ? `${lines[i]}\n${result}` : lines[i];
        if (candidate.length > maxBytes) {
            result = `…(已截断较早记录)\n${result}`;
            break;
        }
        result = candidate;
    }

    return result;
}
