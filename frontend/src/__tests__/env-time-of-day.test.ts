import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnvState } from './mocks/binding-factories';

// ── Babylon / DOM 桩 ──────────────────────────────────────────────
// 仅 mock 相对 + 内部依赖；env-time-of-day 不直接 import @babylonjs/core 根
vi.mock('../scene/env/env-impl', () => ({ ensureEnvUpdateObserver: vi.fn() }));

// 捕获 scene.onBeforeRenderObservable 注册的回调，便于手动驱动
const hoisted = vi.hoisted(() => {
    const sceneObserverCbs: Array<(...args: any[]) => void> = [];
    const mockScene = {
        deltaTime: 16,
        onBeforeRenderObservable: {
            add: vi.fn((cb: (...args: any[]) => void) => {
                sceneObserverCbs.push(cb);
                return { _obs: true };
            }),
            remove: vi.fn(),
        },
    };
    return { sceneObserverCbs, mockScene };
});
vi.mock('../scene/scene', () => ({ scene: hoisted.mockScene }));

vi.mock('../scene/render/lighting', () => ({
    setLightState: vi.fn(),
    getLightState: vi.fn(() => ({
        dirColor: [1, 1, 1],
        dirX: 0,
        dirY: 5,
        dirZ: 0,
        dirIntensity: 1,
        hemiIntensity: 1,
    })),
    setSkipLightAutoSave: vi.fn(),
    _updateSunDisc: vi.fn(),
    isLightingReady: vi.fn(() => false),
}));

vi.mock('../scene/env/_bridge/env-dispatcher', () => {
    const tickCbs: Array<(...args: any[]) => void> = [];
    return {
        dispatchEnvChange: vi.fn(),
        registerSceneTickCallback: vi.fn((cb: (...args: any[]) => void) => {
            tickCbs.push(cb);
            return () => {
                const i = tickCbs.indexOf(cb);
                if (i >= 0) tickCbs.splice(i, 1);
            };
        }),
        __tickCbs: tickCbs,
    };
});

vi.mock('../scene/env/_bridge/env-bridge', () => ({
    setEnvState: vi.fn(),
    setPresetAnimActive: vi.fn(),
    registerEnvStateMiddleware: vi.fn(),
    applyEnvStateFacade: vi.fn(),
}));

vi.mock('../scene/env/_bridge/env-persist', () => ({
    persistEnvState: vi.fn(() => Promise.resolve()),
    cancelEnvPersistTimer: vi.fn(),
}));

vi.mock('../scene/env/env-lighting', () => ({
    deriveLighting: vi.fn((_top: any, _angle: any, _az: any) => ({
        dirDiffuse: [1, 1, 1],
        dirDirection: [0, 1, 0],
        dirIntensity: 1,
        hemiIntensity: 1,
    })),
    TIME_OF_DAY_PRESETS: {
        daytime: {
            label: 'Day',
            skyColorTop: [1, 1, 1],
            skyColorBot: [0, 0, 0],
            sunAngle: 45,
            azimuth: -45,
        },
    },
}));

vi.mock('@/core/feedback', () => ({ feedbackStatus: vi.fn() }));
vi.mock('@/core/logger', () => ({ logWarn: vi.fn() }));
vi.mock('@/core/scene-action-bridge', () => ({ registerSceneAction: vi.fn() }));

import { envState } from '@/core/config';
import * as lighting from '../scene/render/lighting';
import * as envDispatcher from '../scene/env/_bridge/env-dispatcher';
import * as envBridge from '../scene/env/_bridge/env-bridge';
import {
    setEnvSunAngle,
    getEnvSunAngle,
    syncTimeOfDayFromEnv,
    applyEnvPreset,
    applyEnvPresetObject,
    applyEnvPresetByCategory,
    startTimeOfDay,
    isTimeOfDayActive,
    getTimeOfDaySpeed,
} from '../scene/env/env-time-of-day';

function fireSceneObserver(idx = 0): void {
    hoisted.sceneObserverCbs[idx]();
}

beforeEach(() => {
    hoisted.sceneObserverCbs.length = 0;
    Object.assign(envState, createMockEnvState());
    setEnvSunAngle(45);
    // 复位模块私有标志（_timeOfDayPaused / _timeOfDayBeforePreset）
    syncTimeOfDayFromEnv();
    // 复位 lighting mock 行为，避免跨用例污染
    vi.mocked(lighting.isLightingReady).mockReturnValue(false);
    vi.mocked(lighting.setLightState).mockImplementation(() => true);
});

