// [doc:adr-126] Transform Adapter Registry — 跨 kind 拖拽/数值双模态去重
//
// 职责: 把「某 kind 支持哪些变换能力 + 如何读写」抽象为 TransformAdapter 接口，
//        同构的 Gizmo 调度与滑杆渲染收敛到此，消除 buildTransformCard 的 9 段 if/else。
//
// 依赖方向（避免循环依赖）:
//   本文件不 import 任何 kind 模块；由各 kind 模块（model-ops / props / lighting）
//   反向调用 registerTransformAdapter 注册，载入即完成注册（ADR-121 依赖方向）。

import type { Node } from '@babylonjs/core/node';
import {
    attachGizmo,
    detachGizmo,
    isGizmoActive,
    isGizmoDragging,
    getGizmoTargetId,
    onGizmoDragObservable,
    getGizmoNode,
    getActiveGizmoTypes,
    setGizmoSnapDistance,
    getGizmoSnapConfig,
    type GizmoType,
} from '../render/transform-gizmo';
import type { ResourceKind } from '../../core/load-manager';

export type TransformCapability = 'slider-scale' | 'slider-opacity';

export interface TransformAdapter {
    /** 该适配器服务的 kind（actor 与 stage 共用同一适配器 → 数组声明） */
    kinds: ResourceKind[];

    // ── Gizmo 拖拽（粗调）──
    /** 返回该 id 对应的可拖拽 Node；null 表示不可拖拽 */
    getNode(id: string): Node | null;
    /** 该 kind 支持的 Gizmo 轴（可按 type 动态返回，如 point 灯无旋转） */
    gizmoTypes(id: string): GizmoType[];
    /** 位置拖拽结束回写（统一 funnel 到持久化） */
    onPositionDragEnd(id: string, node: Node): void;
    onRotationDragEnd?: (id: string, node: Node) => void;
    onScaleDragEnd?: (id: string, node: Node) => void;

    // ── 数值滑杆（精调，能力声明式）──
    capabilities: ReadonlyArray<TransformCapability>;
    getScale?(id: string): number;
    setScale?(id: string, v: number): void;
    /** 归一化 0..1；boolean 可见性应映射为 1/0 */
    getOpacity?(id: string): number;
    /** 归一化 0..1 */
    setOpacity?(id: string, v: number): void;
}

const adapters = new Map<ResourceKind, TransformAdapter>();

/** 注册变换适配器；同一适配器可声明多个 kind（如 actor + stage） */
export function registerTransformAdapter(a: TransformAdapter): void {
    for (const k of a.kinds) {
        adapters.set(k, a);
    }
}

export function getTransformAdapter(kind: ResourceKind): TransformAdapter | null {
    return adapters.get(kind) ?? null;
}

/**
 * 统一 Gizmo 入口：替代三个 attachXxxGizmo。
 * 根据 kind 取适配器 → 取 node → attachGizmo（独占策略，自动 detach 上一个）。
 */
export function attachGizmoForKind(kind: ResourceKind, id: string): boolean {
    const a = adapters.get(kind);
    const node = a?.getNode(id);
    if (!a || !node) {
        return false;
    }
    return attachGizmo({
        id,
        node,
        types: a.gizmoTypes(id),
        onPositionDragEnd: (n) => a.onPositionDragEnd(id, n),
        onRotationDragEnd: a.onRotationDragEnd ? (n) => a.onRotationDragEnd!(id, n) : undefined,
        onScaleDragEnd: a.onScaleDragEnd ? (n) => a.onScaleDragEnd!(id, n) : undefined,
    });
}

// 统一透传底层 Gizmo 控制 API，调用方从本模块统一 import
export {
    detachGizmo,
    isGizmoActive,
    isGizmoDragging,
    getGizmoTargetId,
    onGizmoDragObservable,
    getGizmoNode,
    getActiveGizmoTypes,
    setGizmoSnapDistance,
    getGizmoSnapConfig,
};
