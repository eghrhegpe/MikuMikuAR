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

    it('passes options through to addEventListener', () => {
        const el = document.createElement('button');
        const fn = vi.fn();
        const spy = vi.spyOn(el, 'addEventListener');
        addDisposableListener(el, 'click', fn, { passive: true, once: true });
        expect(spy).toHaveBeenCalledWith('click', fn, { passive: true, once: true });
        spy.mockRestore();
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
