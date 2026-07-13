// [doc:architecture] DOM element references for MikuMikuAR.
// Extracted from config.ts — pure DOM refs, zero runtime logic.

import { t } from './i18n/t';

export const dom = {
    canvas: document.getElementById('renderCanvas') as HTMLCanvasElement,
    statusBar: document.getElementById('statusBar') as HTMLElement,
    statusText: document.getElementById('statusText') as HTMLElement,
    fpsClock: document.getElementById('fpsClock') as HTMLElement,
    loadingEl: document.getElementById('loading') as HTMLElement,
    btnMainAction: document.getElementById('btnMainAction') as HTMLButtonElement,
    btnMotionPopup: document.getElementById('btnMotionPopup') as HTMLButtonElement,
    playbackBar: document.getElementById('playbackBar') as HTMLElement,
    btnPlayPause: document.getElementById('btnPlayPause') as HTMLButtonElement,
    btnLoopToggle: document.getElementById('btnLoopToggle') as HTMLButtonElement,
    timeDisplay: document.getElementById('timeDisplay') as HTMLElement,
    seekBar: document.getElementById('seekBar') as HTMLElement,
    seekProgress: document.getElementById('seekProgress') as HTMLElement,
    loadingText: document.getElementById('loadingText') as HTMLElement,
    btnSettings: document.getElementById('btnSettings') as HTMLButtonElement,
    btnScene: document.getElementById('btnScene') as HTMLButtonElement,
    btnEnv: document.getElementById('btnEnv') as HTMLButtonElement,
    btnPlaza: document.getElementById('btnPlaza') as HTMLButtonElement,
    sceneOverlay: document.getElementById('sceneOverlay') as HTMLElement,
    webviewLayer: document.getElementById('webviewLayer') as HTMLElement,

    /** 引擎就绪后调用：隐藏 loading 遮罩，显示主应用 UI */
    showApp(): void {
        this.loadingText.textContent = t('boot.engineReady');
        // 短暂显示"就绪"再隐藏，让用户感知切换
        setTimeout(() => {
            this.loadingEl.style.display = 'none';
            this.canvas.style.visibility = 'visible';
            this.playbackBar.style.pointerEvents = 'auto';
            this.statusText.textContent = t('boot.readyHint');
        }, 150);
    },

    /** 引擎初始化失败时调用：保留遮罩，显示错误信息 */
    showError(msg: string): void {
        this.loadingEl.style.pointerEvents = 'auto';
        this.loadingText.textContent = t('boot.initFailed', { msg });
        this.loadingEl.style.background = 'linear-gradient(135deg, #2d1a1a 0%, #1a1a2e 100%)';
    },
};

// [doc:adr-102] Type alias for the `dom` singleton, so split modules (events.ts etc.)
// can declare a `DomRefs` parameter without reaching for `any` (prevents 模式 #3).
export type DomRefs = typeof dom;
