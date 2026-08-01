// [doc:architecture] Transform Selection — 统一「当前选中物」状态源
// 职责: 面板详情打开时声明当前变换目标（kind+id），由全局拖拽开关决定是否挂 Gizmo。
// 设计: 三个详情面板（模型/舞台/灯光）共用 buildTransformCard，渲染即声明选中；
//       场景开关 scene:dragMode 只做总闸（ADR-171），开关开则挂当前选中物，关则卸载。
// 依赖方向: 本模块 import transform-adapter/transform-mode，无反向依赖。

import type { ResourceKind } from '@/core/load-manager';
import { attachGizmoForKind, detachGizmo, getGizmoTargetId } from './transform-adapter';
import { isDragModeEnabled } from './transform-mode';
import { registerLoadRefreshHook } from '@/core/load-refresh-registry';

export interface TransformTarget {
    kind: ResourceKind;
    id: string;
}

let _selected: TransformTarget | null = null;
/** attachGizmoForKind 返回 false 表示无 adapter 或节点未就绪；记录以便节点就绪后重试 */
let _pendingRetry: TransformTarget | null = null;

export function getSelectedTransformTarget(): TransformTarget | null {
    return _selected;
}

function sameTarget(a: TransformTarget | null, b: TransformTarget | null): boolean {
    return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

/** 声明当前选中物（面板详情渲染时调用）。若拖拽开关开则立即挂 Gizmo。
 *  同 kind+id 重复声明（面板无关状态变化触发重渲染）跳过 syncDragMode，避免独占式
 *  detach+attach 重建 gizmo 造成的拖拽手柄闪烁（交叉审核 P3）。 */
export function setSelectedTransformTarget(target: TransformTarget | null): void {
    const unchanged = sameTarget(_selected, target);
    _selected = target;
    if (unchanged) {
        return;
    }
    syncDragMode();
}

/** 清除选中并卸载 Gizmo（面板关闭/切换时调用）。 */
export function clearSelectedTransformTarget(): void {
    _selected = null;
    _pendingRetry = null;
    detachGizmo();
}

/** 拖拽开关状态变化后同步：开→挂当前选中物；关→卸载。 */
export function syncDragMode(): void {
    if (!isDragModeEnabled()) {
        _pendingRetry = null;
        detachGizmo();
        return;
    }
    if (_selected) {
        // 已挂在同一目标则跳过（场景点击 tryAttachGizmoFromPick 先挂载、随后 setSelected 同步选中态，
        // 此时 gizmo 已指向该目标，重复 attach 会 detach+重建造成闪烁）
        if (getGizmoTargetId() === _selected.id) {
            return;
        }
        _pendingRetry = _selected;
        if (!attachGizmoForKind(_selected.kind, _selected.id)) {
            // 节点未就绪：记录待重试目标，等待 retryPendingAttachment（本模块重试接口）
            return;
        }
        _pendingRetry = null;
    }
}

/**
 * 节点就绪后重试：面板渲染时若适配器节点尚未就绪（attachGizmoForKind 返回 false），
 * 已记录的选中物在节点就绪后调用本函数补挂一次（交叉审核 P3 节点就绪时序）。
 */
export function retryPendingAttachment(): void {
    const target = _pendingRetry;
    if (!target || !isDragModeEnabled()) {
        return;
    }
    // 若当前 gizmo 已挂在别的目标（场景点击挂载了另一个物体），不覆盖用户意图，直接放弃重试
    const currentTargetId = getGizmoTargetId();
    if (currentTargetId !== null && currentTargetId !== target.id) {
        _pendingRetry = null;
        return;
    }
    if (attachGizmoForKind(target.kind, target.id)) {
        _pendingRetry = null;
    }
}

// 模型加载完成后节点就绪，自动补挂此前因节点未就绪而未能挂载的 Gizmo
registerLoadRefreshHook(retryPendingAttachment);
