// error-buffer.ts — ADR-196 诊断上下文·错误环形缓冲（新增，leaf 模块）
//
// 职责：以固定容量环形缓冲收集运行时错误，作为内置 AI 诊断助手的三源上下文之一
//       （错误环形缓冲 + 引擎快照 + 用户附加）。
//
// 设计约束（对齐 ADR-191 叶模块纪律）：
//   - 零依赖应用层（仅引 @/core/logger 这个 leaf），不引 dom/state/fileservice，
//     保证 vitest worker 不挂死、可纯单测、无循环依赖。
//   - 全局捕获与缓冲写入解耦：installErrorCaptureOn 为纯函数（可注入 target/buffer），
//     便于在无真实 window 的测试里用假对象驱动；installGlobalErrorCapture 仅作默认封装。

import { logError as logErrorRaw } from '@/core/logger';

/** 单条错误记录。 */
export interface ErrorEntry {
    /** 毫秒时间戳（Date.now()）。 */
    timestamp: number;
    /**
     * 来源类别：
     * - 'log'：经本模块 logError 包装写入；
     * - 'uncaught'：window error 事件（window.onerror）；
     * - 'unhandledrejection'：未处理的 Promise 拒绝。
     */
    kind: 'log' | 'uncaught' | 'unhandledrejection';
    /** 模块标签（沿用 logger 的 [tag] 约定）。 */
    tag: string;
    /** 人类可读消息。 */
    message: string;
    /** 错误名（Error.name），无则 undefined。 */
    name?: string;
    /** 截断后的堆栈（<= maxStackLength，约 4KB）。 */
    stack?: string;
}

/** 环形缓冲容量（整数 >= 1）。 */
export type RingCapacity = number;

/**
 * 固定容量环形缓冲。写入超过容量时覆盖最旧条目（FIFO 上限）。
 * 采用 head 指针循环覆盖，避免 Array.shift 的 O(n) 移动，单条写入 O(1)。
 */
export class ErrorRingBuffer {
    private readonly slots: (ErrorEntry | undefined)[];
    private head = 0; // 下一个写入位置
    private _count = 0;

    constructor(public readonly capacity: RingCapacity = 50) {
        if (!Number.isInteger(capacity) || capacity < 1) {
            throw new RangeError(`ErrorRingBuffer capacity 必须为 >=1 的整数，收到 ${capacity}`);
        }
        this.slots = new Array<ErrorEntry | undefined>(capacity);
    }

    /** 当前已存条目数（<= capacity）。 */
    get size(): number {
        return this._count;
    }

    /** 是否已满（size === capacity）。 */
    get full(): boolean {
        return this._count === this.capacity;
    }

    /** 写入一条记录，返回实际写入的条目（timestamp 缺省时自动补全）。 */
    push(partial: Omit<ErrorEntry, 'timestamp'> & { timestamp?: number }): ErrorEntry {
        const entry: ErrorEntry = {
            timestamp: partial.timestamp ?? Date.now(),
            kind: partial.kind,
            tag: partial.tag,
            message: partial.message,
            name: partial.name,
            stack: partial.stack,
        };
        this.slots[this.head] = entry;
        this.head = (this.head + 1) % this.capacity;
        if (this._count < this.capacity) this._count++;
        return entry;
    }

    /** 按时间从旧到新返回条目快照（返回新数组，不暴露内部存储）。 */
    toArray(): ErrorEntry[] {
        const out: ErrorEntry[] = [];
        const start = this._count < this.capacity ? 0 : this.head;
        for (let i = 0; i < this._count; i++) {
            const e = this.slots[(start + i) % this.capacity];
            if (e) out.push(e);
        }
        return out;
    }

    /** 最新一条（undefined 表示空）。 */
    get newest(): ErrorEntry | undefined {
        if (this._count === 0) return undefined;
        const idx = (this.head - 1 + this.capacity) % this.capacity;
        return this.slots[idx];
    }

    /** 最旧一条（undefined 表示空）。 */
    get oldest(): ErrorEntry | undefined {
        if (this._count === 0) return undefined;
        const start = this._count < this.capacity ? 0 : this.head;
        return this.slots[start];
    }

    /** 清空缓冲（重置容量不变）。 */
    clear(): void {
        this.slots.fill(undefined);
        this.head = 0;
        this._count = 0;
    }
}

/** 默认全局缓冲（容量 50，对齐 ADR-196 风险缓解「环形上限 50 条」）。 */
export const errorBuffer = new ErrorRingBuffer(50);

/** 单条 stack 截断上限（字符，约 4KB，对齐 ADR-196）。 */
const DEFAULT_MAX_STACK = 4096;

function truncateStack(stack: string, max: number): string {
    return stack.length > max ? stack.slice(0, max) : stack;
}

/** 将任意 err 归一化为 {name,message,stack}，统一不同来源的抛错形态。 */
function normalizeError(err: unknown, maxStack: number): { name?: string; message?: string; stack?: string } {
    if (err == null) return {};
    if (err instanceof Error) {
        return { name: err.name, message: err.message, stack: truncateStack(err.stack ?? '', maxStack) };
    }
    if (typeof err === 'string') return { message: err };
    if (typeof err === 'object') {
        const o = err as Record<string, unknown>;
        const message = typeof o.message === 'string' ? o.message : String(err);
        const name = typeof o.name === 'string' ? o.name : undefined;
        const stack = typeof o.stack === 'string' ? truncateStack(o.stack, maxStack) : undefined;
        return { name, message, stack };
    }
    return { message: String(err) };
}

