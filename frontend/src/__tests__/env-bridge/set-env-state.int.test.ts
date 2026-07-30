// env-bridge/set-env-state.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// setEnvState 中央入口（13 用例）

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
    '../../scene/env/env-dispatcher',
    async () => (await import('./env-mocks')).envDispatcherModule
);
vi.mock('../../scene/render/lighting', async () => (await import('./env-mocks')).lightingModule);
vi.mock('../../scene/scene', async () => (await import('./env-mocks')).sceneModule);

import {
    mockApplyLightingPresetFromEnv,
    mockConfigEnvState,
    mockConfigTriggerAutoSave,
    mockImplApplySky,
    mockImplUpdateWaterAnimSpeed,
    mockSetEnvState,
} from './env-mocks';
import { setEnvState } from '../../scene/env/_bridge/env-bridge';

// ──── setEnvState (central entry) ──────────────────────────────

describe('setEnvState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(globalThis, 'setTimeout');
        vi.spyOn(globalThis, 'clearTimeout');
        Object.assign(mockConfigEnvState, {
            skyMode: 'color',
            skyColorTop: [0.3, 0.5, 0.8],
            skyColorMid: [0.8, 0.8, 0.9],
            skyColorBot: [0.2, 0.2, 0.25],
            sunAngle: 45,
            azimuth: -45,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('merges partial state into envState', () => {
        setEnvState({ sunAngle: 60 });
        expect(mockConfigEnvState.sunAngle).toBe(60);
    });

    it('calls _applyEnvStateFacade (applySky)', () => {
        setEnvState({ skyMode: 'procedural' });
        expect(mockImplApplySky).toHaveBeenCalled();
    });

    it('does NOT call updateWaterAnimSpeed from setEnvState (handled by _syncWaterUniforms)', () => {
        setEnvState({ waterAnimSpeed: 2 });
        // waterAnimSpeed 由 _applyEnvStateFacade → createWater → _syncWaterUniforms 统一处理，
        // 不再由 setEnvState 直接调用 updateWaterAnimSpeed
        expect(mockImplUpdateWaterAnimSpeed).not.toHaveBeenCalled();
    });

    it('does NOT call updateWaterAnimSpeed when waterAnimSpeed is undefined', () => {
        setEnvState({ skyMode: 'color' });
        expect(mockImplUpdateWaterAnimSpeed).not.toHaveBeenCalled();
    });

    it('calls applyLightingPresetFromEnv when lightingPresetName provided', () => {
        setEnvState({ lightingPresetName: 'dramatic' });
        expect(mockApplyLightingPresetFromEnv).toHaveBeenCalledWith('dramatic');
    });

    it('does NOT call applyLightingPresetFromEnv when lightingPresetName is undefined', () => {
        setEnvState({ skyMode: 'color' });
        expect(mockApplyLightingPresetFromEnv).not.toHaveBeenCalled();
    });

    it('sets a persistent timer (calls setTimeout)', () => {
        setEnvState({ sunAngle: 50 });
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('debounces persistent timer (calls clearTimeout on consecutive calls)', () => {
        setEnvState({ sunAngle: 50 });
        setEnvState({ sunAngle: 55 });
        expect(clearTimeout).toHaveBeenCalled();
        expect((setTimeout as any).mock.calls.length).toBe(2);
    });

    it('fires SetEnvState via timer callback', async () => {
        setEnvState({ sunAngle: 50 });
        const callback = (setTimeout as any).mock.calls[0][0];
        expect(callback).toBeInstanceOf(Function);
        callback();
        // [ADR-176] persistEnvState 内部 await resolveBackend() 后才调用 SetEnvState，
        // 需 flush microtask 让 Promise 链 settle。
        await new Promise((r) => setTimeout(r, 0));
        expect(mockSetEnvState).toHaveBeenCalled();
    });

    it('calls triggerAutoSave by default', () => {
        setEnvState({ sunAngle: 50 });
        expect(mockConfigTriggerAutoSave).toHaveBeenCalledTimes(1);
    });

    it('skips triggerAutoSave when skipAutoSave=true', () => {
        setEnvState({ sunAngle: 50 }, true);
        expect(mockConfigTriggerAutoSave).not.toHaveBeenCalled();
    });

    it('still sets persistent timer when skipAutoSave=true', () => {
        setEnvState({ sunAngle: 50 }, true);
        expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it('clears previous timer when setting new one (debounce)', () => {
        setEnvState({ sunAngle: 50 });
        setEnvState({ sunAngle: 55 });
        // clearTimeout is called because _envPersistTimer was non-null from first call
        expect(clearTimeout).toHaveBeenCalled();
        // setTimeout should be called twice (once per setEnvState call)
        expect(setTimeout).toHaveBeenCalledTimes(2);
    });
});
