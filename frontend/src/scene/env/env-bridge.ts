// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState, SetUIState } from '../../core/wails-bindings';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

import { envState, EnvState, triggerAutoSave, mmdRuntime } from '../../core/config';
import { uiState, setUIPersistCallback } from '../../core/state';
import type { UIState } from '../../core/types';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { deriveLighting, TIME_OF_DAY_PRESETS } from './env-lighting';
import * as impl from './env-impl';
import {
    setLightState,
    getLightState,
    setSkipLightAutoSave,
    hemiLight,
    _updateSunDisc,
} from '../render/lighting';
import type { LightState } from '../render/lighting';
import { applyLightingPresetFromEnv } from '../render/lighting';
import { scene, setRenderState } from '../scene';

function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
    obj[key] = value;
}

/** 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 */
function _applyEnvStateFacade(state: EnvState, partial?: Partial<EnvState>): void {
    const changed = partial ? Object.keys(partial) : null;

    // Guard: skip sky rebuild unless a sky-related property changed
    const skyKeys = [
        'skyMode',
        'skyColorTop',
        'skyColorMid',
        'skyColorBot',
        'skyTexture',
        'skyRotationY',
        'skyRotationSpeed',
        'skyBrightness',
        'starsEnabled',
        'envIntensity',
        'sunAngle',
        'azimuth',
    ];
    if (!changed || changed.some((k) => skyKeys.includes(k))) {
        try {
            impl.applySky(state);
        } catch (e) {
            console.warn('[env] sky fail:', e);
        }
    }

    // Guard: skip ground rebuild unless ground-related property changed
    const groundKeys = [
        'groundVisible',
        'groundMode',
        'groundColor',
        'groundAlpha',
        'groundTexture',
        'groundTextureEnabled',
        'groundTextureScale',
        'groundTextureRotation',
        'groundTerrainHeight',
        'groundTerrainScale',
        'groundTerrainSeed',
        'groundTerrainOctaves',
    ];
    if (!changed || changed.some((k) => groundKeys.includes(k))) {
        try {
            impl.applyGround(state);
        } catch (e) {
            console.warn('[env] ground fail:', e);
        }
    }

    // Guard: skip fog rebuild unless fog-related property changed
    const fogKeys = ['fogEnabled', 'fogColor', 'fogDensity', 'fogMode', 'fogStart', 'fogEnd'];
    if (!changed || changed.some((k) => fogKeys.includes(k))) {
        try {
            impl.applyFog(state);
        } catch (e) {
            console.warn('[env] fog fail:', e);
        }
    }

    // Water
    const waterKeys = [
        'waterEnabled',
        'waterLevel',
        'waterColor',
        'waterTransparency',
        'waterWaveHeight',
        'waterSize',
        'waterAnimSpeed',
        'fresnelBias',
        'fresnelPower',
        'diffuseStrength',
        'ambientStrength',
        'foamTransitionRange',
        'rippleNormalStrength',
        'rippleGlintStrength',
        'causticColor1',
        'causticColor2',
        'causticScrollX',
        'causticScrollY',
        'fresnelAlphaInfluence',
        'foamOpacity',
        'waterFogColor',
        'waterFogDensity',
        'waterFogOpacityInfluence',
    ];
    if (!changed || changed.some((k) => waterKeys.includes(k))) {
        try {
            if (state.waterEnabled) {
                impl.createWater(state);
            } else {
                impl.disposeWater();
            }
        } catch (e) {
            console.warn('[env] water fail:', e);
        }
    }

    // Particles
    const particleKeys = [
        'particleEnabled',
        'particleType',
        'particleEmitRate',
        'particleSize',
        'particleSpeed',
        'particleSplash',
        'particleCustomTexture',
    ];
    if (!changed || changed.some((k) => particleKeys.includes(k))) {
        try {
            if (state.particleEnabled && state.particleType && state.particleType !== 'none') {
                impl.createParticleEmitter(state.particleType, state.windEnabled);
            } else {
                impl.disposeParticles();
            }
        } catch (e) {
            console.warn('[env] particle fail:', e);
        }
    }

    // Clouds
    const cloudKeys = [
        'cloudsEnabled',
        'cloudCover',
        'cloudScale',
        'cloudHeight',
        'cloudThickness',
        'cloudVisibility',
        'cloudGap',
    ];
    if (!changed || changed.some((k) => cloudKeys.includes(k))) {
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

    // 半球光 — 强度跟随当前灯光状态，颜色随天空色
    hemiLight.intensity = getLightState().hemiIntensity;
    const skyMid = state.skyColorMid ?? [
        (state.skyColorTop[0] + state.skyColorBot[0]) / 2,
        (state.skyColorTop[1] + state.skyColorBot[1]) / 2,
        (state.skyColorTop[2] + state.skyColorBot[2]) / 2,
    ];
    hemiLight.diffuse = new Color3(skyMid[0], skyMid[1], skyMid[2]);
    hemiLight.groundColor = new Color3(
        state.groundColor[0] * 0.5,
        state.groundColor[1] * 0.5,
        state.groundColor[2] * 0.5
    );
    // 场景环境色 — 直接影响 MMD 材质的 ambient 项，envIntensity 控制渗透力度
    // 0→0, 默认2→0.3, 3→0.45，最大不超过 0.5 以免冲淡方向光
    const ambientStrength = Math.min(state.envIntensity * 0.15, 0.5);
    scene.ambientColor = new Color3(
        skyMid[0] * ambientStrength,
        skyMid[1] * ambientStrength,
        skyMid[2] * ambientStrength
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
        _lastSkySunAngle = envSunAngle; // sync so 0.4 check won't double-fire (Fix C)
        envState.sunAngle = envSunAngle;
        _applyEnvStateFacade(envState);
    } else if (Math.abs(envSunAngle - _lastSkySunAngle) >= 0.4) {
        _lastSkySunAngle = envSunAngle;
        if (envState.skyMode === 'procedural') {
            impl.applySky(envState);
        }
    }
}

export function startTimeOfDay(speed?: number): void {
    if (speed !== undefined) {
        _timeOfDaySpeed = speed;
        envState.timeOfDaySpeed = speed;
    }
    if (_timeOfDayActive) {
        return;
    }
    _timeOfDayActive = true;
    envState.timeOfDayActive = true;
    _lastSkySunAngle = envSunAngle;
    _lastAutoLinkSunAngle = envSunAngle;
    // 使用 impl 的统一 observer 注册表，避免多个独立的 scene observer
    impl.ensureEnvUpdateObserver(); // 确保 impl 的 observer 已初始化
    _unregisterTimeOfDay = impl.registerSceneTickCallback(_timeOfDayTick);
}

export function stopTimeOfDay(): void {
    _timeOfDayActive = false;
    envState.timeOfDayActive = false;
    if (_unregisterTimeOfDay) {
        _unregisterTimeOfDay();
        _unregisterTimeOfDay = null;
    }
    // 持久化当前 sunAngle 到后端
    SetEnvState(envState).catch(
        () => {}
    );
}

export function isTimeOfDayActive(): boolean {
    return _timeOfDayActive;
}

export function getTimeOfDaySpeed(): number {
    return _timeOfDaySpeed;
}

export function setTimeOfDaySpeed(s: number): void {
    _timeOfDaySpeed = s;
    envState.timeOfDaySpeed = s;
}

/** 从持久化的 envState 恢复 time-of-day 模块变量（启动时调用） */
export function syncTimeOfDayFromEnv(): void {
    _timeOfDayActive = envState.timeOfDayActive;
    _timeOfDaySpeed = envState.timeOfDaySpeed;
}

// ======== Environment Presets ========

let _presetAnimId = 0; // 动画 ID，每次新预设递增，用于取消旧动画

export function applyEnvPreset(name: string): boolean {
    const preset = TIME_OF_DAY_PRESETS[name];
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
    dirDiffuse?: [number, number, number];
    dirDirection?: [number, number, number];
    dirIntensity?: number;
    hemiIntensity?: number;
}): boolean {
    _presetAnimId++;
    const myId = _presetAnimId;
    envSunAngle = preset.sunAngle;

    const mid: [number, number, number] = [
        (preset.skyColorTop[0] + preset.skyColorBot[0]) / 2,
        (preset.skyColorTop[1] + preset.skyColorBot[1]) / 2,
        (preset.skyColorTop[2] + preset.skyColorBot[2]) / 2,
    ];

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
    const derived = preset.dirDirection
        ? preset
        : (() => {
              const d = deriveLighting(preset.skyColorTop, preset.sunAngle, preset.azimuth ?? -45);
              return { ...preset, ...d };
          })();
    const targetLight: Partial<LightState> = {
        dirColor: [1, 0.95, 0.9],
        dirX: derived.dirDirection[0],
        dirY: derived.dirDirection[1],
        dirZ: derived.dirDirection[2],
        dirIntensity: derived.dirIntensity,
        hemiIntensity: derived.hemiIntensity,
    };

    const duration = 2000;
    const startTime = performance.now();
    let lastSkyUpdate = 0;
    const SKY_UPDATE_INTERVAL = 50; // ms — 显示器刷新率无关，始终 ~20fps

    setSkipLightAutoSave(true);

    const animLoop = () => {
        if (_presetAnimId !== myId) {
            setSkipLightAutoSave(false);
            return;
        }
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);
        const lerp = (a: number, b: number) => a + (b - a) * t;

        // 天空纹理重建开销大（dispose + 重新生成），50ms 间隔节流（~20fps），
        // 显示器刷新率无关，texture rebuild 从 ~120 次降到 ~40 次。
        if (elapsed - lastSkyUpdate >= SKY_UPDATE_INTERVAL || t >= 0.999) {
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
            );
            lastSkyUpdate = elapsed;
        }

        // 灯光每帧更新（开销小，无纹理重建）
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
            SetEnvState(envState).catch(
                () => {}
            );
            triggerAutoSave();
            return;
        }
        scene.onBeforeRenderObservable?.addOnce(animLoop);
    };

    scene.onBeforeRenderObservable?.addOnce(animLoop);
    return true;
}

