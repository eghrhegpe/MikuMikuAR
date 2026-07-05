import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROC_STATE, PROC_MOTION_BONE_CATEGORIES } from '../motion-algos/procedural-motion';
import { BeatDetector } from '../motion-algos/beat-detector';

// =====================================================================
// hoisted mock state — shared between vi.mock factories and test body
// =====================================================================

const mockState = vi.hoisted(() => ({
    // --- config mocks ---
    focusedModelId: null as string | null,
    mmdRuntime: null as any,
    triggerAutoSave: vi.fn(),

    // --- audio mocks ---
    isAudioPlaying: vi.fn(() => false),

    // --- scene mocks ---
    modelManager: {
        get: vi.fn(),
    } as any,
    focusedMmdModel: vi.fn(() => null),
    focusedModel: vi.fn(() => null),
    loadVMDMotion: vi.fn().mockResolvedValue(undefined),
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(),
            remove: vi.fn(),
        },
        activeCamera: null,
    } as any,
}));

// =====================================================================
// Mock every external module the SUT imports
// =====================================================================

vi.mock('../core/config', () => ({
    get focusedModelId() { return mockState.focusedModelId; },
    get mmdRuntime() { return mockState.mmdRuntime; },
    triggerAutoSave: mockState.triggerAutoSave,
}));

vi.mock('../outfit/audio', () => ({
    isAudioPlaying: () => mockState.isAudioPlaying(),
}));

vi.mock('../scene/scene', () => ({
    modelManager: mockState.modelManager,
    focusedMmdModel: ((...args: any[]) => (mockState.focusedMmdModel as any)(...args)) as any,
    focusedModel: ((...args: any[]) => (mockState.focusedModel as any)(...args)) as any,
    loadVMDMotion: ((...args: any[]) => (mockState.loadVMDMotion as any)(...args)) as any,
    scene: mockState.scene,
}));

// Note: BeatDetector, procedural-motion algos, and Babylon.js math
// (Quaternion/Vector3/Matrix) are NOT mocked — they are pure data/constants
// that work in the test environment without side effects.

// =====================================================================
// SUT type + dynamic import (fresh module per test via resetModules)
// =====================================================================

type Sut = typeof import('../scene/motion/proc-motion-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/proc-motion-bridge');

    // Reset mock state to defaults
    mockState.focusedModelId = null;
    mockState.mmdRuntime = null;
    mockState.triggerAutoSave.mockReset();
    mockState.isAudioPlaying.mockReset();
    mockState.isAudioPlaying.mockReturnValue(false);
    mockState.modelManager.get.mockReset();
    mockState.focusedMmdModel.mockReset();
    mockState.focusedMmdModel.mockReturnValue(null);
    mockState.focusedModel.mockReset();
    mockState.focusedModel.mockReturnValue(null);
    mockState.loadVMDMotion.mockReset();
    mockState.loadVMDMotion.mockResolvedValue(undefined);
    mockState.scene.onBeforeRenderObservable.add.mockReset();
    mockState.scene.onBeforeRenderObservable.remove.mockReset();
});

// =====================================================================
// isProcVmdActive
// =====================================================================

describe('isProcVmdActive', () => {
    it('returns false initially', () => {
        expect(sut.isProcVmdActive()).toBe(false);
    });
});

// =====================================================================
// setProcMotionMode
// =====================================================================

describe('setProcMotionMode', () => {
    it('sets mode to idle', () => {
        sut.setProcMotionMode('idle');
        expect(sut.getProcMotionState().mode).toBe('idle');
    });

    it('sets mode to autodance', () => {
        sut.setProcMotionMode('autodance');
        expect(sut.getProcMotionState().mode).toBe('autodance');
    });

    it('sets mode to off and stops proc motion', () => {
        sut.setProcMotionMode('off');
        expect(sut.getProcMotionState().mode).toBe('off');
        expect(sut.isProcVmdActive()).toBe(false);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionMode('idle');
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not crash when stopping with no active motion', () => {
        // Default state = off, not active — stopProcMotion is called but is a no-op
        sut.setProcMotionMode('idle');
        sut.setProcMotionMode('off');
        expect(sut.getProcMotionState().mode).toBe('off');
    });
});

// =====================================================================
// setProcMotionIntensity
// =====================================================================

