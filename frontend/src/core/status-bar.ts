import { dom } from './dom';
import { addDisposableListener } from './dom';
import { uiState } from './state';
import { t } from './i18n/t';

let hintActive = false;
let savedStatusText = '';
let savedStatusColor = '';
let _statusTimer: ReturnType<typeof setTimeout> | null = null;
const _hintDisposables: { dispose(): void }[] = [];

/**
 * 按 statusText 是否有内容切换 #statusBar 显隐。
 * 修复：文本淡出置空后，#statusBar 仍带背景/内边距残留空黑框的问题。
 * 同步写入 display 不破坏 .ui-hidden #statusBar{display:none!important} 的优先级。
 */
function syncStatusBarVisibility(): void {
    if (!dom.statusBar || !dom.statusText) {
        return;
    }
    const hasContent = (dom.statusText.textContent || '').trim().length > 0;
    dom.statusBar.style.display = hasContent ? 'flex' : 'none';
}

/**
 * 按 uiState 开关应用顶部 HUD 显隐：帧率时钟（#fpsClock）与多线程徽标（#runtimeBadge）。
 * undefined/null/true → 显示；false → 隐藏。在 restoreUIState 之后与设置开关 onChange 中调用。
 */
export function applyHudVisibility(): void {
    if (dom.fpsClock) {
        dom.fpsClock.style.display = uiState.showFpsClock !== false ? '' : 'none';
    }
    if (dom.runtimeBadge) {
        dom.runtimeBadge.style.display = uiState.showRuntimeBadge !== false ? '' : 'none';
    }
}

export function setStatus(text: string, ok: boolean, hold = false): void {
    if (!dom.statusText) {
        return;
    }

    if (_statusTimer) {
        clearTimeout(_statusTimer);
        _statusTimer = null;
    }

    if (hintActive) {
        savedStatusText = text;
        savedStatusColor = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
        return;
    }

    dom.statusText.textContent = text;
    dom.statusText.style.color = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
    dom.statusText.style.opacity = '1';
    syncStatusBarVisibility();

    if (!hold) {
        const delay = ok ? 2000 : 5000;
        _statusTimer = setTimeout(() => {
            dom.statusText.style.transition = 'opacity 0.5s ease';
            dom.statusText.style.opacity = '0';
            _statusTimer = setTimeout(() => {
                dom.statusText.textContent = '';
                dom.statusText.style.transition = '';
                dom.statusText.style.opacity = '1';
                syncStatusBarVisibility();
            }, 500);
        }, delay);
    }
}

export function showHint(text: string): void {
    if (!dom.statusText) {
        return;
    }
    if (!hintActive) {
        savedStatusText = dom.statusText.textContent || '';
        savedStatusColor = dom.statusText.style.color || '';
    }
    hintActive = true;
    dom.statusText.textContent = text;
    dom.statusText.style.color = 'rgba(255,255,255,0.4)';
    dom.statusText.style.opacity = '1';
    syncStatusBarVisibility();
}

export function hideHint(): void {
    hintActive = false;
    if (!dom.statusText) {
        return;
    }
    dom.statusText.textContent = savedStatusText;
    dom.statusText.style.color = savedStatusColor;
    dom.statusText.style.opacity = '1';
    syncStatusBarVisibility();
}

/** 清理 status 定时器（供 HMR 清理入口调用）。 */
export function disposeStatusBar(): void {
    if (_statusTimer) {
        clearTimeout(_statusTimer);
        _statusTimer = null;
    }
    for (const d of _hintDisposables) {
        d.dispose();
    }
    _hintDisposables.length = 0;
}

export function initHints(): void {
    document.querySelectorAll('[data-hint]').forEach((el) => {
        _hintDisposables.push(
            addDisposableListener(el, 'mouseenter', () => {
                showHint(el.getAttribute('data-hint') || t('menu.noHint'));
            })
        );
        _hintDisposables.push(addDisposableListener(el, 'mouseleave', () => hideHint()));
    });
}
