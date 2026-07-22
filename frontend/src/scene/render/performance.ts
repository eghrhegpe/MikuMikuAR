// [doc:architecture] Performance Monitor — FPS 监控 + 自动降级
// 在渲染循环中调用，根据帧率自动调整渲染质量。
// 注意：模块级状态假定单例场景，不适用于多渲染上下文。

import type { LightState } from './lighting';
import type { RenderState } from './renderer';
import type { EnvState } from '@/core/config';
import { envState } from '@/core/config';
import { formatTimestamp } from '@/core/utils';
import { uiState, setUIState } from '@/core/state';
import type { UIState } from '@/core/types';
import { setAutoDegradingReflection, setEnvStateForPerformance } from './performance-env-bridge';
import { resolveQualityProfile } from './quality-profile';

// ======== 渲染桥接（ADR-159 P3-A：消除 performance↔scene 静态依赖）========
// 由 scene.ts 在 initScene() 时注入，单向依赖 scene → performance。
// 未注册时各成员为安全默认，避免 bridge 未就绪调用崩溃。

export interface RenderBridge {
    engine: { getFps: () => number };
    setLightState: (state: Partial<LightState>) => void;
    setRenderState: (state: Partial<RenderState>) => void;
    getLightState: () => LightState;
    getRenderState: () => RenderState;
}

let _bridgeEngine: { getFps: () => number } | null = null;
let _bridgeSetLightState: (state: Partial<LightState>) => void = () => {};
let _bridgeSetRenderState: (state: Partial<RenderState>) => void = () => {};
let _bridgeGetLightState: () => LightState = () => ({}) as LightState;
let _bridgeGetRenderState: () => RenderState = () => ({}) as RenderState;

/** ADR-159 P3-A：延迟绑定渲染桥接，由 scene.ts 在 initScene() 时注入。 */
export function registerRenderBridge(bridge: RenderBridge): void {
    _bridgeEngine = bridge.engine;
    _bridgeSetLightState = bridge.setLightState;
    _bridgeSetRenderState = bridge.setRenderState;
    _bridgeGetLightState = bridge.getLightState;
    _bridgeGetRenderState = bridge.getRenderState;
}

// ======== Types ========

export type PerformanceMode = 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';

/** Degradation level applied when FPS drops. */
type DegradeLevel = 0 | 1 | 2 | 3;

// ======== State ========

let _mode: PerformanceMode = 'auto';
const _degradeCooldownMs = 3000; // 降级后冷却 3 秒（缩短以加快响应）
const _recoveryCooldownMs = 2000; // 恢复冷却 2 秒（缩短以加快响应）
let _lastDegradeTime = 0;
let _lastRecoveryTime = 0;
let _currentLevel: DegradeLevel = 0;

// FPS smoothing
const _fpsSamples: number[] = [];
const _fpsSampleSize = 30; // ~0.5s at 60fps
let _lastFpsLog = 0;
let _fpsReady = false; // 累积足够样本后设为 true

// Snapshot of settings before degradation (to restore to user's original state)
let _snapshot: {
    light: Partial<LightState>;
    render: Partial<RenderState>;
    env?: Partial<EnvState>;
} | null = null;

// 抑制标志：applyDegrade 调 setLightState/setRenderState 时置 true，防止
// setLightState/setRenderState 内部的 resetPerformanceSnapshot() 反向恢复快照，
// 形成「降级→恢复→再降级」的反馈循环。
let _suppressSnapshotReset = false;

// ======== renderScale 像素比杠杆（ADR-118 扩展）========
// 降级到 Level 2/3 时自动降低像素比至 0.7，是最有效的 GPU 减负杠杆。
// render-loop.ts 的 applyScaling() 会读取此乘数并与用户 renderScale 相乘。
let _perfRenderScaleMul = 1.0;

/** 降级系统对 renderScale 的乘数（1.0=无影响，0.7=降级时降至 70%）。 */
export function getPerfRenderScaleMul(): number {
    return _perfRenderScaleMul;
}

