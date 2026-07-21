// [doc:adr-102] Render loop + FPS clock (split from main.ts :940-995).
// [adr:audit] 修复：FPS setInterval 与 render-loop 现支持幂等 stop（防 HMR 重复泄漏），
// 性能日志改为 DEV-only + 每 60 帧采样（P4 降噪，见代码审核报告）。
import { engine, scene, applyFrameControl } from '../scene/scene';
import { updatePerformance } from '../scene/render/performance';
import { recalcPerformanceReference } from '../scene/render/performance';
import { uiState, dom } from './config';
import { formatTimestamp } from './utils';
import { logWarn } from './logger';
import { observe, type ObserverHandle } from './observer-handle';
import { safeDispose } from './dispose-helpers';

// 模块级句柄：使渲染循环可被幂等销毁（Vite HMR 重跑 bootstrap 但无真实页面卸载）
let _fpsClockId: ReturnType<typeof setInterval> | null = null;
let _frameCounter = 0;
let _resizeHandler: (() => void) | null = null;
let _beforeObs: ObserverHandle | null = null;
let _afterObs: ObserverHandle | null = null;
let _lastDpr = 1; // 上次检测到的 DPR，用于 resize 时判断是否变化

const PERF_SAMPLE_INTERVAL = 60; // 每 60 帧评估一次性能日志（采样降频，P4）

/**
 * 根据 DPR + renderScale 计算安全的 hardwareScalingLevel，
 * 钳位帧缓冲不超过 GL_MAX_TEXTURE_SIZE（防 DPR×renderScale 越界 OOM）。
 */
export function calcHardwareScaling(dpr: number, renderScale: number): number {
    const base = 1 / (dpr * renderScale);
    const caps = engine.getCaps();
    if (!caps.maxTextureSize) {
        return base;
    }
    // 反推 CSS 宽高：renderWidth = cssW / scalingLevel ⇒ cssW = renderWidth × scalingLevel
    const cssW = engine.getRenderWidth() * engine.getHardwareScalingLevel();
    const cssH = engine.getRenderHeight() * engine.getHardwareScalingLevel();
    const bufW = Math.round(cssW * dpr * renderScale);
    const bufH = Math.round(cssH * dpr * renderScale);
    if (bufW > caps.maxTextureSize || bufH > caps.maxTextureSize) {
        const s = Math.min(caps.maxTextureSize / bufW, caps.maxTextureSize / bufH);
        return base * s;
    }
    return base;
}

/** 应用 hardwareScalingLevel（含 DPR + GL 钳位） */
function applyScaling(): void {
    const dpr = window.devicePixelRatio || 1;
    engine.setHardwareScalingLevel(calcHardwareScaling(dpr, uiState.renderScale ?? 1));
}

export function startRenderLoop(): void {
    // 幂等：HMR 或重复调用前先清理旧实例，避免 setInterval / render-loop 泄漏
    stopRenderLoop();

    applyFrameControl();
    _lastDpr = window.devicePixelRatio || 1;
    applyScaling();
    let _renderBeforeTime = 0;
    _beforeObs = observe(scene.onBeforeRenderObservable, () => {
        _renderBeforeTime = performance.now();
    });
    _afterObs = observe(scene.onAfterRenderObservable, () => {
        const _gpuElapsed = performance.now() - _renderBeforeTime;
        if (_gpuElapsed > 30) {
            const _obsCount = scene.onBeforeRenderObservable.observers
                ? scene.onBeforeRenderObservable.observers.length
                : 0;
            logWarn(
                'perf:gpu',
                `[${formatTimestamp()}] before→after render took ${_gpuElapsed.toFixed(1)}ms (observers=${_obsCount})`
            );
        }
    });
    engine.runRenderLoop(() => {
        const _obsBefore = scene.onBeforeRenderObservable.observers
            ? scene.onBeforeRenderObservable.observers.length
            : 0;
        const _rStart = performance.now();
        scene.render();
        const _rElapsed = performance.now() - _rStart;
        const _obsAfter = scene.onBeforeRenderObservable.observers
            ? scene.onBeforeRenderObservable.observers.length
            : 0;
        const _obsDelta = _obsAfter - _obsBefore;
        // 采样降频 + DEV-only：降低日志噪音（P4）
        _frameCounter++;
        if (
            _frameCounter % PERF_SAMPLE_INTERVAL === 0 &&
            (_rElapsed > 30 || (_obsDelta > 0 && _obsAfter > 100)) &&
            import.meta.env.DEV
        ) {
            logWarn(
                'perf:render',
                `[${formatTimestamp()}] scene.render took ${_rElapsed.toFixed(1)}ms, observers=${_obsBefore}→${_obsAfter} (Δ=${_obsDelta})`
            );
        }
        updatePerformance();
    });
    _resizeHandler = () => {
        engine.resize();
        const newDpr = window.devicePixelRatio || 1;
        if (newDpr !== _lastDpr) {
            _lastDpr = newDpr;
            applyScaling();
            // ADR-118 Phase 2: 外接显示器变化时一并重算刷新率基准
            recalcPerformanceReference();
        }
    };
    window.addEventListener('resize', _resizeHandler);

    // ======== FPS + Clock ========
    const startFpsClock = (): void => {
        if (_fpsClockId) {
            return;
        }
        _fpsClockId = setInterval(() => {
            const now = new Date();
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            dom.fpsClock.textContent = `${Math.round(engine.getFps())} FPS | ${h}:${m}`;
        }, 500);
    };
    startFpsClock();
}

export function stopRenderLoop(): void {
    if (_fpsClockId !== null) {
        clearInterval(_fpsClockId);
        _fpsClockId = null;
    }
    if (_resizeHandler) {
        window.removeEventListener('resize', _resizeHandler);
        _resizeHandler = null;
    }
    if (_beforeObs) {
        _beforeObs = safeDispose(_beforeObs);
    }
    if (_afterObs) {
        _afterObs = safeDispose(_afterObs);
    }
    engine.stopRenderLoop();
}
