// [doc:architecture] Env Bridge — 环境系统与场景的桥接层
// 规范文档: docs/architecture.md §环境系统
// 职责: applyEnvStateFacade（派发+半球光+环境色+方向光同步）+ setEnvState 中央入口 + middleware 机制
// 已迁出: 重力/碰撞 → env-gravity.ts；持久化 → env-persist.ts；时间流转/预设 → env-time-of-day.ts
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { envState, type EnvState, triggerAutoSave } from '@/core/config';
import { logWarn } from '@/core/utils';
import { ENV_LIGHT_MAX } from '@/core/ui-constants';
import { col3FromTriple } from '@/core/color-helpers';
import { deriveLighting } from '../env-lighting';
import { dispatchEnvChange } from './env-dispatcher';
import { GROUND_PRESET_KEYS } from '../env-ground-presets';
import {
    setLightState,
    getLightState,
    getHemiLight,
    rebakeEnvBrightness,
} from '../../render/lighting';
import { applyLightingPresetFromEnv } from '../../render/lighting';
import { registerCelGroundCoupling } from '../../render/renderer';
import { resolveQualityProfile, type QualityProfile } from '../../render/quality-profile';
import { scene } from '../../scene';
import { isAutoDegradingReflection, registerSetEnvState } from '../../render/performance-env-bridge';
import { setPerformanceMode, getPerformanceMode } from '../../render/performance';
import { schedulePersistEnvState } from './env-persist';

// [doc:adr-132] 上一次 envBrightness 值，用于变化时 rebake 光照强度
let _prevEnvBrightness = 1;

// ======== Preset Anim Active Flag ========
// [ADR-148 Phase 5] 预设动画运行标志，供 _applyEnvStateFacade 的方向光同步守卫使用。
// 原为 env-time-of-day.ts 的 _timeOfDayBeforePreset，现提升为 env-bridge.ts 的 boolean flag。
// env-time-of-day.ts 通过 setPresetAnimActive() 设置。
let _presetAnimActive = false;

/** 标记预设动画是否运行中（供 _applyEnvStateFacade 跳过方向光同步） */
export function setPresetAnimActive(active: boolean): void {
    _presetAnimActive = active;
}

/** 等同于 scene-env.ts 的 applyEnvState，但避免循环依赖。
 *  env-time-of-day._timeOfDayTick 直接调用本函数（不走 setEnvState 全链路，避免每帧防抖持久化）。 */
export function applyEnvStateFacade(state: EnvState, partial?: Partial<EnvState>): void {
    const changed = partial ? new Set(Object.keys(partial)) : null;
    const envBrightness = state.globalBrightness ?? 1;

    // 统一反射质量：reflectionQuality 变化时同步 groundReflectionQuality（Go binding 兼容）
    if (partial?.reflectionQuality !== undefined) {
        state.groundReflectionQuality = partial.reflectionQuality;
    }

    // [ADR-138] 通过 env-dispatcher 分发变化给各子系统，破除 env-bridge → env-impl 循环依赖
    dispatchEnvChange(changed, state);

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
        hemi.groundColor = col3FromTriple(state.skyColorBot);
    }
    // 场景环境色 — iblIntensity 控制渗透力度，最大不超过 0.5 以免冲淡方向光
    const ambientStrength = Math.min(
        state.iblIntensity * 0.15 * envBrightness,
        ENV_LIGHT_MAX * envBrightness
    );
    scene.ambientColor = new Color3(
        skyMid[0] * ambientStrength,
        skyMid[1] * ambientStrength,
        skyMid[2] * ambientStrength
    );

    // [doc:adr-132] globalBrightness 变化时 rebake 存储的光照强度
    if (changed?.has('globalBrightness')) {
        rebakeEnvBrightness(envBrightness / _prevEnvBrightness);
    }
    _prevEnvBrightness = envBrightness;

    // 方向光同步：预设动画期间跳过（applyEnvPresetObject 有自己的动画循环管理 dirLight）
    const _LIGHT_SYNC_KEYS = ['sunAngle', 'azimuth', 'skyColorTop', 'skyColorBot'];
    if (!_presetAnimActive && changed && [...changed].some((k) => _LIGHT_SYNC_KEYS.includes(k))) {
        const derived = deriveLighting(state.skyColorTop, state.sunAngle, state.azimuth ?? -45);
        setLightState({
            dirColor: derived.dirDiffuse,
            dirX: derived.dirDirection[0],
            dirY: derived.dirDirection[1],
            dirZ: derived.dirDirection[2],
            dirIntensity: derived.dirIntensity,
            hemiIntensity: derived.hemiIntensity,
        });
    }
}

// ======== setEnvState (central entry point) ========

/**
 * 迁移函数签名：检测 raw 中是否含旧版字段，若有则写入 out 并返回 true。
 * 返回 false 表示该迁移器不适用（无旧字段）。
 */
type Migrator = (raw: Record<string, unknown>, out: Record<string, unknown>) => boolean;

/**
 * groundMode → groundType + groundStyle 迁移（旧版 v1）
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
 */
function migrateDebugMirror(raw: Record<string, unknown>, out: Record<string, unknown>): boolean {
    if (typeof raw.debugMirrorEnabled !== 'boolean') {
        return false;
    }
    out.mirrorEnabled = raw.debugMirrorEnabled;
    delete out.debugMirrorEnabled;
    return true;
}

/**
 * envIntensity → iblIntensity 迁移（ADR-210：变量名名实相符）
 */
