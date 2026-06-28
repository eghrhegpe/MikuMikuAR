// [doc:architecture] ScenePlayback — 播放控制 UI 子模块
// 职责: 从 scene.ts 拆出的播放进度 UI / seek 逻辑
// 注意: import modelManager 来自 scene.ts 但仅在函数体运行时访问，
//       ES module live binding 保证此时 scene.ts 已初始化完毕。

import { modelManager } from "./scene";
import { dom, isPlaying, autoLoop, formatTime, mmdRuntime } from "../core/config";
import { syncAudioPlayback } from "../outfit/audio";

export function updatePlaybackUI(): void {
    const mmdModel = modelManager.focusedMmdModel();
    if (!mmdRuntime || !mmdModel) {
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
    const foc = modelManager.focused();
    const duration = foc?.animationDuration ?? mmdRuntime!.animationDuration;
    if (!mmdRuntime || !modelManager.focusedMmdModel() || duration <= 0) return;
    const rect = dom.seekBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;
    mmdRuntime.seekAnimation(targetTime, true);
    updatePlaybackUI();
    syncAudioPlayback(targetTime, isPlaying, duration);
}
