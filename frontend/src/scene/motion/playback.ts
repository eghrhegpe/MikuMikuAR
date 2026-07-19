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
    seekDragging,
    formatTime,
    mmdRuntime,
} from '@/core/config';
import { isAudioPlaying, syncAudioPlayback } from '@/outfit/audio';
import { animateCameraVmd } from '../camera/camera';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { ModelManager } from '../manager/model-manager';
import type { BeatDetector } from '@/motion-algos/beat-detector';
import { clamp01 } from '@/core/utils';
import { observe, type ObserverHandle } from '@/core/observer-handle';

// ======== 辅助函数 ========

/** 获取当前聚焦模型的动画时长，优先使用模型自身时长，降级到 runtime 默认值。 */
function _getDuration(runtime: IMmdRuntime, manager: ModelManager): number {
    const foc = manager.focused();
    return foc?.animationDuration ?? runtime.animationDuration;
}

/** 当前是否有 auto-loop 在进行中（用于避免 UI 闪烁）。 */
let _loopPending = false;

/** Module-level ModelManager 引用，供 updatePlaybackUI 统一获取动画时长。 */
let _manager: ModelManager | null = null;

/** Dispose guard: prevents double-cleanup if dispose() called more than once. */
let _disposed = false;

// ======== Playback Callbacks Initialization ========

export interface PlaybackObservablesDispose {
    (): void;
}

export function initPlaybackObservables(
    runtime: IMmdRuntime,
    manager: ModelManager,
    updatePlaybackUI: () => void,
    updateProcMotion: () => Promise<void>,
    getProcBeatDetector: () => BeatDetector | null
): PlaybackObservablesDispose {
    _manager = manager;
    _disposed = false; // 重置 dispose guard，支持多轮 init/dispose

    const tickHandle = observe(runtime.onAnimationTickObservable, () => {
        // 每帧统一刷新节拍检测器（供 LipSync + Auto Dance 共享）
        const beatDetector = getProcBeatDetector();
        if (isAudioPlaying() && beatDetector) {
            beatDetector.update();
        }
        updatePlaybackUI();
        animateCameraVmd(runtime.currentTime * 30);
        // updateProcMotion 是 async 函数，在同步回调中 fire-and-forget
        // 添加 .catch 防止未处理的 Promise 拒绝导致静默崩溃
        updateProcMotion().catch((err: unknown) =>
            console.error('[playback] updateProcMotion:', err)
        );
    });

    const playHandle = observe(runtime.onPlayAnimationObservable, () => {
        setIsPlaying(true);
        updatePlaybackUI();
    });

    const pauseHandle = observe(runtime.onPauseAnimationObservable, () => {
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
            const loop = autoLoop; // 快照：防止 async 间隙 autoLoop 变化导致状态漂移
            runtime
                .seekAnimation(0, true)
                .then(() => {
                    if (!loop) {
                        _loopPending = false;
                        return;
                    }
                    // 检查 runtime 和 manager 在 async 间隙是否仍有效
                    if (!loop || !runtime || !_manager) {
                        _loopPending = false;
                        return;
                    }
                    runtime
                        .playAnimation()
                        .then(() => {
                            _loopPending = false;
                            setIsPlaying(true);
                            updatePlaybackUI();
                        })
                        .catch((err: unknown) => {
                            _loopPending = false;
                            console.error('[playback] auto-loop playAnimation failed:', err);
                        });
                })
                .catch((err: unknown) => {
                    _loopPending = false;
                    console.error('[playback] auto-loop seekAnimation failed:', err);
                });
            return;
        }
        updatePlaybackUI();
    });

    // 返回 dispose 函数，供场景销毁时清理观察者，防止内存泄漏
    return () => {
        if (_disposed) {
            return;
        }
        _disposed = true;
        // 逐一清理，catch 异常确保后续 handle 仍能释放（等价旧 _safeRemoveCallback 语义）
        try { tickHandle.dispose(); } catch { /* 单个清理失败不中断整体 */ }
        try { playHandle.dispose(); } catch { /* 单个清理失败不中断整体 */ }
        try { pauseHandle.dispose(); } catch { /* 单个清理失败不中断整体 */ }
    };
}

export function updatePlaybackUI(): void {
    if (!dom.playbackBar) {
        return;
    }

    // Fail-Fast: 无 mmdRuntime 或 seekBar 时直接抛错
    if (!mmdRuntime || !dom.seekBar) {
        throw new Error('playback: mmdRuntime 或 dom.seekBar 未初始化，请检查场景初始化顺序');
    }

    // 到达此处的 guard 保证了 mmdRuntime 和 dom.seekBar 均可用
    // 它被 observable 回调调用，此时 mmdRuntime 一定可用（已被 initScene 初始化）。
    // 但此函数也可能被外部直接调用（如 seekFromEvent），此时 mmdRuntime 可能为 null，
    // 因此保持顶部的 guard 不变。
    dom.playbackBar.style.display = 'flex';
    dom.btnPlayPause.textContent = isPlaying ? '⏸' : '▶';
    dom.btnLoopToggle.style.opacity = autoLoop ? '1' : '0.35';
    const duration = _manager ? _getDuration(mmdRuntime, _manager) : mmdRuntime.animationDuration;
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
    const ratio = clamp01((e.clientX - rect.left) / rect.width);
    const targetTime = ratio * duration;
    mmdRuntime.seekAnimation(targetTime, true);
    updatePlaybackUI();
    syncAudioPlayback(targetTime, isPlaying, duration);
}
