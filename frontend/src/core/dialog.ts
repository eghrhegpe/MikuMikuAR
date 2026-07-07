/**
 * @tag @dialog — 跨平台对话框（替换 window.prompt / window.confirm）
 *
 * 使用 CSS 模态框实现，不依赖原生 prompt/confirm，在 Android WebView
 * （无 WebChromeClient onJsPrompt 实现）和桌面上统一表现。
 *
 * 用法：
 *   const name = await showPrompt('输入名称', '默认值');
 *   if (name === null) return; // 用户取消
 *
 *   const ok = await showConfirm('确定删除吗？');
 *   if (!ok) return;
 */

import { t } from './i18n/t';

export interface DialogOptions {
    title: string;
    message?: string;
    /** Placeholder for prompt input. Default: '' */
    placeholder?: string;
    /** Default value for prompt input. Default: '' */
    defaultValue?: string;
    /** Confirm button label. Default: '确定' */
    confirmLabel?: string;
    /** Cancel button label. Default: '取消' */
    cancelLabel?: string;
    /** If true, shows a text input (prompt mode). Default: false */
    input?: boolean;
}

// Lazy-created singleton overlay
let _overlay: HTMLDivElement | null = null;

function getOverlay(): HTMLDivElement {
    if (_overlay) {
        return _overlay;
    }
    _overlay = document.createElement('div');
    _overlay.id = 'mmd-dialog-overlay';
    _overlay.innerHTML = `
        <div class="mmd-dialog" role="dialog" aria-modal="true">
            <div class="mmd-dialog-title"></div>
            <div class="mmd-dialog-message"></div>
            <input class="mmd-dialog-input" type="text" style="display:none" />
            <div class="mmd-dialog-actions">
                <button class="mmd-dialog-btn mmd-dialog-cancel"></button>
                <button class="mmd-dialog-btn mmd-dialog-confirm"></button>
            </div>
        </div>
    `;
    document.body.appendChild(_overlay);
    return _overlay;
}

function showDialog(opts: DialogOptions): Promise<string | boolean | null> {
    return new Promise((resolve) => {
        const overlay = getOverlay();
        const dialog = overlay.querySelector('.mmd-dialog') as HTMLElement;
        const titleEl = overlay.querySelector('.mmd-dialog-title') as HTMLElement;
        const msgEl = overlay.querySelector('.mmd-dialog-message') as HTMLElement;
        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        const confirmBtn = overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement;
        const cancelBtn = overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement;

        titleEl.textContent = opts.title;
        msgEl.textContent = opts.message ?? '';
        msgEl.style.display = opts.message ? '' : 'none';

        if (opts.input) {
            inputEl.style.display = '';
            inputEl.placeholder = opts.placeholder ?? '';
            inputEl.value = opts.defaultValue ?? '';
            inputEl.focus();
            inputEl.select();
        } else {
            inputEl.style.display = 'none';
            inputEl.value = '';
        }

        confirmBtn.textContent = opts.confirmLabel ?? t('dialog.confirm');
        cancelBtn.textContent = opts.cancelLabel ?? t('dialog.cancel');
        cancelBtn.style.display = opts.cancelLabel === '' ? 'none' : '';

        const cleanup = (result: string | boolean | null) => {
            overlay.classList.remove('mmd-dialog-visible');
            resolve(result);
        };

        const onConfirm = () => {
            if (opts.input) {
                cleanup(inputEl.value);
            } else {
                cleanup(true);
            }
        };

        const onCancel = () => {
            cleanup(opts.input ? null : false);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
                return;
            }
            if (e.key === 'Enter' && opts.input) {
                onConfirm();
                return;
            }
        };

        // Remove old listeners by cloning
        const newConfirm = confirmBtn.cloneNode(true) as HTMLButtonElement;
        const newCancel = cancelBtn.cloneNode(true) as HTMLButtonElement;
        confirmBtn.replaceWith(newConfirm);
        cancelBtn.replaceWith(newCancel);

        newConfirm.addEventListener('click', onConfirm);
        newCancel.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKeyDown, { once: true });

        // Click on backdrop closes
        overlay.addEventListener(
            'click',
            (e) => {
                if (e.target === overlay) {
                    onCancel();
                }
            },
            { once: true }
        );

        // Show with animation
        overlay.classList.add('mmd-dialog-visible');
        dialog.style.display = '';
    });
}

