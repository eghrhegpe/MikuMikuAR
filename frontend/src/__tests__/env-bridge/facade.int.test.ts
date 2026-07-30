// env-bridge/facade.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// _applyEnvStateFacade via setEnvState（13）+ Module-level edge cases（1）= 14 用例

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
    mockConfigEnvState,
    mockGetHemiLight,
    mockGetLightState,
    mockImplApplyFog,
    mockImplApplyGround,
    mockImplApplySky,
    mockImplCreateClouds,
    mockImplCreateParticleEmitter,
    mockImplCreateWater,
    mockImplDisposeClouds,
    mockImplDisposeParticles,
    mockImplDisposeWater,
    mockSceneInstance,
} from './env-mocks';
import { setEnvState } from '../../scene/env/_bridge/env-bridge';

// ──── envState facade (via setEnvState) ────────────────────────

describe('_applyEnvStateFacade (via setEnvState)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset envState defaults
        Object.assign(mockConfigEnvState, {
            skyMode: 'color',
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            iblIntensity: 2,
            groundColor: [0.15, 0.15, 0.18],
            waterEnabled: false,
            particleEnabled: false,
            particleType: 'none',
            cloudEnabled: false,
            windEnabled: true,
            fogEnabled: false,
        });
    });

    it('calls only the relevant subsystems for changed keys', () => {
        setEnvState({ skyMode: 'procedural' });
        expect(mockImplApplySky).toHaveBeenCalled();
        expect(mockImplApplyGround).not.toHaveBeenCalled();
        expect(mockImplApplyFog).not.toHaveBeenCalled();
    });

    it('calls all subsystems when keys from all groups change', () => {
        setEnvState({
            skyMode: 'procedural',
            groundType: 'flat',
            groundStyle: 'solid',
            fogEnabled: true,
        });
        expect(mockImplApplySky).toHaveBeenCalled();
        expect(mockImplApplyGround).toHaveBeenCalled();
        expect(mockImplApplyFog).toHaveBeenCalled();
    });

    it('creates water when waterEnabled is true', () => {
        mockConfigEnvState.waterEnabled = true;
        setEnvState({ waterEnabled: true });
        expect(mockImplCreateWater).toHaveBeenCalled();
        expect(mockImplDisposeWater).not.toHaveBeenCalled();
    });

    it('disposes water when waterEnabled is false', () => {
        setEnvState({ waterEnabled: false });
        expect(mockImplDisposeWater).toHaveBeenCalled();
        expect(mockImplCreateWater).not.toHaveBeenCalled();
    });

    it('creates particles when enabled with valid type', () => {
        mockConfigEnvState.particleEnabled = true;
        mockConfigEnvState.particleType = 'sakura';
        setEnvState({ particleEnabled: true, particleType: 'sakura' });
        expect(mockImplCreateParticleEmitter).toHaveBeenCalledWith('sakura', true);
        expect(mockImplDisposeParticles).not.toHaveBeenCalled();
    });

    it('disposes particles when particleType is none', () => {
        setEnvState({ particleEnabled: false });
        expect(mockImplDisposeParticles).toHaveBeenCalled();
        expect(mockImplCreateParticleEmitter).not.toHaveBeenCalled();
    });

    it('creates clouds when cloudEnabled is true', () => {
        mockConfigEnvState.cloudEnabled = true;
        setEnvState({ cloudEnabled: true });
        expect(mockImplCreateClouds).toHaveBeenCalled();
        expect(mockImplDisposeClouds).not.toHaveBeenCalled();
    });

    it('disposes clouds when cloudEnabled is false', () => {
        setEnvState({ cloudEnabled: false });
        expect(mockImplDisposeClouds).toHaveBeenCalled();
        expect(mockImplCreateClouds).not.toHaveBeenCalled();
    });

    it('updates hemiLight intensity from getLightState()', () => {
        mockGetLightState.mockReturnValueOnce({
            hemiIntensity: 0.6,
            dirIntensity: 0.4,
            dirX: 0,
            dirY: 1,
            dirZ: 0,
            dirColor: [1, 1, 1],
            hemiColor: [1, 1, 1],
            groundColor: [0.3, 0.3, 0.4],
            shadowEnabled: false,
            shadowType: 'soft',
            shadowCascades: 2,
            shadowResolution: 1024,
            shadowBias: 0.0001,
        });
        setEnvState({ skyMode: 'procedural' });
        expect(mockGetHemiLight()!.intensity).toBe(0.6);
    });

    it('sets hemiLight.diffuse from skyColorMid when present', () => {
        mockConfigEnvState.skyColorMid = [0.7, 0.7, 0.8];
        setEnvState({ skyMode: 'procedural' });
        expect(mockGetHemiLight()!.diffuse.r).toBe(0.7);
        expect(mockGetHemiLight()!.diffuse.g).toBe(0.7);
        expect(mockGetHemiLight()!.diffuse.b).toBe(0.8);
    });

    it('computes hemiLight.diffuse as average of top/bot when skyColorMid absent', () => {
        delete mockConfigEnvState.skyColorMid;
        mockConfigEnvState.skyColorTop = [0.4, 0.6, 0.9];
        mockConfigEnvState.skyColorBot = [0.2, 0.4, 0.7];
        setEnvState({});
        const avgR = (0.4 + 0.2) / 2;
        const avgG = (0.6 + 0.4) / 2;
        const avgB = (0.9 + 0.7) / 2;
        expect(mockGetHemiLight()!.diffuse.r).toBeCloseTo(avgR);
        expect(mockGetHemiLight()!.diffuse.g).toBeCloseTo(avgG);
        expect(mockGetHemiLight()!.diffuse.b).toBeCloseTo(avgB);
    });

    it('sets hemiLight.groundColor from skyColorBot', () => {
        setEnvState({});
        // groundColor 从 skyColorBot 派生，保持三色统一
        expect(mockGetHemiLight()!.groundColor.r).toBeCloseTo(0.2);
        expect(mockGetHemiLight()!.groundColor.g).toBeCloseTo(0.2);
        expect(mockGetHemiLight()!.groundColor.b).toBeCloseTo(0.25);
    });

    it('sets scene.ambientColor based on iblIntensity (capped at 0.5)', () => {
        mockConfigEnvState.iblIntensity = 2;
        mockConfigEnvState.skyColorMid = [0.8, 0.8, 0.9];
        setEnvState({});
        expect(mockSceneInstance.ambientColor.r).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.g).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.b).toBeGreaterThan(0);
        expect(mockSceneInstance.ambientColor.r).toBeLessThanOrEqual(0.5);
    });
});

// ──── Edge cases ───────────────────────────────────────────────

describe('Module-level edge cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('setEnvState catches errors in applySky', () => {
        mockImplApplySky.mockImplementationOnce(() => {
            throw new Error('sky error');
        });
        expect(() => {
            setEnvState({ skyMode: 'procedural', groundColor: [0.5, 0.5, 0.5] });
        }).not.toThrow();
        expect(mockImplApplyGround).toHaveBeenCalled();
    });
});
