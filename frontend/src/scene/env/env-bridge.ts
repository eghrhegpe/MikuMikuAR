// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState, SetUIState } from '@/core/wails-bindings';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';

import { envState, EnvState, triggerAutoSave, mmdRuntime } from '@/core/config';
import { uiState, setUIPersistCallback } from '@/core/state';
import { setStatus } from '@/core/status-bar';
import { t as t_i18n } from '@/core/i18n/t';
import {
    lerp as lerpUtil,
    lerpArray,
    formatTimestamp,
    logWarn,
    DebouncedTimer,
} from '@/core/utils';
import { col3FromTriple } from '@/core/color-helpers';
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
import { setContactShadow } from '../render/renderer';
import { scene } from '../scene';
import { setKey } from '@/core/utils';

// 时间戳格式化已收敛至 utils.formatTimestamp

/**
 * 条件执行辅助：仅当 changed 包含 keys 中任意一个（或 changed 为 null 表示全量）时执行 fn。
 * 统一 try/catch + logWarn，消除子系统分支的重复模式。
 */
function _applyIfChanged(
    changed: string[] | null,
    keys: string[],
    label: string,
    fn: () => void
): void {
    if (changed && !changed.some((k) => keys.includes(k))) {
        return;
    }
    try {
        fn();
    } catch (e) {
        logWarn('env', `${label} fail:`, e);
    }
}

// 子系统 key 表 — 集中定义，便于维护
const _SKY_KEYS = [
    'skyMode', 'skyColorTop', 'skyColorMid', 'skyColorBot',
    'skyTexture', 'skyRotationY', 'skyRotationSpeed', 'skyBrightness',
    'starsEnabled', 'starsTexture', 'envIntensity', 'sunAngle', 'azimuth',
];
const _GROUND_KEYS = [
    'groundVisible', 'groundType', 'groundStyle', 'groundDecoStyle',
    'groundColor', 'groundAlpha', 'groundTexture', 'groundTextureEnabled',
    'groundTextureScale', 'groundTextureRotation', 'groundTerrainHeight',
    'groundTerrainScale', 'groundTerrainSeed', 'groundTerrainOctaves',
    'groundSize', 'groundGridSize', 'groundLineColor', 'groundEdgeFade',
    'groundPitch', 'groundRoll', 'groundScrollSpeedX', 'groundScrollSpeedZ',
    'groundPattern', 'groundReflectionBlend', 'groundReflectionQuality',
    'groundNormalTexture', 'groundNormalStrength', 'groundElevationColoring',
    'groundFollowCamera', 'groundLevel',
];
const _FOG_KEYS = ['fogEnabled', 'fogColor', 'fogDensity', 'fogMode', 'fogStart', 'fogEnd'];
const _WATER_KEYS = [
    'waterEnabled', 'waterLevel', 'waterColor', 'waterTransparency',
    'waterWaveHeight', 'waterSize', 'waterAnimSpeed', 'fresnelBias',
    'fresnelPower', 'diffuseStrength', 'ambientStrength', 'foamTransitionRange',
    'rippleNormalStrength', 'rippleGlintStrength', 'causticColor1', 'causticColor2',
    'causticScrollX', 'causticScrollY', 'fresnelAlphaInfluence',
    'foamThreshold', 'foamIntensity', 'foamOpacity',
    'waterFogColor', 'waterFogDensity', 'waterFogOpacityInfluence',
    'reflectionQuality', // ADR-114 修复：反射质量开关需触发材质重建（PLANAR_REFLECTION define 切换）
];
const _PARTICLE_KEYS = [
    'particleEnabled', 'particleType', 'particleEmitRate',
    'particleSize', 'particleSpeed', 'particleSplash', 'particleCustomTexture',
];
const _CLOUD_KEYS = [
    'cloudsEnabled', 'cloudCover', 'cloudScale', 'cloudHeight',
    'cloudThickness', 'cloudVisibility', 'cloudGap',
];
// ADR-114 Phase 3: 接触阴影后处理（转发到 renderer.setContactShadow）
const _CONTACT_SHADOW_KEYS = [
    'groundContactShadowEnabled', 'groundContactShadowIntensity',
    'groundContactShadowDistance', 'groundReflectionQuality',
];

