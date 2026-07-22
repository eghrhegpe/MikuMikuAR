import { scheduleRefresh } from '@/core/reactivity';

const STORAGE_KEY = 'miku.dragModeEnabled';

let _dragModeEnabled = localStorage.getItem(STORAGE_KEY) === '1';

export function isDragModeEnabled(): boolean {
    return _dragModeEnabled;
}

export function setDragModeEnabled(enabled: boolean): void {
    if (_dragModeEnabled === enabled) {
        return;
    }
    _dragModeEnabled = enabled;
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    scheduleRefresh();
}

export function toggleDragMode(): void {
    setDragModeEnabled(!_dragModeEnabled);
}
