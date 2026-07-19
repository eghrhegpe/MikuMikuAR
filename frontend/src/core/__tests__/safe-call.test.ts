import { describe, it, expect, vi } from 'vitest';
import { safeCall, safeCallVoid, safeCallAsync } from '../safe-call';

describe('safe-call', () => {
    it('safeCall returns value on success', () => {
        expect(safeCall('t', 'm', () => 42)).toBe(42);
    });

    it('safeCall returns undefined and logs on throw', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = new Error('boom');
        const r = safeCall('t', 'm', () => {
            throw err;
        });
        expect(r).toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[t] m', err);
        spy.mockRestore();
    });

    it('safeCallVoid does not throw and logs on throw', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = new Error('boom');
        expect(() => safeCallVoid('t', 'm', () => {
            throw err;
        })).not.toThrow();
        expect(spy).toHaveBeenCalledWith('[t] m', err);
        spy.mockRestore();
    });

    it('safeCallAsync resolves value on success', async () => {
        await expect(safeCallAsync('t', 'm', async () => 7)).resolves.toBe(7);
    });

    it('safeCallAsync resolves undefined and logs on reject', async () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const err = new Error('async boom');
        await expect(
            safeCallAsync('t', 'm', async () => {
                throw err;
            })
        ).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[t] m', err);
        spy.mockRestore();
    });
});
