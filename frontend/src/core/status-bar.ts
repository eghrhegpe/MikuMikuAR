import { dom } from './dom';
import { addDisposableListener } from './dom';
import { uiState } from './state';
import { t } from './i18n/t';
import { updateMmarStatus, type MmarPhase } from './mmar-globals';

let hintActive = false;
let savedStatusText = '';
let savedStatusColor = '';
let _statusTimer: ReturnType<typeof setTimeout> | null = null;
let _statusFadeTimer: ReturnType<typeof setTimeout> | null = null; // [audit:P3] 内层淡出 timer
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

export function setStatus(text: string, ok: boolean, hold = false, mmarPhase?: MmarPhase): void {
    if (!dom.statusText) {
        return;
    }

    // ADR-153: 状态栏文本变化时屏幕阅读器可感知
    if (!dom.statusText.hasAttribute('role')) {
        dom.statusText.setAttribute('role', 'status');
        dom.statusText.setAttribute('aria-live', 'polite');
    }

    if (_statusTimer) {
        clearTimeout(_statusTimer);
        _statusTimer = null;
    }
    if (_statusFadeTimer) {
        clearTimeout(_statusFadeTimer); // [audit:P3] 新状态到来时取消未完成的淡出
        _statusFadeTimer = null;
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
            _statusFadeTimer = setTimeout(() => {
                _statusFadeTimer = null;
                dom.statusText.textContent = '';
                dom.statusText.style.transition = '';
                dom.statusText.style.opacity = '1';
                syncStatusBarVisibility();
            }, 500);
        }, delay);
    }

    // 同步更新 __mmar.status（LLM 可读）
    updateMmarStatus(mmarPhase ?? (ok ? 'idle' : 'error'), text);
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
    if (_statusFadeTimer) {
        clearTimeout(_statusFadeTimer);
        _statusFadeTimer = null;
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

// ======== 加载状态旋转图标（底部状态栏） ========

/** 注入 status-spin CSS keyframes（仅首次调用时） */
let _statusSpinInjected = false;

function _ensureStatusSpinStyle(): void {
    if (_statusSpinInjected) return;
    _statusSpinInjected = true;
    const style = document.createElement('style');
    style.textContent = '@keyframes status-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
}

let _loadingSpinner: HTMLElement | null = null;

function _getOrCreateSpinner(): HTMLElement {
    if (!_loadingSpinner) {
        _loadingSpinner = document.createElement('span');
        _loadingSpinner.id = 'statusLoadingSpinner';
        _loadingSpinner.style.cssText = 'display:none;flex-shrink:0;width:14px;height:14px;margin-right:6px';
        _loadingSpinner.innerHTML = [
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none"',
            '  stroke="currentColor" stroke-width="2.5" stroke-linecap="round"',
            '  stroke-linejoin="round"',
            '  style="animation:status-spin 1s linear infinite">',
            '  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
            '  <path d="M21 3v5h-5"/>',
            '</svg>',
        ].join('');
        _ensureStatusSpinStyle();
        // 插入到 statusText 前面
        if (dom.statusBar && dom.statusText) {
            dom.statusBar.insertBefore(_loadingSpinner, dom.statusText);
        }
    }
    return _loadingSpinner;
}

/**
 * 在底部状态栏显示带旋转图标的加载文本，用于消解用户"卡住焦虑"。
 * hold=true 时不自动淡出，需调用 hideLoadingStatus() 或新的 setStatus() 清除。
 * 内部调用 setStatus(text, false, hold) 设置白色文本。
 */
export function setLoadingStatus(text: string, hold = true): void {
    const spinner = _getOrCreateSpinner();
    spinner.style.display = '';
    // 直接声明 loading 态为 scanning，避免 setStatus 因 ok=false 误写 error 后再覆盖的双写
    setStatus(text, false, hold, 'scanning');
}

/**
 * 隐藏底部状态栏的旋转加载图标，不改变当前文本。
 * 文本由 setStatus 的自动淡出机制或后续调用清除。
 */
export function hideLoadingStatus(): void {
    if (_loadingSpinner) {
        _loadingSpinner.style.display = 'none';
    }
}