/** 供 setLightState/setRenderState 检查是否应跳过 resetPerformanceSnapshot。 */
export function isSnapshotResetSuppressed(): boolean {
    return _suppressSnapshotReset;
}

// ======== 每级完整目标状态 ========
// 定义每个质量级别下的渲染/光照配置全集。
// 降级时应用目标级别的完整状态；恢复时计算当前级别与目标级别的差集，仅应用变化。

interface LevelConfig {
    shadowResolution: number;
    shadowEnabled: boolean;
    bloomEnabled: boolean;
    dofEnabled: boolean;
    vignetteEnabled: boolean;
    fxaaEnabled: boolean;
    outlineEnabled: boolean;
    chromaticAberrationEnabled: boolean;
    grainEnabled: boolean;
    glowEnabled: boolean;
    ssaoEnabled: boolean;
    /** ADR-130 Phase 2.3: 统一质量档位，反射/云/粒子等从此派生 */
    qualityProfile?: 'high' | 'medium' | 'low';
    label: string;
}

/** 反射质量档位序（降级上限守卫用：off < low < medium < high） */
const REFLECTION_QUALITY_ORDER: Record<string, number> = { off: 0, low: 1, medium: 2, high: 3 };

const LEVEL_CONFIGS: Record<DegradeLevel, LevelConfig> = {
    0: {
        shadowResolution: 2048,
        shadowEnabled: true,
        bloomEnabled: true,
        dofEnabled: true,
        vignetteEnabled: true,
        fxaaEnabled: true,
        outlineEnabled: true,
        chromaticAberrationEnabled: true,
        grainEnabled: true,
        glowEnabled: true,
        ssaoEnabled: true,
        qualityProfile: 'high',
        label: '正常',
    },
    1: {
        shadowResolution: 512,
        shadowEnabled: true,
        bloomEnabled: false,
        dofEnabled: true,
        vignetteEnabled: true,
        fxaaEnabled: true,
        outlineEnabled: true,
        chromaticAberrationEnabled: false,
        grainEnabled: false,
        glowEnabled: false,
        ssaoEnabled: true,
        qualityProfile: 'medium',
        label: '轻度降级',
    },
    2: {
        shadowResolution: 512,
        shadowEnabled: false,
        bloomEnabled: false,
        dofEnabled: false,
        vignetteEnabled: false,
        fxaaEnabled: false,
        outlineEnabled: true,
        chromaticAberrationEnabled: false,
        grainEnabled: false,
        glowEnabled: false,
        ssaoEnabled: false,
        qualityProfile: 'low',
        label: '中度降级',
    },
    3: {
        shadowResolution: 512,
        shadowEnabled: false,
        bloomEnabled: false,
        dofEnabled: false,
        vignetteEnabled: false,
        fxaaEnabled: false,
        outlineEnabled: false,
        chromaticAberrationEnabled: false,
        grainEnabled: false,
        glowEnabled: false,
        ssaoEnabled: false,
        qualityProfile: 'low',
        label: '重度降级',
    },
};

