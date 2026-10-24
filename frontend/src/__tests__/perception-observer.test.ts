// @vitest-environment node
// [audit:fix 2026-09] 感知层 stage 异常节流测试（round74 diff-coverage 收口）
// 驱动 _applyPerceptionForContext 覆盖：
//   1. 7 个 stage 的 catch 分支（逐条覆盖）
//   2. _reportStageError 首帧打一次 / 60 帧窗口内静默 / 窗口外带「累计 N 次」重打 / 成功帧复位
// perception-* apply 模块全部 per-file mock（不影响其他测试文件的真实模块测试）；
// getScene mock 掉，避免 env 侧效应。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type {
    PerceptionContext,
    PerceptionState,
    MmdModelLike,
    PerceptionTier,
} from '../scene/motion/perception-shared';
import { _createPerceptionPool } from '../scene/motion/perception-shared';
import { _applyPerceptionForContext } from '../scene/motion/perception-observer';

const shared = vi.hoisted(() => ({
    logWarn: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),
    logDebug: vi.fn(),
    __debugLog: { value: false },
    getDebugLog: () => false,
    setDebugLog: vi.fn(),
    getConsoleOutput: () => true,
    setConsoleOutput: vi.fn(),
    getLogBuffer: vi.fn(),
    clearLogs: vi.fn(),
    apply: {
        breathing: vi.fn(),
        blinking: vi.fn(),
        micro: vi.fn(),
        balance: vi.fn(),
        lipsync: vi.fn(),
        gaze: vi.fn(),
    },
}));

vi.mock('../core/logger', () => shared);
vi.mock('../scene/motion/perception-breathing', () => ({
    _applyBreathing: shared.apply.breathing,
}));
vi.mock('../scene/motion/perception-blinking', () => ({
    _applyBlinking: shared.apply.blinking,
}));
vi.mock('../scene/motion/perception-expression', () => ({
    _applyMicroExpression: shared.apply.micro,
}));
vi.mock('../scene/motion/perception-balance', () => ({
    _applyBalanceSway: shared.apply.balance,
}));
vi.mock('../scene/motion/perception-lipsync', () => ({
    _applyLipSync: shared.apply.lipsync,
}));
vi.mock('../scene/motion/perception-gaze', () => ({
    _applyGaze: shared.apply.gaze,
}));
vi.mock('../scene/env/env', () => ({
    getScene: () => ({ activeCamera: { id: 'mock-camera' } }),
}));

/** 与 perception-breathing.test.ts 同款的最小 state（gaze/lipsync 依赖项全关） */
const baseState: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: false,
    headTrackingEnabled: false,
    eyeTrackingEnabled: false,
    microExpressionEnabled: false,
    emotion: 'neutral',
    balanceSwayEnabled: false,
    lipSyncEnabled: false,
    lipSyncSensitivity: 0.2,
    lipSyncIntensity: 0.8,
    lipSyncMultiMorphEnabled: false,
    breathFrequency: 0.3,
    breathAmplitude: 0.02,
    blinkFrequency: 0.25,
    blinkAmplitude: 1,
    headGazeMaxYaw: 75,
    headGazeMaxPitch: 35,
    eyeGazeMaxYaw: 9,
    eyeGazeMaxPitch: 8,
    eyeGazeSmooth: 0.65,
    balanceSwayPeriod: 2,
    balanceSwayAmplitude: 1,
};

function makeCtx(modelId: string, overrides: Partial<PerceptionState> = {}): PerceptionContext {
    return {
        modelId,
        state: { ...baseState, ...overrides },
        isActive: true,
        isPinned: false,
        lastOffsets: {
            breath: 0,
            balance: {
                lastBobY: 0,
                swayCenterName: null,
                lastCenterRz: 0,
                lastCenterRx: 0,
                lastUpperRx: 0,
                lastWaistRz: 0,
                lastAllParentRx: 0,
                lastAllParentRz: 0,
            },
            emotion: null,
        },
        pool: _createPerceptionPool(),
        gazeCache: { headWorldQ: null, eyeLocalQ: new Map() },
    };
}

function makeModel(): MmdModelLike {
    return { runtimeBones: [], mesh: {} };
}

