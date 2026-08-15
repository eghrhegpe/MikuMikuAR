import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { showConfirm, showPrompt, showPrompt2, disposeOverlay2 } from '../core/dialog';
import { bundles } from '../core/i18n/t';
import { zhCN } from '../core/i18n/locales/zh-CN';

// [doc:perf] 语言包改为运行时加载，测试环境直接预填缓存
beforeAll(() => {
    bundles['zh-CN'] = zhCN;
});

function getOverlay(id = 'mmd-dialog-overlay'): HTMLElement {
    return document.getElementById(id)!;
}

beforeEach(() => {
    let app = document.getElementById('app');
    if (!app) {
        app = document.createElement('div');
        app.id = 'app';
        document.body.prepend(app);
    }
    app.innerHTML = '<button id="dialog-trigger">Open</button>';
    app.removeAttribute('inert');
    (document.getElementById('dialog-trigger') as HTMLButtonElement).focus();
});

async function dismissVisibleDialog(overlay: HTMLElement): Promise<void> {
    const cancel = overlay.querySelector<HTMLButtonElement>('.mmd-dialog-cancel');
    const confirm = overlay.querySelector<HTMLButtonElement>('.mmd-dialog-confirm');
    if (cancel && cancel.style.display !== 'none') {
        cancel.click();
    } else if (confirm) {
        confirm.click();
    }
    await Promise.resolve();
}

afterEach(async () => {
    // 若用例在关闭弹窗前失败，先点掉所有可见对话框并 flush 队列，避免
    // `_dialogActive`/`_pendingDialogs` 残留污染后续用例。
    for (let i = 0; i < 10; i++) {
        const overlay = document.getElementById('mmd-dialog-overlay');
        const overlay2 = document.getElementById('mmd-dialog-overlay-2');
        const visible = [overlay, overlay2].find(
            (el): el is HTMLElement => !!el?.classList.contains('mmd-dialog-visible')
        );
        if (!visible) {
            break;
        }
        await dismissVisibleDialog(visible);
    }

    // 清理可见态和 inert，避免跨用例污染；overlay 本身由 dialog 模块单例复用，
    // 不可整体移除（移除后模块内引用会指向脱离 DOM 的元素）。
    document.getElementById('app')?.removeAttribute('inert');
    for (const id of ['mmd-dialog-overlay', 'mmd-dialog-overlay-2']) {
        const overlay = document.getElementById(id);
        if (overlay) {
            overlay.classList.remove('mmd-dialog-visible');
            overlay.removeAttribute('inert');
            overlay.style.pointerEvents = '';
        }
    }
});