/** 比较两个级别配置，返回从 prev 切换到 next 所需的变化集合。 */
function levelDiff(
    prev: LevelConfig,
    next: LevelConfig
): { light: Partial<LightState>; render: Partial<RenderState>; env?: Partial<EnvState> } {
    const light: Partial<LightState> = {};
    const render: Partial<RenderState> = {};
    const env: Partial<EnvState> = {};
    if (prev.shadowResolution !== next.shadowResolution) {
        light.shadowResolution = next.shadowResolution;
    }
    if (prev.shadowEnabled !== next.shadowEnabled) {
        light.shadowEnabled = next.shadowEnabled;
    }
    if (prev.bloomEnabled !== next.bloomEnabled) {
        render.bloomEnabled = next.bloomEnabled;
    }
    if (prev.dofEnabled !== next.dofEnabled) {
        render.dofEnabled = next.dofEnabled;
    }
    if (prev.vignetteEnabled !== next.vignetteEnabled) {
        render.vignetteEnabled = next.vignetteEnabled;
    }
    if (prev.fxaaEnabled !== next.fxaaEnabled) {
        render.fxaaEnabled = next.fxaaEnabled;
    }
    if (prev.outlineEnabled !== next.outlineEnabled) {
        render.outlineEnabled = next.outlineEnabled;
    }
    if (prev.chromaticAberrationEnabled !== next.chromaticAberrationEnabled) {
        render.chromaticAberrationEnabled = next.chromaticAberrationEnabled;
    }
    if (prev.grainEnabled !== next.grainEnabled) {
        render.grainEnabled = next.grainEnabled;
    }
    if (prev.glowEnabled !== next.glowEnabled) {
        render.glowEnabled = next.glowEnabled;
    }
    if (prev.ssaoEnabled !== next.ssaoEnabled) {
        render.ssaoEnabled = next.ssaoEnabled;
    }
    // ADR-130 Phase 2.3: 统一质量档位
    // 注意：不传播 qualityProfile 本身——它只由用户手动更改，auto-degrade 只动子字段，
    // 避免「用户设 reflectionQuality=off，degrade 后 qualityProfile 漂移为 low」的漂移 bug。
    if (next.qualityProfile) {
        const prevR = resolveQualityProfile(prev.qualityProfile || 'high');
        const nextR = resolveQualityProfile(next.qualityProfile);
        if (prevR.reflectionQuality !== nextR.reflectionQuality)
            env.reflectionQuality = nextR.reflectionQuality;
        if (prevR.cloudQuality !== nextR.cloudQuality)
            env.cloudQuality = nextR.cloudQuality;
        if (prevR.particleQuality !== nextR.particleQuality)
            env.particleQuality = nextR.particleQuality;
    }
    return { light, render, env };
}

// ======== Apply Degradation ========

/**
 * 恢复快照到用户原始设置的公共逻辑（applyDegrade level=0 与 resetPerformanceSnapshot 共用）。
 * 先提取 + 清空 `_snapshot` 再应用，避免 setLightState → resetPerformanceSnapshot 死循环；
 * 全程置 `_suppressSnapshotReset` 防止反向恢复反馈。
 * @returns 是否存在快照（存在才实际执行了恢复）
 */
function _restoreSnapshot(): boolean {
    if (!_snapshot) {
        return false;
    }
    const light = _snapshot.light;
    const render = _snapshot.render;
    const snapEnv = _snapshot.env;
    _snapshot = null;
    _suppressSnapshotReset = true;
    try {
        _bridgeSetLightState(light);
        _bridgeSetRenderState(render);
        if (snapEnv && Object.keys(snapEnv).length > 0) {
            setAutoDegradingReflection(true);
            try {
                setEnvStateForPerformance(snapEnv, true);
            } finally {
                setAutoDegradingReflection(false);
            }
        }
    } finally {
        _suppressSnapshotReset = false;
    }
    // 恢复 renderScale 乘数
    _perfRenderScaleMul = 1.0;
    return true;
}

/**
 * 应用指定级别的降级/恢复。
 * @param level 目标级别
 * @param force 若为 true，绕过冷却检查（用于强制模式切换）
 */
