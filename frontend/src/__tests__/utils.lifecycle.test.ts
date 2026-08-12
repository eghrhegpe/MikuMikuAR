// @vitest-environment node
// [doc:adr-101] P2 工具函数单测：lifecycle guards
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoadingGuard, DebouncedTimer, Abortable, makeLazyLoader } from '../core/async';

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

        it('leave without enter is a safe no-op', () => {
            const guard = new LoadingGuard();
            expect(() => guard.leave()).not.toThrow();
            expect(() => guard.leave('x')).not.toThrow();
            expect(guard.isLoading()).toBe(false);
        });

        it('leave non-existent key: does not affect other keys', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('a');
            guard.leave('b');
            expect(guard.isLoading('a')).toBe(true);
            expect(guard.tryEnter('b')).toBe(true);
        });

        it('isLoading before any enter returns false', () => {
            const guard = new LoadingGuard();
            expect(guard.isLoading()).toBe(false);
            expect(guard.isLoading('any')).toBe(false);
        });

        it('boolean mode: multiple enter/leave cycles', () => {
            const guard = new LoadingGuard();
            for (let i = 0; i < 5; i++) {
                expect(guard.tryEnter()).toBe(true);
                guard.leave();
            }
            expect(guard.tryEnter()).toBe(true);
        });

        it('set mode: re-enter same key after leave', () => {
            const guard = new LoadingGuard();
            guard.tryEnter('k');
            guard.leave('k');
            expect(guard.tryEnter('k')).toBe(true);
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

        it('multiple aborts: each creates a fresh non-aborted signal', () => {
            const a = new Abortable();
            a.abort();
            const s1 = a.signal;
            expect(s1.aborted).toBe(false);
            a.abort();
            const s2 = a.signal;
            expect(s2.aborted).toBe(false);
            expect(s1.aborted).toBe(true);
            expect(s2).not.toBe(s1);
        });

        it('signal after dispose stays aborted', () => {
            const a = new Abortable();
            a.dispose();
            expect(a.signal.aborted).toBe(true);
            // signal 不会自动重置
            expect(a.signal.aborted).toBe(true);
        });

        it('abort after dispose creates new usable controller', () => {
            const a = new Abortable();
            a.dispose();
            expect(a.signal.aborted).toBe(true);
            a.abort();
            expect(a.signal.aborted).toBe(false);
        });

        it('controller getter returns AbortController instance', () => {
            const a = new Abortable();
            expect(a.controller).toBeInstanceOf(AbortController);
            expect(a.controller.signal).toBe(a.signal);
        });
    });

    describe('makeLazyLoader', () => {
        it('caches result after first successful load', async () => {
            let callCount = 0;
            const loader = makeLazyLoader(async () => {
                callCount++;
                return 42;
            });
            const r1 = await loader();
            expect(r1).toBe(42);
            expect(callCount).toBe(1);
            const r2 = await loader();
            expect(r2).toBe(42);
            expect(callCount).toBe(1);
        });

        it('concurrent calls share the same promise and call loader once', async () => {
            let callCount = 0;
            const loader = makeLazyLoader(async () => {
                callCount++;
                return 'shared';
            });
            const [r1, r2, r3] = await Promise.all([loader(), loader(), loader()]);
            expect(r1).toBe('shared');
            expect(r2).toBe('shared');
            expect(r3).toBe('shared');
            expect(callCount).toBe(1);
        });

        it('retries on failure: next call invokes loader again', async () => {
            let callCount = 0;
            const loader = makeLazyLoader(async () => {
                callCount++;
                if (callCount === 1) throw new Error('fail');
                return 'recovered';
            });
            await expect(loader()).rejects.toThrow('fail');
            expect(callCount).toBe(1);
            const r = await loader();
            expect(r).toBe('recovered');
            expect(callCount).toBe(2);
        });

        it('concurrent calls on failure: all get same rejection, then next retries', async () => {
            let callCount = 0;
            const loader = makeLazyLoader(async () => {
                callCount++;
                if (callCount === 1) throw new Error('first fail');
                return 'ok';
            });
            const results = await Promise.allSettled([loader(), loader(), loader()]);
            expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
            expect(callCount).toBe(1);
            const r = await loader();
            expect(r).toBe('ok');
            expect(callCount).toBe(2);
        });

        it('multiple failures: retries each time', async () => {
            let callCount = 0;
            const loader = makeLazyLoader(async () => {
                callCount++;
                if (callCount <= 2) throw new Error(`fail ${callCount}`);
                return 'finally';
            });
            await expect(loader()).rejects.toThrow('fail 1');
            expect(callCount).toBe(1);
            await expect(loader()).rejects.toThrow('fail 2');
            expect(callCount).toBe(2);
            const r = await loader();
            expect(r).toBe('finally');
            expect(callCount).toBe(3);
        });

        it('caches null-like values correctly', async () => {
            const loader = makeLazyLoader(async () => null);
            const r1 = await loader();
            expect(r1).toBeNull();
            const r2 = await loader();
            expect(r2).toBeNull();
        });

        it('caches zero/falsy values correctly', async () => {
            const loader = makeLazyLoader(async () => 0);
            const r1 = await loader();
            expect(r1).toBe(0);
            const r2 = await loader();
            expect(r2).toBe(0);
        });
    });
});
