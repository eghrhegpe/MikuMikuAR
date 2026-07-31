// [doc:adr-196] error-buffer 守护测试：环形缓冲 CRUD、captureError、logging patch、全局捕获。
// 纯函数 + 可 mock 的全局事件。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ErrorRingBuffer,
    captureError,
    inferSeverity,
    installLoggingPatch,
    uninstallLoggingPatch,
    installErrorCaptureOn,
    toDiagnosticContext,
    getErrors,
    clearErrors,
    errorBuffer,
    type ErrorEntry,
} from '../error-buffer';

describe('ErrorRingBuffer', () => {
    /** 快速创建一条错误条目（tag/message 可覆盖）。 */
    function e(
        msg: string,
        overrides: Partial<{
            tag: string;
            timestamp: number;
            severity: ErrorEntry['severity'];
            kind: ErrorEntry['kind'];
        }> = {}
    ): Parameters<ErrorRingBuffer['push']>[0] {
        return {
            kind: 'log',
            tag: 't',
            message: msg,
            timestamp: 1,
            severity: 'warn',
            ...overrides,
        };
    }

    it('构造容量必须为正整数', () => {
        expect(() => new ErrorRingBuffer(0)).toThrow('容量必须为正整数');
        expect(() => new ErrorRingBuffer(-1)).toThrow('容量必须为正整数');
        expect(() => new ErrorRingBuffer(1.5)).toThrow('容量必须为正整数');
        expect(() => new ErrorRingBuffer(1)).not.toThrow();
    });

    it('空 buffer 属性正常', () => {
        const buf = new ErrorRingBuffer(5);
        expect(buf.size).toBe(0);
        expect(buf.full).toBe(false);
        expect(buf.oldest).toBeUndefined();
        expect(buf.newest).toBeUndefined();
        expect(buf.toArray()).toEqual([]);
    });

    it('push 后 size 增加', () => {
        const buf = new ErrorRingBuffer(5);
        buf.push(e('a'));
        expect(buf.size).toBe(1);
        expect(buf.oldest?.message).toBe('a');
        expect(buf.newest?.message).toBe('a');
    });

    it('超出容量覆盖最旧条目', () => {
        const buf = new ErrorRingBuffer(3);
        for (let i = 1; i <= 5; i++) {
            buf.push(e(`${i}`, { timestamp: i }));
        }
        expect(buf.size).toBe(3);
        expect(buf.oldest?.message).toBe('3');
        expect(buf.newest?.message).toBe('5');
        expect(buf.toArray().map((e) => e.message)).toEqual(['3', '4', '5']);
    });

    it('full 标志正确', () => {
        const buf = new ErrorRingBuffer(2);
        expect(buf.full).toBe(false);
        buf.push(e('1'));
        expect(buf.full).toBe(false);
        buf.push(e('2'));
        expect(buf.full).toBe(true);
        buf.push(e('3'));
        expect(buf.full).toBe(true); // 仍满
    });

    it('clear 清空所有条目', () => {
        const buf = new ErrorRingBuffer(5);
        buf.push(e('x'));
        buf.clear();
        expect(buf.size).toBe(0);
        expect(buf.toArray()).toEqual([]);
    });

    it('toArray 按插入顺序返回', () => {
        const buf = new ErrorRingBuffer(10);
        for (let i = 1; i <= 4; i++) {
            buf.push(e(`${i}`, { timestamp: i }));
        }
        expect(buf.toArray().map((e) => e.message)).toEqual(['1', '2', '3', '4']);
    });
});

describe('inferSeverity', () => {
    it('uncaught / unhandledrejection → error', () => {
        expect(inferSeverity('uncaught', 'any')).toBe('error');
        expect(inferSeverity('unhandledrejection', 'any')).toBe('error');
    });

    it('ai-stream / ai-connection → error', () => {
        expect(inferSeverity('log', 'ai-stream')).toBe('error');
        expect(inferSeverity('log', 'ai-connection')).toBe('error');
    });

    it('ai-config → warn', () => {
        expect(inferSeverity('log', 'ai-config')).toBe('warn');
    });

    it('其他 → warn', () => {
        expect(inferSeverity('log', 'console')).toBe('warn');
    });
});

