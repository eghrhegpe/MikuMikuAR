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

/**
 * 通过 cloneNode + replaceWith 移除按钮旧监听器，再挂新监听器。
 * 消除 showDialog / showErrorAction / showPrompt2 三份重复。
 */
function _replaceButtonListeners(
    confirmBtn: HTMLButtonElement,
    cancelBtn: HTMLButtonElement,
    onConfirm: () => void,
    onCancel: () => void
): void {
    const newConfirm = confirmBtn.cloneNode(true) as HTMLButtonElement;
    const newCancel = cancelBtn.cloneNode(true) as HTMLButtonElement;
    confirmBtn.replaceWith(newConfirm);
    cancelBtn.replaceWith(newCancel);
    newConfirm.addEventListener('click', onConfirm);
    newCancel.addEventListener('click', onCancel);
}

function showDialog(opts: DialogOptions): Promise<string | boolean | null> {
    return new Promise((resolve) => {
        const overlay = getOverlay();
        // 清除前一次可能残留的 inline style，让 CSS class 重新生效
        overlay.style.pointerEvents = '';
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
            // 隐藏后恢复 pointer-events 为 CSS 默认值
            overlay.style.pointerEvents = '';
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
        _replaceButtonListeners(confirmBtn, cancelBtn, onConfirm, onCancel);
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
    _replaceButtonListeners(confirmBtn, cancelBtn, onCopy, onClose);
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
    title = t('dialog.confirmTitle'),
    confirmLabel = t('dialog.confirm'),
    cancelLabel = t('dialog.cancel')
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

// ===================================================================
// showPrompt2 — 双字段输入对话框（替代连续两次 showPrompt）
// ===================================================================

export interface Prompt2Options {
    title: string;
    label1: string;
    placeholder1?: string;
    defaultValue1?: string;
    label2: string;
    placeholder2?: string;
    defaultValue2?: string;
    confirmLabel?: string;
    cancelLabel?: string;
}

let _overlay2: HTMLDivElement | null = null;

function getOverlay2(): HTMLDivElement {
    if (_overlay2) {
        return _overlay2;
    }
    _overlay2 = document.createElement('div');
    _overlay2.id = 'mmd-dialog-overlay-2';
    _overlay2.innerHTML = `
        <div class="mmd-dialog" role="dialog" aria-modal="true">
            <div class="mmd-dialog-title"></div>
            <div class="mmd-dialog-2fields">
                <div class="mmd-dialog-field">
                    <label class="mmd-dialog-field-label"></label>
                    <input class="mmd-dialog-input" type="text" />
                </div>
                <div class="mmd-dialog-field">
                    <label class="mmd-dialog-field-label"></label>
                    <input class="mmd-dialog-input" type="text" />
                </div>
            </div>
            <div class="mmd-dialog-actions">
                <button class="mmd-dialog-btn mmd-dialog-cancel"></button>
                <button class="mmd-dialog-btn mmd-dialog-confirm"></button>
            </div>
        </div>
    `;
    document.body.appendChild(_overlay2);
    return _overlay2;
}

/** 移除 showPrompt2 创建的 overlay2 DOM（供 HMR 清理入口调用）。 */
export function disposeOverlay2(): void {
    if (_overlay2) {
        _overlay2.remove();
        _overlay2 = null;
    }
}

/**
 * 双字段输入对话框。返回 [value1, value2] 或 null（取消）。
 * 替代连续两次 showPrompt，用户一次交互完成。
 */
export function showPrompt2(opts: Prompt2Options): Promise<[string, string] | null> {
    return new Promise((resolve) => {
        const overlay = getOverlay2();
        const dialog = overlay.querySelector('.mmd-dialog') as HTMLElement;
        const titleEl = overlay.querySelector('.mmd-dialog-title') as HTMLElement;
        const fields = overlay.querySelectorAll<HTMLInputElement>('.mmd-dialog-input');
        const labels = overlay.querySelectorAll<HTMLLabelElement>('.mmd-dialog-field-label');
        const confirmBtn = overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement;
        const cancelBtn = overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement;

        titleEl.textContent = opts.title;
        labels[0].textContent = opts.label1;
        labels[0].htmlFor = 'mmd-dlg-input-0';
        fields[0].id = 'mmd-dlg-input-0';
        fields[0].placeholder = opts.placeholder1 ?? '';
        fields[0].value = opts.defaultValue1 ?? '';
        labels[1].textContent = opts.label2;
        labels[1].htmlFor = 'mmd-dlg-input-1';
        fields[1].id = 'mmd-dlg-input-1';
        fields[1].placeholder = opts.placeholder2 ?? '';
        fields[1].value = opts.defaultValue2 ?? '';

        confirmBtn.textContent = opts.confirmLabel ?? t('dialog.confirm');
        cancelBtn.textContent = opts.cancelLabel ?? t('dialog.cancel');

        const cleanup = (result: [string, string] | null) => {
            overlay.classList.remove('mmd-dialog-visible');
            resolve(result);
        };

        const onConfirm = () => cleanup([fields[0].value, fields[1].value]);
        const onCancel = () => cleanup(null);

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
                return;
            }
            if (e.key === 'Enter') {
                onConfirm();
                return;
            }
        };

        _replaceButtonListeners(confirmBtn, cancelBtn, onConfirm, onCancel);
        document.addEventListener('keydown', onKeyDown, { once: true });
        overlay.addEventListener(
            'click',
            (e) => {
                if (e.target === overlay) {
                    onCancel();
                }
            },
            { once: true }
        );

        overlay.classList.add('mmd-dialog-visible');
        dialog.style.display = '';
        fields[0].focus();
    });
}
