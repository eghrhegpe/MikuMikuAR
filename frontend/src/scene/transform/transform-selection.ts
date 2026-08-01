// [doc:architecture] Transform Selection — 统一「当前选中物」状态源
// 职责: 面板详情打开时声明当前变换目标（kind+id），由全局拖拽开关决定是否挂 Gizmo。
// 设计: 三个详情面板（模型/舞台/灯光）共用 buildTransformCard，渲染即声明选中；
//       场景开关 scene:dragMode 只做总闸（ADR-171），开关开则挂当前选中物，关则卸载。
// 依赖方向: 本模块 import transform-adapter/transform-mode，无反向依赖。

import type { ResourceKind } from '@/core/load-manager';
import { attachGizmoForKind, detachGizmo } from './transform-adapter';
import { isDragModeEnabled } from './transform-mode';

export interface TransformTarget {
    kind: ResourceKind;
    id: string;
}

let _selected: TransformTarget | null = null;

export function getSelectedTransformTarget(): TransformTarget | null {
    return _selected;
}

/** 声明当前选中物（面板详情渲染时调用）。若拖拽开关开则立即挂 Gizmo。 */
export function setSelectedTransformTarget(target: TransformTarget | null): void {
    _selected = target;
    syncDragMode();
}

/** 清除选中并卸载 Gizmo（面板关闭/切换时调用）。 */
export function clearSelectedTransformTarget(): void {
    _selected = null;
    detachGizmo();
}

/** 拖拽开关状态变化后同步：开→挂当前选中物；关→卸载。 */
export function syncDragMode(): void {
    if (!isDragModeEnabled()) {
        detachGizmo();
        return;
    }
    if (_selected) {
        attachGizmoForKind(_selected.kind, _selected.id);
    }
}
