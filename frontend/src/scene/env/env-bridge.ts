// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: envAutoLink、太阳角、时间流转、环境预设、setEnvState、重力控制
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { SetEnvState, SetUIState, type UIState } from '@/core/wails-bindings';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { observe, type ObserverHandle } from '@/core/observer-handle';

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
import { DEFAULT_GRAVITY, ENV_LIGHT_MAX, AUTO_LINK_THRESHOLD_DEG } from '@/core/ui-constants';
import { col3FromTriple } from '@/core/color-helpers';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { applyGroundCollision } from '../physics/ground-collision';
import { deriveLighting, TIME_OF_DAY_PRESETS, type CategorizedEnvPreset } from './env-lighting';
import { ensureEnvUpdateObserver } from './env';
import { dispatchEnvChange, registerSceneTickCallback } from './env-dispatcher';
import {
    setLightState,
    getLightState,
    setSkipLightAutoSave,
    getHemiLight,
    _updateSunDisc,
    rebakeEnvBrightness,
} from '../render/lighting';
import type { LightState } from '../render/lighting';
import { applyLightingPresetFromEnv } from '../render/lighting';
import { setContactShadow, registerCelGroundCoupling } from '../render/renderer';
import { resolveQualityProfile, type QualityProfile } from '../render/quality-profile';
import { scene } from '../scene';
import { setKey } from '@/core/utils';
import { isAutoDegradingReflection, registerSetEnvState } from '../render/performance-env-bridge';
import { setPerformanceMode, getPerformanceMode } from '../render/performance';

// 时间戳格式化已收敛至 utils.formatTimestamp

/**
 * 条件执行辅助：仅当 changed 包含 keys 中任意一个（或 changed 为 null 表示全量）时执行 fn。
 * 统一 try/catch + logWarn，消除子系统分支的重复模式。
 */
function _applyIfChanged(
    changed: Set<string> | null,
    keys: string[],
    label: string,
    fn: () => void
): void {
    if (changed && !keys.some((k) => changed.has(k))) {
        return;
    }
    try {
        fn();
    } catch (e) {
        logWarn('env', `${label} fail:`, e);
    }
}

// [doc:adr-132] 上一次 envBrightness 值，用于变化时 rebake 光照强度
let _prevEnvBrightness = 1;

// ADR-114 Phase 3: 接触阴影后处理（转发到 renderer.setContactShadow）
const _CONTACT_SHADOW_KEYS = [
    'groundContactShadowEnabled',
    'groundContactShadowIntensity',
    'groundContactShadowDistance',
];

/** 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。 */
function _applyEnvStateFacade(state: EnvState, partial?: Partial<EnvState>): void {
    const changed = partial ? new Set(Object.keys(partial)) : null;
    const envBrightness = state.envBrightness ?? 1;

    // 统一反射质量：reflectionQuality 变化时同步 groundReflectionQuality（Go binding 兼容）
    if (partial?.reflectionQuality !== undefined) {
        state.groundReflectionQuality = partial.reflectionQuality;
    }

    // [ADR-138] 通过 env-dispatcher 分发变化给各子系统，破除 env-bridge → env-impl 循环依赖
    dispatchEnvChange(changed, state);

    // ADR-114 Phase 3: 接触阴影后处理（转发到 renderer）
    // 保留在 env-bridge 中，不属于子系统逻辑
    _applyIfChanged(changed, _CONTACT_SHADOW_KEYS, 'contactShadow', () => {
        setContactShadow(state);
    });

    // 半球光 — 强度跟随当前灯光状态，颜色随天空色（灯光未初始化时跳过）
    const skyMid = state.skyColorMid ?? [
        (state.skyColorTop[0] + state.skyColorBot[0]) / 2,
        (state.skyColorTop[1] + state.skyColorBot[1]) / 2,
        (state.skyColorTop[2] + state.skyColorBot[2]) / 2,
    ];
    const hemi = getHemiLight();
    if (hemi) {
        hemi.intensity = getLightState().hemiIntensity * envBrightness;
        hemi.diffuse = col3FromTriple(skyMid);
        // groundColor 从 skyColorBot 派生，保持三色统一
        hemi.groundColor = col3FromTriple(state.skyColorBot);
    }
    // 场景环境色 — envIntensity 控制渗透力度，最大不超过 0.5 以免冲淡方向光
    const ambientStrength = Math.min(
        state.envIntensity * 0.15 * envBrightness,
        ENV_LIGHT_MAX * envBrightness
    );
    scene.ambientColor = new Color3(
        skyMid[0] * ambientStrength,
        skyMid[1] * ambientStrength,
        skyMid[2] * ambientStrength
    );

    // [doc:adr-132] envBrightness 变化时 rebake 存储的光照强度
    if (changed?.has('envBrightness')) {
        rebakeEnvBrightness(envBrightness / _prevEnvBrightness);
    }
    _prevEnvBrightness = envBrightness;

    // 方向光同步：跳过预设动画期间（applyEnvPresetObject 有自己的动画循环管理 dirLight）
    const _LIGHT_SYNC_KEYS = ['sunAngle', 'azimuth', 'skyColorTop', 'skyColorBot'];
    if (
        _timeOfDayBeforePreset === null &&
        changed &&
        [...changed].some((k) => _LIGHT_SYNC_KEYS.includes(k))
    ) {
        const derived = deriveLighting(state.skyColorTop, state.sunAngle, state.azimuth ?? -45);
        setLightState({
            // dirColor 从天空颜色派生，保持三色统一
            dirColor: derived.dirDiffuse,
            dirX: derived.dirDirection[0],
            dirY: derived.dirDirection[1],
            dirZ: derived.dirDirection[2],
            dirIntensity: derived.dirIntensity,
            hemiIntensity: derived.hemiIntensity,
        });
    }
}

