// @vitest-environment node
// [doc:adr-101] P3 工具函数单测：pure math helpers
import { describe, it, expect } from 'vitest';
import { clamp, clampInt, clamp01, lerp, lerpArray, clampPct } from '../core/clamp';
import { dist2d, dist3d, degToRad, radToDeg } from '../core/math-geometry';

describe('ADR-101 P3: pure math functions', () => {
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

        it('handles negative degrees', () => {
            expect(degToRad(-90)).toBeCloseTo(-Math.PI / 2);
            expect(degToRad(-180)).toBeCloseTo(-Math.PI);
        });
    });

    describe('radToDeg', () => {
        it('converts 0/π/2/π/2π radians', () => {
            expect(radToDeg(0)).toBe(0);
            expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
            expect(radToDeg(Math.PI)).toBeCloseTo(180);
            expect(radToDeg(Math.PI * 2)).toBeCloseTo(360);
        });

        it('handles negative radians', () => {
            expect(radToDeg(-Math.PI / 2)).toBeCloseTo(-90);
            expect(radToDeg(-Math.PI)).toBeCloseTo(-180);
        });
    });

    describe('degToRad / radToDeg round-trip', () => {
        it('round-trips without loss', () => {
            const v = 42.5;
            expect(radToDeg(degToRad(v))).toBeCloseTo(v);
        });

        it('round-trips negative values', () => {
            const v = -42.5;
            expect(radToDeg(degToRad(v))).toBeCloseTo(v);
        });
    });

    describe('lerp', () => {
        it('interpolates linearly at t=0/0.5/1', () => {
            expect(lerp(0, 10, 0)).toBe(0);
            expect(lerp(0, 10, 1)).toBe(10);
            expect(lerp(0, 10, 0.5)).toBe(5);
        });

        it('extrapolates when t outside [0, 1]', () => {
            expect(lerp(0, 10, -1)).toBe(-10);
            expect(lerp(0, 10, 2)).toBe(20);
        });

        it('handles negative range', () => {
            expect(lerp(-10, -5, 0.5)).toBe(-7.5);
        });
    });

    describe('lerpArray', () => {
        it('interpolates arrays element-wise', () => {
            expect(lerpArray([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
        });

        it('returns a at t=0 and b at t=1', () => {
            expect(lerpArray([1, 2], [3, 4], 0)).toEqual([1, 2]);
            expect(lerpArray([1, 2], [3, 4], 1)).toEqual([3, 4]);
        });

        it('handles single-element arrays', () => {
            expect(lerpArray([0], [100], 0.5)).toEqual([50]);
        });
    });

    describe('clamp01', () => {
        it('clamps to [0, 1]', () => {
            expect(clamp01(-0.5)).toBe(0);
            expect(clamp01(0)).toBe(0);
            expect(clamp01(0.5)).toBe(0.5);
            expect(clamp01(1)).toBe(1);
            expect(clamp01(1.5)).toBe(1);
        });
    });

    describe('clampInt', () => {
        it('rounds and clamps within range', () => {
            expect(clampInt(5.7, 0, 10)).toBe(6);
            expect(clampInt(4.2, 0, 10)).toBe(4);
        });

        it('clamps below lo', () => {
            expect(clampInt(-5, 0, 10)).toBe(0);
        });

        it('clamps above hi', () => {
            expect(clampInt(15, 0, 10)).toBe(10);
        });
    });

    describe('clamp', () => {
        it('passes through values within range', () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });

        it('clamps below lo', () => {
            expect(clamp(-5, 0, 10)).toBe(0);
        });

        it('clamps above hi', () => {
            expect(clamp(15, 0, 10)).toBe(10);
        });

        it('handles negative range', () => {
            expect(clamp(-15, -10, -5)).toBe(-10);
            expect(clamp(-3, -10, -5)).toBe(-5);
            expect(clamp(-8, -10, -5)).toBe(-8);
        });

        it('handles lo === hi', () => {
            expect(clamp(5, 3, 3)).toBe(3);
            expect(clamp(0, 3, 3)).toBe(3);
        });

        it('handles lo > hi gracefully', () => {
            const result = clamp(5, 10, 0);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(10);
        });
    });
});