describe('showConfirm', () => {
    it('creates overlay with correct structure and default labels', async () => {
        const promise = showConfirm('Are you sure?');
        const overlay = getOverlay();
        expect(overlay.classList.contains('mmd-dialog-visible')).toBe(true);

        const titleEl = overlay.querySelector('.mmd-dialog-title');
        expect(titleEl!.textContent).toBe('确认');

        const msgEl = overlay.querySelector('.mmd-dialog-message');
        expect(msgEl!.textContent).toBe('Are you sure?');
        expect((msgEl as HTMLElement).style.display).not.toBe('none');

        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        expect(inputEl.style.display).toBe('none');

        expect(overlay.querySelector('.mmd-dialog-confirm')!.textContent).toBe('确定');
        expect(overlay.querySelector('.mmd-dialog-cancel')!.textContent).toBe('取消');

        // Resolve promise to end test cleanly
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        await promise;
    });

    it('confirm button resolves with true', async () => {
        const promise = showConfirm('test');
        const overlay = getOverlay();
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe(true);
    });

    it('cancel button resolves with false', async () => {
        const promise = showConfirm('test');
        const overlay = getOverlay();
        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await promise).toBe(false);
    });

    it('pressing Escape resolves with false', async () => {
        const promise = showConfirm('test');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await promise).toBe(false);
    });

    it('custom labels are applied correctly', async () => {
        const promise = showConfirm('custom msg', '警告', '是', '否');
        const overlay = getOverlay();
        expect(overlay.querySelector('.mmd-dialog-title')!.textContent).toBe('警告');
        expect(overlay.querySelector('.mmd-dialog-confirm')!.textContent).toBe('是');
        expect(overlay.querySelector('.mmd-dialog-cancel')!.textContent).toBe('否');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe(true);
    });

    it('backdrop click resolves with false', async () => {
        const promise = showConfirm('test');
        const overlay = getOverlay();
        overlay.click();
        expect(await promise).toBe(false);
    });

    it('empty cancel label hides cancel button', async () => {
        const promise = showConfirm('test', undefined, '确定', '');
        const overlay = getOverlay();
        expect((overlay.querySelector('.mmd-dialog-cancel') as HTMLElement).style.display).toBe(
            'none'
        );
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe(true);
    });

    it('modal has dialog aria attributes and freezes background', async () => {
        const trigger = document.getElementById('dialog-trigger') as HTMLButtonElement;
        const promise = showConfirm('test');
        const overlay = getOverlay();
        const dialog = overlay.querySelector('.mmd-dialog') as HTMLElement;
        const titleEl = overlay.querySelector('.mmd-dialog-title') as HTMLElement;

        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('mmd-dialog-title');
        expect(titleEl.id).toBe('mmd-dialog-title');
        expect(document.getElementById('app')!.hasAttribute('inert')).toBe(true);

        // 打开后焦点应移入对话框（确认按钮），不能停留在已 inert 的背景触发按钮上
        expect(document.activeElement).toBe(
            overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement
        );

        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        await promise;

        // 关闭后恢复背景可交互，焦点回到触发按钮
        expect(document.getElementById('app')!.hasAttribute('inert')).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    it('concurrent showConfirm calls are queued FIFO and both resolve', async () => {
        const first = showConfirm('first');
        const second = showConfirm('second');
        const overlay = getOverlay();

        // 队列期间仍只有一个可见对话框，第二次调用不能覆盖第一次
        expect(overlay.querySelector('.mmd-dialog-message')!.textContent).toBe('first');

        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await first).toBe(false);

        // 第一个关闭后第二个自动弹出
        expect(overlay.querySelector('.mmd-dialog-message')!.textContent).toBe('second');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await second).toBe(true);
    });
});

describe('showPrompt', () => {
    it('creates overlay with input field visible', async () => {
        const promise = showPrompt('Enter name:');
        const overlay = getOverlay();
        expect(overlay.classList.contains('mmd-dialog-visible')).toBe(true);

        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        expect(inputEl.style.display).not.toBe('none');
        expect(inputEl.type).toBe('text');

        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        await promise;
    });

    it('pressing Enter resolves with input value', async () => {
        const promise = showPrompt('Enter name:', 'Miku');
        const inputEl = getOverlay().querySelector('.mmd-dialog-input') as HTMLInputElement;
        inputEl.value = '初音ミク';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(await promise).toBe('初音ミク');
    });

    it('pressing Escape resolves with null', async () => {
        const promise = showPrompt('Enter name:');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(await promise).toBeNull();
    });

    it('cancel button resolves with null', async () => {
        const promise = showPrompt('Enter name:');
        const overlay = getOverlay();
        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await promise).toBeNull();
    });

    it('default value and placeholder are set correctly', async () => {
        const promise = showPrompt('Name:', 'DefaultName', '输入', 'Your name here...');
        const overlay = getOverlay();
        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        expect(inputEl.value).toBe('DefaultName');
        expect(inputEl.placeholder).toBe('Your name here...');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe('DefaultName');
    });

    it('moves focus into the input after the overlay is visible and restores it', async () => {
        const trigger = document.getElementById('dialog-trigger') as HTMLButtonElement;
        const promise = showPrompt('Name:', 'Miku');
        const inputEl = getOverlay().querySelector('.mmd-dialog-input') as HTMLInputElement;

        expect(document.activeElement).toBe(inputEl);

        inputEl.value = 'restored';
        (getOverlay().querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe('restored');
        expect(document.activeElement).toBe(trigger);
    });
});

