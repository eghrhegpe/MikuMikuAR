// @vitest-environment node
// proc-motion-bridge 拆分 — 状态读写 / 模式 / 强度 / 速度 / 拷贝语义
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROC_STATE } from '../motion-algos/procedural-motion';
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
vi.mock('@/core/audio', () => mockAudio(mockState));
vi.mock('../scene/scene', () => mockScene(mockState));
vi.mock('../scene/motion/vmd-layers', () => mockVmdLayers());
vi.mock('../scene/motion/perception', () => mockPerception(mockState));
vi.mock('../scene/motion/motion-intent', () => mockMotionIntent(mockState));
vi.mock('../motion-algos/beat-detector', () => mockBeatDetector(mockState));
vi.mock('../motion-algos/proc-motion-idle', () => ({ generateIdleVmd: () => new ArrayBuffer(0) }));
vi.mock('../motion-algos/proc-motion-autodance', () => ({
    generateAutoDanceVmd: () => new ArrayBuffer(0),
}));

type Sut = typeof import('../scene/motion/proc-motion-bridge');
let sut: Sut;

beforeEach(async () => {
    vi.resetModules();
    sut = await import('../scene/motion/proc-motion-bridge');
    resetProcMockState(mockState);
}, 30000); // 全量并行时 transform 与并行套件争抢资源，放宽 hook 超时

describe('isProcVmdActive', () => {
    it('returns false initially', () => {
        expect(sut.isProcVmdActive()).toBe(false);
    });
});

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

describe('setProcMotionIntensity', () => {
    it('stores the given value', () => {
        sut.setProcMotionIntensity('idle', 0.3);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0.3);
    });

    it('clamps negative values to 0', () => {
        sut.setProcMotionIntensity('idle', -0.1);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        sut.setProcMotionIntensity('idle', 1.5);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(1);
    });

    it('accepts boundary values 0 and 1', () => {
        sut.setProcMotionIntensity('idle', 0);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(0);
        sut.setProcMotionIntensity('idle', 1);
        expect(sut.getProcMotionState().params.idle.intensity).toBe(1);
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.intensity', () => {
        expect(sut.getProcMotionState().params.idle.intensity).toBe(DEFAULT_PROC_STATE.params.idle.intensity);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionIntensity('idle', 0.7);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('setProcMotionSpeed', () => {
    it('stores the given value', () => {
        sut.setProcMotionSpeed('idle', 0.8);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.8);
    });

    it('clamps below 0.5 to 0.5', () => {
        sut.setProcMotionSpeed('idle', 0.1);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.5);
    });

    it('clamps above 2 to 2', () => {
        sut.setProcMotionSpeed('idle', 3);
        expect(sut.getProcMotionState().params.idle.speed).toBe(2);
    });

    it('accepts boundary values 0.5 and 2', () => {
        sut.setProcMotionSpeed('idle', 0.5);
        expect(sut.getProcMotionState().params.idle.speed).toBe(0.5);
        sut.setProcMotionSpeed('idle', 2);
        expect(sut.getProcMotionState().params.idle.speed).toBe(2);
    });

    it('defaults to DEFAULT_PROC_STATE.params.idle.speed', () => {
        expect(sut.getProcMotionState().params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
    });

    it('calls triggerAutoSave', () => {
        sut.setProcMotionSpeed('idle', 1.5);
        expect(mockState.triggerAutoSave).toHaveBeenCalledOnce();
    });
});

describe('getProcMotionState', () => {
    it('returns a copy — mutating the result does not affect internal state', () => {
        const state = sut.getProcMotionState();
        state.params.idle.intensity = 0.99;
        expect(sut.getProcMotionState().params.idle.intensity).toBe(
            DEFAULT_PROC_STATE.params.idle.intensity
        );
    });

    it('returns a new object each call', () => {
        const a = sut.getProcMotionState();
        const b = sut.getProcMotionState();
        expect(a).not.toBe(b);
    });

    it('reflects changes made by setters', () => {
        sut.setProcMotionMode('idle');
        sut.setProcMotionIntensity('idle', 0.7);
        sut.setProcMotionSpeed('idle', 1.2);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('idle');
        expect(s.params.idle.intensity).toBe(0.7);
        expect(s.params.idle.speed).toBe(1.2);
    });

    it('defaults match DEFAULT_PROC_STATE', () => {
        const s = sut.getProcMotionState();
        expect(s.mode).toBe(DEFAULT_PROC_STATE.mode);
        expect(s.params.idle.intensity).toBe(DEFAULT_PROC_STATE.params.idle.intensity);
        expect(s.params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
        expect(s.params.idle.boneToggles).toEqual(DEFAULT_PROC_STATE.params.idle.boneToggles);
        expect(s.params.autodance).toEqual(DEFAULT_PROC_STATE.params.autodance);
        expect(s.bpmQuantizeEnabled).toBe(DEFAULT_PROC_STATE.bpmQuantizeEnabled);
        expect(s.eyeTrackingEnabled).toBe(DEFAULT_PROC_STATE.eyeTrackingEnabled);
        expect(s.headTrackingEnabled).toBe(DEFAULT_PROC_STATE.headTrackingEnabled);
    });
});

describe('setProcMotionState', () => {
    it('replaces the entire state', () => {
        sut.setProcMotionMode('idle');

        const newState = {
            ...DEFAULT_PROC_STATE,
            mode: 'autodance' as const,
            params: {
                idle: { ...DEFAULT_PROC_STATE.params.idle, intensity: 0.9 },
                autodance: { ...DEFAULT_PROC_STATE.params.autodance },
            },
        };
        sut.setProcMotionState(newState);

        const s = sut.getProcMotionState();
        expect(s.mode).toBe('autodance');
        expect(s.params.idle.intensity).toBe(0.9);
        expect(s.params.idle.speed).toBe(DEFAULT_PROC_STATE.params.idle.speed);
    });

    it('does not call triggerAutoSave', () => {
        sut.setProcMotionState({ ...DEFAULT_PROC_STATE });
        expect(mockState.triggerAutoSave).not.toHaveBeenCalled();
    });
});

describe('per-mode 独立参数（audit）', () => {
    it('idle 与 autodance 的强度/速度互不影响', () => {
        sut.setProcMotionIntensity('idle', 0.3);
        sut.setProcMotionIntensity('autodance', 0.9);
        sut.setProcMotionSpeed('idle', 0.6);
        sut.setProcMotionSpeed('autodance', 1.8);
        const s = sut.getProcMotionState();
        expect(s.params.idle.intensity).toBe(0.3);
        expect(s.params.autodance.intensity).toBe(0.9);
        expect(s.params.idle.speed).toBe(0.6);
        expect(s.params.autodance.speed).toBe(1.8);
    });

    it('两模式参数引用独立（改一个不影响另一个）', () => {
        const s = sut.getProcMotionState();
        expect(s.params.idle).not.toBe(s.params.autodance);
    });
});
