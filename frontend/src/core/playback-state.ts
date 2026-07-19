/**
 * [doc:architecture] Playback control store — ADR-141 split from core/state.ts.
 * 状态访问规约见 scene-state.ts 头部注释（单一写入点 + 禁止直接赋值 export let）。
 */

// ======== Playback State ========

export let isPlaying = false;
export function setIsPlaying(v: boolean): void {
    isPlaying = v;
}

export let autoLoop = true;
export function setAutoLoop(v: boolean): void {
    autoLoop = v;
}

// ======== Seek ========

export let seekDragging = false;
export function setSeekDragging(v: boolean): void {
    seekDragging = v;
}
