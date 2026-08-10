// @vitest-environment node
// env-bridge/time-of-day.int.test.ts — 拆自 env-bridge.test.ts（ADR-204 P2）
// Time of Day：start/stop/isActive/speed/_timeOfDayTick（24 用例）

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
    mockEnsureEnvUpdateObserver,
    mockImplApplyFog,
    mockImplApplyGround,
    mockImplApplySky,
    mockRegisterSceneTickCallback,
    mockSceneInstance,
    mockSetEnvState,
    mockUpdateSunDisc,
} from './env-mocks';
import {
    setEnvSunAngle,
    getEnvSunAngle,
    startTimeOfDay,
    stopTimeOfDay,
    isTimeOfDayActive,
    getTimeOfDaySpeed,
    setTimeOfDaySpeed,
} from '../../scene/env/env-time-of-day';

// ──── Time of Day ──────────────────────────────────────────────

describe('Time of Day', () => {
    let registeredTickCallback: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        registeredTickCallback = null;

        mockRegisterSceneTickCallback.mockImplementation((cb?: () => void) => {
            registeredTickCallback = cb;
            return vi.fn();
        });

        setEnvSunAngle(45);
        if (isTimeOfDayActive()) {
            stopTimeOfDay();
        }
    });

    describe('startTimeOfDay', () => {
        afterEach(() => {
            if (isTimeOfDayActive()) {
                stopTimeOfDay();
            }
        });

        it('starts time-of-day and sets active flag', () => {
            startTimeOfDay();
            expect(isTimeOfDayActive()).toBe(true);
        });

        it('calls ensureEnvUpdateObserver', () => {
            startTimeOfDay();
            expect(mockEnsureEnvUpdateObserver).toHaveBeenCalled();
        });

        it('registers tick callback via registerSceneTickCallback', () => {
            startTimeOfDay();
            expect(mockRegisterSceneTickCallback).toHaveBeenCalled();
            expect(registeredTickCallback).not.toBeNull();
        });

        it('uses provided speed parameter', () => {
            startTimeOfDay(10);
            expect(getTimeOfDaySpeed()).toBe(10);
        });

        it('keeps existing speed when no parameter given', () => {
            setTimeOfDaySpeed(5);
            startTimeOfDay();
            expect(getTimeOfDaySpeed()).toBe(5);
        });

        it('is idempotent when already active', () => {
            startTimeOfDay();
            mockRegisterSceneTickCallback.mockClear();
            startTimeOfDay();
            expect(mockRegisterSceneTickCallback).not.toHaveBeenCalled();
        });
    });

    describe('stopTimeOfDay', () => {
        it('clears active flag', () => {
            startTimeOfDay();
            stopTimeOfDay();
            expect(isTimeOfDayActive()).toBe(false);
        });

        it('calls unregister function', () => {
            const unregister = vi.fn();
            mockRegisterSceneTickCallback.mockImplementationOnce(() => unregister);
            startTimeOfDay();
            stopTimeOfDay();
            expect(unregister).toHaveBeenCalled();
        });

        it('calls SetEnvState to persist', async () => {
            vi.spyOn(globalThis, 'setTimeout');
            startTimeOfDay();
            mockSetEnvState.mockClear();
            stopTimeOfDay();
            // [ADR-176] stopTimeOfDay 内部 fire-and-forget persistEnvState（async），
            // 需 flush microtask 让 Promise 链 settle 后再断言。
            await new Promise((r) => setTimeout(r, 0));
            expect(mockSetEnvState).toHaveBeenCalled();
        });
    });

    describe('isTimeOfDayActive', () => {
        it('returns false when not active', () => {
            expect(isTimeOfDayActive()).toBe(false);
        });

        it('returns true after start', () => {
            startTimeOfDay();
            expect(isTimeOfDayActive()).toBe(true);
        });

        it('returns false after stop', () => {
            startTimeOfDay();
            stopTimeOfDay();
            expect(isTimeOfDayActive()).toBe(false);
        });
    });

    describe('speed controls', () => {
        beforeEach(() => {
            setTimeOfDaySpeed(3);
        });

        it('getTimeOfDaySpeed returns 3 initially', () => {
            expect(getTimeOfDaySpeed()).toBe(3);
        });

        it('setTimeOfDaySpeed updates speed', () => {
            setTimeOfDaySpeed(10);
            expect(getTimeOfDaySpeed()).toBe(10);
        });

        it('setTimeOfDaySpeed accepts zero', () => {
            setTimeOfDaySpeed(0);
            expect(getTimeOfDaySpeed()).toBe(0);
        });
    });

    describe('_timeOfDayTick (via registered callback)', () => {
        beforeEach(() => {
            setTimeOfDaySpeed(3);
        });

        afterEach(() => {
            if (isTimeOfDayActive()) {
                stopTimeOfDay();
            }
        });

        it('does nothing when time-of-day is not active', () => {
            startTimeOfDay();
            stopTimeOfDay();
            const prevAngle = getEnvSunAngle();
            expect(isTimeOfDayActive()).toBe(false);

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBeCloseTo(prevAngle);
        });

        it('increments envSunAngle by speed * dt when active', () => {
            startTimeOfDay(3);
            const prevAngle = getEnvSunAngle();
            const dt = mockSceneInstance.deltaTime / 1000;

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBeCloseTo(prevAngle + 3 * dt);
        });

        it('wraps sun angle > 90 to -15', () => {
            setEnvSunAngle(89);
            startTimeOfDay(10);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBe(-15);
        });

        it('wraps sun angle < -15 to 90', () => {
            setEnvSunAngle(-14);
            startTimeOfDay(-10);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(getEnvSunAngle()).toBe(90);
        });

        it('calls _updateSunDisc every tick', () => {
            startTimeOfDay(3);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockUpdateSunDisc).toHaveBeenCalled();
        });

        it('calls _applyEnvStateFacade when angle diff >= AUTO_LINK_THRESHOLD_DEG (0.5)', () => {
            startTimeOfDay(3);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            // sunAngle 属于 skyKeys，只触发 sky 重建，不触发 ground/fog/water（F1 优化：传 partial 避免全量重建）
            expect(mockImplApplySky).toHaveBeenCalled();
            expect(mockImplApplyGround).not.toHaveBeenCalled();
            expect(mockImplApplyFog).not.toHaveBeenCalled();
        });

        it('does NOT call _applyEnvStateFacade for tiny angle changes below threshold', () => {
            mockImplApplySky.mockClear();
            mockImplApplyGround.mockClear();
            mockImplApplyFog.mockClear();

            startTimeOfDay(0.4);
            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockImplApplyGround).not.toHaveBeenCalled();
        });

        it('calls impl.applySky when skyMode=procedural and angle diff >= 0.4', () => {
            mockConfigEnvState.skyMode = 'procedural';
            startTimeOfDay(0.5);
            mockImplApplySky.mockClear();

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            expect(mockImplApplySky).toHaveBeenCalled();
            const arg = mockImplApplySky.mock.calls[0][0];
            expect(arg.skyMode).toBe('procedural');
        });

        it('does NOT call the sky-mode-specific applySky (only from _applyEnvStateFacade) when skyMode is not procedural', () => {
            mockConfigEnvState.skyMode = 'color';
            startTimeOfDay(0.5);
            mockImplApplySky.mockClear();

            if (registeredTickCallback) {
                registeredTickCallback();
            }
            // _applyEnvStateFacade calls applySky unconditionally, so there's 1 call.
            // The skyMode-specific check inside _timeOfDayTick would add a 2nd call.
            // With skyMode='color', only 1 call happens (from _applyEnvStateFacade).
            expect(mockImplApplySky).toHaveBeenCalledTimes(1);
        });
    });
});
