// [doc:architecture] ScenePlayback — 播放控制 UI 子模块
// 职责: 从 scene.ts 拆出的播放进度 UI / seek 逻辑 + MMD runtime observable 回调聚合
// 注意: import modelManager 来自 scene.ts 但仅在函数体运行时访问，
//       ES module live binding 保证此时 scene.ts 已初始化完毕。

import { modelManager } from "./scene";
import {
    dom, isPlaying, setIsPlaying, autoLoop,
    setSeekDragging, seekDragging,
    formatTime, mmdRuntime,
    setIsLoadingVmd, setAutoLoop,
} from "../core/config";
import { syncAudioPlayback, isAudioPlaying } from "../outfit/audio";
import { animateCameraVmd } from "./camera";
import type { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";

// ======== Playback Callbacks Initialization ========

export function initPlaybackObservables(
    runtime: MmdWasmRuntime,
    updatePlaybackUI: () => void,
    updateProcMotion: () => Promise<void>,
    updateLipSync: () => void,
    getProcBeatDetector: () => any | null,
): void {
    // 每帧统一刷新
    runtime.onAnimationTickObservable.add(() => {
        // 每帧统一刷新节拍检测器（供 LipSync + Auto Dance 共享）
        const beatDetector = getProcBeatDetector();
        if (isAudioPlaying() && beatDetector) beatDetector.update();
        updatePlaybackUI();
        const foc = modelManager?.focused();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, isPlaying, dur);
        animateCameraVmd(runtime.currentTime * 30);
        updateProcMotion();
        updateLipSync();
    });

    runtime.onPlayAnimationObservable.add(() => {
        setIsPlaying(true);
        updatePlaybackUI();
        const foc = modelManager?.focused();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, true, dur);
    });

    runtime.onPauseAnimationObservable.add(() => {
        // NOTE: babylon-mmd fires onPause when animation reaches the end (no
        // separate onFinish event), so the auto-loop logic lives here.
        setIsPlaying(false);
        if (seekDragging) { updatePlaybackUI(); return; }
        // Auto-loop: use the focused model's animation duration
        const focModel = modelManager?.focused();
        if (autoLoop && focModel && runtime && focModel.animationDuration > 0
            && runtime.currentTime >= focModel.animationDuration - 0.1) {
            runtime.seekAnimation(0, true).then(() => {
                if (!autoLoop || !mmdRuntime) return;
                mmdRuntime.playAnimation().then(() => {
                    setIsPlaying(true);
                    updatePlaybackUI();
                });
            });
        }
        updatePlaybackUI();
        const foc = modelManager?.focused();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, false, dur);
    });
}

export function updatePlaybackUI(): void {
    if (!mmdRuntime || !modelManager) {
        dom.playbackBar.style.display = "none";
        return;
    }
    const mmdModel = modelManager.focusedMmdModel();
    if (!mmdModel) {
        dom.playbackBar.style.display = "none";
        return;
    }
    const foc = modelManager.focused();
    const duration = foc?.animationDuration ?? mmdRuntime.animationDuration;
    dom.playbackBar.style.display = "flex";
    dom.btnPlayPause.textContent = isPlaying ? "⏸" : "▶";
    dom.btnLoopToggle.style.opacity = autoLoop ? "1" : "0.35";
    dom.timeDisplay.textContent = `${formatTime(mmdRuntime.currentTime)} / ${formatTime(duration)}`;
    if (duration > 0) {
        const pct = (mmdRuntime.currentTime / duration) * 100;
        dom.seekProgress.style.width = `${Math.min(pct, 100)}%`;
    }
}

export function seekFromEvent(e: MouseEvent | PointerEvent): void {
    if (!mmdRuntime || !modelManager) return;
    const foc = modelManager.focused();
    const duration = foc?.animationDuration ?? mmdRuntime.animationDuration;
    if (!modelManager.focusedMmdModel() || duration <= 0) return;
    const rect = dom.seekBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;
    mmdRuntime.seekAnimation(targetTime, true);
    updatePlaybackUI();
    syncAudioPlayback(targetTime, isPlaying, duration);
}
