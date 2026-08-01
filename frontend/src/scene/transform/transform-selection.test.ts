import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    attachGizmoForKind: vi.fn(),
    detachGizmo: vi.fn(),
    isDragModeEnabled: vi.fn(),
    getGizmoTargetId: vi.fn(),
    registerLoadRefreshHook: vi.fn(),
}));

vi.mock('./transform-adapter', () => ({
    attachGizmoForKind: mocks.attachGizmoForKind,
    detachGizmo: mocks.detachGizmo,
    getGizmoTargetId: mocks.getGizmoTargetId,
}));

vi.mock('./transform-mode', () => ({
    isDragModeEnabled: mocks.isDragModeEnabled,
}));

vi.mock('@/core/load-refresh-registry', () => ({
    registerLoadRefreshHook: mocks.registerLoadRefreshHook,
}));

import {
    getSelectedTransformTarget,
    setSelectedTransformTarget,
    clearSelectedTransformTarget,
    syncDragMode,
    retryPendingAttachment,
} from './transform-selection';

const {
    attachGizmoForKind,
    detachGizmo,
    isDragModeEnabled,
    getGizmoTargetId,
    registerLoadRefreshHook,
} = mocks;

describe('transform-selection (ADR-171 面板化选中态)', () => {
    beforeEach(() => {
        clearSelectedTransformTarget(); // 重置 _selected，放在 mockClear 之前避免污染计数
        attachGizmoForKind.mockClear();
        detachGizmo.mockClear();
        isDragModeEnabled.mockReset();
        getGizmoTargetId.mockReset();
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

    it('sameTarget：同 kind+id 重复声明跳过 syncDragMode（避免重渲染抖动）', () => {
        isDragModeEnabled.mockReturnValue(true);
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        attachGizmoForKind.mockClear();
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        expect(getSelectedTransformTarget()).toEqual({ kind: 'light', id: 'l1' });
    });

    it('sameTarget：不同 kind+id 声明触发重挂', () => {
        isDragModeEnabled.mockReturnValue(true);
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        attachGizmoForKind.mockClear();
        setSelectedTransformTarget({ kind: 'actor', id: 'm2' });
        expect(attachGizmoForKind).toHaveBeenCalledWith('actor', 'm2');
    });

    it('节点未就绪（attach 返回 false）记录 pending，retryPendingAttachment 补挂', () => {
        isDragModeEnabled.mockReturnValue(true);
        attachGizmoForKind.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'late' });
        expect(attachGizmoForKind).toHaveBeenCalledWith('actor', 'late');
        // 节点就绪后重试成功
        attachGizmoForKind.mockReturnValue(true);
        retryPendingAttachment();
        expect(attachGizmoForKind).toHaveBeenCalledWith('actor', 'late');
    });

    it('节点未就绪后开关关闭则 pending 被清空，不再重试', () => {
        isDragModeEnabled.mockReturnValue(true);
        attachGizmoForKind.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'late' });
        // 开关关闭 → syncDragMode 清 pending
        isDragModeEnabled.mockReturnValue(false);
        syncDragMode();
        attachGizmoForKind.mockClear();
        retryPendingAttachment();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
    });

    it('syncDragMode：gizmo 已挂在同一目标时跳过（场景点击同步选中态不重复 attach）', () => {
        isDragModeEnabled.mockReturnValue(true);
        getGizmoTargetId.mockReturnValue('l1');
        setSelectedTransformTarget({ kind: 'light', id: 'l1' });
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        expect(getSelectedTransformTarget()).toEqual({ kind: 'light', id: 'l1' });
    });

    it('retryPendingAttachment：gizmo 已挂在别的目标时不覆盖（放弃重试）', () => {
        isDragModeEnabled.mockReturnValue(true);
        attachGizmoForKind.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'a' });
        // 场景点击把 gizmo 挂到了另一个目标 b
        getGizmoTargetId.mockReturnValue('b');
        attachGizmoForKind.mockClear();
        retryPendingAttachment();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
    });

    it('retryPendingAttachment：gizmo 已挂在 pending 目标本身时不重复 attach（清 pending 防闪烁）', () => {
        isDragModeEnabled.mockReturnValue(true);
        attachGizmoForKind.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'a' });
        // 场景点击把 gizmo 挂到了 pending 目标 a（getGizmoTargetId 返回 a）
        getGizmoTargetId.mockReturnValue('a');
        attachGizmoForKind.mockClear();
        retryPendingAttachment();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
    });

    it('syncDragMode：同目标跳过时同时清空 pending（不残留待重试）', () => {
        isDragModeEnabled.mockReturnValue(true);
        attachGizmoForKind.mockReturnValue(false);
        setSelectedTransformTarget({ kind: 'actor', id: 'a' });
        // 场景点击把 gizmo 挂到 a，随后 setSelected 同步选中态 → syncDragMode 同目标跳过
        getGizmoTargetId.mockReturnValue('a');
        attachGizmoForKind.mockClear();
        setSelectedTransformTarget({ kind: 'actor', id: 'a' });
        expect(attachGizmoForKind).not.toHaveBeenCalled();
        // pending 已清：随后 retry 不再补挂
        retryPendingAttachment();
        expect(attachGizmoForKind).not.toHaveBeenCalled();
    });

    it('registerLoadRefreshHook 注册了 retryPendingAttachment', () => {
        expect(registerLoadRefreshHook).toHaveBeenCalledWith(retryPendingAttachment);
    });
});
