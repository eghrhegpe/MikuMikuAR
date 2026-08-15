// [doc:architecture] FullscreenOverlay — 全屏覆盖层组件
// 状态机：CLOSED → FULLSCREEN → CLOSED
// 所有关闭入口统一调用 closeFullscreen()，onBack 由 closeFullscreen 统一触发一次

import { logWarn } from './logger';
import { addDisposableListener } from './dom';
import { createFocusTrap } from './ui-focus-trap';
import { createKeyboardNav } from './ui-keyboard-nav';
import { t } from './i18n/t';

// 用 WeakMap 存储 overlay 清理函数，避免 DOM 属性污染
const _cleanupMap = new WeakMap<HTMLElement, () => void>();

// ======== Types ========

export interface FullscreenOverlayOptions {
    /** 渲染内容的工厂函数；navigate 可用于在全屏内跳转到新内容 */
    renderContent: (
        container: HTMLElement,
        navigate: (title: string, render: (c: HTMLElement) => void) => void
    ) => void;
    /** 标题 */
    title: string;
    /** 返回回调 */
    onBack: () => void;
}

export interface FullscreenOverlayHandle {
    /** 关闭全屏 */
    close: () => void;
    /** 获取容器元素 */
    getElement: () => HTMLElement;
}

// ======== State Machine ========

export type OverlayState = 'CLOSED' | 'FULLSCREEN';

let currentState: OverlayState = 'CLOSED';
let currentOverlay: FullscreenOverlayHandle | null = null;
let currentOnBack: (() => void) | null = null;
let frozenSlideMenuElements: HTMLElement[] = [];
let _trapRestore: (() => void) | null = null;

// ======== State Transitions ========

export function openFullscreen(options: FullscreenOverlayOptions): FullscreenOverlayHandle {
    if (currentState !== 'CLOSED') {
        logWarn('FullscreenOverlay', `Cannot open: current state is ${currentState}`);
        return { close: () => {}, getElement: () => document.createElement('div') };
    }

    // 创建全屏 Overlay
    const overlay = createOverlayElement(options);
    document.body.appendChild(overlay);

    // 冻结 SlideMenu
    freezeSlideMenu();

    currentOnBack = options.onBack;
    currentOverlay = {
        close: () => closeFullscreen(),
        getElement: () => overlay,
    };
    currentState = 'FULLSCREEN';
    _trapRestore = createFocusTrap({ container: overlay, onEscape: closeFullscreen });

    return currentOverlay;
}

export function closeFullscreen(): void {
    if (currentState !== 'FULLSCREEN') {
        return;
    }

    const onBack = currentOnBack;
    currentOnBack = null;

    // 移除 Overlay 并清理事件监听
    _trapRestore?.();
    _trapRestore = null;
    if (currentOverlay) {
        const element = currentOverlay.getElement();
        const cleanup = _cleanupMap.get(element);
        if (cleanup) {
            cleanup();
            _cleanupMap.delete(element);
        }
        element.remove();
        currentOverlay = null;
    }

    // 恢复 SlideMenu
    unfreezeSlideMenu();

    currentState = 'CLOSED';
    onBack?.();
}

export function getCurrentState(): OverlayState {
    return currentState;
}

export function setCurrentState(state: OverlayState): void {
    currentState = state;
}

// ======== SlideMenu Freeze/Unfreeze ========

function freezeSlideMenu(): void {
    // 找到 SlideMenu 容器并隐藏（真实菜单根类为 .slide-menu，见 menus/menu.ts）
    const slideMenus = document.querySelectorAll<HTMLElement>('.slide-menu');
    slideMenus.forEach((el) => {
        if (el.style.display !== 'none') {
            el.dataset.previousDisplay = el.style.display;
            el.style.display = 'none';
            frozenSlideMenuElements.push(el);
        }
    });
}

function unfreezeSlideMenu(): void {
    for (const el of frozenSlideMenuElements) {
        const prevDisplay = el.dataset.previousDisplay || '';
        el.style.display = prevDisplay;
        delete el.dataset.previousDisplay;
    }
    frozenSlideMenuElements = [];
}

// ======== Overlay Element Creation ========

function createOverlayElement(options: FullscreenOverlayOptions): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(18, 18, 26, 0.55);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        display: flex;
        flex-direction: column;
        animation: fadeIn 0.2s ease-out;
    `;

    // 内部导航栈（存父级 render 闭包，返回时重新渲染父级而非子级）
    const navStack: { title: string; render: (c: HTMLElement) => void }[] = [];
    let currentRender: (c: HTMLElement) => void = () => {};

    // 顶部栏
    const header = document.createElement('div');
    header.className = 'fullscreen-header';
    header.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--white-06);
        background: var(--card-bg);
    `;

    // 返回按钮 — 有导航历史时弹栈，否则关闭全屏
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-sm';
    backBtn.textContent = '←';
    backBtn.title = '返回';
    backBtn.addEventListener('click', () => {
        if (navStack.length > 0) {
            const prev = navStack.pop()!;
            titleEl.textContent = prev.title;
            content.innerHTML = '';
            currentRender = prev.render;
            prev.render(content);
        } else {
            closeFullscreen();
        }
    });

    // 标题
    const titleEl = document.createElement('span');
    titleEl.style.cssText = `
        flex: 1;
        font-size: var(--font-title);
        color: var(--text);
    `;
    titleEl.textContent = options.title;

    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost btn-sm';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', t('common.close'));
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', () => {
        closeFullscreen();
    });

    header.appendChild(backBtn);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // 内容区
    const content = document.createElement('div');
    content.className = 'fullscreen-content';
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 16px;
    `;

    // navigate 回调 — 在全屏内跳转到新内容（将当前 render 压栈，返回时恢复）
    const navigate = (newTitle: string, newRender: (c: HTMLElement) => void) => {
        navStack.push({ title: titleEl.textContent || '', render: currentRender });
        titleEl.textContent = newTitle;
        content.innerHTML = '';
        currentRender = newRender;
        newRender(content);
    };

    currentRender = (c) => options.renderContent(c, navigate);
    currentRender(content);

    overlay.appendChild(header);
    overlay.appendChild(content);

    // 键盘导航：Escape 关闭，方向键聚焦，Enter 选择
    const handleKeyDown = (e: KeyboardEvent) => {
        if (currentState !== 'FULLSCREEN') {
            return;
        }
        if (e.key === 'Escape') {
            cleanup();
            closeFullscreen();
            return;
        }
    };
    const escapeDisp = addDisposableListener(document, 'keydown', handleKeyDown);

    // ADR-153: 键盘导航（Arrow 键 + Enter 激活资源卡片）
    const keyNavDisp = createKeyboardNav(content, {
        selector: '.resource-card, .resource-row',
    });

    // Overlay 背景点击关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && currentState === 'FULLSCREEN') {
            cleanup();
            closeFullscreen();
        }
    });

    // 清理函数
    const cleanup = () => {
        escapeDisp.dispose();
        keyNavDisp.dispose();
    };

    // 将 cleanup 存入 WeakMap，供外部调用
    _cleanupMap.set(overlay, cleanup);

    return overlay;
}

// ======== CSS Animation ========

// [fix:test-env] 顶层 DOM 副作用守卫：node 环境（@vitest-environment node 测试）
// 无 document，跳过 CSS 注入（仅渲染语义，测试不渲染无影响）；happy-dom/浏览器照常。
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}