describe('captureError', () => {
    it('从 Error 对象提取 name 和 stack', () => {
        const buf = new ErrorRingBuffer(10);
        const err = new TypeError('bad type');
        const entry = captureError('test', '出错了', err, 'log', { buffer: buf });
        expect(entry.name).toBe('TypeError');
        expect(entry.stack).toBeTruthy();
        expect(entry.severity).toBe('warn');
        expect(buf.size).toBe(1);
    });

    it('stack 截断', () => {
        const buf = new ErrorRingBuffer(10);
        const err = new Error('long stack');
        const entry = captureError('test', 'msg', err, 'log', { buffer: buf, maxStack: 50 });
        expect(entry.stack!.length).toBeLessThanOrEqual(50);
    });

    it('非 Error 对象兼容', () => {
        const buf = new ErrorRingBuffer(10);
        const entry = captureError('test', 'msg', { name: 'CustomError', stack: 'at x' }, 'log', {
            buffer: buf,
        });
        expect(entry.name).toBe('CustomError');
        expect(entry.stack).toBe('at x');
    });

    it('默认使用全局 errorBuffer', () => {
        clearErrors();
        captureError('test', 'global', null, 'log');
        expect(getErrors().length).toBeGreaterThan(0);
    });
});

describe('installLoggingPatch / uninstallLoggingPatch', () => {
    let originalError: typeof console.error;

    beforeEach(() => {
        originalError = console.error;
        uninstallLoggingPatch(); // 确保干净
    });

    afterEach(() => {
        uninstallLoggingPatch();
        console.error = originalError;
    });

    it('patch 后 console.error 入环', () => {
        const buf = new ErrorRingBuffer(10);
        // 用自定义 buffer 验证
        const spy = vi.spyOn(errorBuffer, 'push');

        installLoggingPatch();
        console.error('[test]', 'something broke', new Error('eek'));

        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('uninstall 后 console.error 不再入环', () => {
        const spy = vi.spyOn(errorBuffer, 'push');
        installLoggingPatch();
        uninstallLoggingPatch();
        console.error('[test]', 'should not be captured');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('重复 install 幂等', () => {
        installLoggingPatch();
        const patched = console.error;
        installLoggingPatch();
        expect(console.error).toBe(patched);
    });
});

describe('installErrorCaptureOn', () => {
    it('注册 error/unhandledrejection 事件', () => {
        const listeners: [string, unknown][] = [];
        const target = {
            addEventListener(type: string, fn: unknown) {
                listeners.push([type, fn]);
            },
            removeEventListener(type: string, _fn: unknown) {
                listeners.push([`remove:${type}`, _fn]);
            },
        };

        const dispose = installErrorCaptureOn(target, new ErrorRingBuffer(10));
        expect(listeners.map(([t]) => t)).toEqual(['error', 'unhandledrejection']);

        dispose();
        // 验证 dispose 注册了 remove
        const removeCalls = listeners.filter(([t]) => t.startsWith('remove:'));
        expect(removeCalls).toHaveLength(2);
    });
});

describe('toDiagnosticContext', () => {
    it('空 buffer 返回占位', () => {
        clearErrors();
        expect(toDiagnosticContext()).toBe('(无捕获错误)');
    });

    it('格式化错误条目', () => {
        const buf = new ErrorRingBuffer(10);
        buf.push({ kind: 'log', tag: 'test', message: 'hello', timestamp: 1, severity: 'warn' });
        clearErrors();
        // 用全局 errorBuffer 添加一条
        captureError('test', 'hello', null, 'log');
        const ctx = toDiagnosticContext();
        expect(ctx).toContain('test');
        expect(ctx).toContain('hello');
    });

    it('maxBytes 截断', () => {
        clearErrors();
        captureError('test', 'a'.repeat(100), null, 'log');
        captureError('test', 'b'.repeat(100), null, 'log');
        const ctx = toDiagnosticContext({ maxBytes: 50 });
        expect(ctx.length).toBeLessThanOrEqual(100); // 截断后不会超过 maxBytes + 短前缀
    });
});
