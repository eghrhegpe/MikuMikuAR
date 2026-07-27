// [doc:architecture] Env Time-of-Day — 时间流转 + 太阳角 + 环境预设动画
// 从 env-bridge.ts 拆出（ADR-148 Phase 5：env-bridge 瘦身）
// 职责: envSunAngle 缓存、time-of-day tick、预设动画过渡、分类预设应用
// 依赖: env-bridge（setEnvState/setPresetAnimActive/registerEnvStateMiddleware）+ env-persist

import { observe, type ObserverHandle } from '@/core/observer-handle';
import { envState } from '@/core/config';
import { feedbackStatus } from '@/core/feedback';
import {
    lerp as lerpUtil,
    lerpArray,
} from '@/core/clamp';
import { formatTimestamp } from '@/core/format-timestamp';
import { logWarn } from '@/core/logger';
import { setKey } from '@/core/set-key';
import { AUTO_LINK_THRESHOLD_DEG } from '@/core/ui-constants';
import { deriveLighting, TIME_OF_DAY_PRESETS, type CategorizedEnvPreset } from './env-lighting';
import { ensureEnvUpdateObserver } from './env-impl';
import { dispatchEnvChange, registerSceneTickCallback } from './env-dispatcher';
import {
    setLightState,
    getLightState,
    setSkipLightAutoSave,
    _updateSunDisc,
} from '../render/lighting';
import type { LightState } from '../render/lighting';
import { scene } from '../scene';
import {
    setEnvState,
    setPresetAnimActive,
    registerEnvStateMiddleware,
    applyEnvStateFacade,
} from './env-bridge';
import { persistEnvState, cancelEnvPersistTimer } from './env-persist';

// ======== Environment Sun Angle ========

// [fix:ghost-state] envSunAngle 与 envState.sunAngle 双源同步：
// envSunAngle 是模块内缓存（供 _timeOfDayTick 高频递增 + 滑块 bind 读取），
// envState.sunAngle 是持久化源。setEnvState 现在会反向同步 envSunAngle（见 syncEnvSunAngle 中间件），
// 消除原「setEnvState({ sunAngle }) 只写 envState、漏写 envSunAngle」的漂移陷阱。
let envSunAngle = 45;

export function setEnvSunAngle(deg: number): void {
    envSunAngle = Math.max(-15, Math.min(90, deg));
    envState.sunAngle = envSunAngle;
}

export function getEnvSunAngle(): number {
    return envSunAngle;
}

// ======== Time-of-Day ========

// [fix:ghost-state] 拆分双源：
//   - envState.timeOfDayActive = 用户意图（是否启用），持久化，由 start/stop 写入
//   - _timeOfDayPaused = 预设动画期间的临时暂停标志，不持久化
let _timeOfDayPaused = false;
let _timeOfDaySpeed = 3;
let _lastSkySunAngle = 90;
let _lastAutoLinkSunAngle = 90;
let _unregisterTimeOfDay: (() => void) | null = null;

function _timeOfDayTick(): void {
    if (!envState.timeOfDayActive || _timeOfDayPaused) {
        return;
    }
    const dt = scene.deltaTime / 1000;
    envSunAngle += _timeOfDaySpeed * dt;
    if (envSunAngle > 90) {
        envSunAngle = -15;
    }
    if (envSunAngle < -15) {
        envSunAngle = 90;
    }

    _updateSunDisc();

    if (Math.abs(envSunAngle - _lastAutoLinkSunAngle) >= AUTO_LINK_THRESHOLD_DEG) {
        _lastAutoLinkSunAngle = envSunAngle;
        _lastSkySunAngle = envSunAngle;
        envState.sunAngle = envSunAngle;
        const _tickStart = performance.now();
        applyEnvStateFacade(envState, { sunAngle: envSunAngle });
        if (performance.now() - _tickStart > 2) {
            logWarn(
                'perf:tick',
                `[${formatTimestamp()}] _applyEnvStateFacade(sunAngle) took ${performance.now() - _tickStart}ms (angle=${envSunAngle.toFixed(1)})`
            );
        }
    } else if (Math.abs(envSunAngle - _lastSkySunAngle) >= 0.4) {
        _lastSkySunAngle = envSunAngle;
        if (envState.skyMode === 'procedural') {
            dispatchEnvChange(new Set(['sunAngle']), envState);
        }
    }
}

export function startTimeOfDay(speed?: number): void {
    if (speed !== undefined) {
        _timeOfDaySpeed = speed;
        setEnvState({ timeOfDaySpeed: speed }, true);
    }
    if (envState.timeOfDayActive && !_timeOfDayPaused) {
        return;
    }
    setEnvState({ timeOfDayActive: true }, true);
    _timeOfDayPaused = false;
    _lastSkySunAngle = envSunAngle;
    _lastAutoLinkSunAngle = envSunAngle;
    ensureEnvUpdateObserver();
    _unregisterTimeOfDay = registerSceneTickCallback(_timeOfDayTick);
}

