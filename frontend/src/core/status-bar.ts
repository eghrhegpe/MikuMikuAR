import { dom } from './dom';

let hintActive = false;
let savedStatusText = '';
let savedStatusColor = '';
let _statusTimer: ReturnType<typeof setTimeout> | null = null;

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

    if (!hold) {
        const delay = ok ? 2000 : 5000;
        _statusTimer = setTimeout(() => {
            dom.statusText.style.transition = 'opacity 0.5s ease';
            dom.statusText.style.opacity = '0';
            _statusTimer = setTimeout(() => {
                dom.statusText.textContent = '';
                dom.statusText.style.transition = '';
                dom.statusText.style.opacity = '1';
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
}

export function hideHint(): void {
    hintActive = false;
    if (!dom.statusText) {
        return;
    }
    dom.statusText.textContent = savedStatusText;
    dom.statusText.style.color = savedStatusColor;
    dom.statusText.style.opacity = '1';
}

export function initHints(): void {
    document.querySelectorAll('[data-hint]').forEach((el) => {
        el.addEventListener('mouseenter', () => {
            showHint(el.getAttribute('data-hint') || '暂无提示');
        });
        el.addEventListener('mouseleave', () => hideHint());
    });
}
