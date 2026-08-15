// [doc:adr-101] P2 Step 5: addDisposableListener 单测
import { describe, it, expect, vi } from 'vitest';
import { addDisposableListener, type Disposable } from '../core/dom';

describe('ADR-101 P2: addDisposableListener', () => {
    it('receives events after attach', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const d = addDisposableListener(el, 'click', fn);
        expect(d).toHaveProperty('dispose');
        el.dispatchEvent(new Event('click'));
        expect(fn).toHaveBeenCalledOnce();
    });

    it('stops receiving events after dispose', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const d = addDisposableListener(el, 'click', fn);
        d.dispose();
        el.dispatchEvent(new Event('click'));
        expect(fn).not.toHaveBeenCalled();
    });

    it('dispose is idempotent', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const d = addDisposableListener(el, 'click', fn);
        d.dispose();
        d.dispose(); // 二次 dispose 不抛
        el.dispatchEvent(new Event('click'));
        expect(fn).not.toHaveBeenCalled();
    });

    it('passes options through to addEventListener and removes with captured capture', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const addSpy = vi.spyOn(el, 'addEventListener');
        const removeSpy = vi.spyOn(el, 'removeEventListener');
        const d = addDisposableListener(el, 'click', fn, {
            passive: true,
            once: true,
            capture: true,
        });
        expect(addSpy).toHaveBeenCalledWith('click', fn, {
            passive: true,
            once: true,
            capture: true,
        });
        d.dispose();
        expect(removeSpy).toHaveBeenCalledWith('click', fn, true);
        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('removes a capture listener even if options object is mutated after attach', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const options = { capture: true };
        const d = addDisposableListener(el, 'click', fn, options);
        options.capture = false;
        d.dispose();
        el.dispatchEvent(new Event('click'));
        expect(fn).not.toHaveBeenCalled();
    });

    it('returns Disposable compatible with interface', () => {
        const el = document.createElement('div');
        const d: Disposable = addDisposableListener(el, 'mouseenter', () => {});
        expect(typeof d.dispose).toBe('function');
        d.dispose();
    });

    it('supports multiple independent listeners on same element', () => {
        const el = document.createElement('button');
        const fn1 = vi.fn();
        const fn2 = vi.fn();
        const d1 = addDisposableListener(el, 'click', fn1);
        const d2 = addDisposableListener(el, 'click', fn2);
        el.dispatchEvent(new Event('click'));
        expect(fn1).toHaveBeenCalledOnce();
        expect(fn2).toHaveBeenCalledOnce();
        d1.dispose();
        el.dispatchEvent(new Event('click'));
        expect(fn1).toHaveBeenCalledOnce();
        expect(fn2).toHaveBeenCalledTimes(2);
        d2.dispose();
    });
});
