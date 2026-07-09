// [doc:menu-architecture] Menu Factory — 统一弹窗入口工厂
// 将 4 个 showXxxMenu 的模板代码（class 清理 / dataset / 复用 / reset）压缩为 1 行调用
// 参见 docs/menu-architecture.md §「showXxxMenu 入口模式」

import { dom, closeAllOverlays, getMenuWrapper, PopupLevel, PopupRow } from '../core/config';
import { SlideMenu } from './menu';

/** 不含 container/onClose 的菜单回调（由工厂统一注入） */
export interface PopupMenuHandlers {
    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    extraButtonFactory?: () => HTMLElement[];
}

/** 注册式菜单配置——工厂内部维护引用，返回 handle */
export interface RegisteredPopupMenuConfig {
    /** wrapper DOM id（传给 getMenuWrapper） */
    wrapperKey: string;
    /** dataset.popupType 值 */
    popupType: string;
    /** 额外 overlay class（如 'sceneOverlay-settings' / 'sceneOverlay-motion'） */
    overlayClass?: string;
    /** 根级构建器 */
    buildRoot: () => PopupLevel;
    /** 根级 items 构建器（用于 refreshRoot） */
    buildRootItems?: () => PopupRow[];
    /** 业务回调 */
    handlers: PopupMenuHandlers;
    /**
     * 每次 show 时调用的副作用钩子（如注册全局引用）。
     * 每次 show 都会调用——因为 onClose 可能清空引用。
     */
    onShow?: (menu: SlideMenu) => void;
    /**
     * 关闭前的副作用钩子（如清空全局引用）。
     * 在 closeAllOverlays() 之前调用。
     */
    onClose?: () => void;
}

/** 注册后的菜单句柄——提供 get/refresh 能力 */
export interface PopupMenuHandle {
    /** 获取当前菜单实例（可能为 null） */
    getMenu: () => SlideMenu | null;
    /** 重新计算根级 items 并触发 reRender */
    refreshRoot: () => void;
    /** 显示菜单（内部调用 showPopupMenu） */
    show: () => void;
}

/**
 * 注册弹窗菜单——工厂内部维护引用，返回统一的 handle。
 *
 * 相比 showPopupMenu，此模式：
 * 1. 内部维护 menu 引用，不需要调用方声明 let xxxMenu
 * 2. 返回 getMenu/refreshRoot，所有菜单统一暴露能力
 * 3. onClose 时自动清空引用
 *
 * @example
 * const { getMenu, refreshRoot, show } = registerPopupMenu({
 *     wrapperKey: 'settings-menu',
 *     popupType: 'settings',
 *     buildRoot: buildSettingsRoot,
 *     buildRootItems: buildSettingsRootItems,
 *     handlers: { onItemClick, onFolderEnter },
 * });
 * export { getMenu as getSettingsMenu, refreshRoot as refreshSettingsRoot };
 */
export function registerPopupMenu(config: RegisteredPopupMenuConfig): PopupMenuHandle {
    let menu: SlideMenu | null = null;

    const getMenu = (): SlideMenu | null => menu;

    const refreshRoot = (): void => {
        if (!menu) {
            return;
        }
        const root = menu.getLevel(0);
        if (root && config.buildRootItems) {
            root.items = config.buildRootItems();
            menu.reRender();
        }
    };

    const show = (): void => {
        // 清理所有 overlay 类型 class，避免共享 #sceneOverlay 的 class 残留导致样式串台
        Array.from(dom.sceneOverlay.classList).forEach((c) => {
            if (c.startsWith('sceneOverlay-')) dom.sceneOverlay.classList.remove(c);
        });
        if (config.overlayClass) {
            dom.sceneOverlay.classList.add(config.overlayClass);
        }
        dom.sceneOverlay.dataset.popupType = config.popupType;

        const wrapper = getMenuWrapper(config.wrapperKey);
        if (menu) {
            config.onShow?.(menu);
            menu.resetToRoot();
            menu.reRender();
            return;
        }

        const newMenu = new SlideMenu({
            container: wrapper,
            onClose: () => {
                config.onClose?.();
                newMenu.dispose();
                menu = null;
                closeAllOverlays();
            },
            onItemClick: config.handlers.onItemClick,
            onFolderEnter: config.handlers.onFolderEnter,
            onHover: config.handlers.onHover,
            onAfterRender: config.handlers.onAfterRender,
            extraButtonFactory: config.handlers.extraButtonFactory,
        });
        // 覆写 dispose：确保无论通过何种路径 dispose，menu 引用都会被清空
        const _origDispose = newMenu.dispose.bind(newMenu);
        newMenu.dispose = () => {
            _origDispose();
            menu = null;
        };
        menu = newMenu;
        config.onShow?.(menu);
        // [doc:adr-065] 根层自动挂 itemBuilder，使纯 items 根层随语言热刷新
        const rootLevel = config.buildRoot();
        if (config.buildRootItems) {
            rootLevel.itemBuilder = config.buildRootItems;
        }
        menu.reset(rootLevel);
    };

    return { getMenu, refreshRoot, show };
}

/**
 * 轻量级弹窗入口：适用于不需要注册 handle 的一次性场景。
 * 调用方自行维护菜单引用。
 */
export interface PopupMenuConfig {
    getMenu: () => SlideMenu | null;
    setMenu: (m: SlideMenu | null) => void;
    wrapperKey: string;
    popupType: string;
    overlayClass?: string;
    buildRoot: () => PopupLevel;
    /** 根级 items 构建器（用于 [doc:adr-065] 根层语言热刷新） */
    buildRootItems?: () => PopupRow[];
    handlers: PopupMenuHandlers;
    onShow?: (menu: SlideMenu) => void;
    onClose?: () => void;
}

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
            menu.dispose();
            config.setMenu(null);
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
    // [doc:adr-065] 根层自动挂 itemBuilder，使纯 items 根层随语言热刷新
    const rootLevel = config.buildRoot();
    if (config.buildRootItems) {
        rootLevel.itemBuilder = config.buildRootItems;
    }
    menu.reset(rootLevel);
}
