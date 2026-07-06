import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveLighting, calcLuminance, TIME_OF_DAY_PRESETS } from '../scene/env/env-lighting';

// ── scene-lighting-smoke: Babylon mocks ──────────────────────────
vi.mock('@babylonjs/core/Lights/hemisphericLight', () => ({ HemisphericLight: vi.fn() }));
vi.mock('@babylonjs/core/Lights/directionalLight', () => ({ DirectionalLight: vi.fn() }));
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: class { constructor(public x: number, public y: number, public z: number) {} },
    Quaternion: class { constructor(public x: number, public y: number, public z: number, public w: number = 1) {} },
}));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color3: vi.fn(), Color4: vi.fn() }));
vi.mock('@babylonjs/core/Meshes/mesh', () => ({ Mesh: vi.fn() }));
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({ MeshBuilder: { CreateSphere: vi.fn() } }));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({ StandardMaterial: vi.fn() }));
vi.mock('@babylonjs/core/Lights/Shadows/shadowGenerator', () => ({ ShadowGenerator: vi.fn() }));

import * as sceneLighting from '../scene/render/lighting';

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

describe('TIME_OF_DAY_PRESETS', () => {
    it('has all 6 presets', () => {
        expect(Object.keys(TIME_OF_DAY_PRESETS)).toEqual([
            'dawn',
            'noon',
            'sunset',
            'night',
            'overcast',
            'neon',
        ]);
    });

    it('each preset has all required fields', () => {
        for (const [_key, p] of Object.entries(TIME_OF_DAY_PRESETS)) {
            expect(p.label).toBeTruthy();
            expect(p.dirDiffuse).toHaveLength(3);
            expect(p.dirDirection).toHaveLength(3);
            expect(p.hemiIntensity).toBeGreaterThanOrEqual(0);
        }
    });
});

// ====================================================================
// scene-lighting 烟雾测试（合并自 scene-lighting-smoke.test.ts）
// ====================================================================

describe('scene-lighting — deriveLighting', () => {
    it('模块可导入', () => {
        expect(sceneLighting.transitionLighting).toBeTypeOf('function');
        expect(sceneLighting.initLighting).toBeTypeOf('function');
    });
});

describe('scene-lighting — transitionLighting smoke', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('transitionLighting 在缺少 Babylon 对象时提前返回（不抛异常）', () => {
        expect(() => {
            sceneLighting.transitionLighting({ dirIntensity: 0.5 }, 2000);
        }).not.toThrow();
    });
});
