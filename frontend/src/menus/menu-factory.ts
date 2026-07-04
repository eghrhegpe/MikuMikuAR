// [doc:menu-architecture] Menu Factory — 统一弹窗入口工厂
// 将 4 个 showXxxMenu 的模板代码（class 清理 / dataset / 复用 / reset）压缩为 1 行调用
// 参见 docs/menu-architecture.md §「showXxxMenu 入口模式」

import {
    dom,
    closeAllOverlays,
    getMenuWrapper,
    PopupLevel,
    PopupRow,
} from '../core/config';
import { SlideMenu } from './menu';

/** 不含 container/onClose 的菜单回调（由工厂统一注入） */
export interface PopupMenuHandlers {
    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    extraButtonFactory?: () => HTMLElement[];
}

export interface PopupMenuConfig {
    /** 菜单引用 getter（返回当前实例或 null） */
    getMenu: () => SlideMenu | null;
    /** 菜单引用 setter（首次创建时注入新实例） */
    setMenu: (m: SlideMenu | null) => void;
    /** wrapper DOM id（传给 getMenuWrapper） */
    wrapperKey: string;
    /** dataset.popupType 值 */
    popupType: string;
    /** 额外 overlay class（如 'sceneOverlay-settings' / 'sceneOverlay-motion'） */
    overlayClass?: string;
    /** 根级构建器 */
    buildRoot: () => PopupLevel;
    /** 业务回调 */
    handlers: PopupMenuHandlers;
    /**
     * 实例创建后的副作用钩子（如 settings 用来注册 window.__getSettingsMenuPush 等全局引用）。
     * 每次 show 都会调用——因为 onClose 可能清空引用，需要在每次显示时重新注册。
     */
    onShow?: (menu: SlideMenu) => void;
    /**
     * 关闭前的副作用钩子（如 settings 用来清空 window 全局引用）。
     * 在 closeAllOverlays() 之前调用。
     */
    onClose?: () => void;
}

/**
 * 统一弹窗入口：替代各 showXxxMenu 中 16~60 行的模板代码。
 *
 * 模板流程：
 * 1. 清理 dom.sceneOverlay 的 class，加 overlayClass（可选），设 dataset.popupType
 * 2. 取 wrapper；若菜单已存在 → resetToRoot + reRender + onShow，返回
 * 3. 否则 new SlideMenu → setMenu 注入 → onShow → reset(buildRoot())
 */
export function showPopupMenu(config: PopupMenuConfig): void {
    dom.sceneOverlay.classList.remove(
        'sceneOverlay-model',
        'sceneOverlay-motion',
        'sceneOverlay-settings'
    );
    if (config.overlayClass) {
        dom.sceneOverlay.classList.add(config.overlayClass);
    }
    dom.sceneOverlay.dataset.popupType = config.popupType;

    const wrapper = getMenuWrapper(config.wrapperKey);
    const existing = config.getMenu();
    if (existing) {
        config.onShow?.(existing);
        existing.resetToRoot();
        existing.reRender();
        return;
    }

    const menu = new SlideMenu({
        container: wrapper,
        onClose: () => {
            config.onClose?.();
            closeAllOverlays();
        },
        onItemClick: config.handlers.onItemClick,
        onFolderEnter: config.handlers.onFolderEnter,
        onHover: config.handlers.onHover,
        onAfterRender: config.handlers.onAfterRender,
        extraButtonFactory: config.handlers.extraButtonFactory,
    });
    config.setMenu(menu);
    config.onShow?.(menu);
    menu.reset(config.buildRoot());
}
