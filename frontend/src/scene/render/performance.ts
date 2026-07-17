// [doc:architecture] Performance Monitor — FPS 监控 + 自动降级
// 在渲染循环中调用，根据帧率自动调整渲染质量。
// 注意：模块级状态假定单例场景，不适用于多渲染上下文。

import { engine } from '../scene';
import { setLightState, setRenderState, getLightState, getRenderState } from '../scene';
import type { LightState, RenderState } from '../scene';
import { formatTimestamp } from '@/core/utils';
import { uiState, setUIState } from '@/core/state';
import type { UIState } from '@/core/types';

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
let _snapshot: { light: Partial<LightState>; render: Partial<RenderState> } | null = null;

// 抑制标志：applyDegrade 调 setLightState/setRenderState 时置 true，防止
// setLightState/setRenderState 内部的 resetPerformanceSnapshot() 反向恢复快照，
// 形成「降级→恢复→再降级」的反馈循环。
let _suppressSnapshotReset = false;

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
    ssrEnabled: boolean;
    reflectionProbeEnabled: boolean;
    ssaoEnabled: boolean;
    label: string;
}

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
        ssrEnabled: true,
        reflectionProbeEnabled: true,
        ssaoEnabled: true,
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
        ssrEnabled: false,
        reflectionProbeEnabled: true,
        ssaoEnabled: true,
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
        ssrEnabled: false,
        reflectionProbeEnabled: false,
        ssaoEnabled: false,
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
        ssrEnabled: false,
        reflectionProbeEnabled: false,
        ssaoEnabled: false,
        label: '重度降级',
    },
};

/** 比较两个级别配置，返回从 prev 切换到 next 所需的变化集合。 */
function levelDiff(
    prev: LevelConfig,
    next: LevelConfig
): { light: Partial<LightState>; render: Partial<RenderState> } {
    const light: Partial<LightState> = {};
    const render: Partial<RenderState> = {};
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
    if (prev.ssrEnabled !== next.ssrEnabled) {
        render.ssrEnabled = next.ssrEnabled;
    }
    if (prev.reflectionProbeEnabled !== next.reflectionProbeEnabled) {
        render.reflectionProbeEnabled = next.reflectionProbeEnabled;
    }
    if (prev.ssaoEnabled !== next.ssaoEnabled) {
        render.ssaoEnabled = next.ssaoEnabled;
    }
    return { light, render };
}

// ======== Apply Degradation ========

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
            light: getLightState(),
            render: getRenderState(),
        };
    }

    // 恢复到 Level 0：使用快照还原用户原始设置
    if (level === 0 && _snapshot) {
        const light = _snapshot.light;
        const render = _snapshot.render;
        _snapshot = null;
        _suppressSnapshotReset = true;
        try {
            setLightState(light);
            setRenderState(render);
        } finally {
            _suppressSnapshotReset = false;
        }
        _currentLevel = 0;
        _lastRecoveryTime = now;
        console.info(`[${formatTimestamp()}] [Performance] Restored to full quality`);
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
                setLightState(changes.light);
            }
            if (Object.keys(changes.render).length > 0) {
                setRenderState(changes.render);
            }
        } finally {
            _suppressSnapshotReset = false;
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
    console.info(
        `[${formatTimestamp()}] [Performance] Level ${level}: ${LEVEL_CONFIGS[level].label}`
    );
}

// ======== Thresholds with Hysteresis ========

// 刷新率感知：将阈值按 refRate/60 缩放，使高刷设备获得正确校准。
// 60Hz 下 RSCALE=1，行为与历史完全一致（零回归）。
function detectRefreshRate(): number {
    const r = (window.screen as unknown as { refreshRate?: number }).refreshRate;
    return typeof r === 'number' && r > 0 ? r : 60;
}
function clampRate(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}
const REF_RATE = clampRate(detectRefreshRate(), 30, 240);
const RSCALE = REF_RATE / 60;

// 降级阈值（帧率低于此值则降级），按刷新率缩放
const DEGRADE_THRESHOLDS: Record<DegradeLevel, number> = {
    0: Infinity, // 不降级
    1: 28 * RSCALE, // 60Hz→28；120Hz→56（原 25/28，收紧提前干预）
    2: 20 * RSCALE, // 60Hz→20；120Hz→40
    3: 14 * RSCALE, // 60Hz→14；120Hz→28
};
// 恢复阈值（帧率高于此值才允许恢复），按刷新率缩放
const RECOVERY_THRESHOLDS: Record<DegradeLevel, number> = {
    0: Infinity,
    1: 32 * RSCALE, // 60Hz→32；120Hz→64（gap 4，原 7）
    2: 24 * RSCALE, // 60Hz→24；120Hz→48
    3: 18 * RSCALE, // 60Hz→18；120Hz→36
};

// ======== Public API ========

/**
 * 每帧调用（渲染循环内）。
 * 采集平滑 FPS 并根据帧率触发降级/恢复。
 */
export function updatePerformance(): void {
    if (_mode === 'quality' || _mode === 'custom') {
        return;
    }

    // 采集 FPS 样本
    const fps = engine.getFps();
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
        if (_currentLevel < 3 && avgFps < DEGRADE_THRESHOLDS[(_currentLevel + 1) as DegradeLevel]) {
            targetLevel = (_currentLevel + 1) as DegradeLevel;
        } else if (
            _currentLevel > 0 &&
            avgFps > RECOVERY_THRESHOLDS[_currentLevel as DegradeLevel]
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
    console.info(`[${formatTimestamp()}] [Performance] Mode set to: ${mode}`);
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
    if (_snapshot) {
        // 先提取 + 清空快照，再恢复，避免 setLightState → resetPerformanceSnapshot 死循环
        const light = _snapshot.light;
        const render = _snapshot.render;
        _snapshot = null;
        // 恢复快照时抑制 setLightState/setRenderState 内部的 resetPerformanceSnapshot 调用
        _suppressSnapshotReset = true;
        try {
            setLightState(light);
            setRenderState(render);
        } finally {
            _suppressSnapshotReset = false;
        }
    }
    _currentLevel = 0;
    _lastDegradeTime = 0;
    _lastRecoveryTime = 0;
}
