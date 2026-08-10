// [doc:architecture] DOM element references for MikuMikuAR.
// Extracted from config.ts — pure DOM refs, zero runtime logic.

import { t } from './i18n/t';

// [fix:test-env] node 环境（@vitest-environment node 测试）无 document，顶层引用
// 改惰性兜底：真实浏览器/happy-dom 行为与原先完全一致（加载时取一次引用），
// node 下各引用为 null——依赖 dom 的消费方（status-bar 等）在 node 测试里不被
// 调用，null 无害。保持属性可写，test helpers（model-preset-helpers）的注入赋值照常。
const _doc = typeof document !== 'undefined' ? document : null;

export const dom = {
    canvas: _doc?.getElementById('renderCanvas') as HTMLCanvasElement,
    statusBar: _doc?.getElementById('statusBar') as HTMLElement,
    statusText: _doc?.getElementById('statusText') as HTMLElement,
    fpsClock: _doc?.getElementById('fpsClock') as HTMLElement,
    runtimeBadge: _doc?.getElementById('runtimeBadge') as HTMLElement,
    loadingEl: _doc?.getElementById('loading') as HTMLElement,
    btnMainAction: _doc?.getElementById('btnMainAction') as HTMLButtonElement,
    btnMotionPopup: _doc?.getElementById('btnMotionPopup') as HTMLButtonElement,
    playbackBar: _doc?.getElementById('playbackBar') as HTMLElement,
    btnPlayPause: _doc?.getElementById('btnPlayPause') as HTMLButtonElement,
    btnLoopToggle: _doc?.getElementById('btnLoopToggle') as HTMLButtonElement,
    timeDisplay: _doc?.getElementById('timeDisplay') as HTMLElement,
    seekBar: _doc?.getElementById('seekBar') as HTMLElement,
    seekProgress: _doc?.getElementById('seekProgress') as HTMLElement,
    loadingText: _doc?.getElementById('loadingText') as HTMLElement,
    btnSettings: _doc?.getElementById('btnSettings') as HTMLButtonElement,
    btnScene: _doc?.getElementById('btnScene') as HTMLButtonElement,
    btnEnv: _doc?.getElementById('btnEnv') as HTMLButtonElement,
    btnAssistant: _doc?.getElementById('btnAssistant') as HTMLButtonElement,
    btnPlaza: _doc?.getElementById('btnPlaza') as HTMLButtonElement,
    sceneOverlay: _doc?.getElementById('sceneOverlay') as HTMLElement,
    webviewLayer: _doc?.getElementById('webviewLayer') as HTMLElement,

    /** 引擎就绪后调用：隐藏 loading 遮罩，显示主应用 UI */
    showApp(): void {
        this.loadingText.textContent = t('boot.engineReady');
        // 短暂显示"就绪"再隐藏，让用户感知切换
        setTimeout(() => {
            this.loadingEl.style.display = 'none';
            // 解除加载态镂空：AI/广场按钮恢复常态层级（app.css body.app-booting）
            document.body.classList.remove('app-booting');
            this.canvas.style.visibility = 'visible';
            this.playbackBar.style.pointerEvents = 'auto';
            this.statusText.textContent = t('boot.readyHint');
            this.statusBar.style.display = 'flex';
        }, 150);
    },

    /** 引擎初始化失败时调用：保留遮罩，显示错误信息 */
    showError(msg: string): void {
        // 初始化失败仍解除镂空态，让用户能点 AI 诊断/广场自救（二者不依赖 3D 场景）
        document.body.classList.remove('app-booting');
        this.loadingEl.style.pointerEvents = 'auto';
        this.loadingText.textContent = t('boot.initFailed', { msg });
        this.loadingEl.style.background = 'linear-gradient(135deg, #2d1a1a 0%, #1a1a2e 100%)';
    },
};

// [doc:adr-102] Type alias for the `dom` singleton, so split modules (events.ts etc.)
// can declare a `DomRefs` parameter without reaching for `any` (prevents 模式 #3).
export type DomRefs = typeof dom;

// [doc:adr-101] P2: Disposable pattern for event listener cleanup
export interface Disposable {
    dispose(): void;
}

/**
 * 添加事件监听器并返回 Disposable，便于在 dispose 链路中统一释放。
 * 与手动 addEventListener/removeEventListener 相比，确保配对不遗漏。
 */
export function addDisposableListener(
    el: EventTarget,
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions
): Disposable {
    el.addEventListener(event, handler, options);
    return {
        dispose(): void {
            el.removeEventListener(event, handler, options);
        },
    };
}
