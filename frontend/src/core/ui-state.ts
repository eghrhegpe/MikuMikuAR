/**
 * [doc:architecture] UI persistent store — ADR-141 split from core/state.ts.
 * 状态访问规约见 scene-state.ts 头部注释（单一写入点 + 禁止直接赋值 export let）。
 */

import type { UIState } from './types';

// ======== Popup State ========

export let popupOpen = false;
export function setPopupOpen(v: boolean): void {
    popupOpen = v;
}

// ======== UI State ========

export const uiState: UIState = {};

/** 持久化回调。由 env-bridge.ts 在初始化时注册，避免循环依赖。 */
let _uiPersistCb: (() => void) | null = null;
export function setUIPersistCallback(cb: () => void): void {
    _uiPersistCb = cb;
}

export function setUIState(state: UIState): void {
    Object.assign(uiState, state);
    try {
        _uiPersistCb?.();
    } catch (e) {
        // [audit:P3] 持久化回调异常不应阻塞 UI 状态更新
        console.error('[ui-state] persist callback error:', e);
    }
}

// ======== UI 派生记忆态 ========

/** 当前选中的 time-of-day 预设 key。预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享同一状态。 */
export let activeTimeOfDayPreset = 'noon';
export function setActiveTimeOfDayPreset(v: string): void {
    activeTimeOfDayPreset = v;
}
