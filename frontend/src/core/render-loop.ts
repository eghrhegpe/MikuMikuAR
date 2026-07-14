// [doc:adr-102] Render loop + FPS clock (split from main.ts :940-995).
// Pure initialization/side-effect module: wires perf observers, starts the
// Babylon render loop, the resize handler, and the FPS clock. Exported as
// `startRenderLoop()` so the Bootstrap layer can invoke it after scene init.
import { engine, scene, applyFrameControl } from '../scene/scene';
import { updatePerformance } from '../scene/render/performance';
import { uiState, dom } from './config';
import { formatTimestamp, logWarn } from './utils';

export function startRenderLoop(): void {
    applyFrameControl();
    engine.setHardwareScalingLevel(1 / (uiState.renderScale ?? 1));
    // 时间戳格式化已收敛至 utils.formatTimestamp
    let _renderBeforeTime = 0;
    scene.onBeforeRenderObservable.add(() => {
        _renderBeforeTime = performance.now();
    });
    scene.onAfterRenderObservable.add(() => {
        const _afterTime = performance.now();
        const _gpuElapsed = _afterTime - _renderBeforeTime;
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
        if (_rElapsed > 30 || (_obsDelta > 0 && _obsAfter > 100)) {
            logWarn(
                'perf:render',
                `[${formatTimestamp()}] scene.render took ${_rElapsed.toFixed(1)}ms, observers=${_obsBefore}→${_obsAfter} (Δ=${_obsDelta})`
            );
        }
        updatePerformance();
    });
    window.addEventListener('resize', () => {
        engine.resize();
    });

    // ======== FPS + Clock ========
    let _fpsClockId: ReturnType<typeof setInterval> | null = null;
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