/**
 * Show an error dialog with a copy button.
 * The error message is displayed in a scrollable area, and the user can
 * copy the full message to clipboard with one click.
 */
export function showErrorAction(title: string, message: string): void {
    const overlay = getOverlay();
    const dialog = overlay.querySelector('.mmd-dialog') as HTMLElement;
    const titleEl = overlay.querySelector('.mmd-dialog-title') as HTMLElement;
    const msgEl = overlay.querySelector('.mmd-dialog-message') as HTMLElement;
    const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
    const confirmBtn = overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement;
    const cancelBtn = overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement;

    titleEl.textContent = title;
    msgEl.textContent = message;
    msgEl.style.display = '';
    msgEl.style.maxHeight = '200px';
    msgEl.style.overflowY = 'auto';
    msgEl.style.userSelect = 'text';
    msgEl.style.cursor = 'text';
    msgEl.style.fontSize = '12px';
    msgEl.style.fontFamily = 'monospace';
    msgEl.style.background = 'rgba(0,0,0,0.25)';
    msgEl.style.padding = '8px 10px';
    msgEl.style.borderRadius = '6px';
    msgEl.style.whiteSpace = 'pre-wrap';
    msgEl.style.wordBreak = 'break-all';
    inputEl.style.display = 'none';

    cancelBtn.textContent = t('dialog.close');
    confirmBtn.textContent = t('dialog.copy');

    const cleanup = () => {
        overlay.classList.remove('mmd-dialog-visible');
    };

    const onCopy = () => {
        navigator.clipboard
            .writeText(message)
            .then(() => {
                confirmBtn.textContent = t('dialog.copied');
                setTimeout(() => {
                    confirmBtn.textContent = t('dialog.copy');
                }, 1500);
            })
            .catch(() => {
                // fallback: select the message text
                const range = document.createRange();
                range.selectNodeContents(msgEl);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            });
    };

    const onClose = () => {
        cleanup();
    };

    // Clone to remove old listeners
    const newConfirm = confirmBtn.cloneNode(true) as HTMLButtonElement;
    const newCancel = cancelBtn.cloneNode(true) as HTMLButtonElement;
    confirmBtn.replaceWith(newConfirm);
    cancelBtn.replaceWith(newCancel);

    newConfirm.addEventListener('click', onCopy);
    newCancel.addEventListener('click', onClose);
    document.addEventListener(
        'keydown',
        (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        },
        { once: true }
    );
    overlay.addEventListener(
        'click',
        (e) => {
            if (e.target === overlay) {
                onClose();
            }
        },
        { once: true }
    );

    overlay.classList.add('mmd-dialog-visible');
    dialog.style.display = '';
}

/** Show a confirmation dialog. Returns true if confirmed, false if cancelled. */
export function showConfirm(
    message: string,
    title = '确认',
    confirmLabel = '确定',
    cancelLabel = '取消'
): Promise<boolean> {
    return showDialog({
        title,
        message,
        confirmLabel,
        cancelLabel,
        input: false,
    }) as Promise<boolean>;
}

/** Show a prompt dialog. Returns the input string, or null if cancelled. */
export function showPrompt(
    message: string,
    defaultValue = '',
    title = t('dialog.inputTitle'),
    placeholder = '',
    confirmLabel = t('dialog.confirm'),
    cancelLabel = t('dialog.cancel')
): Promise<string | null> {
    return showDialog({
        title,
        message,
        defaultValue,
        placeholder,
        confirmLabel,
        cancelLabel,
        input: true,
    }) as Promise<string | null>;
}
