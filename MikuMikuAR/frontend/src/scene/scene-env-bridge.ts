// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState } from '../../wailsjs/go/main/App';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { envState, EnvState, triggerAutoSave, mmdRuntime } from '../core/config';
import { deriveLighting, ENV_PRESETS } from './env-lighting';
import {
    applyEnvState as applyEnvStateFacade,
    applySky,
    updateWaterAnimSpeed,
    registerSceneTickCallback,
    ensureEnvUpdateObserver,
} from './scene-env';
import { scene, setRenderState } from './scene';
import { setLightState, getLightState, _updateSunDisc } from './scene-lighting';
import type { LightState } from './scene-lighting';

// ======== Gravity ========

const DEFAULT_GRAVITY = -98;
let _gravityStrength = 1.0;
const _gravityVec = new Vector3(0, DEFAULT_GRAVITY, 0);

export function setGravityStrength(value: number): void {
    _gravityStrength = Math.max(0, Math.min(2, value));
    _gravityVec.y = DEFAULT_GRAVITY * _gravityStrength;
    mmdRuntime.physics.setGravity(_gravityVec);
    triggerAutoSave();
}

export function getGravityStrength(): number {
    return _gravityStrength;
}

// ======== Environment Auto-Link ========

let envAutoLink = true;
let envSunAngle = 45;
let _envPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function setEnvAutoLink(on: boolean): void {
    envAutoLink = on;
}

export function getEnvAutoLink(): boolean {
    return envAutoLink;
}

export function setEnvSunAngle(deg: number): void {
    envSunAngle = Math.max(-15, Math.min(90, deg));
}

export function getEnvSunAngle(): number {
    return envSunAngle;
}

// ======== Time-of-Day ========

let _timeOfDayActive = false;
let _timeOfDaySpeed = 3;
let _lastSkySunAngle = 90;
let _unregisterTimeOfDay: (() => void) | null = null; // 回调注销函数

function _timeOfDayTick(): void {
    if (!_timeOfDayActive) {
        return;
    }
    const dt = scene.getAnimationRatio() * (1 / 60);
    envSunAngle += _timeOfDaySpeed * dt;
    if (envSunAngle > 90) {
        envSunAngle = -15;
    }
    if (envSunAngle < -15) {
        envSunAngle = 90;
    }

    _updateSunDisc();
    redoEnvAutoLink();

    if (Math.abs(envSunAngle - _lastSkySunAngle) >= 0.4) {
        _lastSkySunAngle = envSunAngle;
        if (envState.skyMode === 'procedural') {
            applySky(envState);
        }
    }
}

export function startTimeOfDay(speed?: number): void {
    if (speed !== undefined) {
        _timeOfDaySpeed = speed;
    }
    if (_timeOfDayActive) {
        return;
    }
    _timeOfDayActive = true;
    _lastSkySunAngle = envSunAngle;
    // 使用 impl 的统一 observer 注册表，避免多个独立的 scene observer
    ensureEnvUpdateObserver(); // 确保 impl 的 observer 已初始化
    _unregisterTimeOfDay = registerSceneTickCallback(_timeOfDayTick);
}

export function stopTimeOfDay(): void {
    _timeOfDayActive = false;
    _unregisterTimeOfDay();
    _unregisterTimeOfDay = null;
}

export function isTimeOfDayActive(): boolean {
    return _timeOfDayActive;
}

export function getTimeOfDaySpeed(): number {
    return _timeOfDaySpeed;
}

export function setTimeOfDaySpeed(s: number): void {
    _timeOfDaySpeed = s;
}

// ======== Env Auto-Link Derivation ========

export function redoEnvAutoLink(): void {
    if (!envAutoLink || envState.skyMode !== 'procedural') {
        return;
    }
    const l = deriveLighting(envState.skyColorTop, envSunAngle, envState.azimuth ?? -45);
    setLightState({
        dirColor: l.dirDiffuse,
        dirX: l.dirDirection[0],
        dirY: l.dirDirection[1],
        dirZ: l.dirDirection[2],
        dirIntensity: l.dirIntensity,
        hemiIntensity: l.hemiIntensity,
    });
}

// ======== Environment Presets ========

