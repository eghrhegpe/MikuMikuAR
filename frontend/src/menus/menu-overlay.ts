// [doc:architecture] Menu overlay & wrapper management.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Depends on DOM and popup state, so it lives in the menus subsystem rather than core.

import { dom } from '@/core/dom';
import { setPopupOpen } from '@/core/state';

let _onCloseAllOverlays: (() => void) | null = null;

export function setOnCloseAllOverlays(fn: (() => void) | null): void {
    _onCloseAllOverlays = fn;
}

/** Close all visible overlays, reset popup state, and invoke the registered callback. */
export function closeAllOverlays(): void {
    document.querySelectorAll<HTMLElement>('[data-overlay].visible').forEach((el) => {
        el.classList.remove('visible', 'overlay-fade-out');
        el.inert = true; // 关闭时从 Tab 顺序中移除，防止 AI/键盘聚焦到不可见元素
    });
    setPopupOpen(false);
    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        btn.setAttribute('aria-expanded', 'false');
    });
    // 关闭可能残留的弹窗对话框（menu 关闭时 dialog 未自动隐藏）
    const dialogOverlay = document.getElementById('mmd-dialog-overlay');
    if (dialogOverlay) {
        dialogOverlay.classList.remove('mmd-dialog-visible');
        dialogOverlay.style.pointerEvents = '';
    }
    _onCloseAllOverlays?.();
}

const _menuWrapperRegistry = new Map<string, HTMLElement>();

export function getMenuWrapper(menuId: string): HTMLElement {
    let wrapper = _menuWrapperRegistry.get(menuId);
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'menu-wrapper';
        wrapper.dataset.menuId = menuId;
        dom.sceneOverlay.appendChild(wrapper);
        _menuWrapperRegistry.set(menuId, wrapper);
    }
    for (const [id, w] of _menuWrapperRegistry) {
        (w as HTMLElement).style.display = id === menuId ? '' : 'none';
    }
    return wrapper;
}

export function disposeMenuWrapper(menuId: string): void {
    const wrapper = _menuWrapperRegistry.get(menuId);
    if (wrapper) {
        wrapper.remove();
        _menuWrapperRegistry.delete(menuId);
    }
}

export function clearAllMenuWrappers(): void {
    for (const [id] of _menuWrapperRegistry) {
        disposeMenuWrapper(id);
    }
}