describe('env-time-of-day: 太阳角 / 预设 / time-of-day', () => {
    it('setEnvSunAngle 做 [-15,90] 钳制并同步 envState.sunAngle（双源修复）', () => {
        setEnvSunAngle(120);
        expect(getEnvSunAngle()).toBe(90);
        expect(envState.sunAngle).toBe(90);
        setEnvSunAngle(-50);
        expect(getEnvSunAngle()).toBe(-15);
        expect(envState.sunAngle).toBe(-15);
        setEnvSunAngle(30);
        expect(getEnvSunAngle()).toBe(30);
        expect(envState.sunAngle).toBe(30);
    });

    it('applyEnvPreset: 未知预设返回 false，已知预设返回 true 并启动动画', () => {
        expect(applyEnvPreset('__nope__')).toBe(false);
        const ok = applyEnvPreset('daytime');
        expect(ok).toBe(true);
        // 注册了 onBeforeRender 动画回调
        expect(hoisted.sceneObserverCbs.length).toBe(1);
    });

    it('applyEnvPresetObject: 正常 tick 跑通 _presetAnimLoop（try 分支覆盖）', () => {
        const ok = applyEnvPresetObject({
            label: 'x',
            skyColorTop: [1, 0, 0],
            skyColorBot: [0, 1, 0],
            sunAngle: 60,
        });
        expect(ok).toBe(true);
        expect(hoisted.sceneObserverCbs.length).toBe(1);
        // 手动驱动一帧：覆盖 _presetAnimLoop 主体 + try 包裹
        fireSceneObserver();
    });

    it('[fix P2] applyEnvPresetObject: 动画循环异常时 catch 复位运行标志', () => {
        vi.mocked(lighting.isLightingReady).mockReturnValue(true);
        // 让 setLightState 抛错以触发 catch 分支
        vi.mocked(lighting.setLightState).mockImplementation(() => {
            throw new Error('boom');
        });
        // 让预设动画前 time-of-day 活跃 → 覆盖 catch 内 _timeOfDayBeforePreset 复位
        envState.timeOfDayActive = true;

        const ok = applyEnvPresetObject({
            label: 'x',
            skyColorTop: [1, 0, 0],
            skyColorBot: [0, 1, 0],
            sunAngle: 60,
        });
        expect(ok).toBe(true);
        expect(() => fireSceneObserver()).not.toThrow();
        expect(envBridge.setPresetAnimActive).toHaveBeenCalledWith(false);
        expect(lighting.setSkipLightAutoSave).toHaveBeenCalledWith(false);
    });

    it('[fix P3] syncTimeOfDayFromEnv: 复位 _timeOfDayBeforePreset 残留', () => {
        // 先制造残留（预设动画捕获），再 sync 应清零
        envState.timeOfDayActive = true;
        applyEnvPresetObject({
            label: 'x',
            skyColorTop: [1, 0, 0],
            skyColorBot: [0, 1, 0],
            sunAngle: 60,
        });
        // syncTimeOfDayFromEnv 内部执行 _timeOfDayBeforePreset = null（修复行）
        expect(() => syncTimeOfDayFromEnv()).not.toThrow();
        // 之后再次应用预设应重新捕获 time-of-day 状态（不被 stale 干扰）
        const ok = applyEnvPreset('daytime');
        expect(ok).toBe(true);
    });

    it('applyEnvPresetByCategory: 空 fields 返回 false；env:sky 应用 sunAngle', () => {
        expect(applyEnvPresetByCategory({ category: 'env:sky', fields: {} } as any)).toBe(false);
        const ok = applyEnvPresetByCategory({
            category: 'env:sky',
            fields: { sunAngle: 12 },
        } as any);
        expect(ok).toBe(true);
        expect(getEnvSunAngle()).toBe(12);
    });

    it('[fix P3] _timeOfDayTick: procedural 分支同步 envState.sunAngle（幽灵路径修复）', () => {
        envState.skyMode = 'procedural';
        envState.timeOfDayActive = true;
        startTimeOfDay(3);
        expect(isTimeOfDayActive()).toBe(true);
        expect(getTimeOfDaySpeed()).toBe(3);
        // dt=0.15 → envSunAngle 增量 0.45，落入 (0.4, 0.5) 区间命中 else-if 分支
        hoisted.mockScene.deltaTime = 150;
        const before = getEnvSunAngle();
        (envDispatcher as any).__tickCbs.forEach((cb: (...a: any[]) => void) => cb());
        // 关键修复行：envState.sunAngle 被同步为 envSunAngle
        expect(envState.sunAngle).toBeCloseTo(before + 0.45, 5);
    });
});
