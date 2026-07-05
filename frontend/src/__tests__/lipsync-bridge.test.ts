import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_LIPSYNC_STATE } from '../motion-algos/lipsync';

// =====================================================================
// hoisted mock state — shared between vi.mock factories and test body
// =====================================================================

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    setModelMorphWeight: vi.fn(),
    getProcBeatDetector: vi.fn(() => null),
}));

// =====================================================================
// Mock every external module the SUT imports
// =====================================================================

vi.mock('../core/config', () => ({
    get focusedModelId() { return mockState.focusedModelId; },
    triggerAutoSave: mockState.triggerAutoSave,
}));

vi.mock('../outfit/audio', () => ({
    isAudioPlaying: () => mockState.isAudioPlaying(),
    getAudioPath: () => mockState.getAudioPath(),
}));

vi.mock('../scene/scene', () => ({
    setModelMorphWeight: ((...args: any[]) => (mockState.setModelMorphWeight as any)(...args)) as any,
}));

vi.mock('../scene/motion/proc-motion-bridge', () => ({
    getProcBeatDetector: () => mockState.getProcBeatDetector(),
}));

// =====================================================================
// SUT type + dynamic import (fresh module per test via resetModules)
// =====================================================================

type Sut = typeof import('../scene/motion/lipsync-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/lipsync-bridge');

    // Reset all mock state to known defaults
    mockState.focusedModelId = null;
    mockState.triggerAutoSave.mockReset();
    mockState.isAudioPlaying.mockReset();
    mockState.isAudioPlaying.mockReturnValue(false);
    mockState.getAudioPath.mockReset();
    mockState.getAudioPath.mockReturnValue('');
    mockState.setModelMorphWeight.mockReset();
    mockState.getProcBeatDetector.mockReset();
    mockState.getProcBeatDetector.mockReturnValue(null);
});

// =====================================================================
// setLipSyncEnabled / getLipSyncState
// =====================================================================

