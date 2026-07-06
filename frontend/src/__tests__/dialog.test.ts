import { describe, it, expect, afterEach } from 'vitest';
import { showConfirm, showPrompt } from '../core/dialog';

describe('showConfirm', () => {
    afterEach(() => {
        // Reset overlay visibility between tests
        const overlay = document.getElementById('mmd-dialog-overlay');
        if (overlay) {
            overlay.classList.remove('mmd-dialog-visible');
        }
    });

    it('creates overlay with correct structure and default labels', async () => {
        const promise = showConfirm('Are you sure?');
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        expect(overlay).not.toBeNull();
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
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe(true);
    });

    it('cancel button resolves with false', async () => {
        const promise = showConfirm('test');
        const overlay = document.getElementById('mmd-dialog-overlay')!;
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
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        expect(overlay.querySelector('.mmd-dialog-title')!.textContent).toBe('警告');
        expect(overlay.querySelector('.mmd-dialog-confirm')!.textContent).toBe('是');
        expect(overlay.querySelector('.mmd-dialog-cancel')!.textContent).toBe('否');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe(true);
    });

    it('backdrop click resolves with false', async () => {
        const promise = showConfirm('test');
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        overlay.click();
        expect(await promise).toBe(false);
    });
});

describe('showPrompt', () => {
    afterEach(() => {
        const overlay = document.getElementById('mmd-dialog-overlay');
        if (overlay) {
            overlay.classList.remove('mmd-dialog-visible');
        }
    });

    it('creates overlay with input field visible', async () => {
        const promise = showPrompt('Enter name:');
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        expect(overlay.classList.contains('mmd-dialog-visible')).toBe(true);

        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        expect(inputEl.style.display).not.toBe('none');
        expect(inputEl.type).toBe('text');

        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        await promise;
    });

    it('pressing Enter resolves with input value', async () => {
        const promise = showPrompt('Enter name:', 'Miku');
        const inputEl = document
            .getElementById('mmd-dialog-overlay')!
            .querySelector('.mmd-dialog-input') as HTMLInputElement;
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
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        (overlay.querySelector('.mmd-dialog-cancel') as HTMLButtonElement).click();
        expect(await promise).toBeNull();
    });

    it('default value and placeholder are set correctly', async () => {
        const promise = showPrompt('Name:', 'DefaultName', '输入', 'Your name here...');
        const overlay = document.getElementById('mmd-dialog-overlay')!;
        const inputEl = overlay.querySelector('.mmd-dialog-input') as HTMLInputElement;
        expect(inputEl.value).toBe('DefaultName');
        expect(inputEl.placeholder).toBe('Your name here...');
        (overlay.querySelector('.mmd-dialog-confirm') as HTMLButtonElement).click();
        expect(await promise).toBe('DefaultName');
    });
});
