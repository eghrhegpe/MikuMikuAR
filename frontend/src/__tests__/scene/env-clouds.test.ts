import { describe, it, expect, vi } from 'vitest';

// 依赖桩：env-clouds 在模块加载时会 import 这些模块并向 env-dispatcher 注册回调、
// 通过 getEnvKeys('cloud') 计算响应式键。全部桩掉以避免触发 Babylon 资源创建
// （RawTexture3D 在 NullEngine 下不支持）以及真实的场景/渲染管线。
vi.mock('../../scene/env/env-context', () => ({
    getScene: () => null as any,
}));
vi.mock('../../scene/env/env-impl', () => ({
    ensureEnvUpdateObserver: () => {},
}));
vi.mock('../../scene/env/env-dispatcher', () => ({
    registerEnvCallback: vi.fn(),
}));
vi.mock('@/core/env-state-schema', () => ({
    getEnvKeys: () => [] as string[],
}));
vi.mock('@/core/observer-handle', () => ({
    observe: vi.fn(() => ({ dispose: vi.fn() })),
    ObserverHandle: class {},
}));
vi.mock('@/core/dispose-helpers', () => ({
    safeDispose: vi.fn((x: any) => x),
}));

// 真实导入被测模块（仅纯函数/着色器字符串，不触发 createClouds）
import {
    FRAG_SRC,
    resolveCloudShaderParams,
    buildJitterSource,
} from '../../scene/env/env-clouds';

describe('env-clouds shader 契约 (ADR-113)', () => {
    it('FRAG_SRC 距离雾 fade 到 sceneFogColor（非白雾硬编码）', () => {
        expect(FRAG_SRC).toContain('uniform vec3 sceneFogColor;');
        expect(FRAG_SRC).toContain('vec3 fogCol = sceneFogColor;');
        expect(FRAG_SRC).toContain('color = mix(color, fogCol, fogFactor * 0.3);');
        // 回归守护：不得再出现白雾硬编码
        expect(FRAG_SRC).not.toContain('mix(color, vec3(1.0, 1.0, 1.0), fogFactor');
    });

    it('FRAG_SRC cloudColor 作为云反照率基底（高度梯度 × 日落双因子）', () => {
        expect(FRAG_SRC).toContain('uniform vec3 cloudColor;');
        expect(FRAG_SRC).toContain('cloudBot');
        expect(FRAG_SRC).toContain('cloudTop');
        expect(FRAG_SRC).toContain('cloudHeightFactor');
        expect(FRAG_SRC).toContain('sunsetMix');
        // 旧的乘性暖色单因子函数应已移除
        expect(FRAG_SRC).not.toContain('applySunsetTint');
    });

    it('FRAG_SRC 含地平线延展（低仰角放宽 maxT）', () => {
        expect(FRAG_SRC).toContain('cloudVisibility * 3.0');
    });

    it('FRAG_SRC 平板相交 early-exit + slab-uniform 步长', () => {
        expect(FRAG_SRC).toContain('abs(rd.y) < 1e-4');
        expect(FRAG_SRC).toContain('slabDt = clamp(slabLen / 24.0');
        // 步进策略已定为 slab-uniform，旧自适应步长字符串不应存在
        expect(FRAG_SRC).not.toContain('float dt = CLOUD_STEP_MIN + t');
    });

    it('FRAG_SRC 注入的散射常量存在', () => {
        expect(FRAG_SRC).toContain('CLOUD_LIGHT_ATTEN 0.40');
        expect(FRAG_SRC).toContain('CLOUD_SCATTER_INTENSITY 0.50');
        expect(FRAG_SRC).toContain('CLOUD_DENSITY_THRESHOLD 0.005');
    });

    it('resolveCloudShaderParams: standard=轻量(96步,无蓝噪) / high=满血(200步,蓝噪)', () => {
        expect(resolveCloudShaderParams('standard')).toEqual({
            maxSteps: 96,
            lightSteps: 1,
            useBlueNoise: false,
        });
        expect(resolveCloudShaderParams('high')).toEqual({
            maxSteps: 200,
            lightSteps: 2,
            useBlueNoise: true,
        });
        // 未指定时回流 high（与 schema 默认一致）
        expect(resolveCloudShaderParams(undefined)).toEqual({
            maxSteps: 200,
            lightSteps: 2,
            useBlueNoise: true,
        });
    });

    it('buildJitterSource: high 用 blueNoiseTex，standard 用 hash', () => {
        expect(buildJitterSource(true)).toContain('blueNoiseTex');
        expect(buildJitterSource(false)).toContain('fract(');
    });
});
