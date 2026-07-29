// proc-motion-bridge 拆分 — 骨骼开关 / VPD / 插值覆盖
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROC_STATE, PROC_MOTION_BONE_CATEGORIES } from '../motion-algos/procedural-motion';
import {
    createProcMockState,
    resetProcMockState,
    mockConfig,
    mockAudio,
    mockScene,
    mockVmdLayers,
} from './proc-motion-bridge-mocks';

const mockState = createProcMockState();

vi.mock('../core/config', () => mockConfig(mockState));
vi.mock('../outfit/audio', () => mockAudio(mockState));
vi.mock('../scene/scene', () => mockScene(mockState));
vi.mock('../scene/motion/vmd-layers', () => mockVmdLayers());

type Sut = typeof import('../scene/motion/proc-motion-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/proc-motion-bridge');
    resetProcMockState(mockState);
}, 30000); // 全量并行时 transform 与并行套件争抢资源，放宽 hook 超时

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
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid bone category'));
        warnSpy.mockRestore();
    });

    it('warns and returns for non-boolean value', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sut.setProcMotionBoneToggle('arm', 1 as any);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
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
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
        warnSpy.mockRestore();
    });

    it('calls triggerAutoSave on success', () => {
        sut.setProcMotionVpdApplyEnabled(true);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

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
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value'));
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