export function applyEnvPreset(name: string): boolean {
    const preset = ENV_PRESETS[name];
    if (!preset) {
        return false;
    }
    const wasLinked = envAutoLink;
    envAutoLink = false;
    envSunAngle = preset.sunAngle;

    const mid: [number, number, number] = [
        (preset.skyColorTop[0] + preset.skyColorBot[0]) / 2,
        (preset.skyColorTop[1] + preset.skyColorBot[1]) / 2,
        (preset.skyColorTop[2] + preset.skyColorBot[2]) / 2,
    ];

    // 捕获当前状态用于插值
    const startSkyTop = [...envState.skyColorTop] as [number, number, number];
    const startSkyBot = [...envState.skyColorBot] as [number, number, number];
    const startSkyMid = envState.skyColorMid
        ? ([...envState.skyColorMid] as [number, number, number])
        : [
              (startSkyTop[0] + startSkyBot[0]) / 2,
              (startSkyTop[1] + startSkyBot[1]) / 2,
              (startSkyTop[2] + startSkyBot[2]) / 2,
          ];
    const startLight = getLightState();
    const targetLight: Partial<LightState> = {
        dirColor: preset.dirDiffuse,
        dirX: preset.dirDirection[0],
        dirY: preset.dirDirection[1],
        dirZ: preset.dirDirection[2],
        dirIntensity: preset.dirIntensity,
        hemiIntensity: preset.hemiIntensity,
    };

    const duration = 2000;
    const startTime = performance.now();

    const animLoop = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const lerp = (a: number, b: number) => a + (b - a) * t;

        // 插值天空颜色
        const skyTop: [number, number, number] = [
            lerp(startSkyTop[0], preset.skyColorTop[0]),
            lerp(startSkyTop[1], preset.skyColorTop[1]),
            lerp(startSkyTop[2], preset.skyColorTop[2]),
        ];
        const skyBot: [number, number, number] = [
            lerp(startSkyBot[0], preset.skyColorBot[0]),
            lerp(startSkyBot[1], preset.skyColorBot[1]),
            lerp(startSkyBot[2], preset.skyColorBot[2]),
        ];
        const skyMid: [number, number, number] = [
            lerp(startSkyMid[0], mid[0]),
            lerp(startSkyMid[1], mid[1]),
            lerp(startSkyMid[2], mid[2]),
        ];

        setEnvState({
            skyMode: 'procedural',
            skyColorTop: skyTop,
            skyColorMid: skyMid,
            skyColorBot: skyBot,
            skyBrightness: 1.0,
            sunAngle: preset.sunAngle,
            azimuth: preset.azimuth ?? -45,
        });

        // 插值并应用光照参数
        const interpLight: Partial<LightState> = {};
        for (const key of Object.keys(targetLight) as (keyof LightState)[]) {
            const a = startLight[key];
            const b = targetLight[key];
            if (typeof a === 'number' && typeof b === 'number') {
                (interpLight as any)[key] = lerp(a, b);
            } else if (Array.isArray(a) && Array.isArray(b)) {
                (interpLight as any)[key] = a.map((v, i) => lerp(v, b[i])) as any;
            }
        }
        setLightState(interpLight);

        if (t >= 1) {
            setRenderState({ exposure: preset.exposure, toneMapping: preset.toneMapping });
            envAutoLink = wasLinked;
        } else {
            requestAnimationFrame(animLoop);
        }
    };
    requestAnimationFrame(animLoop);
    return true;
}

// ======== setEnvState (central entry point) ========

export function setEnvState(partial: Partial<EnvState>, skipAutoSave = false): void {
    const isFullRestore = Object.keys(partial).length > 5 && partial.skyColorTop[0] === 0;
    if (
        !isFullRestore &&
        ((partial.skyColorTop &&
            partial.skyColorTop[0] === 0 &&
            partial.skyColorTop[1] === 0 &&
            partial.skyColorTop[2] === 0) ||
            (partial.skyColorBot &&
                partial.skyColorBot[0] === 0 &&
                partial.skyColorBot[1] === 0 &&
                partial.skyColorBot[2] === 0))
    ) {
        console.warn('[env] ⚠️ setEnvState with black sky color:', JSON.stringify(partial));
        console.warn(new Error().stack);
    }

    Object.assign(envState, partial);

    applyEnvStateFacade(envState);

    if (
        envAutoLink &&
        envState.skyMode === 'procedural' &&
        (partial.skyColorTop !== undefined ||
            partial.skyColorMid !== undefined ||
            partial.skyColorBot !== undefined ||
            partial.skyBrightness !== undefined)
    ) {
        const l = deriveLighting(envState.skyColorTop, envSunAngle, envState.azimuth ?? -45);
        setLightState({
            dirColor: l.dirDiffuse,
            dirX: l.dirDirection[0],
            dirY: l.dirDirection[1],
            dirZ: l.dirDirection[2],
            dirIntensity: l.dirIntensity,
            hemiIntensity: l.hemiIntensity,
        });
    }

    if (partial.waterAnimSpeed !== undefined) {
        updateWaterAnimSpeed(partial.waterAnimSpeed);
    }

    if (_envPersistTimer) {
        clearTimeout(_envPersistTimer);
    }
    _envPersistTimer = setTimeout(() => {
        SetEnvState(envState as any).catch(() => {});
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}
