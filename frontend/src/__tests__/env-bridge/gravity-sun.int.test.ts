// env-bridge/gravity-sun.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// Gravity（5）+ Sun Angle（4）= 9 用例

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
    '../../scene/env/env-dispatcher',
    async () => (await import('./env-mocks')).envDispatcherModule
);
vi.mock('../../scene/render/lighting', async () => (await import('./env-mocks')).lightingModule);
vi.mock('../../scene/scene', async () => (await import('./env-mocks')).sceneModule);

import { mockConfigTriggerAutoSave } from './env-mocks';
import { setGravityStrength, getGravityStrength } from '../../scene/env/env-gravity';
import { setEnvSunAngle, getEnvSunAngle } from '../../scene/env/env-time-of-day';

// ──── Gravity ──────────────────────────────────────────────────

describe('Gravity', () => {
    beforeEach(() => {
        setGravityStrength(1.0);
        vi.clearAllMocks();
        // Clear refs triggerAutoSave too since vi.clearAllMocks clears vi.fn() instances
    });

    it('default gravity strength is 1.0', () => {
        expect(getGravityStrength()).toBeCloseTo(1.0);
    });

    it('setGravityStrength/getGravityStrength roundtrip', () => {
        setGravityStrength(0.5);
        expect(getGravityStrength()).toBeCloseTo(0.5);
        setGravityStrength(1.5);
        expect(getGravityStrength()).toBeCloseTo(1.5);
    });

    it('clamps to [0, 2]', () => {
        setGravityStrength(-1);
        expect(getGravityStrength()).toBe(0);
        setGravityStrength(5);
        expect(getGravityStrength()).toBe(2);
    });

    it('roundtrips state correctly', () => {
        setGravityStrength(0.5);
        expect(getGravityStrength()).toBeCloseTo(0.5);
    });

    it('calls triggerAutoSave', () => {
        setGravityStrength(0.8);
        expect(mockConfigTriggerAutoSave).toHaveBeenCalledTimes(1);
    });
});

// ──── Sun Angle ────────────────────────────────────────────────

describe('Sun Angle', () => {
    beforeEach(() => {
        setEnvSunAngle(45);
    });

    it('default is 45', () => {
        expect(getEnvSunAngle()).toBe(45);
    });

    it('setEnvSunAngle/getEnvSunAngle roundtrip', () => {
        setEnvSunAngle(30);
        expect(getEnvSunAngle()).toBe(30);
        setEnvSunAngle(0);
        expect(getEnvSunAngle()).toBe(0);
    });

    it('clamps to [-15, 90]', () => {
        setEnvSunAngle(-30);
        expect(getEnvSunAngle()).toBe(-15);
        setEnvSunAngle(100);
        expect(getEnvSunAngle()).toBe(90);
    });

    it('boundary values are accepted', () => {
        setEnvSunAngle(-15);
        expect(getEnvSunAngle()).toBe(-15);
        setEnvSunAngle(90);
        expect(getEnvSunAngle()).toBe(90);
    });
});