/** 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 */
function _applyEnvStateFacade(state: EnvState, partial?: Partial<EnvState>): void {
    const changed = partial ? Object.keys(partial) : null;

    _applyIfChanged(changed, _SKY_KEYS, 'sky', () => {
        const t0 = performance.now();
        impl.applySky(state);
        // color 模式下无天空 mesh，需单独同步调试镜面 clearColor
        if (impl.isDebugMirrorActive() && impl.updateDebugMirrorClearColor) {
            impl.updateDebugMirrorClearColor();
        }
        const elapsed = performance.now() - t0;
        if (elapsed > 2) {
            logWarn('perf:env', `[${formatTimestamp()}] applySky took ${elapsed.toFixed(1)}ms`);
        }
    });

    _applyIfChanged(changed, _GROUND_KEYS, 'ground', () => impl.applyGround(state));

    _applyIfChanged(changed, _FOG_KEYS, 'fog', () => impl.applyFog(state));

    _applyIfChanged(changed, _WATER_KEYS, 'water', () => {
        if (state.waterEnabled) impl.createWater(state);
        else impl.disposeWater();
    });

    _applyIfChanged(changed, _PARTICLE_KEYS, 'particle', () => {
        if (state.particleEnabled && state.particleType && state.particleType !== 'none') {
            impl.createParticleEmitter(state.particleType, state.windEnabled);
        } else {
            impl.disposeParticles();
        }
    });

    _applyIfChanged(changed, _CLOUD_KEYS, 'cloud', () => {
        if (state.cloudsEnabled) impl.createClouds(state);
        else impl.disposeClouds();
    });

    // ADR-114 Phase 3: 接触阴影后处理（转发到 renderer）
    _applyIfChanged(changed, _CONTACT_SHADOW_KEYS, 'contactShadow', () => {
        setContactShadow(state);
    });

    _applyIfChanged(changed, ['debugMirrorEnabled'], 'debugMirror', () => {
        if (state.debugMirrorEnabled && !impl.isDebugMirrorActive()) impl.createDebugMirror();
        else if (!state.debugMirrorEnabled && impl.isDebugMirrorActive()) impl.disposeDebugMirror();
    });

    // 半球光 — 强度跟随当前灯光状态，颜色随天空色（灯光未初始化时跳过）
    const skyMid = state.skyColorMid ?? [
        (state.skyColorTop[0] + state.skyColorBot[0]) / 2,
        (state.skyColorTop[1] + state.skyColorBot[1]) / 2,
        (state.skyColorTop[2] + state.skyColorBot[2]) / 2,
    ];
    if (hemiLight) {
        hemiLight.intensity = getLightState().hemiIntensity;
        hemiLight.diffuse = col3FromTriple(skyMid);
        hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);
    }
    // 场景环境色 — envIntensity 控制渗透力度，最大不超过 0.5 以免冲淡方向光
    const ambientStrength = Math.min(state.envIntensity * 0.15, 0.5);
    scene.ambientColor = new Color3(
        skyMid[0] * ambientStrength,
        skyMid[1] * ambientStrength,
        skyMid[2] * ambientStrength
    );

    // 方向光同步：跳过预设动画期间（applyEnvPresetObject 有自己的动画循环管理 dirLight）
    const _LIGHT_SYNC_KEYS = ['sunAngle', 'azimuth', 'skyColorTop', 'skyColorBot'];
    if (
        _timeOfDayBeforePreset === null &&
        changed &&
        changed.some((k) => _LIGHT_SYNC_KEYS.includes(k))
    ) {
        const derived = deriveLighting(state.skyColorTop, state.sunAngle, state.azimuth ?? -45);
        setLightState({
            dirColor: [1, 0.95, 0.9],
            dirX: derived.dirDirection[0],
            dirY: derived.dirDirection[1],
            dirZ: derived.dirDirection[2],
            dirIntensity: derived.dirIntensity,
            hemiIntensity: derived.hemiIntensity,
        });
    }
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

// ======== Collision (WASM Bullet) ========

export function setCollisionEnabled(value: boolean): void {
    envState.collisionEnabled = value;
    triggerAutoSave();
}

export function getCollisionEnabled(): boolean {
    return envState.collisionEnabled;
}

export function setBodyCollisionEnabled(value: boolean): void {
    envState.bodyCollisionEnabled = value;
    triggerAutoSave();
}

export function getBodyCollisionEnabled(): boolean {
    return envState.bodyCollisionEnabled;
}

export function setGroundCollisionEnabled(value: boolean): void {
    envState.groundCollisionEnabled = value;
    triggerAutoSave();
}

export function getGroundCollisionEnabled(): boolean {
    return envState.groundCollisionEnabled;
}

// ======== Environment Sun Angle ========