function applyDegrade(level: DegradeLevel, force = false): void {
    if (level === _currentLevel) {
        return;
    }

    const now = performance.now();

    // 冷却检查：强制模式（来自 setPerformanceMode）绕过冷却
    if (!force) {
        if (level > _currentLevel) {
            // 降级方向：受 degrade cooldown 限制
            if (now - _lastDegradeTime < _degradeCooldownMs) {
                return;
            }
        } else {
            // 恢复方向：受 recovery cooldown 限制，防止帧率抖动
            if (now - _lastRecoveryTime < _recoveryCooldownMs) {
                return;
            }
        }
    }

    // 首次降级时保存快照（用户原始设置）
    if (!_snapshot && level > 0) {
        _snapshot = {
            light: _bridgeGetLightState(),
            render: _bridgeGetRenderState(),
            env: {
                qualityProfile: envState.qualityProfile,
                reflectionQuality: envState.reflectionQuality,
                cloudQuality: envState.cloudQuality,
                particleQuality: envState.particleQuality,
            },
        };
    }

    // 恢复到 Level 0：使用快照还原用户原始设置
    if (level === 0 && _snapshot) {
        _restoreSnapshot();
        _currentLevel = 0;
        _lastRecoveryTime = now;
        if (import.meta.env.DEV) {
            console.info(`[${formatTimestamp()}] [Performance] Restored to full quality`);
        }
        return;
    }

    // 恢复到 0 但无快照：无需操作
    if (level === 0 && !_snapshot) {
        _currentLevel = 0;
        return;
    }

    // 计算当前级别配置与目标级别配置的差集
    const prevCfg = LEVEL_CONFIGS[_currentLevel];
    const nextCfg = LEVEL_CONFIGS[level];
    const changes = levelDiff(prevCfg, nextCfg);

    if (Object.keys(changes.light).length > 0 || Object.keys(changes.render).length > 0) {
        _suppressSnapshotReset = true;
        try {
            if (Object.keys(changes.light).length > 0) {
                _bridgeSetLightState(changes.light);
            }
            if (Object.keys(changes.render).length > 0) {
                _bridgeSetRenderState(changes.render);
            }
        } finally {
            _suppressSnapshotReset = false;
        }
    }

    // ADR-151 收口：反射降级上限守卫 —— 降级目标不得高于用户原始 reflectionQuality，
    // 避免「用户关了反射，降级却把反射打开」的反直觉行为。
    if (changes.env && changes.env.reflectionQuality !== undefined) {
        const userQ = _snapshot?.env?.reflectionQuality;
        if (userQ !== undefined) {
            if (
                (REFLECTION_QUALITY_ORDER[changes.env.reflectionQuality] ?? 0) >
                (REFLECTION_QUALITY_ORDER[userQ] ?? 0)
            ) {
                changes.env.reflectionQuality = userQ;
            }
        }
    }

    // ADR-130 Phase 2.3: 反射质量联动（水面/地面）
    if (changes.env && Object.keys(changes.env).length > 0) {
        setAutoDegradingReflection(true);
        try {
            setEnvStateForPerformance(changes.env, true);
        } finally {
            setAutoDegradingReflection(false);
        }
    }

    const prevLevel = _currentLevel;
    _currentLevel = level;

    if (level > prevLevel) {
        // 实际发生了降级
        _lastDegradeTime = now;
    } else {
        // 实际发生了恢复
        _lastRecoveryTime = now;
    }

    // renderScale 像素比杠杆：Level 2/3 自动降至 0.7，Level 0/1 恢复 1.0
    const targetMul = level >= 2 ? 0.7 : 1.0;
    if (_perfRenderScaleMul !== targetMul) {
        _perfRenderScaleMul = targetMul;
        if (import.meta.env.DEV) {
            console.info(
                `[${formatTimestamp()}] [Performance] renderScale mul → ${targetMul}`
            );
        }
    }
    if (import.meta.env.DEV) {
        console.info(
            `[${formatTimestamp()}] [Performance] Level ${level}: ${LEVEL_CONFIGS[level].label}`
        );
    }
}

// ======== Thresholds with Hysteresis ========

