// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState } from '../../wailsjs/go/main/App';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { envState, EnvState, triggerAutoSave, mmdRuntime } from '../core/config';
import { deriveLighting, ENV_PRESETS } from './env-lighting';
// 直接从 impl 导入，避免与 scene-env.ts 的循环依赖
import * as impl from './scene-env-impl';
import { scene, setRenderState } from './scene';
import {
    setLightState,
    getLightState,
    _updateSunDisc,
    setSkipLightAutoSave,
} from './scene-lighting';
import type { LightState } from './scene-lighting';

function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
    obj[key] = value;
}

/** 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 */
function _applyEnvStateFacade(state: EnvState): void {
    try {
        impl.applySky(state);
    } catch (e) {
        console.warn('[env] sky fail:', e);
    }
    try {
        impl.applyGround(state);
    } catch (e) {
        console.warn('[env] ground fail:', e);
    }
    try {
        impl.applyFog(state);
    } catch (e) {
        console.warn('[env] fog fail:', e);
    }
    try {
        if (state.waterEnabled) {
            impl.createWater(state);
        } else {
            impl.disposeWater();
        }
    } catch (e) {
        console.warn('[env] water fail:', e);
    }
    try {
        if (state.particleEnabled && state.particleType && state.particleType !== 'none') {
            impl.createParticleEmitter(state.particleType, state.windEnabled);
        } else {
            impl.disposeParticles();
        }
    } catch (e) {
        console.warn('[env] particle fail:', e);
    }
    try {
        if (state.cloudsEnabled) {
            impl.createClouds(state);
        } else {
            impl.disposeClouds();
        }
    } catch (e) {
        console.warn('[env] cloud fail:', e);
    }
}

// ======== Gravity ========

const DEFAULT_GRAVITY = -98;
let _gravityStrength = 1.0;
const _gravityVec = new Vector3(0, DEFAULT_GRAVITY, 0);

export function setGravityStrength(value: number): void {
    _gravityStrength = Math.max(0, Math.min(2, value));
    _gravityVec.y = DEFAULT_GRAVITY * _gravityStrength;
    if (mmdRuntime?.physics) {
        mmdRuntime.physics.setGravity(_gravityVec);
    }
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

const _AUTO_LINK_THRESHOLD_DEG = 0.5;

let _timeOfDayActive = false;
let _timeOfDaySpeed = 3;
let _lastSkySunAngle = 90;
let _lastAutoLinkSunAngle = 90;
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

    if (Math.abs(envSunAngle - _lastAutoLinkSunAngle) >= _AUTO_LINK_THRESHOLD_DEG) {
        _lastAutoLinkSunAngle = envSunAngle;
        redoEnvAutoLink();
    }

    if (Math.abs(envSunAngle - _lastSkySunAngle) >= 0.4) {
        _lastSkySunAngle = envSunAngle;
        if (envState.skyMode === 'procedural') {
            impl.applySky(envState);
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
    _lastAutoLinkSunAngle = envSunAngle;
    // 使用 impl 的统一 observer 注册表，避免多个独立的 scene observer
    impl.ensureEnvUpdateObserver(); // 确保 impl 的 observer 已初始化
    _unregisterTimeOfDay = impl.registerSceneTickCallback(_timeOfDayTick);
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

let _presetAnimId = 0; // 动画 ID，每次新预设递增，用于取消旧动画

export function applyEnvPreset(name: string): boolean {
    const preset = ENV_PRESETS[name];
    if (!preset) {
        return false;
    }
    _presetAnimId++; // 取消所有正在进行的预设动画
    const myId = _presetAnimId;
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

    // 动画期间抑制自动保存，避免每帧触发 I/O
    setSkipLightAutoSave(true);

    const animLoop = () => {
        // 取消检测：新预设已启动，当前动画失效
        if (_presetAnimId !== myId) {
            return;
        }
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

        // 动画中跳过自动保存，仅更新状态和场景
        setEnvState(
            {
                skyMode: 'procedural',
                skyColorTop: skyTop,
                skyColorMid: skyMid,
                skyColorBot: skyBot,
                skyBrightness: 1.0,
                sunAngle: preset.sunAngle,
                azimuth: preset.azimuth ?? -45,
            },
            true
        ); // skipAutoSave

        // 插值并应用光照参数
        const interpLight: Partial<LightState> = {};
        for (const key of Object.keys(targetLight) as (keyof LightState)[]) {
            const a = startLight[key];
            const b = targetLight[key];
            if (typeof a === 'number' && typeof b === 'number') {
                setKey(interpLight, key, lerp(a, b) as LightState[typeof key]);
            } else if (Array.isArray(a) && Array.isArray(b)) {
                setKey(interpLight, key, a.map((v, i) => lerp(v, b[i])) as LightState[typeof key]);
            }
        }
        setLightState(interpLight); // setSkipLightAutoSave 已抑制其内部保存

        if (t >= 1) {
            setSkipLightAutoSave(false);
            setRenderState({ exposure: preset.exposure, toneMapping: preset.toneMapping });
            envAutoLink = wasLinked;
            // 动画完成，执行一次性后端保存和本地保存
            SetEnvState(envState as unknown as import('../../wailsjs/go/models').main.EnvState).catch(() => {});
            triggerAutoSave();
        } else {
            requestAnimationFrame(animLoop);
        }
    };
    requestAnimationFrame(animLoop);
    return true;
}

// ======== setEnvState (central entry point) ========

export function setEnvState(partial: Partial<EnvState>, skipAutoSave = false): void {
    Object.assign(envState, partial);

    _applyEnvStateFacade(envState);

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
        impl.updateWaterAnimSpeed(partial.waterAnimSpeed);
    }

    if (_envPersistTimer) {
        clearTimeout(_envPersistTimer);
    }
    _envPersistTimer = setTimeout(() => {
        SetEnvState(envState as unknown as import('../../wailsjs/go/models').main.EnvState).catch(() => {});
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}