let envSunAngle = 45;
const _envPersistTimer = new DebouncedTimer();

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
        // 传 partial 避免全量重建：sunAngle 变化只影响天空与灯光，不触发 ground/fog/water 分支
        const _tickStart = performance.now();
        _applyEnvStateFacade(envState, { sunAngle: envSunAngle });
        if (performance.now() - _tickStart > 2) {
            logWarn(
                'perf:tick',
                `[${formatTimestamp()}] _applyEnvStateFacade(sunAngle) took ${performance.now() - _tickStart}ms (angle=${envSunAngle.toFixed(1)})`
            );
        }
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
    SetEnvState(envState).catch((err) => {
        logWarn('_applyTimeOfDayPreset', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
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
let _timeOfDayBeforePreset: boolean | null = null; // 预设动画前的 time-of-day 状态

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
const SKY_UPDATE_INTERVAL = 50; // ms — 显示器刷新率无关，始终 ~20fps

function _presetAnimLoop(ctx: PresetAnimCtx, observer: Observer<Scene>): void {
    if (_presetAnimId !== ctx.myId) {
        scene.onBeforeRenderObservable.remove(observer);
        return;
    }
    const elapsed = performance.now() - ctx.startTime;
    const t = Math.min(elapsed / PRESET_ANIM_DURATION, 1.0);
    const lerp = (a: number, b: number) => lerpUtil(a, b, t);

    // 天空纹理重建开销大，50ms 间隔节流（~20fps）
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

    // 灯光每帧插值（开销小，无纹理重建）
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
        scene.onBeforeRenderObservable.remove(observer);
        setSkipLightAutoSave(false);
        if (_timeOfDayBeforePreset) {
            _timeOfDayActive = true;
            _lastSkySunAngle = envSunAngle;
            _lastAutoLinkSunAngle = envSunAngle;
        }
        _timeOfDayBeforePreset = null;
        SetEnvState(envState).catch((err) => {
            logWarn('applyLightingPresetFromEnv', 'persist failed', err);
            setStatus(t_i18n('env.persistFailed'), false);
        });
        triggerAutoSave();
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
        _timeOfDayBeforePreset = _timeOfDayActive;
    }
    if (_timeOfDayActive) {
        _timeOfDayActive = false;
    }

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
        dirColor: [1, 0.95, 0.9],
        dirX: derived.dirDirection[0],
        dirY: derived.dirDirection[1],
        dirZ: derived.dirDirection[2],
        dirIntensity: derived.dirIntensity,
        hemiIntensity: derived.hemiIntensity,
    };

    setSkipLightAutoSave(true);

    const ctx: PresetAnimCtx = {
        myId, preset, startSkyTop, startSkyBot, startSkyMid,
        mid, startLight, targetLight,
        startTime: performance.now(), lastSkyUpdate: 0,
    };
    const observer = scene.onBeforeRenderObservable.add(
        () => _presetAnimLoop(ctx, observer)
    );
    return true;
}

// ======== setEnvState (central entry point) ========

/**
 * 配置迁移：旧版本以单一 groundMode 枚举同时表达「几何类型」与「外观样式」两轴
 * （solid/grid/checker/texture = 平面样式；heightmap = 程序化地形）。
 * 现拆分为 groundType(flat|terrain) + groundStyle(solid|grid|checker|texture)。
 * 在 setEnvState 中央入口统一转换，覆盖所有 hydrate 路径（main.ts / scene-serialize / 预设等）。
 */
function migrateEnvState(input: Partial<EnvState>): Partial<EnvState> {
    const raw = input as Record<string, unknown>;
    // 仅当入参含旧字段 groundMode 时才迁移；新版本 partial 原样返回，
    // 避免向 changed 集合注入 groundType/groundStyle 导致无关节点更新误触发 applyGround。
    if (typeof raw.groundMode !== 'string') {
        return input;
    }
    const out = { ...raw } as Record<string, unknown>;
    const m = raw.groundMode;
    if (m === 'heightmap') {
        out.groundType = 'terrain';
    } else {
        out.groundType = 'flat';
        out.groundStyle = m; // 'solid' | 'grid' | 'checker' | 'texture'
    }
    delete out.groundMode;
    return out as Partial<EnvState>;
}

export function setEnvState(partial: Partial<EnvState>, skipAutoSave = false): void {
    const migrated = migrateEnvState(partial);
    Object.assign(envState, migrated);

    _applyEnvStateFacade(envState, migrated);

    // 灯光预设变化 → 平滑过渡
    if (partial.lightingPresetName !== undefined) {
        applyLightingPresetFromEnv(partial.lightingPresetName);
    }

    _envPersistTimer.schedule(() => {
        SetEnvState(envState).catch((err) => {
            logWarn('setEnvState', 'persist failed', err);
            setStatus(t_i18n('env.persistFailed'), false);
        });
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}

/** 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushEnvState(): void {
    _envPersistTimer.cancel();
    SetEnvState(envState).catch((err) => {
        logWarn('flushEnvState', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
}

/** 取消挂起的 env state 防抖持久化定时器（HMR 重入清理用，见 ADR-106 D3）。 */
export function cancelEnvPersistTimer(): void {
    _envPersistTimer.cancel();
}

// ======== UIState Persistence ========

const _uiPersistTimer = new DebouncedTimer();

/** 以当前 uiState 完整对象构建持久化载荷，剔除未定义字段。 */
function _buildUIStatePayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const s = uiState as Record<string, unknown>;
    for (const key of Object.keys(s)) {
        const v = s[key];
        if (v !== undefined) {
            p[key] = v;
        }
    }
    return p;
}

/** 防抖调度 UIState 持久化。修改 uiState 后调用此函数。 */
export function schedulePersistUI(): void {
    _uiPersistTimer.schedule(() => flushUIState(), 500);
}

/** 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushUIState(): void {
    _uiPersistTimer.cancel();
    const payload = _buildUIStatePayload();
    if (Object.keys(payload).length === 0) {
        return;
    } // nothing to persist
    // Go 端 SetUIState 语义是 json.Unmarshal 合并（缺省字段保留原值），
    // 但类型声明是完整 UIState。此处强转后传入部分字段是安全的。
    SetUIState(payload as unknown as import('../../core/wails-bindings').UIState).catch((err) => {
        logWarn('flushUIState', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
}

// 注册持久化回调（state.ts → 本模块，避免循环依赖）
setUIPersistCallback(schedulePersistUI);
