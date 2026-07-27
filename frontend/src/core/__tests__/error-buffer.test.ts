import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ErrorRingBuffer,
    errorBuffer,
    captureError,
    logError,
    getErrors,
    clearErrors,
    installErrorCaptureOn,
    installGlobalErrorCapture,
    toDiagnosticContext,
    type ErrorEntry,
    type GlobalErrorTarget,
} from '../ai/error-buffer';

/** 构造可注入的假全局目标，记录监听并在 dispatch 时回放。 */
function fakeTarget() {
    const handlers: Record<string, Array<(ev: unknown) => void>> = {};
    const target: GlobalErrorTarget & { dispatch(type: string, ev: unknown): void } = {
        addEventListener(type, fn) {
            (handlers[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
            handlers[type] = (handlers[type] || []).filter((h) => h !== fn);
        },
        dispatch(type, ev) {
            (handlers[type] || []).forEach((h) => h(ev));
        },
    };
    return target;
}

describe('ErrorRingBuffer 环形语义', () => {
    it('新建容量为正整数，非法容量抛 RangeError', () => {
        expect(() => new ErrorRingBuffer(0)).toThrow(RangeError);
        expect(() => new ErrorRingBuffer(1.5)).toThrow(RangeError);
        expect(new ErrorRingBuffer(3).capacity).toBe(3);
    });

    it('push 后 size / toArray 顺序 / newest / oldest 正确', () => {
        const buf = new ErrorRingBuffer(3);
        buf.push({ kind: 'log', tag: 'a', message: 'm1', timestamp: 1 });
        buf.push({ kind: 'log', tag: 'b', message: 'm2', timestamp: 2 });
        expect(buf.size).toBe(2);
        expect(buf.full).toBe(false);
        const arr = buf.toArray();
        expect(arr.map((e) => e.message)).toEqual(['m1', 'm2']);
        expect(buf.oldest?.message).toBe('m1');
        expect(buf.newest?.message).toBe('m2');
    });

    it('超过容量时覆盖最旧条目，size 封顶', () => {
        const buf = new ErrorRingBuffer(3);
        for (let i = 1; i <= 5; i++) {
            buf.push({ kind: 'log', tag: 't', message: `m${i}`, timestamp: i });
        }
        expect(buf.size).toBe(3);
        expect(buf.full).toBe(true);
        expect(buf.toArray().map((e) => e.message)).toEqual(['m3', 'm4', 'm5']);
        expect(buf.oldest?.message).toBe('m3');
        expect(buf.newest?.message).toBe('m5');
    });

    it('clear 后 size 归零、toArray 为空', () => {
        const buf = new ErrorRingBuffer(2);
        buf.push({ kind: 'log', tag: 't', message: 'x', timestamp: 1 });
        buf.clear();
        expect(buf.size).toBe(0);
        expect(buf.toArray()).toEqual([]);
        expect(buf.newest).toBeUndefined();
        expect(buf.oldest).toBeUndefined();
    });

    it('toArray 返回新数组，不暴露内部存储（外部修改不影响缓冲）', () => {
        const buf = new ErrorRingBuffer(2);
        buf.push({ kind: 'log', tag: 't', message: 'x', timestamp: 1 });
        const arr = buf.toArray();
        arr.push({} as ErrorEntry);
        expect(buf.size).toBe(1);
    });
});

describe('captureError 归一化', () => {
    it('Error 对象提取 name/message/stack', () => {
        const buf = new ErrorRingBuffer(5);
        const e = new TypeError('bad');
        const entry = captureError('mod', 'oops', e, 'log', { buffer: buf });
        expect(entry.kind).toBe('log');
        expect(entry.tag).toBe('mod');
        expect(entry.message).toBe('oops');
        expect(entry.name).toBe('TypeError');
        expect(entry.stack).toContain('bad');
        expect(buf.size).toBe(1);
    });

    it('字符串错误仅填 message', () => {
        const buf = new ErrorRingBuffer(5);
        const entry = captureError('mod', 'msg', 'plain string', 'uncaught', { buffer: buf });
        expect(entry.message).toBe('msg');
        expect(entry.name).toBeUndefined();
        expect(entry.stack).toBeUndefined();
    });

    it('类错误对象（含 message/name/stack）被归一化，但显式 message 仍优先', () => {
        const buf = new ErrorRingBuffer(5);
        const entry = captureError('mod', 'msg', { name: 'Custom', message: 'hi', stack: 's1\ns2' }, 'log', {
            buffer: buf,
        });
        expect(entry.name).toBe('Custom');
        expect(entry.message).toBe('msg'); // 显式摘要优先于 err.message
        expect(entry.stack).toBe('s1\ns2');
    });

    it('err 为 undefined 时各字段缺省', () => {
        const buf = new ErrorRingBuffer(5);
        const entry = captureError('mod', 'msg', undefined, 'log', { buffer: buf });
        expect(entry.name).toBeUndefined();
        expect(entry.stack).toBeUndefined();
    });

    it('stack 按 maxStack 截断', () => {
        const buf = new ErrorRingBuffer(5);
        const longStack = 'a'.repeat(100);
        const entry = captureError('mod', 'msg', { message: 'm', stack: longStack }, 'log', {
            buffer: buf,
            maxStack: 10,
        });
        expect(entry.stack?.length).toBe(10);
    });

    it('默认写入全局 errorBuffer（不污染自定义 buffer）', () => {
        clearErrors();
        const custom = new ErrorRingBuffer(5);
        captureError('mod', 'only-custom', undefined, 'log', { buffer: custom });
        expect(custom.size).toBe(1);
        expect(errorBuffer.size).toBe(0);
    });
});

describe('logError 包装', () => {
    beforeEach(() => clearErrors());

    it('调用原始 console.error 且同时入环', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const err = new Error('boom');
        logError('test', 'failed', err);
        expect(spy).toHaveBeenCalledWith('[test] failed', err);
        const entries = getErrors();
        expect(entries).toHaveLength(1);
        expect(entries[0].kind).toBe('log');
        expect(entries[0].name).toBe('Error');
        expect(entries[0].message).toBe('failed');
        spy.mockRestore();
    });
});

describe('installErrorCaptureOn（注入假 target）', () => {
    it('error 事件入环为 uncaught', () => {
        const buf = new ErrorRingBuffer(5);
        const target = fakeTarget();
        const dispose = installErrorCaptureOn(target, buf);
        target.dispatch('error', { message: 'boom', error: new Error('x') });
        expect(buf.size).toBe(1);
        expect(buf.newest?.kind).toBe('uncaught');
        expect(buf.newest?.message).toBe('boom');
        expect(buf.newest?.name).toBe('Error');
        dispose();
    });

    it('unhandledrejection 事件入环为 unhandledrejection（reason 为 Error）', () => {
        const buf = new ErrorRingBuffer(5);
        const target = fakeTarget();
        const dispose = installErrorCaptureOn(target, buf);
        target.dispatch('unhandledrejection', { reason: new Error('rejected') });
        expect(buf.size).toBe(1);
        expect(buf.newest?.kind).toBe('unhandledrejection');
        expect(buf.newest?.message).toBe('rejected');
    });

    it('unhandledrejection 事件 reason 为字符串', () => {
        const buf = new ErrorRingBuffer(5);
        const target = fakeTarget();
        const dispose = installErrorCaptureOn(target, buf);
        target.dispatch('unhandledrejection', { reason: 'plain reject' });
        expect(buf.newest?.kind).toBe('unhandledrejection');
        expect(buf.newest?.message).toBe('plain reject');
        dispose();
    });

    it('disposer 移除监听后不再捕获', () => {
        const buf = new ErrorRingBuffer(5);
        const target = fakeTarget();
        const dispose = installErrorCaptureOn(target, buf);
        target.dispatch('error', { message: 'first' });
        dispose();
        target.dispatch('error', { message: 'second' });
        expect(buf.size).toBe(1);
        expect(buf.newest?.message).toBe('first');
    });

    it('多次 dispatch 按序进入环形缓冲', () => {
        const buf = new ErrorRingBuffer(5);
        const target = fakeTarget();
        const dispose = installErrorCaptureOn(target, buf);
        target.dispatch('error', { message: 'e1' });
        target.dispatch('unhandledrejection', { reason: new Error('r1') });
        expect(buf.toArray().map((e) => e.message)).toEqual(['e1', 'r1']);
        dispose();
    });
});

describe('installGlobalErrorCapture（默认目标，幂等）', () => {
    it('无 window 环境返回 no-op 且不抛', () => {
        // happy-dom 下 globalThis 有 addEventListener，这里只验证函数可被调用且不抛。
        const d = installGlobalErrorCapture();
        expect(typeof d).toBe('function');
        d();
    });

    it('重复调用返回同一 disposer', () => {
        const d1 = installGlobalErrorCapture();
        const d2 = installGlobalErrorCapture();
        expect(d1).toBe(d2);
        d1();
        const d3 = installGlobalErrorCapture();
        expect(d3).not.toBe(d1);
        d3();
    });
});

describe('toDiagnosticContext 序列化', () => {
    beforeEach(() => clearErrors());

    it('空缓冲返回占位符', () => {
        expect(toDiagnosticContext()).toBe('(无捕获错误)');
    });

    it('多条目从旧到新拼接，含 kind/tag', () => {
        captureError('mod', 'm1', new Error('e1'));
        captureError('mod', 'm2', undefined, 'uncaught');
        const text = toDiagnosticContext({ maxBytes: 100000 });
        expect(text).toContain('log <mod> m1');
        expect(text).toContain('uncaught <mod> m2');
        // 顺序：旧在前
        expect(text.indexOf('m1')).toBeLessThan(text.indexOf('m2'));
    });

    it('超出 maxBytes 截断头部、保留最新', () => {
        for (let i = 0; i < 20; i++) {
            captureError('mod', `m${i}`, undefined, 'log');
        }
        const text = toDiagnosticContext({ maxBytes: 40 });
        expect(text).toContain('…(已截断较早记录)');
        expect(text).toContain('m19');
        expect(text.length).toBeLessThanOrEqual(40 + '…(已截断较早记录)\n'.length);
    });
});
