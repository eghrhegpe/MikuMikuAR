import { describe, it, expect, vi } from 'vitest';
import { Observable } from '@babylonjs/core/Misc/observable';
import { ObserverHandle, ObserverRegistry, observe, observeOnce } from '../observer-handle';

describe('ObserverHandle', () => {
    it('dispose is idempotent (multiple calls safe)', () => {
        const obs = new Observable<void>();
        const handle = new ObserverHandle(
            obs,
            obs.add(() => {})
        );
        expect(handle.isDisposed).toBe(false);

        handle.dispose();
        expect(handle.isDisposed).toBe(true);

        // 第二次 dispose 不抛错
        handle.dispose();
        expect(handle.isDisposed).toBe(true);
    });

    it('dispose removes observer from observable', () => {
        const obs = new Observable<void>();
        const cb = vi.fn();
        const handle = new ObserverHandle(obs, obs.add(cb)!);

        handle.dispose();
        obs.notifyObservers();
        expect(cb).not.toHaveBeenCalled();
    });

    it('dispose on null observer is safe', () => {
        const handle = new ObserverHandle(null, null);
        expect(() => handle.dispose()).not.toThrow();
        expect(handle.isDisposed).toBe(true);
    });
});

describe('ObserverRegistry', () => {
    it('add and disposeAll', () => {
        const obs1 = new Observable<void>();
        const obs2 = new Observable<void>();
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const reg = new ObserverRegistry();

        reg.add(obs1, cb1);
        reg.add(obs2, cb2);

        reg.disposeAll();
        expect(reg.size).toBe(0);

        obs1.notifyObservers();
        expect(cb1).not.toHaveBeenCalled();
        obs2.notifyObservers();
        expect(cb2).not.toHaveBeenCalled();
    });

    it('disposeAll is idempotent', () => {
        const obs = new Observable<void>();
        const reg = new ObserverRegistry();
        reg.add(obs, () => {});

        reg.disposeAll();
        expect(() => reg.disposeAll()).not.toThrow(); // 第二次调用
        expect(() => reg.clear()).not.toThrow(); // clear 别名也安全
        expect(reg.size).toBe(0);
    });

    it('remove individual handle', () => {
        const obs = new Observable<void>();
        const cb = vi.fn();
        const reg = new ObserverRegistry();
        const handle = reg.add(obs, cb);

        expect(reg.size).toBe(1);
        const removed = reg.remove(handle);
        expect(removed).toBe(true);
        expect(reg.size).toBe(0);

        // 已移除的句柄 observer 也被 dispose
        obs.notifyObservers();
        expect(cb).not.toHaveBeenCalled();
    });

    it('remove non-existent handle returns false', () => {
        const reg = new ObserverRegistry();
        const dummy = new ObserverHandle(null, null);
        expect(reg.remove(dummy)).toBe(false);
    });

    it('clear alias behaves like disposeAll', () => {
        const obs = new Observable<void>();
        const reg = new ObserverRegistry();
        reg.add(obs, () => {});
        expect(reg.size).toBe(1);

        reg.clear();
        expect(reg.size).toBe(0);
    });
});

describe('observe convenience function', () => {
    it('creates ObserverHandle from observable + callback', () => {
        const obs = new Observable<number>();
        const cb = vi.fn();
        const handle = observe(obs, cb);

        obs.notifyObservers(42);
        expect(cb).toHaveBeenCalled();
        expect(cb.mock.calls[0][0]).toBe(42);

        handle.dispose();
        expect(handle.isDisposed).toBe(true);
    });
});

describe('observeOnce convenience function', () => {
    it('fires exactly once then auto-disposes', () => {
        const obs = new Observable<number>();
        const cb = vi.fn();
        const handle = observeOnce(obs, cb);

        obs.notifyObservers(1);
        expect(cb).toHaveBeenCalledTimes(1);

        // 第二次触发不再调用（addOnce 自动移除）
        obs.notifyObservers(2);
        expect(cb).toHaveBeenCalledTimes(1);

        // dispose 安全（observer 已由 addOnce 自动移除）
        expect(() => handle.dispose()).not.toThrow();
    });
});
