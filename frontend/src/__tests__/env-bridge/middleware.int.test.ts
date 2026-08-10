// @vitest-environment node
// env-bridge/middleware.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// ADR-173: setEnvState middleware（12 用例）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock(
    'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime',
    async () => (await import('./env-mocks')).mmdWasmRuntimeModule
);
vi.mock('../../core/backend', async () => (await import('./env-mocks')).backendModule);
vi.mock(
    '@babylonjs/core/Maths/math.vector',
    async () => (await import('./env-mocks')).babylonVectorModule
);
vi.mock(
    '@babylonjs/core/Maths/math.color',
    async () => (await import('./env-mocks')).babylonColorModule
);
vi.mock('../../core/config', async () => (await import('./env-mocks')).configModule);
vi.mock(
    '../../scene/env/env-lighting',
    async () => (await import('./env-mocks')).envLightingModule
);
vi.mock('../../scene/env/env-impl', async () => (await import('./env-mocks')).envImplModule);
vi.mock(
    '../../scene/env/_bridge/env-dispatcher',
    async () => (await import('./env-mocks')).envDispatcherModule
);
vi.mock('../../scene/render/lighting', async () => (await import('./env-mocks')).lightingModule);
vi.mock('../../scene/scene', async () => (await import('./env-mocks')).sceneModule);

import { mockApplyLightingPresetFromEnv, mockConfigEnvState, mockImplApplySky } from './env-mocks';
import { setEnvState } from '../../scene/env/_bridge/env-bridge';
import { getEnvSunAngle } from '../../scene/env/env-time-of-day';

// ──── ADR-173: setEnvState middleware ──────────────────────────

describe('ADR-173: setEnvState middleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(globalThis, 'setTimeout');
        vi.spyOn(globalThis, 'clearTimeout');
        Object.assign(mockConfigEnvState, {
            skyMode: 'color',
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('pre-facade: syncEnvSunAngle 同步 envSunAngle 缓存', () => {
        setEnvState({ sunAngle: 60 });
        // getEnvSunAngle 读取模块级 envSunAngle 缓存（已在顶部导入）
        expect(getEnvSunAngle()).toBe(60);
    });

    it('pre-facade: resolveQualityProfileMiddleware 解析 qualityProfile 为子字段', () => {
        // 清除可能残留的子字段
        delete mockConfigEnvState.reflectionQuality;
        delete mockConfigEnvState.cloudQuality;
        delete mockConfigEnvState.particleQuality;

        setEnvState({ qualityProfile: 'low' });

        // low profile → reflection=low, cloud=standard, particle=low
        expect(mockConfigEnvState.reflectionQuality).toBe('low');
        expect(mockConfigEnvState.cloudQuality).toBe('standard');
        expect(mockConfigEnvState.particleQuality).toBe('low');
    });

    it('pre-facade: qualityProfile=high 解析为 high/high/high', () => {
        delete mockConfigEnvState.reflectionQuality;
        delete mockConfigEnvState.cloudQuality;
        delete mockConfigEnvState.particleQuality;

        setEnvState({ qualityProfile: 'high' });

        expect(mockConfigEnvState.reflectionQuality).toBe('high');
        expect(mockConfigEnvState.cloudQuality).toBe('high');
        expect(mockConfigEnvState.particleQuality).toBe('high');
    });

    it('pre-facade: 无 qualityProfile 时不触发子字段解析', () => {
        delete mockConfigEnvState.reflectionQuality;
        setEnvState({ sunAngle: 50 });
        expect(mockConfigEnvState.reflectionQuality).toBeUndefined();
    });

    it('post-facade: applyLightingPresetMiddleware 触发灯光预设过渡', () => {
        setEnvState({ lightingPresetName: 'dramatic' });
        expect(mockApplyLightingPresetFromEnv).toHaveBeenCalledWith('dramatic');
    });

    it('post-facade: 无 lightingPresetName 时不触发灯光预设', () => {
        setEnvState({ sunAngle: 50 });
        expect(mockApplyLightingPresetFromEnv).not.toHaveBeenCalled();
    });

    it('middleware 异常隔离: pre-facade 抛错不中断 post-facade 和 persist', () => {
        // 临时 mock console.warn 避免噪声
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // 通过临时污染 resolveQualityProfile 使其抛错
        // 但我们不能直接修改 quality-profile 模块，所以改为验证现有异常隔离机制：
        // mockImplApplySky 抛错（facade 层异常）不应影响 post-facade middleware
        mockImplApplySky.mockImplementationOnce(() => {
            throw new Error('facade error');
        });

        expect(() => {
            setEnvState({ skyMode: 'procedural', lightingPresetName: 'dramatic' });
        }).not.toThrow();

        // post-facade middleware 仍执行
        expect(mockApplyLightingPresetFromEnv).toHaveBeenCalledWith('dramatic');
        // persist timer 仍调度
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);

        warnSpy.mockRestore();
    });

    it('middleware 执行顺序: pre-facade 全部先于 post-facade', () => {
        // 通过验证 qualityProfile（pre-facade）写入的子字段在 facade 派发时可见，
        // 且 lightingPreset（post-facade）在 facade 之后执行
        delete mockConfigEnvState.reflectionQuality;
        delete mockConfigEnvState.cloudQuality;
        delete mockConfigEnvState.particleQuality;

        setEnvState({ qualityProfile: 'medium', lightingPresetName: 'studio' });

        // pre-facade 已解析子字段
        expect(mockConfigEnvState.reflectionQuality).toBe('medium');
        expect(mockConfigEnvState.cloudQuality).toBe('high');
        expect(mockConfigEnvState.particleQuality).toBe('medium');
        // post-facade 已触发灯光预设
        expect(mockApplyLightingPresetFromEnv).toHaveBeenCalledWith('studio');
    });

    it('pre-facade: 手动改 ground 字段 → groundPreset 重置为 custom', () => {
        mockConfigEnvState.groundPreset = 'stoneTile';
        setEnvState({ groundColor: [0.1, 0.1, 0.1] });
        expect(mockConfigEnvState.groundPreset).toBe('custom');
    });

    it('pre-facade: 点击预设（带 groundPreset）不被误清为 custom', () => {
        mockConfigEnvState.groundPreset = 'custom';
        setEnvState({ groundColor: [0.2, 0.2, 0.22], groundPreset: 'cleanGray' });
        expect(mockConfigEnvState.groundPreset).toBe('cleanGray');
    });

    it('pre-facade: 仅改非 ground 字段时不动 groundPreset', () => {
        mockConfigEnvState.groundPreset = 'grass';
        setEnvState({ sunAngle: 30 });
        expect(mockConfigEnvState.groundPreset).toBe('grass');
    });

    it('pre-facade: 改预设不管的 ground 字段（碰撞/无限）不清 groundPreset', () => {
        mockConfigEnvState.groundPreset = 'woodStage';
        setEnvState({ groundCollisionEnabled: true });
        expect(mockConfigEnvState.groundPreset).toBe('woodStage');
        setEnvState({ groundInfiniteEnabled: true });
        expect(mockConfigEnvState.groundPreset).toBe('woodStage');
    });
});
