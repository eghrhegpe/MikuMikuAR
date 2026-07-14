import { t } from './i18n/t';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

const MAX_VISIBLE_TOASTS = 5;
const _TOAST_GAP = 8;
let _toastIdCounter = 0;
const _activeToasts: Array<{
    id: number;
    el: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    fadeTimer: ReturnType<typeof setTimeout> | null;
}> = [];

function getToastContainer(): HTMLElement {
    let container = document.getElementById('mmk-toast-container');
    if (container) {
        return container;
    }
    container = document.createElement('div');
    container.id = 'mmk-toast-container';
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
    clearTimeout(entry.timer);
    if (entry.el.parentNode) {
        entry.el.remove();
    }
    _activeToasts.splice(idx, 1);
}

function fadeAndRemoveToast(id: number, el: HTMLElement, fadeDuration = 300): void {
    const entry = _activeToasts.find((t) => t.id === id);
    if (!entry) {
        return;
    }
    clearTimeout(entry.timer);
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
    toastId?: number
): HTMLElement {
    const toast = document.createElement('div');
    toast.style.cssText = [
        'pointer-events:auto',
        'background:var(--bg-scene)',
        'border:1px solid rgba(255,80,80,0.3);border-radius:8px',
        'padding:8px 14px;display:flex;align-items:flex-start;gap:10px',
        'font-size:var(--font-ui);box-shadow:0 2px 16px rgba(0,0,0,0.4)',
        'width:100%;backdrop-filter:blur(8px)',
        'transition:opacity 0.3s ease,transform 0.3s ease',
    ].join(';');

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight:600;color:var(--text-bright);margin-bottom:2px';
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
                copyBtn.textContent = t('toast.copied');
                setTimeout(() => {
                    copyBtn.textContent = t('toast.copy');
                }, 1500);
            } catch {
                // clipboard unavailable — silently ignore
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
                'cursor:pointer;background:var(--accent);color:#fff';
            btn.addEventListener('click', () => {
                act.onClick();
                if (toastId != null) {
                    removeToast(toastId);
                }
            });
            actionsEl.appendChild(btn);
        }
    }

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
        'font-size:11px;color:var(--text-dim);cursor:pointer;padding:2px 4px;line-height:1';
    closeBtn.addEventListener('click', () => {
        if (toastId != null) {
            fadeAndRemoveToast(toastId, toast, 150);
        }
    });
    actionsEl.appendChild(closeBtn);

    toast.appendChild(actionsEl);
    return toast;
}

export function showErrorToast(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    duration = 8000
): void {
    while (_activeToasts.length >= MAX_VISIBLE_TOASTS) {
        const oldest = _activeToasts[0];
        if (oldest) {
            fadeAndRemoveToast(oldest.id, oldest.el, 150);
        } else {
            break;
        }
    }

    const id = ++_toastIdCounter;
    const el = buildToastElement(title, detail, actions, id);
    const container = getToastContainer();
    container.appendChild(el);

    const timer = setTimeout(() => {
        fadeAndRemoveToast(id, el);
    }, duration);

    _activeToasts.push({ id, el, timer, fadeTimer: null });
}
