// [doc:architecture] Menu overlay & wrapper management.
// Extracted from @/core/utils as part of ADR-191 de-barreling.
// Depends on DOM and popup state, so it lives in the menus subsystem rather than core.

import { dom } from '@/core/dom';
import { setPopupOpen } from '@/core/state';
// [doc:adr-238] 注册关闭全部弹窗行为供 core 快捷键层经桥调用（切断 core→menus 反向边）
import { registerUiAction } from '@/core/ui-action-bridge';

let _onCloseAllOverlays: (() => void) | null = null;
const _extraCloseAllOverlays = new Set<() => void>();

export function setOnCloseAllOverlays(fn: (() => void) | null): void {
    _onCloseAllOverlays = fn;
}

/** 追加注册关闭回调（不覆盖主回调，供面板化拖拽卸载等场景用） */
export function addOnCloseAllOverlays(fn: () => void): void {
    _extraCloseAllOverlays.add(fn);
}

/** Close all visible overlays, reset popup state, and invoke the registered callbacks. */
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
    _extraCloseAllOverlays.forEach((fn) => fn());
    // [fix ADR-252] 关闭全部弹窗时同步回收 menu wrapper 注册表，避免 wrapper DOM 与条目常驻内存。
    clearAllMenuWrappers();
}

// [doc:adr-238] 模块加载即注册（menu-overlay 在菜单系统初始化早期必被加载）
registerUiAction('closeAllOverlays', () => {
    closeAllOverlays();
});

// [fix ADR-252] HMR dispose：模块被替换重求值前回收 wrapper 注册表，避免 HMR
// 重跑时新求值的函数操作旧残留 DOM 条目，或旧条目永久驻留。
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        clearAllMenuWrappers();
    });
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