describe('setProcMotionIntensity', () => {
    it('stores the given value', () => {
        sut.setProcMotionIntensity(0.3);
        expect(sut.getProcMotionState().intensity).toBe(0.3);
    });

    it('clamps negative values to 0', () => {
        sut.setProcMotionIntensity(-0.1);
        expect(sut.getProcMotionState().intensity).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        sut.setProcMotionIntensity(1.5);
        expect(sut.getProcMotionState().intensity).toBe(1);
    });

    it('accepts boundary values 0 and 1', () => {
        sut.setProcMotionIntensity(0);
        expect(sut.getProcMotionState().intensity).toBe(0);
        sut.setProcMotionIntensity(1);
        expect(sut.getProcMotionState().intensity).toBe(1);
    });

    it('defaults to DEFAULT_PROC_STATE.intensity', () => {
        expect(sut.getProcMotionState().intensity).toBe(DEFAULT_PROC_STATE.intensity);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionIntensity(0.7);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setProcMotionSpeed
// =====================================================================

describe('setProcMotionSpeed', () => {
    it('stores the given value', () => {
        sut.setProcMotionSpeed(0.8);
        expect(sut.getProcMotionState().speed).toBe(0.8);
    });

    it('clamps below 0.5 to 0.5', () => {
        sut.setProcMotionSpeed(0.1);
        expect(sut.getProcMotionState().speed).toBe(0.5);
    });

    it('clamps above 2 to 2', () => {
        sut.setProcMotionSpeed(3);
        expect(sut.getProcMotionState().speed).toBe(2);
    });

    it('accepts boundary values 0.5 and 2', () => {
        sut.setProcMotionSpeed(0.5);
        expect(sut.getProcMotionState().speed).toBe(0.5);
        sut.setProcMotionSpeed(2);
        expect(sut.getProcMotionState().speed).toBe(2);
    });

    it('defaults to DEFAULT_PROC_STATE.speed', () => {
        expect(sut.getProcMotionState().speed).toBe(DEFAULT_PROC_STATE.speed);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionSpeed(1.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setProcMotionAutoSwitch
// =====================================================================

describe('setProcMotionAutoSwitch', () => {
    it('sets autoSwitch to true', () => {
        sut.setProcMotionAutoSwitch(true);
        expect(sut.getProcMotionState().autoSwitch).toBe(true);
    });

    it('sets autoSwitch to false', () => {
        sut.setProcMotionAutoSwitch(false);
        expect(sut.getProcMotionState().autoSwitch).toBe(false);
    });

    it('defaults to DEFAULT_PROC_STATE.autoSwitch', () => {
        expect(sut.getProcMotionState().autoSwitch).toBe(DEFAULT_PROC_STATE.autoSwitch);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionAutoSwitch(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// getProcMotionState returns a COPY
// =====================================================================

describe('getProcMotionState', () => {
    it('returns a copy — mutating the result does not affect internal state', () => {
        const state = sut.getProcMotionState();
        state.intensity = 0.99;
        expect(sut.getProcMotionState().intensity).toBe(DEFAULT_PROC_STATE.intensity);
    });

    it('returns a new object each call', () => {
        const a = sut.getProcMotionState();
        const b = sut.getProcMotionState();
        expect(a).not.toBe(b);
    });

    it('reflects changes made by setters', () => {
        sut.setProcMotionMode('idle');
        sut.setProcMotionIntensity(0.7);
        sut.setProcMotionSpeed(1.2);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('idle');
        expect(s.intensity).toBe(0.7);
        expect(s.speed).toBe(1.2);
    });

    it('defaults match DEFAULT_PROC_STATE', () => {
        const s = sut.getProcMotionState();
        expect(s.mode).toBe(DEFAULT_PROC_STATE.mode);
        expect(s.intensity).toBe(DEFAULT_PROC_STATE.intensity);
        expect(s.speed).toBe(DEFAULT_PROC_STATE.speed);
        expect(s.autoSwitch).toBe(DEFAULT_PROC_STATE.autoSwitch);
        expect(s.boneToggles).toEqual(DEFAULT_PROC_STATE.boneToggles);
        expect(s.bpmQuantizeEnabled).toBe(DEFAULT_PROC_STATE.bpmQuantizeEnabled);
        expect(s.vpdApplyEnabled).toBe(DEFAULT_PROC_STATE.vpdApplyEnabled);
        expect(s.interpOverride).toBe(DEFAULT_PROC_STATE.interpOverride);
        expect(s.multiMorphEnabled).toBe(DEFAULT_PROC_STATE.multiMorphEnabled);
        expect(s.eyeTrackingEnabled).toBe(DEFAULT_PROC_STATE.eyeTrackingEnabled);
        expect(s.headTrackingEnabled).toBe(DEFAULT_PROC_STATE.headTrackingEnabled);
    });
});

// =====================================================================
// setProcMotionState replaces the state
// =====================================================================

describe('setProcMotionState', () => {
    it('replaces the entire state', () => {
        sut.setProcMotionMode('idle');

        const newState = { ...DEFAULT_PROC_STATE, mode: 'autodance' as const, intensity: 0.9 };
        sut.setProcMotionState(newState);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('autodance');
        expect(s.intensity).toBe(0.9);
        expect(s.speed).toBe(DEFAULT_PROC_STATE.speed);
    });

    it('does not call triggerAutoSave', () => {
        sut.setProcMotionState({ ...DEFAULT_PROC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setProcMotionBoneToggle
// =====================================================================

describe('setProcMotionBoneToggle', () => {
    it('sets a valid bone category to true', () => {
        sut.setProcMotionBoneToggle('arm', false);
        sut.setProcMotionBoneToggle('arm', true);
        expect(sut.getProcMotionState().boneToggles.arm).toBe(true);
    });

    it('sets a valid bone category to false', () => {
        sut.setProcMotionBoneToggle('arm', false);
        expect(sut.getProcMotionState().boneToggles.arm).toBe(false);
    });

    it('warns and returns for invalid bone category', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('nonexistent' as any, true);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid bone category')
        );
        warnSpy.mockRestore();
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('arm', 1 as any);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value type')
        );
        warnSpy.mockRestore();
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionBoneToggle('arm', false);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid category', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('nonexistent' as any, false);
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('all toggles default true from DEFAULT_PROC_STATE', () => {
        const s = sut.getProcMotionState();
        for (const cat of PROC_MOTION_BONE_CATEGORIES) {
            expect(s.boneToggles[cat]).toBe(true);
        }
    });
});

// =====================================================================
// setProcMotionBoneToggles
// =====================================================================

describe('setProcMotionBoneToggles', () => {
    it('sets multiple toggles at once', () => {
        sut.setProcMotionBoneToggles({ arm: false, head: false });
        const s = sut.getProcMotionState();
        expect(s.boneToggles.arm).toBe(false);
        expect(s.boneToggles.head).toBe(false);
        // Other toggles remain default
        expect(s.boneToggles.waist).toBe(true);
    });

    it('warns and returns when a value is not boolean', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggles({ arm: false, head: 'yes' as any });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value type for key "head"')
        );
        warnSpy.mockRestore();
        // No toggles should have been applied
        expect(sut.getProcMotionState().boneToggles.arm).toBe(true);
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionBoneToggles({ arm: false });
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggles({ arm: 'bad' as any });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// =====================================================================
// setProcMotionVpdApplyEnabled
// =====================================================================

describe('setProcMotionVpdApplyEnabled', () => {
    it('sets vpdApplyEnabled to true', () => {
        sut.setProcMotionVpdApplyEnabled(true);
        expect(sut.getProcMotionState().vpdApplyEnabled).toBe(true);
    });

    it('sets vpdApplyEnabled to false', () => {
        sut.setProcMotionVpdApplyEnabled(true);
        sut.setProcMotionVpdApplyEnabled(false);
        expect(sut.getProcMotionState().vpdApplyEnabled).toBe(false);
    });

    it('defaults to DEFAULT_PROC_STATE.vpdApplyEnabled', () => {
        expect(sut.getProcMotionState().vpdApplyEnabled).toBe(DEFAULT_PROC_STATE.vpdApplyEnabled);
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionVpdApplyEnabled('yes' as any);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value type')
        );
        warnSpy.mockRestore();
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionVpdApplyEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

// =====================================================================
// setProcMotionInterpOverride
// =====================================================================

describe('setProcMotionInterpOverride', () => {
    it('sets a valid override value', () => {
        sut.setProcMotionInterpOverride('sharp');
        expect(sut.getProcMotionState().interpOverride).toBe('sharp');
    });

    it('accepts all valid values', () => {
        const valid = ['auto', 'sharp', 'ease-in-out', 'ease-out'] as const;
        for (const v of valid) {
            sut.setProcMotionInterpOverride(v);
            expect(sut.getProcMotionState().interpOverride).toBe(v);
        }
    });

    it('warns and returns for invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionInterpOverride('invalid' as any);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value')
        );
        warnSpy.mockRestore();
    });

    it('defaults to DEFAULT_PROC_STATE.interpOverride', () => {
        expect(sut.getProcMotionState().interpOverride).toBe(DEFAULT_PROC_STATE.interpOverride);
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionInterpOverride('ease-out');
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('does not call triggerAutoSave on invalid value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionInterpOverride('bad' as any);
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// =====================================================================
// setBpmQuantizeEnabled / getBpmQuantizeEnabled
// =====================================================================

describe('setBpmQuantizeEnabled / getBpmQuantizeEnabled', () => {
    it('getBpmQuantizeEnabled returns true when no beat detector exists', () => {
        // Default state: procBeatDetector is null
        expect(sut.getBpmQuantizeEnabled()).toBe(true);
    });

    it('setBpmQuantizeEnabled is a no-op when no beat detector exists (no crash)', () => {
        expect(() => sut.setBpmQuantizeEnabled(false)).not.toThrow();
        expect(() => sut.setBpmQuantizeEnabled(true)).not.toThrow();
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setBpmQuantizeEnabled('yes' as any);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('invalid value type')
        );
        warnSpy.mockRestore();
    });

    it('delegates to a real BeatDetector when one exists', () => {
        // Create a beat detector via the exported factory
        const bd = sut.createProcBeatDetector();

        // At this point procBeatDetector is set internally
        sut.setBpmQuantizeEnabled(false);
        expect(bd.getBpmQuantizeEnabled()).toBe(false);
        expect(sut.getBpmQuantizeEnabled()).toBe(false);

        sut.setBpmQuantizeEnabled(true);
        expect(bd.getBpmQuantizeEnabled()).toBe(true);
        expect(sut.getBpmQuantizeEnabled()).toBe(true);
    });

    it('getBpmQuantizeEnabled reads from the real beat detector after creation', () => {
        sut.createProcBeatDetector();
        sut.setBpmQuantizeEnabled(false);
        expect(sut.getBpmQuantizeEnabled()).toBe(false);
    });
});

// =====================================================================
// setProcMotionEyeTrackingEnabled / setProcMotionHeadTrackingEnabled
// =====================================================================

describe('setProcMotionEyeTrackingEnabled', () => {
    it('sets eyeTrackingEnabled in state', () => {
        sut.setProcMotionEyeTrackingEnabled(false);
        expect(sut.getProcMotionState().eyeTrackingEnabled).toBe(false);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionEyeTrackingEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('defaults to DEFAULT_PROC_STATE.eyeTrackingEnabled', () => {
        expect(sut.getProcMotionState().eyeTrackingEnabled).toBe(DEFAULT_PROC_STATE.eyeTrackingEnabled);
    });
});

describe('setProcMotionHeadTrackingEnabled', () => {
    it('sets headTrackingEnabled in state', () => {
        sut.setProcMotionHeadTrackingEnabled(true);
        expect(sut.getProcMotionState().headTrackingEnabled).toBe(true);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionHeadTrackingEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });

    it('defaults to DEFAULT_PROC_STATE.headTrackingEnabled', () => {
        expect(sut.getProcMotionState().headTrackingEnabled).toBe(DEFAULT_PROC_STATE.headTrackingEnabled);
    });
});

// =====================================================================
// stopProcMotion (direct call)
// =====================================================================

describe('stopProcMotion', () => {
    it('sets isProcVmdActive to false', () => {
        sut.stopProcMotion();
        expect(sut.isProcVmdActive()).toBe(false);
    });

    it('does not crash when called multiple times', () => {
        sut.stopProcMotion();
        sut.stopProcMotion();
        sut.stopProcMotion();
        expect(sut.isProcVmdActive()).toBe(false);
    });
});

// =====================================================================
// regenerateProcMotion — guard behavior
// =====================================================================

describe('regenerateProcMotion — guard returns early', () => {
    it('returns early when mode is off and not active', () => {
        // Default state: mode='off', _procVmdActive=false
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.regenerateProcMotion();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(mockState.loadVMDMotion).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('returns early with warning when no focused MMD model', () => {
        // Change mode so the first guard passes
        sut.setProcMotionMode('idle');
        // focusedMmdModel is already mocked to return null

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.regenerateProcMotion();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('无焦点')
        );
        expect(mockState.loadVMDMotion).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// =====================================================================
// triggerAutoSave interaction (summary)
// =====================================================================

describe('triggerAutoSave interaction', () => {
    it('setProcMotionMode triggers auto-save', () => {
        sut.setProcMotionMode('idle');
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionIntensity triggers auto-save', () => {
        sut.setProcMotionIntensity(0.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionSpeed triggers auto-save', () => {
        sut.setProcMotionSpeed(1.0);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionAutoSwitch triggers auto-save', () => {
        sut.setProcMotionAutoSwitch(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalled();
    });

    it('setProcMotionState does NOT trigger auto-save', () => {
        sut.setProcMotionState({ ...DEFAULT_PROC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });

    it('stopProcMotion does NOT trigger auto-save', () => {
        sut.stopProcMotion();
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});