describe('_applyPerceptionForContext stage 异常节流 [audit:fix 2026-09]', () => {
    beforeEach(() => {
        for (const fn of Object.values(shared.apply)) {
            fn.mockClear();
            fn.mockImplementation(() => {});
        }
        shared.logWarn.mockClear();
    });

    it('breathing 异常：首帧打一次 / 60 帧窗口内静默 / 窗口外带累计重打 / 成功后复位按新首帧', () => {
        const ctx = makeCtx('m-breath');
        const model = makeModel();
        shared.apply.breathing.mockImplementation(() => {
            throw new Error('boom-breathing');
        });

        _applyPerceptionForContext(ctx, model, 0, 0.016, 'high', 100, undefined);
        expect(shared.logWarn).toHaveBeenCalledTimes(1);
        expect(shared.logWarn).toHaveBeenLastCalledWith(
            'perception',
            '[breathing] 异常（帧 100）:',
            expect.any(Error)
        );

        // 60 帧窗口内（100→130）：只累计，不重打
        _applyPerceptionForContext(ctx, model, 0, 0.016, 'high', 130, undefined);
        expect(shared.logWarn).toHaveBeenCalledTimes(1);

        // 窗口外（100→200）：带累计次数重打
        _applyPerceptionForContext(ctx, model, 0, 0.016, 'high', 200, undefined);
        expect(shared.logWarn).toHaveBeenCalledTimes(2);
        expect(shared.logWarn).toHaveBeenLastCalledWith(
            'perception',
            '[breathing] 异常（帧 200，累计 3 次）:',
            expect.any(Error)
        );

        // 成功帧：_resetStageError 清位，不再打
        shared.apply.breathing.mockImplementation(() => {});
        _applyPerceptionForContext(ctx, model, 0, 0.016, 'high', 250, undefined);
        expect(shared.logWarn).toHaveBeenCalledTimes(2);

        // 再次异常：按新首帧打（无累计）
        shared.apply.breathing.mockImplementation(() => {
            throw new Error('boom-breathing-2');
        });
        _applyPerceptionForContext(ctx, model, 0, 0.016, 'high', 251, undefined);
        expect(shared.logWarn).toHaveBeenCalledTimes(3);
        expect(shared.logWarn).toHaveBeenLastCalledWith(
            'perception',
            '[breathing] 异常（帧 251）:',
            expect.any(Error)
        );
    });

    it('其余 6 个 stage 首帧异常各打一次（blinking / micro-expression / balance-sway / lipsync / lipsync-reset / gaze）', () => {
        const model = makeModel();
        const cases: { stage: string; mock: Mock; overrides: Partial<PerceptionState>; tier: PerceptionTier }[] = [
            { stage: 'blinking', mock: shared.apply.blinking, overrides: { blinkEnabled: true }, tier: 'high' },
            { stage: 'micro-expression', mock: shared.apply.micro, overrides: {}, tier: 'high' },
            { stage: 'balance-sway', mock: shared.apply.balance, overrides: {}, tier: 'medium' },
            { stage: 'lipsync', mock: shared.apply.lipsync, overrides: {}, tier: 'high' },
            { stage: 'lipsync-reset', mock: shared.apply.lipsync, overrides: {}, tier: 'low' },
            { stage: 'gaze', mock: shared.apply.gaze, overrides: { headTrackingEnabled: true }, tier: 'high' },
        ];
        cases.forEach((c, i) => {
            const ctx = makeCtx(`m-${c.stage}`, c.overrides);
            const frame = 400 + i;
            // 只让目标 stage 抛错（前一 case 的 throw 实现若不清掉，会污染后续 case 的其他 stage）
            c.mock.mockImplementation(() => {
                throw new Error(`boom-${c.stage}`);
            });
            shared.logWarn.mockClear();
            _applyPerceptionForContext(ctx, model, 0, 0.016, c.tier, frame, undefined);
            c.mock.mockImplementation(() => {});
            expect(shared.logWarn).toHaveBeenCalledTimes(1);
            expect(shared.logWarn).toHaveBeenLastCalledWith(
                'perception',
                `[${c.stage}] 异常（帧 ${frame}）:`,
                expect.any(Error)
            );
        });
    });
});
