// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState } from '../core/wails-bindings';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

import { envState, EnvState, triggerAutoSave, mmdRuntime } from '../core/config';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { deriveLighting, ENV_PRESETS } from './env-lighting';
import * as impl from './scene-env-impl';
import {
    setLightState,
    getLightState,
    setSkipLightAutoSave,
    hemiLight,
    _updateSunDisc,
} from './scene-lighting';
import type { LightState } from './scene-lighting';
import { scene, setRenderState } from './scene';

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

    // 半球光 — 固定强度，颜色随天空色（MMD 材质对其不敏感，设为稳定值）
    hemiLight.intensity = 0.5;
    const skyMid = state.skyColorMid ?? [
        (state.skyColorTop[0] + state.skyColorBot[0]) / 2,
        (state.skyColorTop[1] + state.skyColorBot[1]) / 2,
        (state.skyColorTop[2] + state.skyColorBot[2]) / 2,
    ];
    hemiLight.diffuse = new Color3(skyMid[0], skyMid[1], skyMid[2]);
    hemiLight.groundColor = new Color3(
        state.groundColor[0] * 0.5,
        state.groundColor[1] * 0.5,
        state.groundColor[2] * 0.5,
    );
    // 场景环境色 — 直接影响 MMD 材质的 ambient 项，envIntensity 控制渗透力度
    // 0→0, 默认2→0.3, 3→0.45，最大不超过 0.5 以免冲淡方向光
    const ambientStrength = Math.min(state.envIntensity * 0.15, 0.5);
    scene.ambientColor = new Color3(
        skyMid[0] * ambientStrength,
        skyMid[1] * ambientStrength,
        skyMid[2] * ambientStrength,
    );
}

// ======== Gravity ========

const DEFAULT_GRAVITY = -98;
let _gravityStrength = 1.0;
const _gravityVec = new Vector3(0, DEFAULT_GRAVITY, 0);

export function setGravityStrength(value: number): void {
    _gravityStrength = Math.max(0, Math.min(2, value));
    _gravityVec.y = DEFAULT_GRAVITY * _gravityStrength;
    // physics 是 WASM 版专属 API，JS 版无物理，instanceof 守卫后访问
    if (mmdRuntime instanceof MmdWasmRuntime && mmdRuntime.physics) {
        mmdRuntime.physics.setGravity(_gravityVec);
    }
    triggerAutoSave();
}

export function getGravityStrength(): number {
    return _gravityStrength;
}

// ======== Environment Sun Angle ========

let envSunAngle = 45;
let _envPersistTimer: ReturnType<typeof setTimeout> | null = null;

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
        // 更新 envState.sunAngle 使天空和半球光跟随
        envState.sunAngle = envSunAngle;
        _applyEnvStateFacade(envState);
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

// ======== Environment Presets ========

let _presetAnimId = 0; // 动画 ID，每次新预设递增，用于取消旧动画

export function applyEnvPreset(name: string): boolean {
    const preset = ENV_PRESETS[name];
    if (!preset) {
        return false;
    }
    return applyEnvPresetObject(preset);
}

/** 应用任意 EnvPreset 对象（支持用户自定义预设）。 */
export function applyEnvPresetObject(preset: {
    label: string;
    skyColorTop: [number, number, number];
    skyColorBot: [number, number, number];
    sunAngle: number;
    azimuth?: number;
    exposure: number;
    toneMapping: number;
    dirDiffuse?: [number, number, number];
    dirDirection?: [number, number, number];
    dirIntensity?: number;
    hemiIntensity?: number;
}): boolean {
    _presetAnimId++; // 取消所有正在进行的预设动画
    const myId = _presetAnimId;
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

    // 捕获当前灯光状态用于插值
    const startLight = getLightState();
    // 若 preset 缺少 DerivedLighting 字段（如自定义预设未经过 importEnvPreset），
    // 现场推导一次。
    const derived = preset.dirDirection
        ? preset
        : (() => {
              const d = deriveLighting(
                  preset.skyColorTop,
                  preset.sunAngle,
                  preset.azimuth ?? -45
              );
              return { ...preset, ...d };
          })();
    const targetLight: Partial<LightState> = {
        // 方向光是太阳光，颜色固定为白色（不随天空色偏蓝）
        dirColor: [1, 0.95, 0.9],
        dirX: derived.dirDirection[0],
        dirY: derived.dirDirection[1],
        dirZ: derived.dirDirection[2],
        dirIntensity: derived.dirIntensity,
        hemiIntensity: derived.hemiIntensity,
    };

    const duration = 2000;
    const startTime = performance.now();

    // 动画期间抑制自动保存；先释放旧动画的锁（若有）
    setSkipLightAutoSave(false);
    setSkipLightAutoSave(true);

    const animLoop = () => {
        // 取消检测：新预设已启动，当前动画失效
        if (_presetAnimId !== myId) {
            setSkipLightAutoSave(false);
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

        setEnvState(
            {
                skyMode: 'procedural',
                skyColorTop: skyTop,
                skyColorMid: skyMid,
                skyColorBot: skyBot,
                skyBrightness: 1.0,
                sunAngle: preset.sunAngle,
                azimuth: preset.azimuth ?? -45,
                envIntensity: 2,
            },
            true
        ); // skipAutoSave

        // 插值方向光（太阳）参数
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
        setLightState(interpLight);

        if (t >= 1) {
            setSkipLightAutoSave(false);
            setRenderState({ exposure: preset.exposure, toneMapping: preset.toneMapping });
            SetEnvState(envState as unknown as import('../core/wails-bindings').main.EnvState).catch(() => {});
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

    if (partial.waterAnimSpeed !== undefined) {
        impl.updateWaterAnimSpeed(partial.waterAnimSpeed);
    }

    if (_envPersistTimer) {
        clearTimeout(_envPersistTimer);
    }
    _envPersistTimer = setTimeout(() => {
        SetEnvState(envState as unknown as import('../core/wails-bindings').main.EnvState).catch(() => {});
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}
