// @vitest-environment node
// [doc:adr-101] P1-a 工具函数单测：error & async helpers
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { swallowError, fireAndForget, delay, waitForFrame, makeLazyLoader, LoadingGuard, DebouncedTimer, Abortable } from '../core/async';
import { logWarn, logError } from '../core/logger';

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
        beforeEach(() => {
            if (typeof globalThis.requestAnimationFrame === 'undefined') {
                (globalThis as any).requestAnimationFrame = vi.fn();
            }
        });
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

    describe('makeLazyLoader', () => {
        it('首次调用执行 loader 并返回结果', async () => {
            const loader = vi.fn(async () => 42);
            const lazy = makeLazyLoader(loader);
            const result = await lazy();
            expect(result).toBe(42);
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('成功加载后缓存结果，不再调用 loader', async () => {
            const loader = vi.fn(async () => 'cached');
            const lazy = makeLazyLoader(loader);
            const r1 = await lazy();
            const r2 = await lazy();
            const r3 = await lazy();
            expect(r1).toBe('cached');
            expect(r2).toBe('cached');
            expect(r3).toBe('cached');
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('并发调用共享同一 Promise，loader 只执行一次', async () => {
            let resolveLoader: (v: string) => void;
            const loader = vi.fn(() => new Promise<string>((r) => { resolveLoader = r; }));
            const lazy = makeLazyLoader(loader);
            const p1 = lazy();
            const p2 = lazy();
            const p3 = lazy();
            expect(loader).toHaveBeenCalledTimes(1);
            resolveLoader!('shared');
            const results = await Promise.all([p1, p2, p3]);
            expect(results).toEqual(['shared', 'shared', 'shared']);
            // 缓存命中后不再调 loader
            await lazy();
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('loader 失败后锁清除，下次调用可重试', async () => {
            let calls = 0;
            const loader = vi.fn(async () => {
                calls++;
                if (calls === 1) throw new Error('first fail');
                return 'retry ok';
            });
            const lazy = makeLazyLoader(loader);
            await expect(lazy()).rejects.toThrow('first fail');
            expect(loader).toHaveBeenCalledTimes(1);
            // 失败后重试
            const result = await lazy();
            expect(result).toBe('retry ok');
            expect(loader).toHaveBeenCalledTimes(2);
        });

        it('loader 失败时并发等待者都看到 rejection', async () => {
            const loader = vi.fn(async () => { throw new Error('fail'); });
            const lazy = makeLazyLoader(loader);
            const p1 = lazy();
            const p2 = lazy();
            await expect(p1).rejects.toThrow('fail');
            await expect(p2).rejects.toThrow('fail');
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('loader 返回 undefined 也视为有效缓存值', async () => {
            const loader = vi.fn(async () => undefined);
            const lazy = makeLazyLoader(loader);
            const r1 = await lazy();
            expect(r1).toBeUndefined();
            const r2 = await lazy();
            expect(r2).toBeUndefined();
            expect(loader).toHaveBeenCalledTimes(1);
        });
    });

    describe('LoadingGuard', () => {
        it('tryEnter 默认 key 首次返回 true', () => {
            const guard = new LoadingGuard();
            expect(guard.tryEnter()).toBe(true);
        });

        it('tryEnter 同 key 再次返回 false', () => {
            const guard = new LoadingGuard();
            guard.tryEnter();
            expect(guard.tryEnter()).toBe(false);
        });

        it('leave 后可重新 enter', () => {
            const guard = new LoadingGuard();
            guard.tryEnter();
            guard.leave();
            expect(guard.tryEnter()).toBe(true);
        });

        it('isLoading 正确反映状态', () => {
            const guard = new LoadingGuard();
            expect(guard.isLoading()).toBe(false);
            guard.tryEnter();
            expect(guard.isLoading()).toBe(true);
            guard.leave();
            expect(guard.isLoading()).toBe(false);
        });

        it('不同 key 互不干扰', () => {
            const guard = new LoadingGuard();
            expect(guard.tryEnter('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(true);
            expect(guard.tryEnter('a')).toBe(false);
            expect(guard.tryEnter('b')).toBe(false);
            guard.leave('a');
            expect(guard.tryEnter('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(false);
        });

        it('clear 清除所有状态', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('x');
            guard.tryEnter('y');
            guard.clear();
            expect(guard.isLoading('x')).toBe(false);
            expect(guard.isLoading('y')).toBe(false);
            expect(guard.tryEnter('x')).toBe(true);
            expect(guard.tryEnter('y')).toBe(true);
        });

        it('删除不存在的 key 不抛异常', () => {
            const guard = new LoadingGuard();
            expect(() => guard.leave('nonexistent')).not.toThrow();
            expect(() => guard.leave()).not.toThrow();
        });
    });

    describe('DebouncedTimer', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        it('schedule 在 ms 后执行 fn', () => {
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            expect(fn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(100);
            expect(fn).toHaveBeenCalledOnce();
        });

        it('重复 schedule 取消前一个，仅最后一个执行', () => {
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn1, 100);
            vi.advanceTimersByTime(50);
            timer.schedule(fn2, 100);
            vi.advanceTimersByTime(100);
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).toHaveBeenCalledOnce();
        });

        it('cancel 阻止待执行的定时器', () => {
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            expect(timer.isPending).toBe(true);
            timer.cancel();
            expect(timer.isPending).toBe(false);
            vi.advanceTimersByTime(200);
            expect(fn).not.toHaveBeenCalled();
        });

        it('isPending 反映待执行状态', () => {
            const timer = new DebouncedTimer();
            expect(timer.isPending).toBe(false);
            timer.schedule(() => {}, 100);
            expect(timer.isPending).toBe(true);
            vi.advanceTimersByTime(100);
            expect(timer.isPending).toBe(false);
        });

        it('dispose 等同 cancel', () => {
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            timer.dispose();
            expect(timer.isPending).toBe(false);
            vi.advanceTimersByTime(200);
            expect(fn).not.toHaveBeenCalled();
        });

        it('fn 抛出异常不破坏 timer 状态', () => {
            const timer = new DebouncedTimer();
            const throwingFn = vi.fn(() => { throw new Error('boom'); });
            timer.schedule(throwingFn, 100);
            expect(() => vi.advanceTimersByTime(100)).toThrow('boom');
            expect(throwingFn).toHaveBeenCalledOnce();
            // timer 状态应已清除
            expect(timer.isPending).toBe(false);
            // 可以再次 schedule
            const fn2 = vi.fn();
            timer.schedule(fn2, 50);
            vi.advanceTimersByTime(50);
            expect(fn2).toHaveBeenCalledOnce();
        });
    });

    describe('Abortable', () => {
        it('初始 signal 未 aborted', () => {
            const ab = new Abortable();
            expect(ab.signal.aborted).toBe(false);
        });

        it('abort() 后旧 signal.aborted 为 true，新 signal 未 aborted', () => {
            const ab = new Abortable();
            const oldSig = ab.signal;
            ab.abort();
            expect(oldSig.aborted).toBe(true);
            expect(ab.signal.aborted).toBe(false); // 已自动重置
        });

        it('abort() 后获取新 signal（未 aborted），对象可复用', () => {
            const ab = new Abortable();
            const sig1 = ab.signal;
            ab.abort();
            expect(sig1.aborted).toBe(true);
            const sig2 = ab.signal;
            expect(sig2.aborted).toBe(false);
            expect(sig2).not.toBe(sig1);
        });

        it('dispose() aborts 但不重置 signal', () => {
            const ab = new Abortable();
            const sig = ab.signal;
            ab.dispose();
            expect(sig.aborted).toBe(true);
        });

        it('controller 返回当前 AbortController', () => {
            const ab = new Abortable();
            const ctrl1 = ab.controller;
            expect(ctrl1).toBeInstanceOf(AbortController);
            expect(ab.signal).toBe(ctrl1.signal);
            ab.abort();
            const ctrl2 = ab.controller;
            expect(ctrl2).not.toBe(ctrl1);
            expect(ab.signal).toBe(ctrl2.signal);
        });

        it('可多次 abort 复用', () => {
            const ab = new Abortable();
            ab.abort();
            expect(ab.signal.aborted).toBe(false); // 已重置
            ab.abort();
            expect(ab.signal.aborted).toBe(false); // 再次重置
        });
    });
});
