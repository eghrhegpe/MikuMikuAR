// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createDefaultFeetState } from '../core/scene-state';

describe('createDefaultFeetState', () => {
    it('returns a FeetState with all expected default values', () => {
        const feet = createDefaultFeetState();
        expect(feet).toEqual({
            enabled: false,
            intensity: 1,
            soleHeight: 0,
            jumpThreshold: 9999,
            bodySmooth: 0.5,
            footSmooth: 0.5,
            maxAngle: 30,
            reachAngle: 15,
        });
    });

    it('jumpThreshold is 9999 (disable jump suppression — feet always tracked)', () => {
        expect(createDefaultFeetState().jumpThreshold).toBe(9999);
    });

    it('enabled defaults to false', () => {
        expect(createDefaultFeetState().enabled).toBe(false);
    });

    it('intensity defaults to 1', () => {
        expect(createDefaultFeetState().intensity).toBe(1);
    });

    it('soleHeight defaults to 0', () => {
        expect(createDefaultFeetState().soleHeight).toBe(0);
    });

    it('bodySmooth defaults to 0.5', () => {
        expect(createDefaultFeetState().bodySmooth).toBe(0.5);
    });

    it('footSmooth defaults to 0.5', () => {
        expect(createDefaultFeetState().footSmooth).toBe(0.5);
    });

    it('maxAngle defaults to 30', () => {
        expect(createDefaultFeetState().maxAngle).toBe(30);
    });

    it('reachAngle defaults to 15', () => {
        expect(createDefaultFeetState().reachAngle).toBe(15);
    });

    it('returns a fresh object on each call (no shared reference)', () => {
        const a = createDefaultFeetState();
        const b = createDefaultFeetState();
        expect(a).not.toBe(b);
    });
});
