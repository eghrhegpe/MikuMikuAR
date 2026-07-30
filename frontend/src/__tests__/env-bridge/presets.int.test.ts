// env-bridge/presets.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// applyEnvPreset（4）+ applyEnvPresetObject（6）+ _presetAnimId cancellation（2）= 12 用例

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

import {
    mockConfigEnvState,
    mockDeriveLighting,
    mockSetLightState,
    mockSetSkipLightAutoSave,
} from './env-mocks';
import {
    applyEnvPreset,
    applyEnvPresetObject,
    getEnvSunAngle,
} from '../../scene/env/env-time-of-day';

// ──── applyEnvPreset ───────────────────────────────────────────

describe('applyEnvPreset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true for a valid preset name', () => {
        const result = applyEnvPreset('noon');
        expect(result).toBe(true);
    });

    it('returns false for an invalid preset name', () => {
        const result = applyEnvPreset('nonexistent');
        expect(result).toBe(false);
    });

    it('returns false for empty preset name', () => {
        const result = applyEnvPreset('');
        expect(result).toBe(false);
    });

    it('calls setSkipLightAutoSave(true) at start', () => {
        applyEnvPreset('noon');
        expect(mockSetSkipLightAutoSave).toHaveBeenCalledWith(true);
    });
});

// ──── applyEnvPresetObject ─────────────────────────────────────

describe('applyEnvPresetObject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.assign(mockConfigEnvState, {
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets envSunAngle from preset', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(getEnvSunAngle()).toBe(30);
    });

    it('returns true', () => {
        const result = applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(result).toBe(true);
    });

    it('uses deriveLighting when dirDirection is not provided', () => {
        applyEnvPresetObject({
            label: 'sunset',
            skyColorTop: [0.9, 0.45, 0.2],
            skyColorBot: [0.6, 0.2, 0.1],
            sunAngle: 15,
            azimuth: 90,
        });
        expect(mockDeriveLighting).toHaveBeenCalledWith([0.9, 0.45, 0.2], 15, 90);
    });

    it('skips deriveLighting when dirDirection is provided', () => {
        applyEnvPresetObject({
            label: 'noon',
            skyColorTop: [0.53, 0.71, 0.91],
            skyColorBot: [0.3, 0.5, 0.8],
            sunAngle: 75,
            azimuth: -45,
            dirDiffuse: [0.95, 0.95, 0.95],
            dirDirection: [0.3, 0.9, -0.3],
            dirIntensity: 0.9,
            hemiIntensity: 0.5,
        });
        expect(mockDeriveLighting).not.toHaveBeenCalled();
    });

    it('calls setSkipLightAutoSave(true) at start and (false) on completion', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        expect(mockSetSkipLightAutoSave).toHaveBeenCalledWith(true);

        vi.advanceTimersByTime(2500);
        const falseCalls = mockSetSkipLightAutoSave.mock.calls.filter(
            (call: any[]) => call[0] === false
        );
        expect(falseCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('calls setLightState during animation', () => {
        applyEnvPresetObject({
            label: 'test',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });
        vi.advanceTimersByTime(100);
        expect(mockSetLightState).toHaveBeenCalled();
    });
});

// ──── _presetAnimId cancellation ───────────────────────────────

describe('_presetAnimId cancellation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        Object.assign(mockConfigEnvState, {
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('second preset cancels first: only one completion fires setSkipLightAutoSave(false)', () => {
        // Start first animation
        applyEnvPresetObject({
            label: 'first',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });

        // Start second animation (cancels first via _presetAnimId)
        applyEnvPresetObject({
            label: 'second',
            skyColorTop: [0.5, 0.6, 0.7],
            skyColorBot: [0.8, 0.9, 1.0],
            sunAngle: 60,
        });

        mockSetSkipLightAutoSave.mockClear();
        vi.advanceTimersByTime(3000);

        // setSkipLightAutoSave(false) fires only once:
        // Cancellation does NOT reset flag (new animation has taken over)
        expect(mockSetSkipLightAutoSave).toHaveBeenLastCalledWith(false);
        const falseCalls = mockSetSkipLightAutoSave.mock.calls.filter(
            (call: any[]) => call[0] === false
        );
        expect(falseCalls.length).toBe(1);
    });

    it('completing second preset calls setLightState at completion', () => {
        applyEnvPresetObject({
            label: 'first',
            skyColorTop: [0.1, 0.2, 0.3],
            skyColorBot: [0.4, 0.5, 0.6],
            sunAngle: 30,
        });

        mockSetLightState.mockClear();

        applyEnvPresetObject({
            label: 'second',
            skyColorTop: [0.5, 0.6, 0.7],
            skyColorBot: [0.8, 0.9, 1.0],
            sunAngle: 60,
        });

        vi.advanceTimersByTime(3000);
        expect(mockSetLightState).toHaveBeenCalled();
    });
});
