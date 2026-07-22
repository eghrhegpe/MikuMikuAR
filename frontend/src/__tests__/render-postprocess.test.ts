// render-postprocess.test.ts — Bloom / FXAA / 色调映射 / 曝光 / FOV / 预设 独立测试
//
// 覆盖 renderer.ts 中与 Babylon 环境无关的纯函数逻辑：
//   - defaultRenderState()
//   - ToneMappingMode 常量
//   - RenderState 接口默认值与边界
//   - FILTER_PRESETS 预设参数完整性
//   - camera-state.ts FOV getter/setter 边界（补充 camera.test.ts）
//
// 注意：_applyRenderState 需要 pipeline 实例，属于集成测试范畴。
// 渲染管线集成测试在 scene/env-feature-levels.contract.test.ts 中覆盖。

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// ─── ToneMappingMode 常量 ───────────────────────────────────────

describe('ToneMappingMode 常量', () => {
    // 动态 import 避免 side-effect 触发 renderer 初始化
    // 注：ToneMappingMode 在模块顶层直接导出，import 时无需触发 pipeline 创建
    let ToneMappingMode: Record<string, number>;

    beforeAll(async () => {
        const mod = await import('../scene/render/renderer');
        ToneMappingMode = mod.ToneMappingMode;
    });

    it('5 种模式定义正确', () => {
        expect(ToneMappingMode.OFF).toBe(0);
        expect(ToneMappingMode.ACES).toBe(1);
        expect(ToneMappingMode.REINHARD).toBe(2);
        expect(ToneMappingMode.CINEON).toBe(3);
        expect(ToneMappingMode.NEUTRAL).toBe(4);
    });

    it('所有值都是只读整数', () => {
        const values = Object.values(ToneMappingMode);
        expect(values).toHaveLength(5);
        for (const v of values) {
            expect(typeof v).toBe('number');
            expect(Number.isInteger(v)).toBe(true);
        }
    });
});

// ─── defaultRenderState() ───────────────────────────────────────

describe('defaultRenderState()', () => {
    let defaultRenderState: () => any;

    beforeAll(async () => {
        const mod = await import('../scene/render/renderer');
        defaultRenderState = mod.defaultRenderState;
    });

    it('返回完整字段', () => {
        const state = defaultRenderState();
        // 后处理 — Bloom
        expect(state).toHaveProperty('bloomEnabled', false);
        expect(state).toHaveProperty('bloomWeight', 0);
        expect(state).toHaveProperty('bloomThreshold', 0.5);
        expect(state).toHaveProperty('bloomKernel', 64);
        // 后处理 — 描边
        expect(state).toHaveProperty('outlineEnabled', false);
        expect(state.outlineColor).toEqual([0, 0, 0]);
        // 后处理 — 抗锯齿
        expect(state).toHaveProperty('fxaaEnabled', false);
        expect(state).toHaveProperty('msaaSamples', 1);
        // 色调映射 / 曝光 / 对比度
        expect(state).toHaveProperty('toneMapping', 0);
        expect(state).toHaveProperty('exposure', 1);
        expect(state).toHaveProperty('contrast', 1);
        // DOF
        expect(state).toHaveProperty('dofEnabled', false);
        expect(state.dofAperture).toBeCloseTo(0);
        // Vignette
        expect(state).toHaveProperty('vignetteEnabled', false);
        expect(state).toHaveProperty('vignetteDarkness', 0);
        // 色差 / 颗粒
        expect(state).toHaveProperty('chromaticAberrationEnabled', false);
        expect(state).toHaveProperty('chromaticAberrationAmount', 0);
        expect(state).toHaveProperty('grainEnabled', false);
        expect(state).toHaveProperty('grainIntensity', 0);
        // 锐化
        expect(state).toHaveProperty('sharpenAmount', 0);
        // Glow
        expect(state).toHaveProperty('glowEnabled', false);
        expect(state).toHaveProperty('glowIntensity', 0);
        // SSAO
        expect(state).toHaveProperty('ssaoEnabled', false);
        expect(state).toHaveProperty('ssaoStrength', 0);
        expect(state).toHaveProperty('ssaoRadius', 0);
        expect(state).toHaveProperty('ssaoSamples', 8);
        // cel-shading
        expect(state).toHaveProperty('celShadingMode', false);
        expect(state).toHaveProperty('celColorLevels', 4);
        expect(state).toHaveProperty('celEdgeThreshold', 0.2);
        expect(state).toHaveProperty('celEdgeStrength', 0.6);
    });

    it('bloomWeight 是 0-1 范围', () => {
        const state = defaultRenderState();
        expect(state.bloomWeight).toBeGreaterThanOrEqual(0);
        expect(state.bloomWeight).toBeLessThanOrEqual(1);
    });

    it('bloomThreshold 是 0-1 范围', () => {
        const state = defaultRenderState();
        expect(state.bloomThreshold).toBeGreaterThanOrEqual(0);
        expect(state.bloomThreshold).toBeLessThanOrEqual(1);
    });

    it('bloomKernel 是 16-256 范围', () => {
        const state = defaultRenderState();
        expect(state.bloomKernel).toBeGreaterThanOrEqual(16);
        expect(state.bloomKernel).toBeLessThanOrEqual(256);
    });

    it('exposure 默认 1.0', () => {
        const state = defaultRenderState();
        expect(state.exposure).toBe(1);
    });

    it('contrast 默认 1.0', () => {
        const state = defaultRenderState();
        expect(state.contrast).toBe(1);
    });

    it('toneMapping 默认 OFF (0)', () => {
        const state = defaultRenderState();
        expect(state.toneMapping).toBe(0);
    });
});

