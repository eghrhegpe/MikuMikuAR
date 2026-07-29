// [doc:adr-101] P2 工具函数单测：lifecycle guards
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LoadingGuard, DebouncedTimer, Abortable } from '../core/utils';

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
