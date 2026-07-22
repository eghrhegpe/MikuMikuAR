import { describe, it, expect } from 'vitest';
import { safeDispose } from '../dispose-helpers';

class FakeDisposable {
    disposed = false;
    dispose(...args: any[]): void {
        this.disposed = true;
        this.lastArgs = args;
    }
    lastArgs: any[] = [];
}

describe('safeDispose', () => {
    it('disposes a non-null object and returns null', () => {
        const obj = new FakeDisposable();
        const result = safeDispose(obj);
        expect(obj.disposed).toBe(true);
        expect(result).toBeNull();
    });

    it('is a no-op and returns null when given null', () => {
        const result = safeDispose<FakeDisposable>(null);
        expect(result).toBeNull();
    });

    it('passes through dispose arguments (e.g. mesh.dispose(true))', () => {
        const obj = new FakeDisposable();
        safeDispose(obj, true);
        expect(obj.lastArgs).toEqual([true]);
    });

    it('passes through multiple dispose arguments (e.g. mat.dispose(false, true))', () => {
        const obj = new FakeDisposable();
        safeDispose(obj, false, true);
        expect(obj.lastArgs).toEqual([false, true]);
    });

    it('can be assigned back to the caller reference to null it out', () => {
        let ref: FakeDisposable | null = new FakeDisposable();
        ref = safeDispose(ref);
        expect(ref).toBeNull();
    });
});