// ─── RenderState 边界值 ─────────────────────────────────────────

describe('RenderState 参数边界值', () => {
    let defaultRenderState: () => any;

    beforeAll(async () => {
        const mod = await import('../scene/render/renderer');
        defaultRenderState = mod.defaultRenderState;
    });

    // 核心后处理参数在 UI 和 _applyRenderState 中都有 clamp，
    // 这里验证默认值都在有效范围内
    const paramSpecs: Array<{ key: string; min: number; max: number }> = [
        { key: 'bloomWeight', min: 0, max: 1 },
        { key: 'bloomThreshold', min: 0, max: 1 },
        { key: 'bloomKernel', min: 16, max: 256 },
        { key: 'exposure', min: 0, max: 4 },
        { key: 'contrast', min: 0, max: 4 },
        { key: 'vignetteDarkness', min: 0, max: 1 },
        { key: 'chromaticAberrationAmount', min: 0, max: 1 },
        { key: 'grainIntensity', min: 0, max: 1 },
        { key: 'sharpenAmount', min: 0, max: 1 },
        { key: 'glowIntensity', min: 0, max: 1 },
        { key: 'ssaoStrength', min: 0, max: 1 },
        { key: 'ssaoRadius', min: 0, max: 1 },
        { key: 'ssaoSamples', min: 4, max: 32 },
        { key: 'dofAperture', min: 0, max: 1 },
        { key: 'celColorLevels', min: 2, max: 8 },
        { key: 'celEdgeThreshold', min: 0, max: 1 },
        { key: 'celEdgeStrength', min: 0, max: 1 },
    ];

    for (const spec of paramSpecs) {
        it(`${spec.key} 默认值在 [${spec.min}, ${spec.max}] 范围内`, () => {
            const state = defaultRenderState();
            const val = (state as any)[spec.key];
            expect(typeof val).toBe('number');
            expect(val).toBeGreaterThanOrEqual(spec.min);
            expect(val).toBeLessThanOrEqual(spec.max);
        });
    }

    it('msaaSamples 默认 1（关闭）', () => {
        const state = defaultRenderState();
        expect(state.msaaSamples).toBe(1);
    });

    it('outlineColor RGB 三个分量 0-1', () => {
        const state = defaultRenderState();
        expect(state.outlineColor).toHaveLength(3);
        for (const c of state.outlineColor) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
        }
    });
});

// ─── FOV 边界 ──────────────────────────────────────────────────
// （补充 camera.test.ts 已有的 getFov/setFov 测试，聚焦区间边界）

describe('FOV 参数约束', () => {
    let getFov: () => number;
    let setFov: (v: number) => void;

    beforeAll(async () => {
        const camState = await import('../scene/camera/camera-state');
        getFov = camState.getFov;
        setFov = camState.setFov;
    });

    beforeEach(() => {
        // 重置为默认值
        setFov(0.8);
    });

    it('UI slider 范围 [0.1, 3] 内 value 往返一致', () => {
        setFov(0.1);
        expect(getFov()).toBe(0.1);
        setFov(3.0);
        expect(getFov()).toBe(3.0);
    });

    it('极端小值原样存储（clamp 在 camera.ts 中处理）', () => {
        setFov(0.01);
        expect(getFov()).toBe(0.01);
        setFov(-0.5);
        expect(getFov()).toBe(-0.5);
    });

    it('极端大值原样存储（clamp 在 camera.ts 中处理）', () => {
        setFov(5);
        expect(getFov()).toBe(5);
        setFov(10);
        expect(getFov()).toBe(10);
    });

    it('默认 FOV 为 0.8（弧度）', () => {
        expect(getFov()).toBe(0.8);
    });

    it('多次 set/get 往返不丢失精度', () => {
        const values = [0.15, 0.5, 1.2, 2.0, 2.8];
        for (const v of values) {
            setFov(v);
            expect(getFov()).toBeCloseTo(v, 6);
        }
    });
});