export function stopTimeOfDay(): void {
    setEnvState({ timeOfDayActive: false }, true);
    _timeOfDayPaused = false;
    if (_unregisterTimeOfDay) {
        _unregisterTimeOfDay();
        _unregisterTimeOfDay = null;
    }
    cancelEnvPersistTimer();
    void persistEnvState({ ...envState }).catch((err) => {
        logWarn('stopTimeOfDay', 'persist failed', err);
        feedbackStatus('env.persistFailed', undefined, false);
    });
}

export function isTimeOfDayActive(): boolean {
    return envState.timeOfDayActive && !_timeOfDayPaused;
}

export function getTimeOfDaySpeed(): number {
    return _timeOfDaySpeed;
}

export function setTimeOfDaySpeed(s: number): void {
    _timeOfDaySpeed = s;
    setEnvState({ timeOfDaySpeed: s }, true);
}

/** 从持久化的 envState 恢复 time-of-day 模块变量（启动时调用） */
export function syncTimeOfDayFromEnv(): void {
    _timeOfDayPaused = false;
    _timeOfDaySpeed = envState.timeOfDaySpeed;
}

// ======== Environment Presets ========

let _presetAnimId = 0;
let _timeOfDayBeforePreset: boolean | null = null;

export function applyEnvPreset(name: string): boolean {
    const preset = TIME_OF_DAY_PRESETS[name];
    if (!preset) {
        return false;
    }
    return applyEnvPresetObject(preset);
}

interface PresetAnimCtx {
    myId: number;
    preset: Parameters<typeof applyEnvPresetObject>[0];
    startSkyTop: [number, number, number];
    startSkyBot: [number, number, number];
    startSkyMid: [number, number, number];
    mid: [number, number, number];
    startLight: LightState;
    targetLight: Partial<LightState>;
    startTime: number;
    lastSkyUpdate: number;
}

const PRESET_ANIM_DURATION = 2000;
const SKY_UPDATE_INTERVAL = 50;

function _presetAnimLoop(ctx: PresetAnimCtx, handle: ObserverHandle): void {
    if (_presetAnimId !== ctx.myId) {
        handle.dispose();
        return;
    }
    const elapsed = performance.now() - ctx.startTime;
    const t = Math.min(elapsed / PRESET_ANIM_DURATION, 1.0);
    const lerp = (a: number, b: number) => lerpUtil(a, b, t);

    if (elapsed - ctx.lastSkyUpdate >= SKY_UPDATE_INTERVAL || t >= 0.999) {
        const skyTop: [number, number, number] = [
            lerp(ctx.startSkyTop[0], ctx.preset.skyColorTop[0]),
            lerp(ctx.startSkyTop[1], ctx.preset.skyColorTop[1]),
            lerp(ctx.startSkyTop[2], ctx.preset.skyColorTop[2]),
        ];
        const skyBot: [number, number, number] = [
            lerp(ctx.startSkyBot[0], ctx.preset.skyColorBot[0]),
            lerp(ctx.startSkyBot[1], ctx.preset.skyColorBot[1]),
            lerp(ctx.startSkyBot[2], ctx.preset.skyColorBot[2]),
        ];
        const skyMid: [number, number, number] = [
            lerp(ctx.startSkyMid[0], ctx.mid[0]),
            lerp(ctx.startSkyMid[1], ctx.mid[1]),
            lerp(ctx.startSkyMid[2], ctx.mid[2]),
        ];

        setEnvState(
            {
                skyMode: 'procedural',
                skyColorTop: skyTop,
                skyColorMid: skyMid,
                skyColorBot: skyBot,
                skyBrightness: 1.0,
                sunAngle: ctx.preset.sunAngle,
                azimuth: ctx.preset.azimuth ?? -45,
                envIntensity: 2,
            },
            true
        );
        ctx.lastSkyUpdate = elapsed;
    }

    const interpLight: Partial<LightState> = {};
    for (const key of Object.keys(ctx.targetLight) as (keyof LightState)[]) {
        const a = ctx.startLight[key];
        const b = ctx.targetLight[key];
        if (typeof a === 'number' && typeof b === 'number') {
            setKey(interpLight, key, lerp(a, b) as LightState[typeof key]);
        } else if (Array.isArray(a) && Array.isArray(b)) {
            setKey(interpLight, key, lerpArray(a, b, t) as LightState[typeof key]);
        }
    }
    setLightState(interpLight);

    if (t >= 1) {
        handle.dispose();
        setSkipLightAutoSave(false);
        if (_timeOfDayBeforePreset) {
            _timeOfDayPaused = false;
            _lastSkySunAngle = envSunAngle;
            _lastAutoLinkSunAngle = envSunAngle;
        }
        _timeOfDayBeforePreset = null;
        setPresetAnimActive(false);
        cancelEnvPersistTimer();
        void persistEnvState({ ...envState }).catch((err) => {
            logWarn('presetAnim', 'persist failed', err);
            feedbackStatus('env.persistFailed', undefined, false);
        });
    }
}

