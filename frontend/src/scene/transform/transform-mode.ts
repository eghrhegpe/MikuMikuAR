import { scheduleRefresh } from '@/core/reactivity';

let _dragModeEnabled = false;

export function isDragModeEnabled(): boolean {
    return _dragModeEnabled;
}

export function setDragModeEnabled(enabled: boolean): void {
    if (_dragModeEnabled === enabled) {
        return;
    }
    _dragModeEnabled = enabled;
    scheduleRefresh();
}

export function toggleDragMode(): void {
    setDragModeEnabled(!_dragModeEnabled);
}