// Phase 1: 刷新率感知——将阈值按 refRate/60 缩放，使高刷设备获得正确校准。
// 60Hz 下 RSCALE=1，行为与历史完全一致（零回归）。
// Phase 2: 运行时峰值校准——启动后 ~3s 预热期后滚动 maxFPS 作为 observedCeiling，
// 综合基准 reference = max(hardwareRefRate, observedCeiling) 防止首帧卡顿污染天花板。
// `screen.refreshRate` 是非标准属性（仅部分 Chromium/特供浏览器暴露，WebView2 运行时不支持），
// 故以异常安全方式读取，缺失/非有限正数/访问异常时一律回退 60Hz。
interface ScreenWithRefreshRate extends Screen {
    refreshRate?: number;
}
function detectRefreshRate(): number {
    try {
        const r = (window.screen as ScreenWithRefreshRate).refreshRate;
        if (typeof r === 'number' && Number.isFinite(r) && r > 0) {
            return r;
        }
    } catch {
        // screen 在受限环境不可访问，走下方默认
    }
    return 60;
}
function clampRate(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

// ===== Phase 2: 运行时峰值校准 =====

/** 硬件刷新率（模块加载时定一次，resize 时可重读）。 */
let _hardwareRefRate = clampRate(detectRefreshRate(), 30, 240);

/** 稳态滚动 maxFPS（预热期后开始累积）。 */
let _steadyMaxFps = 0;

/** 运行时观测峰值，用于综合基准计算。 */
let _observedCeiling = 0;

/** 预热期标志：启动后前 ~3s 不追踪天花板，避免首帧卡顿污染。 */
let _warmup = true;

/** 预热开始时间戳。 */
let _warmupStartTime = 0;

/** 综合基准参考值：取硬件刷新率与观测峰值的较大者，上限 240 防止空场景 FPS 飙升永久禁用降级。 */
function getReference(): number {
    return Math.min(Math.max(_hardwareRefRate, _observedCeiling), 240);
}

/** 阈值缩放因子：reference / 60。 */
function getRScale(): number {
    return getReference() / 60;
}

/** 降级阈值（帧率低于此值则降级），按 reference 动态缩放。 */
function getDegradeThreshold(level: DegradeLevel): number {
    // 60Hz→28/20/14；120Hz→56/40/28
    return [Infinity, 28, 20, 14][level] * getRScale();
}

/** 恢复阈值（帧率高于此值才允许恢复），按 reference 动态缩放。 */
function getRecoveryThreshold(level: DegradeLevel): number {
    // 60Hz→32/24/18；120Hz→64/48/36
    return [Infinity, 32, 24, 18][level] * getRScale();
}

/**
 * 重新计算刷新率基准（外接显示器变化时由 render-loop resize 触发）。
 * 仅当硬件刷新率实际下降时收敛 ceiling，避免 WebView2 回退 60Hz 误钳高刷 ceiling。
 */
export function recalcPerformanceReference(): void {
    const prev = _hardwareRefRate;
    _hardwareRefRate = clampRate(detectRefreshRate(), 30, 240);
    if (_hardwareRefRate < prev) {
        const cap = _hardwareRefRate * 1.1;
        if (_observedCeiling > cap) {
            _observedCeiling = cap;
            _steadyMaxFps = cap;
        }
    }
}

// ======== Public API ========

/**
 * 每帧调用（渲染循环内）。
 * 采集平滑 FPS 并根据帧率触发降级/恢复。
 */
export function updatePerformance(): void {
    if (_mode === 'quality' || _mode === 'custom') {
        return;
    }
    // ADR-159 P3-A：bridge 未注册（initScene 尚未完成）时安全跳过，不触发降级
    if (!_bridgeEngine) {
        return;
    }

    // 采集 FPS 样本
    const fps = _bridgeEngine.getFps();
    _fpsSamples.push(fps);
    if (_fpsSamples.length > _fpsSampleSize) {
        _fpsSamples.shift();
    }

    // Issue #7: 累积足够样本后再开始评估
    if (!_fpsReady) {
        if (_fpsSamples.length >= _fpsSampleSize) {
            _fpsReady = true;
        } else {
            return; // 样本不足，跳过
        }
    }

    // 每 ~500ms 评估一次，避免抖动
    const now = performance.now();
    if (now - _lastFpsLog < 500) {
        return;
    }
    _lastFpsLog = now;

    const avgFps = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;

    // Phase 2: 运行时峰值校准（预热期后滚动 maxFPS）
    if (_warmup) {
        if (_warmupStartTime === 0) {
            _warmupStartTime = now;
        } else if (now - _warmupStartTime > 3000) {
            _warmup = false;
            _steadyMaxFps = avgFps;
        }
    } else {
        if (avgFps > _steadyMaxFps) {
            _steadyMaxFps = avgFps;
        } else {
            _steadyMaxFps = Math.max(avgFps, _steadyMaxFps * 0.998);
        }
        _observedCeiling = _steadyMaxFps;
    }

    // 确定目标级别
    let targetLevel: DegradeLevel;
    if (_mode === 'performance') {
        targetLevel = 2;
    } else if (_mode === 'balanced') {
        targetLevel = 1;
    } else {
        // Auto 模式：以当前级别为锚点，严格双阈值滞回
        // - 降级：当 FPS 低于下一级的降级阈值，则降一级
        // - 恢复：当 FPS 高于当前级别的恢复阈值，则升一级
        // - 两端互不干扰，避免阈值附近的来回跳变
        targetLevel = _currentLevel;
        if (
            _currentLevel < 3 &&
            avgFps < getDegradeThreshold((_currentLevel + 1) as DegradeLevel)
        ) {
            targetLevel = (_currentLevel + 1) as DegradeLevel;
        } else if (
            _currentLevel > 0 &&
            avgFps > getRecoveryThreshold(_currentLevel as DegradeLevel)
        ) {
            targetLevel = (_currentLevel - 1) as DegradeLevel;
        }
    }

    applyDegrade(targetLevel);
}

/**
 * 设置性能模式。
 * - "auto": 监控 FPS 自动降级/恢复
 * - "quality": 强制最高质量，永不降级
 * - "balanced": 强制 Level 1 降级
 * - "performance": 强制 Level 2 降级
 * - "custom": 冻结当前 RenderState/LightState 为用户权威配置，停止自动降级
 */
export function setPerformanceMode(mode: PerformanceMode): void {
    _mode = mode;

    // [fix:ghost-state] 同步 uiState.performanceMode 并触发持久化，
    // 修复原「用户切换模式只写 _mode、uiState 不变」导致重启后设置丢失的漂移。
    // setUIState 内部 Object.assign 合并字段 + 调用 _uiPersistCb 持久化。
    if (uiState.performanceMode !== mode) {
        setUIState({ performanceMode: mode } as UIState);
    }

    // Issue #2: 强制模式调用时绕过冷却
    if (mode === 'quality') {
        applyDegrade(0, true);
    } else if (mode === 'balanced') {
        applyDegrade(1, true);
    } else if (mode === 'performance') {
        applyDegrade(2, true);
    } else if (mode === 'custom') {
        // Custom 模式：冻结当前渲染/光照状态为权威配置。
        // 恢复自动降级遗留的快照（若有），使后续不再被降级覆盖；
        // updatePerformance 已在 custom 模式下早返，不会再次降级。
        resetPerformanceSnapshot();
    }
    if (import.meta.env.DEV) {
        console.info(`[${formatTimestamp()}] [Performance] Mode set to: ${mode}`);
    }
}

export function getPerformanceMode(): PerformanceMode {
    return _mode;
}

export function getCurrentDegradeLevel(): DegradeLevel {
    return _currentLevel;
}

/**
 * 重置性能快照（用户手动修改渲染/光照设置后调用）。
 * Issue #4: 重置前先恢复到全质量，避免状态卡死在降级画质。
 */
export function resetPerformanceSnapshot(): void {
    _restoreSnapshot();
    _currentLevel = 0;
    _lastDegradeTime = 0;
    _lastRecoveryTime = 0;
}