function migrateIblIntensity(raw: Record<string, unknown>, out: Record<string, unknown>): boolean {
    if (typeof raw.envIntensity !== 'number') {
        return false;
    }
    out.iblIntensity = raw.envIntensity;
    delete out.envIntensity;
    return true;
}

/**
 * envBrightness → globalBrightness 迁移（ADR-210：变量名名实相符）
 */
function migrateGlobalBrightness(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.envBrightness !== 'number') {
        return false;
    }
    out.globalBrightness = raw.envBrightness;
    delete out.envBrightness;
    return true;
}

/**
 * particleSplash → particleSplashEnabled 迁移（ADR-212：boolean 字段 *Enabled 后缀纪律）
 */
function migrateParticleSplashEnabled(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.particleSplash === 'boolean') {
        out.particleSplashEnabled = raw.particleSplash;
        delete out.particleSplash;
        return true;
    }
    return false;
}

/**
 * debugClouds → debugCloudsEnabled 迁移（ADR-212：boolean 字段 *Enabled 后缀纪律）
 */
function migrateDebugCloudsEnabled(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.debugClouds === 'boolean') {
        out.debugCloudsEnabled = raw.debugClouds;
        delete out.debugClouds;
        return true;
    }
    return false;
}

/**
 * groundInfinite → groundInfiniteEnabled 迁移（ADR-212：boolean 字段 *Enabled 后缀纪律）
 */
function migrateGroundInfiniteEnabled(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.groundInfinite === 'boolean') {
        out.groundInfiniteEnabled = raw.groundInfinite;
        delete out.groundInfinite;
        return true;
    }
    return false;
}

/**
 * groundElevationColoring → groundElevationColoringEnabled 迁移（ADR-212：boolean 字段 *Enabled 后缀纪律）
 */
function migrateGroundElevationColoringEnabled(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.groundElevationColoring === 'boolean') {
        out.groundElevationColoringEnabled = raw.groundElevationColoring;
        delete out.groundElevationColoring;
        return true;
    }
    return false;
}

/**
 * planarReflectBlend → planarReflectionBlend 迁移（ADR-212：缩写统一 Reflect→Reflection）
 */
function migratePlanarReflectionBlend(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.planarReflectBlend === 'number') {
        out.planarReflectionBlend = raw.planarReflectBlend;
        delete out.planarReflectBlend;
        return true;
    }
    return false;
}

/**
 * cloudsEnabled → cloudEnabled 迁移（ADR-212：单复数统一）
 */
function migrateCloudEnabled(
    raw: Record<string, unknown>,
    out: Record<string, unknown>
): boolean {
    if (typeof raw.cloudsEnabled === 'boolean') {
        out.cloudEnabled = raw.cloudsEnabled;
        delete out.cloudsEnabled;
        return true;
    }
    return false;
}

/** 迁移注册表：新增迁移在此追加。 */
const _migrators: Migrator[] = [
    migrateGroundMode,
    migrateDebugMirror,
    migrateIblIntensity,
    migrateGlobalBrightness,
    migrateParticleSplashEnabled,
    migrateDebugCloudsEnabled,
    migrateGroundInfiniteEnabled,
    migrateGroundElevationColoringEnabled,
    migratePlanarReflectionBlend,
    migrateCloudEnabled,
];

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

    applyEnvStateFacade(envState, migrated);

    // ADR-173: 执行 post-facade middleware（派发后处理副作用）
    _runMiddlewares('post-facade', envState, migrated, { skipAutoSave });

    schedulePersistEnvState();

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
// - pre-facade: 在 applyEnvStateFacade 之前，用于补全 envState/migrated
// - post-facade: 在 applyEnvStateFacade 之后，用于处理副作用（如调用 setPerformanceMode）
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

/** 注册 setEnvState 中间件（供 env-time-of-day/env-gravity 等子模块调用） */
export function registerEnvStateMiddleware(mw: EnvStateMiddleware): void {
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

// ADR-130: qualityProfile 变化时同步各子字段
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

// 用户手动微调预设关心的任一 ground 字段（且本次未显式指定 groundPreset）→ 脱离预设，重置为 'custom'。
// 预设点击会同时带 groundPreset，故不会被误清；用 GROUND_PRESET_KEYS 精确白名单而非前缀匹配，
// 避免碰撞/无限/滚动/地形等「预设不管的字段」被改时误清预设标记（参照 _WATER_KEYS 精确清单教训）。
registerEnvStateMiddleware({
    name: 'resetGroundPresetOnManualEdit',
    phase: 'pre-facade',
    fn: (envState, migrated) => {
        if (migrated.groundPreset !== undefined) {
            return;
        }
        const touchedPreset = GROUND_PRESET_KEYS.some((k) => migrated[k] !== undefined);
        if (touchedPreset && envState.groundPreset !== 'custom') {
            envState.groundPreset = 'custom';
            migrated.groundPreset = 'custom';
        }
    },
});

// ADR-130 Phase 2.3: 注册 setEnvState 到 performance 桥接模块
registerSetEnvState(setEnvState);

// cel-shading 激活时强制地面哑光（关 PBR 镜面），消除「cel 角色踩镜面地板」割裂。
let _celGroundSnapshot: { pbr: boolean } | null = null;
registerCelGroundCoupling((celActive: boolean) => {
    if (celActive) {
        _celGroundSnapshot = { pbr: envState.groundPbrEnabled };
        if (_celGroundSnapshot.pbr) {
            setEnvState({ groundPbrEnabled: false }, true);
        }
    } else if (_celGroundSnapshot) {
        setEnvState({ groundPbrEnabled: _celGroundSnapshot.pbr }, true);
        _celGroundSnapshot = null;
    }
});
