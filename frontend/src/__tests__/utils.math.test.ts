// @vitest-environment node
// [doc:adr-101] P3 工具函数单测：pure math helpers
import { describe, it, expect } from 'vitest';
import { clampPct } from '../core/clamp';
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
});
