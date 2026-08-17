import { t } from './i18n/t';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export type ToastVariant = 'error' | 'info';

const MAX_VISIBLE_TOASTS = 5;
let _toastIdCounter = 0;
const _activeToasts: Array<{
    id: number;
    el: HTMLElement;
    timer: ReturnType<typeof setTimeout> | null;
    fadeTimer: ReturnType<typeof setTimeout> | null;
    variant: ToastVariant;
}> = [];

function getToastContainer(): HTMLElement {
    let container = document.getElementById('mmk-toast-container');
    if (container) {
        return container;
    }
    container = document.createElement('div');
    container.id = 'mmk-toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    container.style.cssText = [
        'position:fixed;top:64px;left:50%;transform:translateX(-50%)',
        'display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999',
        'pointer-events:none',
        'max-width:calc(min(80vw,420px));width:max-content',
    ].join(';');
    document.body.appendChild(container);
    return container;
}

function removeToast(id: number): void {
    const idx = _activeToasts.findIndex((t) => t.id === id);
    if (idx === -1) {
        return;
    }
    const entry = _activeToasts[idx];
    if (entry.fadeTimer) {
        clearTimeout(entry.fadeTimer);
    }
    if (entry.timer !== null) {
        clearTimeout(entry.timer);
    }
    if (entry.el.parentNode) {
        entry.el.remove();
    }
    _activeToasts.splice(idx, 1);
    _syncToastAriaLive();
}

/** 根据剩余 toast 中是否有 error 来切换容器 aria-live */
function _syncToastAriaLive(): void {
    const container = document.getElementById('mmk-toast-container');
    if (!container) {
        return;
    }
    const hasError = _activeToasts.some((t) => t.variant === 'error');
    if (hasError) {
        container.setAttribute('role', 'alert');
        container.setAttribute('aria-live', 'assertive');
    } else {
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
    }
}

function fadeAndRemoveToast(id: number, el: HTMLElement, fadeDuration = 300): void {
    const entry = _activeToasts.find((t) => t.id === id);
    if (!entry) {
        return;
    }
    if (entry.timer !== null) {
        clearTimeout(entry.timer);
    }
    if (entry.fadeTimer) {
        clearTimeout(entry.fadeTimer);
    }
    entry.fadeTimer = setTimeout(() => {
        if (el.parentNode) {
            el.style.transition = `opacity ${fadeDuration}ms ease,transform ${fadeDuration}ms ease`;
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px) scale(0.97)';
            setTimeout(() => removeToast(id), fadeDuration);
        }
    }, 50);
}

