// [doc:adr-101] P1-a/P2/P3 工具函数单测
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    logWarn,
    logError,
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    LoadingGuard,
    DebouncedTimer,
    Abortable,
    clampPct,
    dist2d,
    dist3d,
    degToRad,
    radToDeg,
    ensureArray,
    filterKeys,
    Cache,
    allSettledFilter,
    jsonStringify,
    jsonParse,
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
});

describe('ADR-101 P2: lifecycle guards', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('LoadingGuard', () => {
        it('boolean mode: tryEnter returns true first, false on re-entry', () => {
            const guard = new LoadingGuard();
            expect(guard.tryEnter()).toBe(true);
            expect(guard.tryEnter()).toBe(false);
        });

        it('boolean mode: leave allows re-entry', () => {
            const guard = new LoadingGuard();
            guard.tryEnter();
            guard.leave();
            expect(guard.tryEnter()).toBe(true);
        });

        it('set mode: different keys do not block each other', () => {
            const guard = new LoadingGuard();
            expect(guard.tryEnter('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(true);
            expect(guard.tryEnter('a')).toBe(false);
        });

        it('set mode: leave specific key only', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('a');
            guard.tryEnter('b');
            guard.leave('a');
            expect(guard.tryEnter('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(false);
        });

        it('isLoading queries state', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('x');
            expect(guard.isLoading('x')).toBe(true);
            expect(guard.isLoading('y')).toBe(false);
        });

        it('clear resets all keys', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('a');
            guard.tryEnter('b');
            guard.clear();
            expect(guard.tryEnter('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(true);
        });
    });

    describe('DebouncedTimer', () => {
        it('schedule executes fn after ms', async () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            expect(fn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(100);
            expect(fn).toHaveBeenCalledOnce();
        });

        it('isPending reflects scheduled state', () => {
            vi.useFakeTimers();
            const timer = new DebouncedTimer();
            expect(timer.isPending).toBe(false);
            timer.schedule(() => {}, 100);
            expect(timer.isPending).toBe(true);
            vi.advanceTimersByTime(100);
            expect(timer.isPending).toBe(false);
        });

        it('re-schedule cancels previous timer', async () => {
            vi.useFakeTimers();
            const fn1 = vi.fn();
            const fn2 = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn1, 100);
            timer.schedule(fn2, 100);
            await vi.advanceTimersByTimeAsync(100);
            expect(fn1).not.toHaveBeenCalled();
            expect(fn2).toHaveBeenCalledOnce();
        });

        it('cancel prevents execution', async () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            timer.cancel();
            expect(timer.isPending).toBe(false);
            await vi.advanceTimersByTimeAsync(200);
            expect(fn).not.toHaveBeenCalled();
        });

        it('dispose equals cancel', async () => {
            vi.useFakeTimers();
            const fn = vi.fn();
            const timer = new DebouncedTimer();
            timer.schedule(fn, 100);
            timer.dispose();
            await vi.advanceTimersByTimeAsync(200);
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('Abortable', () => {
        it('initial signal is not aborted', () => {
            const a = new Abortable();
            expect(a.signal.aborted).toBe(false);
        });

        it('abort resets to new controller, making signal reusable', () => {
            const a = new Abortable();
            const oldSignal = a.signal;
            a.abort();
            const newSignal = a.signal;
            expect(oldSignal.aborted).toBe(true);
            expect(newSignal.aborted).toBe(false);
            expect(newSignal).not.toBe(oldSignal);
        });

        it('dispose aborts without reset', () => {
            const a = new Abortable();
            a.dispose();
            expect(a.signal.aborted).toBe(true);
        });
    });
});

describe('ADR-101 P3: pure functions', () => {
    describe('clampPct', () => {
        it('clamps to [0, 100]', () => {
            expect(clampPct(-10)).toBe(0);
            expect(clampPct(0)).toBe(0);
            expect(clampPct(50)).toBe(50);
            expect(clampPct(100)).toBe(100);
            expect(clampPct(150)).toBe(100);
        });
    });

    describe('dist2d', () => {
        it('computes 3-4-5 triangle distance', () => {
            expect(dist2d({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
        });

        it('returns 0 for identical points', () => {
            expect(dist2d({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
        });

        it('handles negative deltas', () => {
            expect(dist2d({ x: 3, y: 4 }, { x: 0, y: 0 })).toBeCloseTo(5);
        });
    });

    describe('dist3d', () => {
        it('computes 1-2-2 triangle distance', () => {
            expect(dist3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBeCloseTo(3);
        });

        it('returns 0 for identical points', () => {
            expect(dist3d({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0);
        });
    });

    describe('degToRad', () => {
        it('converts 0/90/180/360 degrees', () => {
            expect(degToRad(0)).toBe(0);
            expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
            expect(degToRad(180)).toBeCloseTo(Math.PI);
            expect(degToRad(360)).toBeCloseTo(Math.PI * 2);
        });
    });

    describe('radToDeg', () => {
        it('converts 0/π/2/π/2π radians', () => {
            expect(radToDeg(0)).toBe(0);
            expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
            expect(radToDeg(Math.PI)).toBeCloseTo(180);
            expect(radToDeg(Math.PI * 2)).toBeCloseTo(360);
        });
    });

    describe('degToRad / radToDeg round-trip', () => {
        it('round-trips without loss', () => {
            const v = 42.5;
            expect(radToDeg(degToRad(v))).toBeCloseTo(v);
        });
    });

    describe('ensureArray', () => {
        it('wraps non-array as single-element array', () => {
            expect(ensureArray(5)).toEqual([5]);
            expect(ensureArray('x')).toEqual(['x']);
        });

        it('passes through arrays unchanged', () => {
            expect(ensureArray([1, 2, 3])).toEqual([1, 2, 3]);
            expect(ensureArray<number>([])).toEqual([]);
        });
    });

    describe('filterKeys', () => {
        it('keeps only keys satisfying predicate', () => {
            const obj = { a: 1, b: 2, c: 3, d: 4 };
            const result = filterKeys(obj, (k) => k === 'a' || k === 'c');
            expect(result).toEqual({ a: 1, c: 3 });
        });

        it('returns empty object when no key matches', () => {
            const obj = { a: 1, b: 2 };
            const result = filterKeys(obj, () => false);
            expect(result).toEqual({});
        });

        it('returns all keys when predicate always true', () => {
            const obj = { a: 1, b: 2 };
            const result = filterKeys(obj, () => true);
            expect(result).toEqual({ a: 1, b: 2 });
        });

        it('does not mutate original object', () => {
            const obj = { a: 1, b: 2 };
            filterKeys(obj, (k) => k === 'a');
            expect(obj).toEqual({ a: 1, b: 2 });
        });
    });

    describe('Cache', () => {
        it('get returns undefined for missing key', () => {
            const cache = new Cache<string, number>();
            expect(cache.get('x')).toBeUndefined();
            expect(cache.has('x')).toBe(false);
        });

        it('set/get/has round-trip', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            expect(cache.has('a')).toBe(true);
            expect(cache.get('a')).toBe(1);
        });

        it('set overwrites existing value', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            cache.set('a', 2);
            expect(cache.get('a')).toBe(2);
        });

        it('delete removes key and returns true', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            expect(cache.delete('a')).toBe(true);
            expect(cache.has('a')).toBe(false);
            expect(cache.delete('a')).toBe(false);
        });

        it('clear removes all keys', () => {
            const cache = new Cache<string, number>();
            cache.set('a', 1);
            cache.set('b', 2);
            cache.clear();
            expect(cache.size).toBe(0);
        });

        it('size reflects entry count', () => {
            const cache = new Cache<string, number>();
            expect(cache.size).toBe(0);
            cache.set('a', 1);
            expect(cache.size).toBe(1);
            cache.set('b', 2);
            expect(cache.size).toBe(2);
            cache.delete('a');
            expect(cache.size).toBe(1);
        });
    });

    describe('allSettledFilter', () => {
        it('returns only fulfilled results in order', async () => {
            const results = await allSettledFilter([
                Promise.resolve('a'),
                Promise.reject(new Error('boom')),
                Promise.resolve('b'),
            ]);
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe('a');
            expect(results[1].value).toBe('b');
        });

        it('returns empty array when all reject', async () => {
            const results = await allSettledFilter([
                Promise.reject(new Error('1')),
                Promise.reject(new Error('2')),
            ]);
            expect(results).toEqual([]);
        });

        it('returns all when all resolve', async () => {
            const results = await allSettledFilter([Promise.resolve(1), Promise.resolve(2)]);
            expect(results).toHaveLength(2);
            expect(results[0].value).toBe(1);
            expect(results[1].value).toBe(2);
        });

        it('handles empty input', async () => {
            const results = await allSettledFilter([]);
            expect(results).toEqual([]);
        });
    });

    describe('jsonStringify', () => {
        it('serializes with 2-space indent', () => {
            const result = jsonStringify({ a: 1, b: [2, 3] });
            expect(result).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
        });

        it('serializes primitives', () => {
            expect(jsonStringify(42)).toBe('42');
            expect(jsonStringify('x')).toBe('"x"');
            expect(jsonStringify(null)).toBe('null');
        });
    });

    describe('jsonParse', () => {
        it('parses valid JSON', () => {
            expect(jsonParse<number>('42')).toBe(42);
            expect(jsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
            expect(jsonParse<number[]>('[1,2,3]')).toEqual([1, 2, 3]);
        });

        it('returns null for invalid JSON', () => {
            expect(jsonParse('not json')).toBeNull();
            expect(jsonParse('{invalid')).toBeNull();
        });

        it('returns null for empty string', () => {
            expect(jsonParse('')).toBeNull();
        });
    });
});