describe('setLipSyncEnabled', () => {
    it('sets enabled=true then getLipSyncState().enabled is true', () => {
        sut.setLipSyncEnabled(true);
        expect(sut.getLipSyncState().enabled).toBe(true);
    });

    it('sets enabled=false then getLipSyncState().enabled is false', () => {
        sut.setLipSyncEnabled(false);
        expect(sut.getLipSyncState().enabled).toBe(false);
    });

    it('calls triggerAutoSave', () => {
        sut.setLipSyncEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not set morph weight when no lipSyncMorphName is cached (no-op)', () => {
        // lipSyncMorphName starts null; even with focusedModelId set,
        // resetLipMorph() bails early
        mockState.focusedModelId = 'model-1';
        sut.setLipSyncEnabled(false);
        expect(mockState.setModelMorphWeight).not.toHaveBeenCalled();
    });

    it('does not call setModelMorphWeight when focusedModelId is null', () => {
        sut.setLipSyncEnabled(true);
        sut.setLipSyncEnabled(false);
        expect(mockState.setModelMorphWeight).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setLipSyncSensitivity
// =====================================================================

describe('setLipSyncSensitivity', () => {
    it('stores the given value in state', () => {
        sut.setLipSyncSensitivity(0.7);
        expect(sut.getLipSyncState().sensitivity).toBe(0.7);
    });

    it('clamps negative values to 0', () => {
        sut.setLipSyncSensitivity(-0.5);
        expect(sut.getLipSyncState().sensitivity).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        sut.setLipSyncSensitivity(1.5);
        expect(sut.getLipSyncState().sensitivity).toBe(1);
    });

    it('accepts boundary values 0 and 1', () => {
        sut.setLipSyncSensitivity(0);
        expect(sut.getLipSyncState().sensitivity).toBe(0);
        sut.setLipSyncSensitivity(1);
        expect(sut.getLipSyncState().sensitivity).toBe(1);
    });

    it('defaults to DEFAULT_LIPSYNC_STATE.sensitivity', () => {
        expect(sut.getLipSyncState().sensitivity).toBe(DEFAULT_LIPSYNC_STATE.sensitivity);
    });

    it('calls triggerAutoSave', () => {
        sut.setLipSyncSensitivity(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setLipSyncIntensity
// =====================================================================

describe('setLipSyncIntensity', () => {
    it('stores the given value in state', () => {
        sut.setLipSyncIntensity(0.3);
        expect(sut.getLipSyncState().intensity).toBe(0.3);
    });

    it('clamps negative values to 0', () => {
        sut.setLipSyncIntensity(-1);
        expect(sut.getLipSyncState().intensity).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        sut.setLipSyncIntensity(2);
        expect(sut.getLipSyncState().intensity).toBe(1);
    });

    it('accepts boundary values 0 and 1', () => {
        sut.setLipSyncIntensity(0);
        expect(sut.getLipSyncState().intensity).toBe(0);
        sut.setLipSyncIntensity(1);
        expect(sut.getLipSyncState().intensity).toBe(1);
    });

    it('defaults to DEFAULT_LIPSYNC_STATE.intensity', () => {
        expect(sut.getLipSyncState().intensity).toBe(DEFAULT_LIPSYNC_STATE.intensity);
    });

    it('calls triggerAutoSave', () => {
        sut.setLipSyncIntensity(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setLipSyncMultiMorphEnabled
// =====================================================================

describe('setLipSyncMultiMorphEnabled', () => {
    it('sets multiMorphEnabled to true', () => {
        sut.setLipSyncMultiMorphEnabled(true);
        expect(sut.getLipSyncState().multiMorphEnabled).toBe(true);
    });

    it('sets multiMorphEnabled to false', () => {
        sut.setLipSyncMultiMorphEnabled(true);
        sut.setLipSyncMultiMorphEnabled(false);
        expect(sut.getLipSyncState().multiMorphEnabled).toBe(false);
    });

    it('defaults to DEFAULT_LIPSYNC_STATE.multiMorphEnabled', () => {
        expect(sut.getLipSyncState().multiMorphEnabled).toBe(DEFAULT_LIPSYNC_STATE.multiMorphEnabled);
    });

    it('calls triggerAutoSave', () => {
        sut.setLipSyncMultiMorphEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// getLipSyncState returns a COPY
// =====================================================================

describe('getLipSyncState', () => {
    it('returns a copy — mutating the result does not affect internal state', () => {
        const state = sut.getLipSyncState();
        state.enabled = true;
        // Internal state should still be the default (enabled: false)
        expect(sut.getLipSyncState().enabled).toBe(DEFAULT_LIPSYNC_STATE.enabled);
    });

    it('returns a new object each call', () => {
        const a = sut.getLipSyncState();
        const b = sut.getLipSyncState();
        expect(a).not.toBe(b);
    });

    it('reflects changes made by setters', () => {
        sut.setLipSyncEnabled(true);
        sut.setLipSyncSensitivity(0.9);
        sut.setLipSyncIntensity(0.1);
        sut.setLipSyncMultiMorphEnabled(true);

        const s = sut.getLipSyncState();
        expect(s.enabled).toBe(true);
        expect(s.sensitivity).toBe(0.9);
        expect(s.intensity).toBe(0.1);
        expect(s.multiMorphEnabled).toBe(true);
    });

    it('defaults match DEFAULT_LIPSYNC_STATE', () => {
        const s = sut.getLipSyncState();
        expect(s.enabled).toBe(DEFAULT_LIPSYNC_STATE.enabled);
        expect(s.sensitivity).toBe(DEFAULT_LIPSYNC_STATE.sensitivity);
        expect(s.intensity).toBe(DEFAULT_LIPSYNC_STATE.intensity);
        expect(s.multiMorphEnabled).toBe(DEFAULT_LIPSYNC_STATE.multiMorphEnabled);
    });
});

// =====================================================================
// setLipSyncState replaces the state
// =====================================================================

describe('setLipSyncState', () => {
    it('replaces the entire state', () => {
        const newState = {
            enabled: true,
            sensitivity: 0.5,
            intensity: 0.6,
            multiMorphEnabled: true,
        };
        sut.setLipSyncState(newState);
        expect(sut.getLipSyncState()).toEqual(newState);
    });

    it('state is replaced, not merged', () => {
        // Set some fields via setters first
        sut.setLipSyncEnabled(true);
        sut.setLipSyncIntensity(0.9);

        // Then replace entire state with a minimal object
        const partial = { enabled: false, sensitivity: 0.1, intensity: 0.2, multiMorphEnabled: true };
        sut.setLipSyncState(partial);
        expect(sut.getLipSyncState()).toEqual(partial);

        // intensity should be 0.2 (from partial), not the earlier 0.9
        expect(sut.getLipSyncState().intensity).toBe(0.2);
    });

    it('accepts the default state object', () => {
        sut.setLipSyncEnabled(true); // change from default
        sut.setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
        expect(sut.getLipSyncState().enabled).toBe(false);
    });

    it('does not call triggerAutoSave', () => {
        sut.setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});

// =====================================================================
// resetLipSyncOnFocusChange
// =====================================================================

describe('resetLipSyncOnFocusChange', () => {
    it('does not throw when called', () => {
        expect(() => sut.resetLipSyncOnFocusChange()).not.toThrow();
    });

    it('can be called multiple times', () => {
        sut.resetLipSyncOnFocusChange();
        sut.resetLipSyncOnFocusChange();
        sut.resetLipSyncOnFocusChange();
        // State should remain valid
        expect(sut.getLipSyncState().enabled).toBe(false);
    });
});

// =====================================================================
// updateLipSync — early returns
// =====================================================================

describe('updateLipSync — early returns', () => {
    it('returns early when disabled', () => {
        // enabled is false by default
        sut.updateLipSync();
        // No external calls should happen
        expect(mockState.isAudioPlaying).not.toHaveBeenCalled();
        expect(mockState.getAudioPath).not.toHaveBeenCalled();
        expect(mockState.setModelMorphWeight).not.toHaveBeenCalled();
    });

    it('returns early when focusedModelId is null', () => {
        sut.setLipSyncEnabled(true);
        // focusedModelId is null by default in mocks
        sut.updateLipSync();
        // Should have checked isAudioPlaying (decay path) but not set morph weight
        // Actually with focusedModelId=null, the path is:
        //   enabled check pass → audio path check → isAudioPlaying? ... depends on mock
        //   → modelId = null → modelId !== lastFocusedId (null !== null = false)
        //   → !modelId → true → return
        // So isAudioPlaying and getAudioPath might be called
        expect(mockState.setModelMorphWeight).not.toHaveBeenCalled();
    });

    it('returns early when focusedModelId is null after audio path check', () => {
        sut.setLipSyncEnabled(true);
        mockState.focusedModelId = null;
        sut.updateLipSync();
        // Should not set any morph weights
        expect(mockState.setModelMorphWeight).not.toHaveBeenCalled();
    });
});

// =====================================================================
// triggerAutoSave interaction
// =====================================================================

describe('triggerAutoSave interaction', () => {
    it('setLipSyncEnabled triggers auto-save', () => {
        sut.setLipSyncEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setLipSyncSensitivity triggers auto-save', () => {
        sut.setLipSyncSensitivity(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setLipSyncIntensity triggers auto-save', () => {
        sut.setLipSyncIntensity(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setLipSyncMultiMorphEnabled triggers auto-save', () => {
        sut.setLipSyncMultiMorphEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setLipSyncState does NOT trigger auto-save', () => {
        sut.setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('resetLipSyncOnFocusChange does NOT trigger auto-save', () => {
        sut.resetLipSyncOnFocusChange();
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});
