import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_LIPSYNC_STATE, type LipSyncState } from '../motion-algos/lipsync';
import type { PerceptionState } from '../scene/motion/perception-shared';

// =====================================================================
// hoisted mock state — 追踪 lipsync-bridge 对 perception 的转发
// =====================================================================
// lipsync-bridge 现为纯转发壳，运行时仅依赖 ./perception；
// 其余（audio / scene / proc-motion-bridge / config）均非本模块依赖，无需 mock。

const mocks = vi.hoisted(() => {
    // 默认 PerceptionState（lip-sync 字段与 DEFAULT_LIPSYNC_STATE 一一对应）
    const defaultPerception: PerceptionState = {
        breathEnabled: true,
        blinkEnabled: true,
        headTrackingEnabled: true,
        eyeTrackingEnabled: true,
        microExpressionEnabled: true,
        emotion: 'neutral',
        balanceSwayEnabled: true,
        lipSyncEnabled: false,
        lipSyncSensitivity: 0.2,
        lipSyncIntensity: 0.8,
        lipSyncMultiMorphEnabled: false,
        // 感知层可调参数默认值
        breathFrequency: 0.3,
        breathAmplitude: 0.02,
        blinkFrequency: 0.25,
        blinkAmplitude: 1.0,
        headGazeMaxYaw: 75,
        headGazeMaxPitch: 35,
        eyeGazeMaxYaw: 9,
        eyeGazeMaxPitch: 8,
        eyeGazeSmooth: 0.35,
    };
    return {
        defaultPerception,
        setLipSyncEnabled: vi.fn(),
        setLipSyncSensitivity: vi.fn(),
        setLipSyncIntensity: vi.fn(),
        setLipSyncMultiMorphEnabled: vi.fn(),
        getPerceptionState: vi.fn(),
        setPerceptionState: vi.fn(),
    };
});

vi.mock('../scene/motion/perception', () => ({
    setLipSyncEnabled: mocks.setLipSyncEnabled,
    setLipSyncSensitivity: mocks.setLipSyncSensitivity,
    setLipSyncIntensity: mocks.setLipSyncIntensity,
    setLipSyncMultiMorphEnabled: mocks.setLipSyncMultiMorphEnabled,
    getPerceptionState: mocks.getPerceptionState,
    setPerceptionState: mocks.setPerceptionState,
}));

import * as sut from '../scene/motion/lipsync-bridge';

beforeEach(() => {
    mocks.setLipSyncEnabled.mockReset();
    mocks.setLipSyncSensitivity.mockReset();
    mocks.setLipSyncIntensity.mockReset();
    mocks.setLipSyncMultiMorphEnabled.mockReset();
    mocks.getPerceptionState.mockReset();
    // 真实 getPerceptionState 每次返回新对象，这里镜像该行为
    mocks.getPerceptionState.mockImplementation(() => ({ ...mocks.defaultPerception }));
    mocks.setPerceptionState.mockReset();
});

// =====================================================================
// setLipSyncEnabled — 透传到 perception.setLipSyncEnabled
// =====================================================================