// ======== Gravity ========

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
    setEnvState({ collisionEnabled: value }, true);
    triggerAutoSave();
}

export function getCollisionEnabled(): boolean {
    return envState.collisionEnabled;
}

export function setBodyCollisionEnabled(value: boolean): void {
    setEnvState({ bodyCollisionEnabled: value }, true);
    triggerAutoSave();
}

export function getBodyCollisionEnabled(): boolean {
    return envState.bodyCollisionEnabled;
}

export function setGroundCollisionEnabled(value: boolean): void {
    if (envState.groundCollisionEnabled === value) {
        return;
    }
    setEnvState({ groundCollisionEnabled: value }, true);
    applyGroundCollision();
    triggerAutoSave();
}

export function getGroundCollisionEnabled(): boolean {
    return envState.groundCollisionEnabled;
}

// ======== Helpers (ADR-143 主题 3) ========

/** 持久化 envState 到后端，统一错误上报。收敛 env-bridge.ts 内 4 处重复 .catch。 */
function persistEnvState(payload: EnvState): void {
    SetEnvState(payload).catch((err) => {
        logWarn('persistEnvState', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
}

// ======== Environment Sun Angle ========

// [fix:ghost-state] envSunAngle 与 envState.sunAngle 双源同步：
// envSunAngle 是模块内缓存（供 _timeOfDayTick 高频递增 + 滑块 bind 读取），
// envState.sunAngle 是持久化源。setEnvState 现在会反向同步 envSunAngle（见 setEnvState），
// 消除原「setEnvState({ sunAngle }) 只写 envState、漏写 envSunAngle」的漂移陷阱。
// 调用方仍可通过 setEnvSunAngle 显式设置（带 clamp），但无需再手动双写。
let envSunAngle = 45;
const _envPersistTimer = new DebouncedTimer();

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
//   原 _timeOfDayActive 同时承担「用户意图」和「运行时状态」双重职责，预设动画期间
//   只写模块变量、漏写 envState，导致双源漂移。现拆为「单一持久源 + 独立暂停标志」。
let _timeOfDayPaused = false;
let _timeOfDaySpeed = 3;
let _lastSkySunAngle = 90;
let _lastAutoLinkSunAngle = 90;
let _unregisterTimeOfDay: (() => void) | null = null; // 回调注销函数

function _timeOfDayTick(): void {
    if (!envState.timeOfDayActive || _timeOfDayPaused) {
        return;
    }
    const dt = scene.deltaTime / 1000; // 用真实 deltaTime，兼容高刷新率屏幕
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
    // 使用 env-dispatcher 的统一 observer 注册表，避免多个独立的 scene observer
    ensureEnvUpdateObserver(); // 确保 impl 的 observer 已初始化
    _unregisterTimeOfDay = registerSceneTickCallback(_timeOfDayTick);
}

export function stopTimeOfDay(): void {
    setEnvState({ timeOfDayActive: false }, true);
    _timeOfDayPaused = false;
    if (_unregisterTimeOfDay) {
        _unregisterTimeOfDay();
        _unregisterTimeOfDay = null;
    }
    // 持久化当前 sunAngle 到后端
    persistEnvState({ ...envState });
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
    // [fix:ghost-state] timeOfDayActive 已统一到 envState.timeOfDayActive（持久源），
    // 启动时重置暂停标志，仅恢复 _timeOfDaySpeed 模块内缓存。
    _timeOfDayPaused = false;
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

function _presetAnimLoop(ctx: PresetAnimCtx, handle: ObserverHandle): void {
    if (_presetAnimId !== ctx.myId) {
        handle.dispose();
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
        handle.dispose();
        setSkipLightAutoSave(false);
        if (_timeOfDayBeforePreset) {
            // [fix:ghost-state] 预设动画结束，恢复 time-of-day 运行（清除暂停标志）
            _timeOfDayPaused = false;
            _lastSkySunAngle = envSunAngle;
            _lastAutoLinkSunAngle = envSunAngle;
        }
        _timeOfDayBeforePreset = null;
        persistEnvState({ ...envState });
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
        _timeOfDayBeforePreset = envState.timeOfDayActive && !_timeOfDayPaused;
    }
    if (envState.timeOfDayActive && !_timeOfDayPaused) {
        // [fix:ghost-state] 预设动画期间临时暂停 time-of-day tick，不修改 envState.timeOfDayActive
        // （保持用户意图的持久化值不变），仅翻转 _timeOfDayPaused 运行时标志。
        _timeOfDayPaused = true;
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
        // dirColor 从天空颜色派生，保持三色统一
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
    // sky 类预设含 sunAngle 时，需先更新模块级 envSunAngle（与 applyEnvPresetObject 一致的前置约束）
    if (preset.category === 'sky' && typeof preset.fields.sunAngle === 'number') {
        setEnvSunAngle(preset.fields.sunAngle);
    }
    setEnvState(preset.fields);
    return true;
}

// ======== setEnvState (central entry point) ========

/**
 * 迁移函数签名：检测 raw 中是否含旧版字段，若有则写入 out 并返回 true。
 * 返回 false 表示该迁移器不适用（无旧字段）。
 */
type Migrator = (raw: Record<string, unknown>, out: Record<string, unknown>) => boolean;

/**
 * groundMode → groundType + groundStyle 迁移（旧版 v1）
 * 旧版本以单一 groundMode 枚举同时表达「几何类型」与「外观样式」两轴
 * （solid/grid/checker/texture = 平面样式；heightmap = 程序化地形）。
 * 现拆分为 groundType(flat|terrain) + groundStyle(solid|grid|checker|texture)。
 */
function migrateGroundMode(raw: Record<string, unknown>, out: Record<string, unknown>): boolean {
    if (typeof raw.groundMode !== 'string') {
        return false;
    }
    const m = raw.groundMode;
    if (m === 'heightmap') {
        out.groundType = 'terrain';
    } else {
        out.groundType = 'flat';
        out.groundStyle = m;
    }
    delete out.groundMode;
    return true;
}

/**
 * debugMirrorEnabled → mirrorEnabled 迁移（ADR-128）
 * 旧 scene preset / config.json 含 debugMirrorEnabled 字段兼容。
 */
function migrateDebugMirror(raw: Record<string, unknown>, out: Record<string, unknown>): boolean {
    if (typeof raw.debugMirrorEnabled !== 'boolean') {
        return false;
    }
    out.mirrorEnabled = raw.debugMirrorEnabled;
    delete out.debugMirrorEnabled;
    return true;
}

/** 迁移注册表：新增迁移在此追加。 */
const _migrators: Migrator[] = [migrateGroundMode, migrateDebugMirror];

function migrateEnvState(input: Partial<EnvState>): Partial<EnvState> {
    const raw = input as Record<string, unknown>;
    const out = { ...raw } as Record<string, unknown>;
    let migrated = false;
    for (const m of _migrators) {
        if (m(raw, out)) {
            migrated = true;
        }
    }
    return migrated ? (out as Partial<EnvState>) : input;
}

export function setEnvState(partial: Partial<EnvState>, skipAutoSave = false): void {
    if (import.meta.env.DEV) {
        const keys = Object.keys(partial).join(', ');
        console.info(
            `[env-persist] setEnvState() called: ${keys} ${skipAutoSave ? '(skipAutoSave)' : ''}`
        );
    }
    const migrated = migrateEnvState(partial);
    Object.assign(envState, migrated);

    // ADR-173: 执行 pre-facade middleware（补全 envState/migrated 后、派发前）
    _runMiddlewares('pre-facade', envState, migrated, { skipAutoSave });

    _applyEnvStateFacade(envState, migrated);

    // ADR-173: 执行 post-facade middleware（派发后处理副作用）
    _runMiddlewares('post-facade', envState, migrated, { skipAutoSave });

    _envPersistTimer.schedule(() => {
        // 传普通对象副本（非 reactive Proxy），避免 JSON.stringify 对 Proxy 枚举不完整
        if (import.meta.env.DEV) {
            console.info('[env-persist] debounce fired → SetEnvState()');
        }
        persistEnvState({ ...envState });
    }, 500);

    if (!skipAutoSave) {
        triggerAutoSave();
    }
}

// ======== ADR-173: setEnvState 中间件注册机制 ========
//
// 将 setEnvState 中跨系统字段的特判 if-block 抽取为独立 middleware，
// 新增跨系统字段只需注册一个新 middleware，不触及核心流程。
//
// middleware 分两阶段执行：
// - pre-facade: 在 _applyEnvStateFacade 之前，用于补全 envState/migrated
// - post-facade: 在 _applyEnvStateFacade 之后，用于处理副作用（如调用 setPerformanceMode）
//
// 错误隔离：单个 middleware 抛异常不影响后续 middleware 和 persist/autoSave。

type EnvStateMiddlewareFn = (
    envState: EnvState,
    migrated: Partial<EnvState>,
    ctx: { skipAutoSave: boolean }
) => void;

interface EnvStateMiddleware {
    name: string;
    phase: 'pre-facade' | 'post-facade';
    fn: EnvStateMiddlewareFn;
}

const _middlewares: EnvStateMiddleware[] = [];

/** 注册 setEnvState 中间件（仅限 env-bridge.ts 内调用） */
function registerEnvStateMiddleware(mw: EnvStateMiddleware): void {
    _middlewares.push(mw);
}

/** 按阶段遍历 middleware，异常隔离 */
function _runMiddlewares(
    phase: 'pre-facade' | 'post-facade',
    envState: EnvState,
    migrated: Partial<EnvState>,
    ctx: { skipAutoSave: boolean }
): void {
    for (const mw of _middlewares) {
        if (mw.phase !== phase) {
            continue;
        }
        try {
            mw.fn(envState, migrated, ctx);
        } catch (e) {
            console.warn(`[env-mw] ${mw.name} failed`, e);
        }
    }
}

// ======== ADR-173 Phase 2: 现有 if-block 迁移为 middleware ========

// [fix:ghost-state] 反向同步 envSunAngle 模块缓存，消除双源漂移：
// 原代码只写 envState.sunAngle，漏写 envSunAngle，导致 _timeOfDayTick
// 从旧 envSunAngle 递增覆盖用户设置，且滑块 getEnvSunAngle() 显示旧值。
registerEnvStateMiddleware({
    name: 'syncEnvSunAngle',
    phase: 'pre-facade',
    fn: (envState, migrated) => {
        if (migrated.sunAngle !== undefined) {
            envSunAngle = migrated.sunAngle;
        }
    },
});

// ADR-130: qualityProfile 变化时同步各子字段
// 确保手动 UI 更改 qualityProfile 后 reflection/cloud/particle 子系统同步更新
registerEnvStateMiddleware({
    name: 'resolveQualityProfileMiddleware',
    phase: 'pre-facade',
    fn: (envState, migrated) => {
        if (migrated.qualityProfile !== undefined) {
            const resolved = resolveQualityProfile(migrated.qualityProfile as QualityProfile);
            envState.reflectionQuality = resolved.reflectionQuality;
            envState.cloudQuality = resolved.cloudQuality;
            envState.particleQuality = resolved.particleQuality;
            Object.assign(migrated, resolved);
        }
    },
});

// ADR-130 Phase 2.3: 用户手动修改反射质量 → 冻结自动降级
// 仅当变更来自用户（非自动降级）且当前为 auto 模式时，切换到 custom 模式
registerEnvStateMiddleware({
    name: 'freezeAutoDegradeOnReflectionChange',
    phase: 'post-facade',
    fn: (_envState, migrated) => {
        if (!isAutoDegradingReflection() && getPerformanceMode() === 'auto') {
            if (migrated.reflectionQuality !== undefined) {
                setPerformanceMode('custom');
            }
        }
    },
});

// 灯光预设变化 → 平滑过渡
registerEnvStateMiddleware({
    name: 'applyLightingPresetMiddleware',
    phase: 'post-facade',
    fn: (_envState, migrated) => {
        if (migrated.lightingPresetName !== undefined) {
            applyLightingPresetFromEnv(migrated.lightingPresetName);
        }
    },
});

// ADR-130 Phase 2.3: 注册 setEnvState 到 performance 桥接模块
registerSetEnvState(setEnvState);

// ADR-114 契合度修复：cel-shading 激活时强制地面哑光 + 接触阴影，消除视觉割裂。
// 纯运行时守卫（skipAutoSave），不脏化场景；cel 关闭时恢复到开启前快照。
let _celGroundSnapshot: { pbr: boolean; contact: boolean } | null = null;
registerCelGroundCoupling((celActive: boolean) => {
    if (celActive) {
        _celGroundSnapshot = {
            pbr: envState.groundPbrEnabled,
            contact: envState.groundContactShadowEnabled,
        };
        // 仅当需要变更时才写：PBR 开启 → 关；接触阴影关闭 → 开
        if (_celGroundSnapshot.pbr || !_celGroundSnapshot.contact) {
            setEnvState({ groundPbrEnabled: false, groundContactShadowEnabled: true }, true);
        }
    } else if (_celGroundSnapshot) {
        setEnvState(
            {
                groundPbrEnabled: _celGroundSnapshot.pbr,
                groundContactShadowEnabled: _celGroundSnapshot.contact,
            },
            true
        );
        _celGroundSnapshot = null;
    }
});

/** 立即刷写 env state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushEnvState(): void {
    if (import.meta.env.DEV) {
        console.info('[env-persist] flushEnvState() — immediate flush');
    }
    _envPersistTimer.cancel();
    // 传普通对象副本（非 reactive Proxy）
    persistEnvState({ ...envState });
}

/** 取消挂起的 env state 防抖持久化定时器（HMR 重入清理用，见 ADR-106 D3）。 */
export function cancelEnvPersistTimer(): void {
    _envPersistTimer.cancel();
}

// ======== ADR-130 Phase 2.3: 反射质量手动设置 → 冻结自动降级 ========

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

/** 与 persistEnvState 对称：持久化 UI state，统一错误上报。收敛 flushUIState 内裸 .catch。
 *
 * Go 端 SetUIState 语义是 json.Unmarshal 合并（缺省字段保留原值），
 * 但类型声明是完整 UIState。payload 用 Partial<UIState> 表达部分字段，
 * 强转后传入是安全的。
 */
function persistUIState(payload: Partial<UIState>): void {
    SetUIState(payload as unknown as UIState).catch((err) => {
        logWarn('persistUIState', 'persist failed', err);
        setStatus(t_i18n('env.persistFailed'), false);
    });
}

/** 立即刷写 UI state 到后端（无防抖）。关闭/隐藏页面时调用。 */
export function flushUIState(): void {
    if (import.meta.env.DEV) {
        console.info('[ui-persist] flushUIState() — immediate flush');
    }
    _uiPersistTimer.cancel();
    const payload = _buildUIStatePayload();
    if (Object.keys(payload).length === 0) {
        return;
    } // nothing to persist
    persistUIState(payload);
}

// 注册持久化回调（state.ts → 本模块，避免循环依赖）
setUIPersistCallback(schedulePersistUI);