/** 将错误写入缓冲（不打印）。供显式采集点调用。 */
export function captureError(
    tag: string,
    message: string,
    err?: unknown,
    kind: ErrorEntry['kind'] = 'log',
    opts?: { buffer?: ErrorRingBuffer; maxStack?: number },
): ErrorEntry {
    const buffer = opts?.buffer ?? errorBuffer;
    const maxStack = opts?.maxStack ?? DEFAULT_MAX_STACK;
    const norm = normalizeError(err, maxStack);
    // 显式 message 为人工摘要，始终优先；err 仅贡献 name/stack 细节，不覆盖 message。
    return buffer.push({ kind, tag, message, name: norm.name, stack: norm.stack });
}

/**
 * 包装 logger.logError：保持原 console 输出不变，同时入环。
 * 调用方若希望错误进入诊断缓冲，应使用本函数替代 logger.logError（加性不侵入既有调用点）。
 */
export function logError(tag: string, message: string, err?: unknown): void {
    logErrorRaw(tag, message, err);
    captureError(tag, message, err, 'log');
}

/** 返回默认缓冲的快照（从旧到新）。 */
export function getErrors(): ErrorEntry[] {
    return errorBuffer.toArray();
}

/** 清空默认缓冲。 */
export function clearErrors(): void {
    errorBuffer.clear();
}

/** 可被注入的全局错误目标（浏览器 window / 测试假对象）。 */
export interface GlobalErrorTarget {
    addEventListener(type: 'error' | 'unhandledrejection', listener: (ev: unknown) => void): void;
    removeEventListener(type: 'error' | 'unhandledrejection', listener: (ev: unknown) => void): void;
}

function getDefaultTarget(): GlobalErrorTarget | null {
    const g = globalThis as unknown as Partial<GlobalErrorTarget>;
    if (typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function') {
        return g as GlobalErrorTarget;
    }
    return null;
}

function extractErrorEvent(ev: unknown): { message: string; err?: unknown } {
    // 浏览器 ErrorEvent 带有 message + error 字段。
    if (ev && typeof (ev as { message?: unknown }).message === 'string') {
        return { message: (ev as { message: string }).message, err: (ev as { error?: unknown }).error };
    }
    return { message: 'uncaught error' };
}

function extractRejection(ev: unknown): { message: string; err?: unknown } {
    const reason = (ev as { reason?: unknown } | undefined)?.reason;
    if (reason instanceof Error) {
        return { message: reason.message || 'unhandled promise rejection', err: reason };
    }
    if (typeof reason === 'string') return { message: reason };
    return { message: 'unhandled promise rejection', err: reason };
}

/**
 * 纯函数：在给定 target 上安装全局错误捕获，写入指定 buffer。
 * 返回 disposer 移除监听。无模块级状态，便于测试注入假 target。
 */
export function installErrorCaptureOn(
    target: GlobalErrorTarget,
    buffer: ErrorRingBuffer = errorBuffer,
    opts?: { maxStack?: number },
): () => void {
    const maxStack = opts?.maxStack ?? DEFAULT_MAX_STACK;
    const onError = (ev: unknown) => {
        const { message, err } = extractErrorEvent(ev);
        captureError('window', message, err, 'uncaught', { buffer, maxStack });
    };
    const onRejection = (ev: unknown) => {
        const { message, err } = extractRejection(ev);
        captureError('window', message, err, 'unhandledrejection', { buffer, maxStack });
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}

let globalDisposer: (() => void) | null = null;

/**
 * 在默认全局目标（window / globalThis）安装错误捕获；幂等，重复调用返回同一 disposer。
 * 无 addEventListener 的环境（理论 SSR / 纯 node）静默返回 no-op，避免启动期报错。
 */
export function installGlobalErrorCapture(opts?: { buffer?: ErrorRingBuffer; maxStack?: number }): () => void {
    if (globalDisposer) return globalDisposer;
    const target = getDefaultTarget();
    if (!target) return () => {};
    const buffer = opts?.buffer ?? errorBuffer;
    const disposer = installErrorCaptureOn(target, buffer, opts);
    globalDisposer = () => {
        disposer();
        globalDisposer = null;
    };
    return globalDisposer;
}

/**
 * 将缓冲序列化为诊断上下文文本（按时间从旧到新），超出 maxBytes 时截断头部（保留最新）。
 * 供后续 AiService.streamChat 的 context 字段直接消费。
 */
export function toDiagnosticContext(opts?: { buffer?: ErrorRingBuffer; maxBytes?: number }): string {
    const buffer = opts?.buffer ?? errorBuffer;
    const maxBytes = opts?.maxBytes ?? 8000;
    const entries = buffer.toArray();
    if (entries.length === 0) return '(无捕获错误)';
    const lines = entries.map((e) => {
        const t = new Date(e.timestamp).toISOString();
        const head = `[${t}] ${e.kind} <${e.tag}> ${e.message}`;
        const detail = e.stack ? `\n    ${e.stack.replace(/\n/g, '\n    ')}` : '';
        return head + detail;
    });
    let text = lines.join('\n');
    if (text.length > maxBytes) {
        text = text.slice(text.length - maxBytes);
        text = '…(已截断较早记录)\n' + text;
    }
    return text;
}
