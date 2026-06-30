// [doc:architecture] ScenePlayback — 播放控制 UI 子模块
// 职责: 从 scene.ts 拆出的播放进度 UI / seek 逻辑 + MMD runtime observable 回调聚合
//
// 循环依赖处理：modelManager 以参数形式注入 initPlaybackObservables，
// 而非静态导入 `./scene`，避免 ES module 循环引用隐患。

import {
    dom,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setSeekDragging,
    seekDragging,
    formatTime,
    mmdRuntime,
} from '../core/config';
import { syncAudioPlayback, isAudioPlaying } from '../outfit/audio';
import { animateCameraVmd } from './camera';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import type { ModelManager } from './scene-model';
import type { BeatDetector } from '../motion/beat-detector';

// ======== 辅助函数 ========

/** 获取当前聚焦模型的动画时长，优先使用模型自身时长，降级到 runtime 默认值。 */
function _getDuration(runtime: MmdWasmRuntime, manager: ModelManager): number {
    const foc = manager.focused();
    return foc?.animationDuration ?? runtime.animationDuration;
}

/** 当前是否有 auto-loop 在进行中（用于避免 UI 闪烁）。 */
let _loopPending = false;

// ======== Playback Callbacks Initialization ========

export interface PlaybackObservablesDispose {
    (): void;
}

export function initPlaybackObservables(
    runtime: MmdWasmRuntime,
    manager: ModelManager,
    updatePlaybackUI: () => void,
    updateProcMotion: () => Promise<void>,
    updateLipSync: () => void,
    getProcBeatDetector: () => BeatDetector | null
): PlaybackObservablesDispose {
    const tickHandler = () => {
        // 每帧统一刷新节拍检测器（供 LipSync + Auto Dance 共享）
        const beatDetector = getProcBeatDetector();
        if (isAudioPlaying() && beatDetector) {
            beatDetector.update();
        }
        updatePlaybackUI();
        const dur = _getDuration(runtime, manager);
        syncAudioPlayback(runtime.currentTime, isPlaying, dur);
        animateCameraVmd(runtime.currentTime * 30);
        // updateProcMotion 是 async 函数，在同步回调中 fire-and-forget
        // 添加 .catch 防止未处理的 Promise 拒绝导致静默崩溃
        updateProcMotion().catch((err: unknown) =>
            console.error('[playback] updateProcMotion:', err)
        );
        updateLipSync();
    };
    runtime.onAnimationTickObservable.add(tickHandler);

    const playHandler = () => {
        setIsPlaying(true);
        updatePlaybackUI();
        const dur = _getDuration(runtime, manager);
        syncAudioPlayback(runtime.currentTime, true, dur);
    };
    runtime.onPlayAnimationObservable.add(playHandler);

    const pauseHandler = () => {
        // NOTE: babylon-mmd fires onPause when animation reaches the end (no
        // separate onFinish event), so the auto-loop logic lives here.

        if (!_loopPending) {
            setIsPlaying(false);
        }
        if (seekDragging) {
            updatePlaybackUI();
            return;
        }
        // Auto-loop: use the focused model's animation duration
        const focModel = manager.focused();
        if (
            autoLoop &&
            focModel &&
            runtime &&
            focModel.animationDuration > 0 &&
            runtime.currentTime >= focModel.animationDuration - 0.1
        ) {
            // 设置 loopPending 标志，阻止 setIsPlaying(false) 导致的 UI 闪烁
            _loopPending = true;
            runtime.seekAnimation(0, true).then(() => {
                if (!autoLoop) {
                    _loopPending = false;
                    return;
                }
                runtime.playAnimation()
                    .then(() => {
                        _loopPending = false;
                        setIsPlaying(true);
                        updatePlaybackUI();
                    })
                    .catch((err: unknown) => {
                        _loopPending = false;
                        console.error('[playback] auto-loop playAnimation failed:', err);
                    });
            });
            return;
        }
        updatePlaybackUI();
        const dur = _getDuration(runtime, manager);
        syncAudioPlayback(runtime.currentTime, false, dur);
    };
    runtime.onPauseAnimationObservable.add(pauseHandler);

    // 返回 dispose 函数，供场景销毁时清理观察者，防止内存泄漏
    return () => {
        try {
            runtime.onAnimationTickObservable.removeCallback(tickHandler);
        } catch (_) {}
        try {
            runtime.onPlayAnimationObservable.removeCallback(playHandler);
        } catch (_) {}
        try {
            runtime.onPauseAnimationObservable.removeCallback(pauseHandler);
        } catch (_) {}
    };
}

export function updatePlaybackUI(): void {
    if (!mmdRuntime || !dom.seekBar) {
        if (dom.playbackBar) {
            dom.playbackBar.style.display = 'none';
        }
        return;
    }
    // 到达此处的 guard 保证了 mmdRuntime 和 dom.seekBar 均可用
    // 它被 observable 回调调用，此时 mmdRuntime 一定可用（已被 initScene 初始化）。
    // 但此函数也可能被外部直接调用（如 seekFromEvent），此时 mmdRuntime 可能为 null，
    // 因此保持顶部的 guard 不变。
    dom.playbackBar.style.display = 'flex';
    dom.btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
    dom.btnLoopToggle.style.opacity = autoLoop ? '1' : '0.35';
    const duration = mmdRuntime.animationDuration;
    dom.timeDisplay.textContent = `${formatTime(mmdRuntime.currentTime)} / ${formatTime(duration)}`;
    if (duration > 0) {
        const pct = (mmdRuntime.currentTime / duration) * 100;
        dom.seekProgress.style.width = `${Math.min(pct, 100)}%`;
    }
}

export function seekFromEvent(e: MouseEvent | PointerEvent): void {
    if (!mmdRuntime || !dom.seekBar) {
        return;
    }
    const duration = mmdRuntime.animationDuration;
    if (duration <= 0) {
        return;
    }
    const rect = dom.seekBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;
    mmdRuntime.seekAnimation(targetTime, true);
    updatePlaybackUI();
    syncAudioPlayback(targetTime, isPlaying, duration);
}
