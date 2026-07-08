// [doc:architecture] FullscreenOverlay — 全屏覆盖层组件
// 状态机：CLOSED → EMBEDDED_GRID → FULLSCREEN → EMBEDDED_GRID
// 所有关闭入口统一调用 closeFullscreen()

// ======== Types ========

export interface FullscreenOverlayOptions {
    /** 渲染内容的工厂函数 */
    renderContent: (container: HTMLElement) => void;
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

export type OverlayState = 'CLOSED' | 'EMBEDDED_GRID' | 'FULLSCREEN';

let currentState: OverlayState = 'CLOSED';
let currentOverlay: FullscreenOverlayHandle | null = null;
let slideMenuFrozen = false;
let frozenSlideMenuElement: HTMLElement | null = null;

// ======== State Transitions ========

export function openFullscreen(options: FullscreenOverlayOptions): FullscreenOverlayHandle {
    if (currentState !== 'EMBEDDED_GRID') {
        console.warn('[FullscreenOverlay] Cannot open: current state is', currentState);
        return { close: () => {}, getElement: () => document.createElement('div') };
    }

    // 创建全屏 Overlay
    const overlay = createOverlayElement(options);
    document.body.appendChild(overlay);

    // 冻结 SlideMenu
    freezeSlideMenu();

    currentOverlay = {
        close: () => closeFullscreen(),
        getElement: () => overlay,
    };
    currentState = 'FULLSCREEN';

    return currentOverlay;
}

export function closeFullscreen(): void {
    if (currentState !== 'FULLSCREEN') {
        return;
    }

    // 移除 Overlay
    if (currentOverlay) {
        const element = currentOverlay.getElement();
        element.remove();
        currentOverlay = null;
    }

    // 恢复 SlideMenu
    unfreezeSlideMenu();

    currentState = 'EMBEDDED_GRID';
}

export function getCurrentState(): OverlayState {
    return currentState;
}

export function setCurrentState(state: OverlayState): void {
    currentState = state;
}

// ======== SlideMenu Freeze/Unfreeze ========

function freezeSlideMenu(): void {
    // 找到 SlideMenu 容器并隐藏
    const slideMenuContainers = document.querySelectorAll('.slide-menu-container');
    slideMenuContainers.forEach((container) => {
        const el = container as HTMLElement;
        if (el.style.display !== 'none') {
            el.dataset.previousDisplay = el.style.display;
            el.style.display = 'none';
            slideMenuFrozen = true;
            frozenSlideMenuElement = el;
        }
    });
}

function unfreezeSlideMenu(): void {
    if (frozenSlideMenuElement) {
        const prevDisplay = frozenSlideMenuElement.dataset.previousDisplay || '';
        frozenSlideMenuElement.style.display = prevDisplay;
        frozenSlideMenuElement = null;
        slideMenuFrozen = false;
    }
}

// ======== Overlay Element Creation ========

function createOverlayElement(options: FullscreenOverlayOptions): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'fullscreen-overlay';
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: var(--bg-app, #1e1e28);
        display: flex;
        flex-direction: column;
        animation: fadeIn 0.2s ease-out;
    `;

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

    // 返回按钮
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-sm';
    backBtn.textContent = '←';
    backBtn.title = '返回';
    backBtn.addEventListener('click', () => {
        closeFullscreen();
        options.onBack();
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
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', () => {
        closeFullscreen();
        options.onBack();
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
    options.renderContent(content);

    overlay.appendChild(header);
    overlay.appendChild(content);

    // Escape 键关闭
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && currentState === 'FULLSCREEN') {
            closeFullscreen();
            options.onBack();
        }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Overlay 背景点击关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && currentState === 'FULLSCREEN') {
            closeFullscreen();
            options.onBack();
        }
    });

    // 清理事件监听
    const originalClose = currentOverlay?.close;
    if (originalClose) {
        const wrappedClose = () => {
            document.removeEventListener('keydown', handleKeyDown);
            originalClose();
        };
        currentOverlay = {
            close: wrappedClose,
            getElement: () => overlay,
        };
    }

    return overlay;
}

// ======== CSS Animation ========

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