// ======== setEnvState (central entry point) ========

export function setEnvState(partial: Partial<EnvState>, skipAutoSave = false): void {
    Object.assign(envState, partial);

    _applyEnvStateFacade(envState, partial);

    if (partial.waterAnimSpeed !== undefined) {
        impl.updateWaterAnimSpeed(partial.waterAnimSpeed);
    }

    // 灯光预设变化 → 平滑过渡
    if (partial.lightingPresetName !== undefined) {
        applyLightingPresetFromEnv(partial.lightingPresetName);
    }

    if (_envPersistTimer) {
        clearTimeout(_envPersistTimer);
    }
    _envPersistTimer = setTimeout(() => {
        SetEnvState(envState).catch(
            () => {}
        );
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}

/** 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushEnvState(): void {
    if (_envPersistTimer) {
        clearTimeout(_envPersistTimer);
        _envPersistTimer = null;
    }
    SetEnvState(envState).catch(
        () => {}
    );
}

// ======== UIState Persistence ========

let _uiPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** 以当前 uiState 完整对象构建持久化载荷，剔除未定义字段。 */
function _buildUIStatePayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const s = uiState as Record<string, unknown>;
    for (const key of Object.keys(s)) {
        const v = (s as any)[key];
        if (v !== undefined) {
            p[key] = v;
        }
    }
    return p;
}

/** 防抖调度 UIState 持久化。修改 uiState 后调用此函数。 */
export function schedulePersistUI(): void {
    if (_uiPersistTimer) {
        clearTimeout(_uiPersistTimer);
    }
    _uiPersistTimer = setTimeout(() => {
        _uiPersistTimer = null;
        flushUIState();
    }, 500);
}

/** 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushUIState(): void {
    if (_uiPersistTimer) {
        clearTimeout(_uiPersistTimer);
        _uiPersistTimer = null;
    }
    const payload = _buildUIStatePayload();
    if (Object.keys(payload).length === 0) return; // nothing to persist
    // Go 端 SetUIState 语义是 json.Unmarshal 合并（缺省字段保留原值），
    // 但类型声明是完整 UIState。此处强转后传入部分字段是安全的。
    SetUIState(payload as unknown as import('../../core/wails-bindings').UIState).catch(
        () => {}
    );
}

// 注册持久化回调（state.ts → 本模块，避免循环依赖）
setUIPersistCallback(schedulePersistUI);
