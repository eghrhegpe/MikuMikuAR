// [doc:adr-101] P1-a 工具函数单测：logWarn/logError/swallowError/fireAndForget/delay/waitForFrame/lazyImport
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    logWarn,
    logError,
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    lazyImport,
} from '../core/utils';

// 辅助：等待微任务 + 宏任务各刷新一轮，确保 Promise.catch handler 执行完毕
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ADR-101 P1-a: error & async helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('logWarn', () => {
        it('formats [tag] message with err as second arg', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const err = new Error('boom');
            logWarn('model-loader', 'failed to load', err);
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith('[model-loader] failed to load', err);
        });

        it('omits trailing arg when err undefined', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            logWarn('tag', 'msg');
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith('[tag] msg');
        });

        it('omits middle space when message is empty', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const err = new Error('x');
            logWarn('swallow', '', err);
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith('[swallow]', err);
        });

        it('logs bare [tag] when both message and err empty', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            logWarn('tag', '');
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith('[tag]');
        });
    });

    describe('logError', () => {
        it('calls console.error with [tag] message and err', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const err = new Error('oops');
            logError('scene', 'init failed', err);
            expect(spy).toHaveBeenCalledOnce();
            expect(spy).toHaveBeenCalledWith('[scene] init failed', err);
        });

        it('omits err arg when undefined', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            logError('scene', 'init failed');
            expect(spy).toHaveBeenCalledWith('[scene] init failed');
        });
    });

    describe('swallowError', () => {
        it('swallows rejected promise without throwing', async () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            swallowError(Promise.reject(new Error('boom')));
            await flushMicrotasks();
            expect(spy).toHaveBeenCalledOnce();
            expect(spy.mock.calls[0][0]).toBe('[swallow]');
        });

        it('does not log when promise resolves', async () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            swallowError(Promise.resolve(42));
            await flushMicrotasks();
            expect(spy).not.toHaveBeenCalled();
        });

        it('returns void (fire-and-forget)', () => {
            const result = swallowError(Promise.resolve(1));
            expect(result).toBeUndefined();
        });
    });

    describe('fireAndForget', () => {
        it('invokes fn and swallows its rejection', async () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            fireAndForget(async () => {
                throw new Error('async boom');
            });
            await flushMicrotasks();
            expect(spy).toHaveBeenCalledOnce();
        });

        it('runs successful fn without logging', async () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            let ran = false;
            fireAndForget(async () => {
                ran = true;
            });
            await flushMicrotasks();
            expect(ran).toBe(true);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('delay', () => {
        it('does not resolve before ms elapses', async () => {
            vi.useFakeTimers();
            let resolved = false;
            delay(100).then(() => {
                resolved = true;
            });
            await vi.advanceTimersByTimeAsync(99);
            expect(resolved).toBe(false);
        });

        it('resolves after ms elapses', async () => {
            vi.useFakeTimers();
            let resolved = false;
            delay(100).then(() => {
                resolved = true;
            });
            await vi.advanceTimersByTimeAsync(100);
            expect(resolved).toBe(true);
        });

        it('resolves with undefined', async () => {
            // 用真实 timer：delay(0) 在下一 tick resolve，验证返回值语义
            const result = await delay(0);
            expect(result).toBeUndefined();
        });
    });

    describe('waitForFrame', () => {
        it('resolves when rAF callback fires', async () => {
            let rafCb: FrameRequestCallback | null = null;
            const rafSpy = vi
                .spyOn(globalThis, 'requestAnimationFrame')
                .mockImplementation((cb: FrameRequestCallback) => {
                    rafCb = cb;
                    return 1;
                });
            const p = waitForFrame();
            expect(rafSpy).toHaveBeenCalledOnce();
            // 尚未 resolve
            let resolved = false;
            p.then(() => {
                resolved = true;
            });
            await Promise.resolve();
            expect(resolved).toBe(false);
            // 触发 rAF 回调
            rafCb!(0);
            await p;
            expect(resolved).toBe(true);
            rafSpy.mockRestore();
        });
    });

    describe('lazyImport', () => {
        it('dynamically imports and returns named export', async () => {
            const clamp = await lazyImport<(v: number, lo: number, hi: number) => number>(
                '../core/utils',
                'clamp'
            );
            expect(clamp(5, 0, 10)).toBe(5);
            expect(clamp(-1, 0, 10)).toBe(0);
            expect(clamp(20, 0, 10)).toBe(10);
        });

        it('returns undefined for non-existent export name', async () => {
            const result = await lazyImport<unknown>('../core/utils', '__nonExistentExport__');
            expect(result).toBeUndefined();
        });
    });
});