function buildToastElement(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    toastId?: number,
    variant: ToastVariant = 'error'
): HTMLElement {
    const toast = document.createElement('div');
    const borderVar = variant === 'info' ? 'var(--toast-border-info)' : 'var(--toast-border-error)';
    toast.style.cssText = [
        'pointer-events:auto',
        'background:var(--bg-scene)',
        `border:1px solid ${borderVar};border-radius:8px`,
        'padding:8px 14px;display:flex;align-items:flex-start;gap:10px',
        'font-size:var(--font-ui);box-shadow:var(--toast-shadow)',
        'width:100%;backdrop-filter:blur(8px)',
        'transition:opacity 0.3s ease,transform 0.3s ease',
    ].join(';');

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';

    const titleEl = document.createElement('div');
    titleEl.style.cssText =
        'font-weight:600;color:var(--text-bright);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (detail) {
        const detailEl = document.createElement('div');
        detailEl.style.cssText =
            'color:var(--text-dim);font-size:var(--font-ui-sm);word-break:break-all;line-height:1.3';
        detailEl.textContent = detail;
        body.appendChild(detailEl);
    }
    toast.appendChild(body);

    const actionsEl = document.createElement('div');
    actionsEl.style.cssText =
        'display:flex;gap:6px;flex-shrink:0;align-items:flex-start;padding-top:2px';

    if (detail) {
        const copyText = `${title}\n${detail}`;
        const copyBtn = document.createElement('button');
        copyBtn.textContent = t('toast.copy');
        copyBtn.style.cssText =
            'padding:3px 10px;border:none;border-radius:4px;font-size:var(--font-ui-sm);cursor:pointer;' +
            'background:var(--white-08);color:var(--text)';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(copyText);
                // [fix] await 期间 toast 可能已被移除，检查 isConnected 防止操作孤儿节点
                if (!copyBtn.isConnected) {
                    return;
                }
                copyBtn.textContent = t('toast.copied');
                setTimeout(() => {
                    if (copyBtn.isConnected) {
                        copyBtn.textContent = t('toast.copy');
                    }
                }, 1500);
            } catch {
                // clipboard API 可能不可用（需用户手势 / Android WebView 限制）
                showErrorToast(t('motion.clipboardUnavailable'));
            }
        });
        actionsEl.appendChild(copyBtn);
    }

    if (actions) {
        for (const act of actions) {
            const btn = document.createElement('button');
            btn.textContent = act.label;
            btn.style.cssText =
                'padding:3px 10px;border:none;border-radius:4px;font-size:var(--font-ui-sm);' +
                'cursor:pointer;background:var(--accent);color:var(--text-bright)';
            btn.addEventListener('click', () => {
                act.onClick();
                if (toastId != null) {
                    removeToast(toastId);
                }
            });
            actionsEl.appendChild(btn);
        }
    }

    // [audit:round16 P2] close 用原生 button（可 Tab 聚焦 + Enter/Space 键盘激活），
    // 而非 span+aria-label——键盘用户与屏幕阅读器均可操作（ADR-153 Phase 3.1 补全）。
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', t('common.close'));
    closeBtn.style.cssText =
        'font-size:11px;color:var(--text-dim);cursor:pointer;padding:2px 4px;line-height:1;' +
        'background:none;border:none';
    closeBtn.addEventListener('click', () => {
        if (toastId != null) {
            fadeAndRemoveToast(toastId, toast, 150);
        }
    });
    actionsEl.appendChild(closeBtn);

    toast.appendChild(actionsEl);
    return toast;
}

export function showToast(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    duration = 8000,
    variant: ToastVariant = 'error'
): void {
    if (typeof document === 'undefined') {
        // 无 document 环境（headless 测试/启动早期）静默降级，不抛错冒泡到调用方（round-12 P2）
        console.warn(`[toast] 跳过 toast（无 document）：${title}`);
        return;
    }
    while (_activeToasts.length >= MAX_VISIBLE_TOASTS) {
        const oldest = _activeToasts[0];
        if (oldest) {
            // 同步移除最旧 toast，避免 fadeAndRemoveToast 异步导致死循环
            removeToast(oldest.id);
        } else {
            break;
        }
    }

    const id = ++_toastIdCounter;
    const el = buildToastElement(title, detail, actions, id, variant);
    const container = getToastContainer();

    // ADR-153: 错误 toast 用 assertive 打断屏幕阅读器
    if (variant === 'error') {
        container.setAttribute('role', 'alert');
        container.setAttribute('aria-live', 'assertive');
    }

    container.appendChild(el);

    const timer = setTimeout(() => {
        fadeAndRemoveToast(id, el);
    }, duration);

    _activeToasts.push({ id, el, timer, fadeTimer: null, variant });
}

export function showErrorToast(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    duration = 8000
): void {
    showToast(title, detail, actions, duration, 'error');
}

export function showInfoToast(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    duration = 3000
): void {
    showToast(title, detail, actions, duration, 'info');
}

// [audit:round16 P2] 测试专用重置钩子：清空模块级 _activeToasts 状态与定时器，
// 供单测 beforeEach 隔离用例（生产零调用）。此前测试靠 removeToast 幂等性偶然通过。
export function _resetToastForTest(): void {
    for (const entry of _activeToasts) {
        if (entry.timer !== null) {
            clearTimeout(entry.timer);
        }
        if (entry.fadeTimer) {
            clearTimeout(entry.fadeTimer);
        }
    }
    _activeToasts.length = 0;
    _toastIdCounter = 0;
}
