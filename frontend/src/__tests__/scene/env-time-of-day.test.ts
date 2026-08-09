import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ======== mock 基础设施（hoisted 供 vi.mock 工厂与断言共用） ========
const h = vi.hoisted(() => {
    // 捕获 scene.onBeforeRenderObservable.add 注册的回调（预设动画循环）
    const observers: Array<(e?: unknown, s?: unknown) => void> = [];
    const scene = {
        deltaTime: 0,
        onBeforeRenderObservable: {
            add: (fn: (e?: unknown, s?: unknown) => void) => {
                observers.push(fn);
                return {
                    dispose: () => {
                        const i = observers.indexOf(fn);
                        if (i >= 0) observers.splice(i, 1);
                    },
                };
            },
            remove: (fn: (e?: unknown, s?: unknown) => void) => {
                const i = observers.indexOf(fn);
                if (i >= 0) observers.splice(i, 1);
            },
        },
    };
    return { observers, scene };
});

const mk = vi.hoisted(() => ({
    setEnvState: vi.fn(),
    setPresetAnimActive: vi.fn(),
    registerEnvStateMiddleware: vi.fn(),
    applyEnvStateFacade: vi.fn(),
    dispatchEnvChange: vi.fn(),
    registerSceneTickCallback: vi.fn((fn: () => void) => {
        mk._lastTick = fn;
        return () => {};
    }),
    _lastTick: undefined as undefined | (() => void),
    persistEnvState: vi.fn(() => Promise.resolve()),
    cancelEnvPersistTimer: vi.fn(),
    setLightState: vi.fn(),
    getLightState: vi.fn(() => ({
        dirColor: [1, 1, 1],
        dirX: 0,
        dirY: 0,
        dirZ: 0,
        dirIntensity: 1,
        hemiIntensity: 1,
    })),
    setSkipLightAutoSave: vi.fn(),
    _updateSunDisc: vi.fn(),
    isLightingReady: vi.fn(() => true),
    deriveLighting: vi.fn(() => ({
        dirDirection: [0, 1, 0],
        dirDiffuse: [1, 1, 1],
        dirIntensity: 1,
        hemiIntensity: 1,
    })),
    registerSceneAction: vi.fn(),
}));

vi.mock('../../scene/scene', () => ({ scene: h.scene }));
vi.mock('../../scene/env/env-impl', () => ({ ensureEnvUpdateObserver: vi.fn() }));
vi.mock('../../scene/env/_bridge/env-bridge', () => ({
    setEnvState: mk.setEnvState,
    setPresetAnimActive: mk.setPresetAnimActive,
    registerEnvStateMiddleware: mk.registerEnvStateMiddleware,
    applyEnvStateFacade: mk.applyEnvStateFacade,
}));
vi.mock('../../scene/env/_bridge/env-dispatcher', () => ({
    dispatchEnvChange: mk.dispatchEnvChange,
    registerSceneTickCallback: mk.registerSceneTickCallback,
}));
vi.mock('../../scene/env/_bridge/env-persist', () => ({
    persistEnvState: mk.persistEnvState,
    cancelEnvPersistTimer: mk.cancelEnvPersistTimer,
}));
vi.mock('../../scene/env/env-lighting', () => ({
    deriveLighting: mk.deriveLighting,
    TIME_OF_DAY_PRESETS: {
        dawn: {
            label: 'dawn',
            skyColorTop: [0.9, 0.7, 0.6],
            skyColorBot: [0.3, 0.3, 0.4],
            sunAngle: 15,
            azimuth: -45,
        },
    },
}));
vi.mock('../../scene/render/lighting', () => ({
    setLightState: mk.setLightState,
    getLightState: mk.getLightState,
    setSkipLightAutoSave: mk.setSkipLightAutoSave,
    _updateSunDisc: mk._updateSunDisc,
    isLightingReady: mk.isLightingReady,
}));
vi.mock('@/core/scene-action-bridge', () => ({ registerSceneAction: mk.registerSceneAction }));

import { envState } from '@/core/config';
import {
    setEnvSunAngle,
    getEnvSunAngle,
    startTimeOfDay,
    isTimeOfDayActive,
    syncTimeOfDayFromEnv,
    applyEnvPreset,
    applyEnvPresetObject,
    applyEnvPresetByCategory,
    setTimeOfDaySpeed,
} from '../../scene/env/env-time-of-day';

let nowMs = 1000;
let nowSpy: ReturnType<typeof vi.spyOn>;

const SAMPLE_PRESET = {
    label: 'sample',
    skyColorTop: [0, 0, 0] as [number, number, number],
    skyColorBot: [0, 0, 0] as [number, number, number],
    sunAngle: 30,
};

beforeEach(() => {
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    // 复位模块级状态，避免用例间污染
    envState.timeOfDayActive = false;
    envState.skyMode = 'procedural';
    envState.skyColorTop = [0.5, 0.5, 0.5];
    envState.skyColorBot = [0.2, 0.2, 0.2];
    envState.skyColorMid = [0.3, 0.3, 0.3];
    setEnvSunAngle(45); // 复位 envSunAngle + envState.sunAngle
    syncTimeOfDayFromEnv(); // 复位 _timeOfDayPaused / _timeOfDayBeforePreset
    h.observers.length = 0;
    mk._lastTick = undefined;
    mk.setEnvState.mockClear();
    mk.setPresetAnimActive.mockClear();
    mk.dispatchEnvChange.mockClear();
    mk.registerSceneTickCallback.mockClear();
    mk.setLightState.mockReset();
    mk.isLightingReady.mockReturnValue(true);
    mk.setLightState.mockImplementation(() => undefined);
    mk.deriveLighting.mockClear();
});

