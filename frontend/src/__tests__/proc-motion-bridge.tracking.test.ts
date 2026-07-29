// proc-motion-bridge 拆分 — BPM 量化 / 眼球·头部追踪 / 停止
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROC_STATE, PROC_MOTION_BONE_CATEGORIES } from '../motion-algos/procedural-motion';
import {
    createProcMockState,
    resetProcMockState,
    mockConfig,
    mockAudio,
    mockScene,
    mockVmdLayers,
    mockPerception,
    mockMotionIntent,
    mockBeatDetector,
} from './proc-motion-bridge-mocks';

const mockState = createProcMockState();

vi.mock('../core/config', () => mockConfig(mockState));
vi.mock('../outfit/audio', () => mockAudio(mockState));
vi.mock('../scene/scene', () => mockScene(mockState));
vi.mock('../scene/motion/vmd-layers', () => mockVmdLayers());
vi.mock('../scene/motion/perception', () => mockPerception(mockState));
vi.mock('../scene/motion/motion-intent', () => mockMotionIntent(mockState));
vi.mock('../motion-algos/beat-detector', () => mockBeatDetector(mockState));
vi.mock('../motion-algos/proc-motion-idle', () => ({ generateIdleVmd: () => new ArrayBuffer(0) }));
vi.mock('../motion-algos/proc-motion-autodance', () => ({ generateAutoDanceVmd: () => new ArrayBuffer(0) }));

type Sut = typeof import('../scene/motion/proc-motion-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/proc-motion-bridge');
    resetProcMockState(mockState);
}, 30000); // 全量并行时 transform 与并行套件争抢资源，放宽 hook 超时

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
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid value type'));
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
        expect(sut.getProcMotionState().eyeTrackingEnabled).toBe(
            DEFAULT_PROC_STATE.eyeTrackingEnabled
        );
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
        expect(sut.getProcMotionState().headTrackingEnabled).toBe(
            DEFAULT_PROC_STATE.headTrackingEnabled
        );
    });
});

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
