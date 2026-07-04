import { describe, it, expect } from 'vitest';
import { deriveLighting, calcLuminance, ENV_PRESETS } from '../scene/env/env-lighting';

describe('calcLuminance', () => {
    it('white is 1.0', () => {
        expect(calcLuminance([1, 1, 1])).toBeCloseTo(1, 3);
    });
    it('black is 0', () => {
        expect(calcLuminance([0, 0, 0])).toBe(0);
    });
    it('mid gray ~0.5', () => {
        expect(calcLuminance([0.5, 0.5, 0.5])).toBeCloseTo(0.5, 3);
    });
});

describe('deriveLighting', () => {
    it('noon: bright warm-white light', () => {
        const l = deriveLighting([0.53, 0.71, 0.91], 75);
        expect(l.dirIntensity).toBeGreaterThan(0.8);
        expect(l.hemiIntensity).toBeLessThan(0.7);
        // 新算法保留色相：最亮通道 ≈ 0.95，各通道比例与 skyColor 一致
        expect(Math.max(...l.dirDiffuse)).toBeCloseTo(0.95, 1);
        const ratio = l.dirDiffuse[0] / l.dirDiffuse[2];
        expect(ratio).toBeCloseTo(0.53 / 0.91, 1);
    });

    it('night: dirIntensity=0 when sunAngle <= 0', () => {
        const l = deriveLighting([0.05, 0.05, 0.15], -15);
        expect(l.dirIntensity).toBe(0);
        expect(l.hemiIntensity).toBeCloseTo(0.3, 1);
        // 夜间方向无意义，但函数仍返回平面方向（y=0）
        expect(l.dirDirection[1]).toBe(0);
    });

    it('sunset: warm light, low angle', () => {
        const l = deriveLighting([0.9, 0.45, 0.2], 15);
        expect(l.dirDiffuse[0]).toBeGreaterThan(l.dirDiffuse[2]);
        expect(l.dirDirection[1]).toBeGreaterThan(0);
        expect(l.dirDirection[1]).toBeLessThan(0.5);
    });
});

describe('ENV_PRESETS', () => {
    it('has all 6 presets', () => {
        expect(Object.keys(ENV_PRESETS)).toEqual([
            'dawn',
            'noon',
            'sunset',
            'night',
            'overcast',
            'neon',
        ]);
    });

    it('each preset has all required fields', () => {
        for (const [_key, p] of Object.entries(ENV_PRESETS)) {
            expect(p.label).toBeTruthy();
            expect(p.dirDiffuse).toHaveLength(3);
            expect(p.dirDirection).toHaveLength(3);
            // night/midnight 的 dirIntensity 可以为 0（太阳在地平线下）
            expect(p.dirIntensity).toBeGreaterThanOrEqual(0);
            expect(p.hemiIntensity).toBeGreaterThanOrEqual(0);
        }
    });
});
