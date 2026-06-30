// [doc:architecture] Performance Monitor — FPS 监控 + 自动降级
// 在渲染循环中调用，根据帧率自动调整渲染质量。

import { engine } from './scene';
import { setLightState, setRenderState, getLightState, getRenderState } from './scene';
import type { LightState, RenderState } from './scene';

// ======== Types ========

export type PerformanceMode = 'auto' | 'quality' | 'balanced' | 'performance';

/** Degradation level applied when FPS drops. */
type DegradeLevel = 0 | 1 | 2 | 3;

// ======== State ========

let _mode: PerformanceMode = 'auto';
let _enabled = true;
const _cooldownMs = 5000; // 降级后冷却 5 秒，避免频繁切换
let _lastDegradeTime = 0;
let _currentLevel: DegradeLevel = 0;

// FPS smoothing
const _fpsSamples: number[] = [];
const _fpsSampleSize = 30; // ~0.5s at 60fps
let _lastFpsLog = 0;

// Snapshot of settings before degradation (to restore)
let _snapshot: { light: Partial<LightState>; render: Partial<RenderState> } | null = null;

// ======== Degrade Thresholds ========

const THRESHOLDS: Record<DegradeLevel, { minFps: number; label: string }> = {
    0: { minFps: 45, label: '正常' },
    1: { minFps: 30, label: '轻度降级' },
    2: { minFps: 20, label: '中度降级' },
    3: { minFps: 0, label: '重度降级' },
};

// ======== Apply Degradation ========

function applyDegrade(level: DegradeLevel): void {
    if (level === _currentLevel) {
        return;
    }

    const now = performance.now();
    if (now - _lastDegradeTime < _cooldownMs && level !== 0) {
        // 冷却期内只允许恢复（level=0），不允许继续降级
        return;
    }

    // Take snapshot before first degradation
    if (!_snapshot && level > 0) {
        _snapshot = {
            light: getLightState(),
            render: getRenderState(),
        };
    }

    // If restoring, revert to snapshot
    if (level === 0 && _snapshot) {
        setLightState(_snapshot.light);
        setRenderState(_snapshot.render);
        _snapshot = null;
        _currentLevel = 0;
        _lastDegradeTime = now;
        console.log('[Performance] Restored to full quality');
        return;
    }

    // Apply degradation step by step
    const lightChanges: Partial<LightState> = {};
    const renderChanges: Partial<RenderState> = {};

    if (level >= 1) {
        // Level 1: reduce shadow resolution, disable Bloom
        lightChanges.shadowResolution = 512;
        lightChanges.shadowEnabled = false;
        renderChanges.bloomEnabled = false;
    }
    if (level >= 2) {
        // Level 2: disable shadows entirely, disable DOF/Vignette, disable FXAA
        lightChanges.shadowEnabled = false;
        renderChanges.dofEnabled = false;
        renderChanges.vignetteEnabled = false;
        renderChanges.fxaaEnabled = false;
    }
    if (level >= 3) {
        // Level 3: disable all post-processing, reduce particle emission
        renderChanges.bloomEnabled = false;
        renderChanges.dofEnabled = false;
        renderChanges.vignetteEnabled = false;
        renderChanges.outlineEnabled = false;
    }

    if (Object.keys(lightChanges).length > 0) {
        setLightState(lightChanges);
    }
    if (Object.keys(renderChanges).length > 0) {
        setRenderState(renderChanges);
    }

    _currentLevel = level;
    _lastDegradeTime = now;
    console.log(`[Performance] Degraded to level ${level}: ${THRESHOLDS[level].label}`);
}

// ======== Public API ========

/**
 * Call this once per frame (inside render loop).
 * Computes smoothed FPS and triggers degradation if needed.
 */
export function updatePerformance(): void {
    if (!_enabled || _mode === 'quality') {
        return;
    }

    // Collect FPS sample
    const fps = engine.getFps();
    _fpsSamples.push(fps);
    if (_fpsSamples.length > _fpsSampleSize) {
        _fpsSamples.shift();
    }

    // Only evaluate every ~500ms to avoid jitter
    const now = performance.now();
    if (now - _lastFpsLog < 500) {
        return;
    }
    _lastFpsLog = now;

    const avgFps = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;

    // Determine target level
    let targetLevel: DegradeLevel = 0;
    if (_mode === 'performance') {
        targetLevel = 2; // Force level 2 for "performance" mode
    } else if (_mode === 'balanced') {
        targetLevel = 1; // Force level 1 for "balanced" mode
    } else {
        // Auto mode: evaluate thresholds
        if (avgFps < THRESHOLDS[2].minFps) {
            targetLevel = 2;
        } else if (avgFps < THRESHOLDS[1].minFps) {
            targetLevel = 1;
        }
        // Note: we use level 2 threshold for level 1 trigger to have hysteresis
        if (avgFps < 25) {
            targetLevel = 2;
        }
        if (avgFps < 15) {
            targetLevel = 3;
        }
    }

    applyDegrade(targetLevel);
}

/**
 * Set performance mode.
 * - "auto": monitor FPS and auto-degrade
 * - "quality": force max quality, no degradation
 * - "balanced": force level 1 degradation
 * - "performance": force level 2 degradation
 */
export function setPerformanceMode(mode: PerformanceMode): void {
    _mode = mode;
    _enabled = mode !== 'quality';

    // If switching to quality, restore immediately
    if (mode === 'quality') {
        applyDegrade(0);
    }
    console.log(`[Performance] Mode set to: ${mode}`);
}

export function getPerformanceMode(): PerformanceMode {
    return _mode;
}

export function getCurrentDegradeLevel(): DegradeLevel {
    return _currentLevel;
}

/** Reset performance snapshot (call after user manually changes settings). */
export function resetPerformanceSnapshot(): void {
    _snapshot = null;
    _currentLevel = 0;
}
