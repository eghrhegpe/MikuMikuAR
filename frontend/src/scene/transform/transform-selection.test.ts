import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    attachGizmoForKind: vi.fn(),
    detachGizmo: vi.fn(),
    isDragModeEnabled: vi.fn(),
}));

vi.mock('./transform-adapter', () => ({
    attachGizmoForKind: mocks.attachGizmoForKind,
    detachGizmo: mocks.detachGizmo,
}));

vi.mock('./transform-mode', () => ({
    isDragModeEnabled: mocks.isDragModeEnabled,
}));

import {
    getSelectedTransformTarget,
    setSelectedTransformTarget,
    clearSelectedTransformTarget,
    syncDragMode,
} from './transform-selection';

const { attachGizmoForKind, detachGizmo, isDragModeEnabled } = mocks;

describe('transform-selection (ADR-171 面板化选中态)', () => {
    beforeEach(() => {
        clearSelectedTransformTarget(); // 重置 _selected，放在 mockClear 之前避免污染计数
        attachGizmoForKind.mockClear();
        detachGizmo.mockClear();
        isDragModeEnabled.mockReset();
    });

    it('开关关时 setSelected 只记录，不挂 Gizmo', () => {
        isDragModeEnabled.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        expect(getSelectedTransformTarget()).toEqual({ kind: 'light', id: 'l1' });
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        expect(detachGizmo).toHaveBeenCalledTimes(1); // syncDragMode 关→卸载
    });

    it('开关开时 setSelected 立即挂当前选中物', () => {
        isDragModeEnabled.mockReturnValue(true);
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        expect(attachGizmoForKind).toHaveBeenCalledWith('light', 'l1');
    });

    it('syncDragMode：开关开但无选中时静默（不挂不卸）', () => {
        isDragModeEnabled.mockReturnValue(true);
        syncDragMode();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        expect(detachGizmo).not.toHaveBeenCalled();
    });

    it('syncDragMode：开关关时强制卸载', () => {
        isDragModeEnabled.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'm1' });
        detachGizmo.mockClear();
        syncDragMode();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        expect(detachGizmo).toHaveBeenCalledTimes(1);
    });

    it('clearSelected 清除选中并卸载', () => {
        isDragModeEnabled.mockReturnValue(true);
        setSelectedTransformTarget({ kind: 'mirror', id: 'mirror' });
        detachGizmo.mockClear();
        clearSelectedTransformTarget();
        expect(getSelectedTransformTarget()).toBeNull();
        expect(detachGizmo).toHaveBeenCalledTimes(1);
    });
});
