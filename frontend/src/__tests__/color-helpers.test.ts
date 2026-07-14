// [doc:adr-101] color-helpers 单测（含 P3 新增 rgbString）
import { describe, it, expect } from 'vitest';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { col3FromTriple, hexToRgb, rgbToString, rgbString } from '../core/color-helpers';

describe('color-helpers', () => {
    describe('col3FromTriple', () => {
        it('constructs Color3 from 3-tuple', () => {
            const c = col3FromTriple([0.1, 0.2, 0.3]);
            expect(c.r).toBeCloseTo(0.1);
            expect(c.g).toBeCloseTo(0.2);
            expect(c.b).toBeCloseTo(0.3);
        });

        it('falls back to 0 for missing indices', () => {
            const c = col3FromTriple([0.5]);
            expect(c.r).toBeCloseTo(0.5);
            expect(c.g).toBe(0);
            expect(c.b).toBe(0);
        });

        it('handles empty array', () => {
            const c = col3FromTriple([]);
            expect(c.r).toBe(0);
            expect(c.g).toBe(0);
            expect(c.b).toBe(0);
        });
    });

    describe('hexToRgb', () => {
        it('parses #rrggbb', () => {
            expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
            expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
            expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
        });

        it('parses rrggbb without #', () => {
            expect(hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
        });

        it('falls back to theme default (74,108,247) for invalid input', () => {
            expect(hexToRgb('not-a-hex')).toEqual({ r: 74, g: 108, b: 247 });
            expect(hexToRgb('#xyz')).toEqual({ r: 74, g: 108, b: 247 });
        });
    });

    describe('rgbToString', () => {
        it('formats as "r, g, b"', () => {
            expect(rgbToString({ r: 255, g: 128, b: 0 })).toBe('255, 128, 0');
        });
    });

    describe('rgbString (ADR-101 P3)', () => {
        it('converts Color3(1,0,0) to rgb(255, 0, 0)', () => {
            expect(rgbString(new Color3(1, 0, 0))).toBe('rgb(255, 0, 0)');
        });

        it('converts Color3(0,1,0) to rgb(0, 255, 0)', () => {
            expect(rgbString(new Color3(0, 1, 0))).toBe('rgb(0, 255, 0)');
        });

        it('converts Color3(0,0,1) to rgb(0, 0, 255)', () => {
            expect(rgbString(new Color3(0, 0, 1))).toBe('rgb(0, 0, 255)');
        });

        it('converts Color3(0,0,0) to rgb(0, 0, 0)', () => {
            expect(rgbString(new Color3(0, 0, 0))).toBe('rgb(0, 0, 0)');
        });

        it('rounds 0.5 to 128 (Math.round semantics)', () => {
            // Math.round(0.5 * 255) = Math.round(127.5) = 128
            expect(rgbString(new Color3(0.5, 0.5, 0.5))).toBe('rgb(128, 128, 128)');
        });

        it('rounds fractional values to nearest integer', () => {
            // 用 2 的幂次精确值避免浮点误差：0.25*255=63.75→64, 0.5*255=127.5→128, 0.75*255=191.25→191
            expect(rgbString(new Color3(0.25, 0.5, 0.75))).toBe('rgb(64, 128, 191)');
        });
    });
});