describe('showPrompt2', () => {
    it('creates dual-field overlay with labels, values, and first input focused', async () => {
        const promise = showPrompt2({
            title: 'Mapping',
            label1: 'Pattern',
            placeholder1: 'regex',
            defaultValue1: 'a',
            label2: 'Category',
            placeholder2: 'cat',
            defaultValue2: 'b',
        });
        const overlay = getOverlay('mmd-dialog-overlay-2');
        expect(overlay.classList.contains('mmd-dialog-visible')).toBe(true);

        const inputs = overlay.querySelectorAll<HTMLInputElement>('.mmd-dialog-input');
        const labels = overlay.querySelectorAll('.mmd-dialog-field-label');
        expect(inputs.length).toBe(2);
        expect(labels[0].textContent).toBe('Pattern');
        expect(labels[1].textContent).toBe('Category');
        expect(inputs[0].value).toBe('a');
        expect(inputs[1].value).toBe('b');
        expect(inputs[0].placeholder).toBe('regex');
        expect(inputs[1].placeholder).toBe('cat');
        expect(document.activeElement).toBe(inputs[0]);

        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toEqual(['a', 'b']);
    });

    it('concurrent showPrompt2 calls are queued FIFO and both resolve', async () => {
        const first = showPrompt2({
            title: 'first',
            label1: 'a',
            label2: 'b',
            defaultValue1: 'a1',
            defaultValue2: 'b1',
        });
        const second = showPrompt2({
            title: 'second',
            label1: 'c',
            label2: 'd',
            defaultValue1: 'c1',
            defaultValue2: 'd1',
        });
        const overlay = getOverlay('mmd-dialog-overlay-2');

        expect(overlay.querySelector('.mmd-dialog-title')!.textContent).toBe('first');

        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await first).toBeNull();

        expect(overlay.querySelector('.mmd-dialog-title')!.textContent).toBe('second');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await second).toEqual(['c1', 'd1']);
    });

    it('disposeOverlay2 while open resolves the active promise and removes the overlay', async () => {
        const promise = showPrompt2({
            title: 'dispose',
            label1: 'a',
            label2: 'b',
            defaultValue1: 'x',
            defaultValue2: 'y',
        });
        expect(getOverlay('mmd-dialog-overlay-2').classList.contains('mmd-dialog-visible')).toBe(
            true
        );

        disposeOverlay2();

        await expect(promise).resolves.toBeNull();
        expect(document.getElementById('mmd-dialog-overlay-2')).toBeNull();
    });
});

describe('dialog lifecycle cleanup', () => {
    it('double-closing showPrompt2 must not unfreeze an outer showConfirm background', async () => {
        const outer = showConfirm('outer');
        const app = document.getElementById('app')!;
        expect(app.hasAttribute('inert')).toBe(true);

        const inner = showPrompt2({ title: 'inner', label1: 'a', label2: 'b' });
        expect(app.hasAttribute('inert')).toBe(true);

        // 连续两次触发同一个取消按钮（或 keydown 双路径），cleanup 必须幂等
        const overlay2 = getOverlay('mmd-dialog-overlay-2');
        const cancelBtn = overlay2.querySelector('.mmd-dialog-cancel') as HTMLButtonElement;
        cancelBtn.click();
        cancelBtn.click();
        expect(await inner).toBeNull();

        // 外层 showConfirm 仍打开，背景必须继续 inert
        expect(app.hasAttribute('inert')).toBe(true);

        (getOverlay().querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await outer).toBe(false);
        expect(app.hasAttribute('inert')).toBe(false);
    });

    it('closing hides the overlay and removes the inert attribute from it', async () => {
        const promise = showConfirm('test');
        const overlay = getOverlay();
        const confirmBtn = overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement;

        expect(overlay.hasAttribute('inert')).toBe(false);
        confirmBtn.click();
        await promise;

        expect(overlay.classList.contains('mmd-dialog-visible')).toBe(false);
        expect(overlay.hasAttribute('inert')).toBe(true);
    });
});