describe('setLipSyncEnabled', () => {
    it('转发 true 到 perception.setLipSyncEnabled', () => {
        sut.setLipSyncEnabled(true);
        expect(mocks.setLipSyncEnabled).toHaveBeenCalledOnce();
        expect(mocks.setLipSyncEnabled).toHaveBeenCalledWith(true);
    });

    it('转发 false 到 perception.setLipSyncEnabled', () => {
        sut.setLipSyncEnabled(false);
        expect(mocks.setLipSyncEnabled).toHaveBeenCalledWith(false);
    });

    it('不调用其它 perception 函数', () => {
        sut.setLipSyncEnabled(true);
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.getPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncSensitivity).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setLipSyncSensitivity — 透传（钳制由 perception 负责，桥接层不钳制）
// =====================================================================

describe('setLipSyncSensitivity', () => {
    it('转发数值到 perception.setLipSyncSensitivity', () => {
        sut.setLipSyncSensitivity(0.5);
        expect(mocks.setLipSyncSensitivity).toHaveBeenCalledOnce();
        expect(mocks.setLipSyncSensitivity).toHaveBeenCalledWith(0.5);
    });

    it('不钳制负值——直接透传（clamp01 在 perception 内）', () => {
        sut.setLipSyncSensitivity(-0.5);
        expect(mocks.setLipSyncSensitivity).toHaveBeenCalledWith(-0.5);
    });

    it('不钳制越上限值——直接透传（clamp01 在 perception 内）', () => {
        sut.setLipSyncSensitivity(1.5);
        expect(mocks.setLipSyncSensitivity).toHaveBeenCalledWith(1.5);
    });

    it('不调用其它 perception 函数', () => {
        sut.setLipSyncSensitivity(0.5);
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setLipSyncIntensity — 透传（钳制由 perception 负责）
// =====================================================================

describe('setLipSyncIntensity', () => {
    it('转发数值到 perception.setLipSyncIntensity', () => {
        sut.setLipSyncIntensity(0.8);
        expect(mocks.setLipSyncIntensity).toHaveBeenCalledOnce();
        expect(mocks.setLipSyncIntensity).toHaveBeenCalledWith(0.8);
    });

    it('不钳制负值——直接透传', () => {
        sut.setLipSyncIntensity(-1);
        expect(mocks.setLipSyncIntensity).toHaveBeenCalledWith(-1);
    });

    it('不钳制越上限值——直接透传', () => {
        sut.setLipSyncIntensity(2);
        expect(mocks.setLipSyncIntensity).toHaveBeenCalledWith(2);
    });

    it('不调用其它 perception 函数', () => {
        sut.setLipSyncIntensity(0.8);
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setLipSyncMultiMorphEnabled — 透传
// =====================================================================

describe('setLipSyncMultiMorphEnabled', () => {
    it('转发 true', () => {
        sut.setLipSyncMultiMorphEnabled(true);
        expect(mocks.setLipSyncMultiMorphEnabled).toHaveBeenCalledOnce();
        expect(mocks.setLipSyncMultiMorphEnabled).toHaveBeenCalledWith(true);
    });

    it('转发 false', () => {
        sut.setLipSyncMultiMorphEnabled(false);
        expect(mocks.setLipSyncMultiMorphEnabled).toHaveBeenCalledWith(false);
    });
});

// =====================================================================
// getLipSyncState — 从 perception.getPerceptionState 读取并转换字段
// =====================================================================

describe('getLipSyncState', () => {
    it('调用 perception.getPerceptionState 一次', () => {
        sut.getLipSyncState();
        expect(mocks.getPerceptionState).toHaveBeenCalledOnce();
    });

    it('将 PerceptionState 的 lip-sync 字段转换为 LipSyncState', () => {
        mocks.getPerceptionState.mockReturnValueOnce({
            ...mocks.defaultPerception,
            lipSyncEnabled: true,
            lipSyncSensitivity: 0.9,
            lipSyncIntensity: 0.1,
            lipSyncMultiMorphEnabled: true,
        });
        const s = sut.getLipSyncState();
        expect(s).toEqual({
            enabled: true,
            sensitivity: 0.9,
            intensity: 0.1,
            multiMorphEnabled: true,
        });
    });

    it('默认 PerceptionState 转换为 DEFAULT_LIPSYNC_STATE', () => {
        expect(sut.getLipSyncState()).toEqual(DEFAULT_LIPSYNC_STATE);
    });

    it('返回副本——修改结果不影响后续读取', () => {
        const a = sut.getLipSyncState();
        a.enabled = true;
        a.sensitivity = 0.99;
        const b = sut.getLipSyncState();
        expect(b.enabled).toBe(false);
        expect(b.sensitivity).toBe(0.2);
    });

    it('每次调用返回新对象', () => {
        const a = sut.getLipSyncState();
        const b = sut.getLipSyncState();
        expect(a).not.toBe(b);
    });

    it('不调用任何 setter', () => {
        sut.getLipSyncState();
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
    });
});

// =====================================================================
// setLipSyncState — 转换为 Partial<PerceptionState> 后调用 setPerceptionState
// =====================================================================

describe('setLipSyncState', () => {
    it('转换 LipSyncState 为 lip-sync 字段并调用 setPerceptionState', () => {
        const lip: LipSyncState = {
            enabled: true,
            sensitivity: 0.5,
            intensity: 0.6,
            multiMorphEnabled: true,
        };
        sut.setLipSyncState(lip);
        expect(mocks.setPerceptionState).toHaveBeenCalledOnce();
        expect(mocks.setPerceptionState).toHaveBeenCalledWith({
            lipSyncEnabled: true,
            lipSyncSensitivity: 0.5,
            lipSyncIntensity: 0.6,
            lipSyncMultiMorphEnabled: true,
        });
    });

    it('只写 lip-sync 四个字段，不含其它 perception 字段', () => {
        sut.setLipSyncState({
            enabled: false,
            sensitivity: 0.1,
            intensity: 0.2,
            multiMorphEnabled: false,
        });
        const arg = mocks.setPerceptionState.mock.calls[0][0] as Record<string, unknown>;
        expect(Object.keys(arg).sort()).toEqual([
            'lipSyncEnabled',
            'lipSyncIntensity',
            'lipSyncMultiMorphEnabled',
            'lipSyncSensitivity',
        ]);
    });

    it('不调用单个 setter', () => {
        sut.setLipSyncState({
            enabled: true,
            sensitivity: 0.5,
            intensity: 0.5,
            multiMorphEnabled: false,
        });
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
        expect(mocks.setLipSyncSensitivity).not.toHaveBeenCalled();
        expect(mocks.setLipSyncIntensity).not.toHaveBeenCalled();
        expect(mocks.setLipSyncMultiMorphEnabled).not.toHaveBeenCalled();
    });

    it('接受 DEFAULT_LIPSYNC_STATE', () => {
        sut.setLipSyncState({ ...DEFAULT_LIPSYNC_STATE });
        expect(mocks.setPerceptionState).toHaveBeenCalledWith({
            lipSyncEnabled: false,
            lipSyncSensitivity: 0.2,
            lipSyncIntensity: 0.8,
            lipSyncMultiMorphEnabled: false,
        });
    });
});

// =====================================================================
// no-op 函数（逻辑已迁入 perception.ts）
// =====================================================================

describe('no-op 函数（initLipSync / updateLipSync / resetLipSyncOnFocusChange）', () => {
    it('initLipSync 不抛异常且不调用 perception', () => {
        expect(() => sut.initLipSync(null as never)).not.toThrow();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
        expect(mocks.getPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
    });

    it('updateLipSync 不抛异常且不调用 perception', () => {
        expect(() => sut.updateLipSync()).not.toThrow();
        expect(mocks.getPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
    });

    it('resetLipSyncOnFocusChange 不抛异常且不调用 perception', () => {
        expect(() => sut.resetLipSyncOnFocusChange()).not.toThrow();
        expect(mocks.getPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setPerceptionState).not.toHaveBeenCalled();
        expect(mocks.setLipSyncEnabled).not.toHaveBeenCalled();
    });

    it('重复调用 no-op 仍安全', () => {
        expect(() => {
            sut.initLipSync(null as never);
            sut.updateLipSync();
            sut.resetLipSyncOnFocusChange();
            sut.updateLipSync();
            sut.resetLipSyncOnFocusChange();
        }).not.toThrow();
    });
});