/** 应用任意 EnvPreset 对象（支持用户自定义预设）。 */
export function applyEnvPresetObject(preset: {
    label: string;
    skyColorTop: [number, number, number];
    skyColorBot: [number, number, number];
    sunAngle: number;
    azimuth?: number;
    dirDiffuse?: [number, number, number];
    dirDirection?: [number, number, number];
    dirIntensity?: number;
    hemiIntensity?: number;
}): boolean {
    _presetAnimId++;
    const myId = _presetAnimId;
    envSunAngle = preset.sunAngle;

    if (_timeOfDayBeforePreset === null) {
        _timeOfDayBeforePreset = envState.timeOfDayActive && !_timeOfDayPaused;
    }
    if (envState.timeOfDayActive && !_timeOfDayPaused) {
        _timeOfDayPaused = true;
    }
    setPresetAnimActive(true);

    const mid: [number, number, number] = [
        (preset.skyColorTop[0] + preset.skyColorBot[0]) / 2,
        (preset.skyColorTop[1] + preset.skyColorBot[1]) / 2,
        (preset.skyColorTop[2] + preset.skyColorBot[2]) / 2,
    ];

    const startSkyTop = [...envState.skyColorTop] as [number, number, number];
    const startSkyBot = [...envState.skyColorBot] as [number, number, number];
    const startSkyMid: [number, number, number] = envState.skyColorMid
        ? [...envState.skyColorMid]
        : [
              (startSkyTop[0] + startSkyBot[0]) / 2,
              (startSkyTop[1] + startSkyBot[1]) / 2,
              (startSkyTop[2] + startSkyBot[2]) / 2,
          ];

    const startLight = getLightState();
    const derived = preset.dirDirection
        ? preset
        : (() => {
              const d = deriveLighting(preset.skyColorTop, preset.sunAngle, preset.azimuth ?? -45);
              return { ...preset, ...d };
          })();
    const targetLight: Partial<LightState> = {
        dirColor: derived.dirDiffuse,
        dirX: derived.dirDirection[0],
        dirY: derived.dirDirection[1],
        dirZ: derived.dirDirection[2],
        dirIntensity: derived.dirIntensity,
        hemiIntensity: derived.hemiIntensity,
    };

    setSkipLightAutoSave(true);

    const ctx: PresetAnimCtx = {
        myId,
        preset,
        startSkyTop,
        startSkyBot,
        startSkyMid,
        mid,
        startLight,
        targetLight,
        startTime: performance.now(),
        lastSkyUpdate: 0,
    };
    const handle = observe(scene.onBeforeRenderObservable, () => _presetAnimLoop(ctx, handle));
    return true;
}

/**
 * [adr-120] 按类别应用用户自定义预设。
 * 与 applyEnvPresetObject（内置天空预设，带动画过渡）不同，本函数直接 setEnvState 该类别字段，
 * 不做动画过渡（用户分类预设追求精确还原，无需过渡）。天空类预设会额外触发光照联动。
 */
export function applyEnvPresetByCategory(preset: CategorizedEnvPreset): boolean {
    if (!preset.fields || Object.keys(preset.fields).length === 0) {
        return false;
    }
    if (preset.category === 'sky' && typeof preset.fields.sunAngle === 'number') {
        setEnvSunAngle(preset.fields.sunAngle);
    }
    setEnvState(preset.fields);
    return true;
}

// ======== Middleware: syncEnvSunAngle ========
// [fix:ghost-state] 反向同步 envSunAngle 模块缓存，消除双源漂移：
// 原代码只写 envState.sunAngle，漏写 envSunAngle，导致 _timeOfDayTick
// 从旧 envSunAngle 递增覆盖用户设置，且滑块 getEnvSunAngle() 显示旧值。
registerEnvStateMiddleware({
    name: 'syncEnvSunAngle',
    phase: 'pre-facade',
    fn: (_envState, migrated) => {
        if (migrated.sunAngle !== undefined) {
            envSunAngle = migrated.sunAngle;
        }
    },
});