afterEach(() => {
    nowSpy.mockRestore();
});

describe('env-time-of-day — _timeOfDayTick 幽灵路径修复（fix P3）', () => {
    it('skyMode=procedural 且增量落在 [0.4,0.5) 时同步 envState.sunAngle 并 dispatch', () => {
        envState.timeOfDayActive = true;
        envState.skyMode = 'procedural';
        startTimeOfDay(3); // _timeOfDaySpeed=3, 注册 tick
        expect(isTimeOfDayActive()).toBe(true);

        // dt=0.15s → 增量 = 3 * 0.15 = 0.45deg ∈ [0.4, 0.5)
        h.scene.deltaTime = 150;
        const tick = mk._lastTick!;
        tick();

        // [fix P3] 关键点：envState.sunAngle 被同步为最新角度（此前走幽灵路径漏写）
        expect(envState.sunAngle).toBeCloseTo(45.45, 5);
        expect(mk.dispatchEnvChange).toHaveBeenCalledWith(
            new Set(['sunAngle']),
            envState
        );
    });
});

describe('env-time-of-day — syncTimeOfDayFromEnv 复位（fix P3）', () => {
    it('先经预设捕获使 _timeOfDayBeforePreset 非 null，syncTimeOfDayFromEnv 复位并同步 speed', () => {
        envState.timeOfDayActive = true;
        envState.timeOfDaySpeed = 7;
        // 触发捕获路径（applyEnvPresetObject 内部 _timeOfDayBeforePreset === null 分支）
        applyEnvPresetObject(SAMPLE_PRESET);
        expect(mk._lastTick === undefined).toBe(true); // 未注册 tick（仅预设动画 observer）

        // [fix P3] 复位预设捕获残留
        syncTimeOfDayFromEnv();
        expect(envState.timeOfDaySpeed).toBe(7); // _timeOfDaySpeed 同步自 envState
        // 不抛错即覆盖 _timeOfDayBeforePreset = null 修复行
    });
});

describe('env-time-of-day — applyEnvPresetObject 异常中断复位（fix P2/P3）', () => {
    it('动画循环抛错时 catch 复位运行标志并恢复 time-of-day 暂停', () => {
        envState.timeOfDayActive = true; // 原 time-of-day 活跃 → 捕获 true、pause true
        mk.isLightingReady.mockReturnValue(true);
        mk.setLightState.mockImplementation(() => {
            throw new Error('light boom');
        });

        applyEnvPresetObject(SAMPLE_PRESET);
        expect(h.observers.length).toBe(1); // 注册了动画循环 observer

        // 驱动一次循环 → setLightState 抛错 → 进入 catch 复位分支
        h.observers[0]();

        expect(mk.setPresetAnimActive).toHaveBeenCalledWith(false);
        expect(mk.setSkipLightAutoSave).toHaveBeenCalledWith(false);
        expect(mk.cancelEnvPersistTimer).toHaveBeenCalled();
    });
});

describe('env-time-of-day — applyEnvPresetObject 正常完成恢复 time-of-day（t>=1）', () => {
    it('动画到达 t>=1 时复位预设标志并恢复 time-of-day 暂停状态', () => {
        envState.timeOfDayActive = true;
        nowMs = 1000; // startTime
        applyEnvPresetObject(SAMPLE_PRESET);

        // 推进到 >= 动画时长(2000ms) → t=1 完成分支
        nowMs = 3000;
        h.observers[0]();

        expect(mk.setPresetAnimActive).toHaveBeenCalledWith(false);
        expect(mk.setSkipLightAutoSave).toHaveBeenCalledWith(false);
        expect(mk.cancelEnvPersistTimer).toHaveBeenCalled();
    });
});

describe('env-time-of-day — 分类预设 / 预设应用（导出 API）', () => {
    it('applyEnvPresetByCategory：空 fields 返回 false', () => {
        expect(applyEnvPresetByCategory({ version: 3, category: 'env:sky', label: 'test', fields: {} })).toBe(false);
    });

    it('applyEnvPresetByCategory：env:sky 且含 sunAngle 时调用 setEnvSunAngle 并 setEnvState', () => {
        const ok = applyEnvPresetByCategory({ version: 3, category: 'env:sky', label: 'test', fields: { sunAngle: 30 } });
        expect(ok).toBe(true);
        expect(getEnvSunAngle()).toBeCloseTo(30, 5);
        expect(mk.setEnvState).toHaveBeenCalled();
    });

    it('applyEnvPreset：命中 TIME_OF_DAY_PRESETS 返回 true，未命中返回 false', () => {
        expect(applyEnvPreset('dawn')).toBe(true);
        expect(applyEnvPreset('nonexistent')).toBe(false);
    });

    it('setTimeOfDaySpeed：写 _timeOfDaySpeed 并同步 setEnvState', () => {
        setTimeOfDaySpeed(4);
        expect(mk.setEnvState).toHaveBeenCalledWith({ timeOfDaySpeed: 4 }, true);
    });
});
