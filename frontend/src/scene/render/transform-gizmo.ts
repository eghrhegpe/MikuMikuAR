// [doc:adr-048] Transform Gizmo — 模型/道具/灯光 3D 拖拽 Gizmo 统一抽象
// 职责: 封装 PositionGizmo / RotationGizmo / ScaleGizmo 生命周期
//        一次只允许一个实体激活 Gizmo（独占策略）。
// 调用方: lighting.ts / model-ops.ts / scene-prop-levels.ts

import { PositionGizmo } from '@babylonjs/core/Gizmos/positionGizmo';
import { RotationGizmo } from '@babylonjs/core/Gizmos/rotationGizmo';
import { ScaleGizmo } from '@babylonjs/core/Gizmos/scaleGizmo';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { Scene } from '@babylonjs/core/scene';
import type { Node } from '@babylonjs/core/node';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Observable } from '@babylonjs/core/Misc/observable';

export type GizmoType = 'position' | 'rotation' | 'scale';

// ======== Module-level State (singleton — 独占策略) ========

let _scene: Scene | null = null;
let _gizmoLayer: UtilityLayerRenderer | null = null;
let _posGizmo: PositionGizmo | null = null;
let _rotGizmo: RotationGizmo | null = null;
let _scaleGizmo: ScaleGizmo | null = null;
let _gizmoTargetId: string | null = null;
let _gizmoNode: Node | null = null;

// 网格吸附（ADR-126 Phase 3）：position 以场景单位步进，rotation/scale 派生。
// Babylon 语义：snapDistance=0 即禁用吸附，故默认关闭即零副作用。
let _snapEnabled = false;
let _snapStep = 1.0; // 场景单位（position）；rotation/scale 按轴派生

/** 拖拽进行中（连续）可观察量：任一 Gizmo 轴被拖动时每帧触发，
 *  供数值滑杆实时同步显示（ADR-126 Phase 2 双模态）。
 *  注意：仅作显示同步，不含持久化回写——连续 setScaling 会触发 triggerAutoSave 风暴。 */
export const onGizmoDragObservable = new Observable<void>();

// ======== Initialization ========

export function initTransformGizmo(scene: Scene): void {
    _scene = scene;
}

function _getOrCreateLayer(): UtilityLayerRenderer {
    if (!_gizmoLayer && _scene) {
        _gizmoLayer = new UtilityLayerRenderer(_scene);
        _gizmoLayer.shouldRender = false;
    }
    return _gizmoLayer!;
}

// ======== Attach / Detach ========

/** 纯函数：给定轴类型与吸附配置，计算吸附步长（场景单位）。
 *  snapDistance=0 表示禁用（Babylon 语义）。抽离为导出纯函数以便单测覆盖三轴派生逻辑
 *  （ADR-126 Phase 3 审计 P4：原 _snapFor 私有不可测）。 */
export function computeSnapDistance(type: GizmoType, enabled: boolean, step: number): number {
    if (!enabled) {
        return 0;
    }
    switch (type) {
        case 'position':
            return step; // 场景单位，如 1.0
        case 'rotation':
            return step * (Math.PI / 12); // step=1 → 15°（π/12 rad）
        case 'scale':
            return step * 0.1; // step=1 → 0.1 缩放增量
    }
}

/** 基于当前模块级吸附状态计算某轴类型的吸附步长。 */
function _snapFor(type: GizmoType): number {
    return computeSnapDistance(type, _snapEnabled, _snapStep);
}

export interface GizmoAttachOptions {
    /** 实体唯一标识（灯光/模型/道具 ID），用于 getGizmoTargetId() 查询 */
    id: string;
    /** 要绑定的 Babylon.js Node（Mesh / TransformNode / Light） */
    node: Node;
    /** 需要激活的 Gizmo 类型组合 */
    types: GizmoType[];
    /** 位置 Gizmo 拖拽结束回调 */
    onPositionDragEnd?: (node: Node) => void;
    /** 旋转 Gizmo 拖拽结束回调 */
    onRotationDragEnd?: (node: Node) => void;
    /** 缩放 Gizmo 拖拽结束回调 */
    onScaleDragEnd?: (node: Node) => void;
}

/**
 * 为指定 Node 激活变换 Gizmo。
 * 独占策略：自动 detach 上一个 Gizmo。
 * 返回 true 表示成功。
 */
export function attachGizmo(options: GizmoAttachOptions): boolean {
    if (!_scene) {
        return false;
    }

    // 先 detach 上一个
    detachGizmo();

    const layer = _getOrCreateLayer();
    layer.shouldRender = true;

    // 兼容 Light 等非 AbstractMesh 类型：项目 tsconfig strict=false，
    // 且 Babylon.js 运行时 accepts any Node with transform properties
    // 使用 AbstractMesh 达到 Gizmo.attachedNode 的类型要求
    const node = options.node as AbstractMesh;

    for (const type of options.types) {
        switch (type) {
            case 'position': {
                const g = new PositionGizmo(layer);
                g.attachedNode = node;
                g.snapDistance = _snapFor('position');
                if (options.onPositionDragEnd) {
                    g.onDragEndObservable.add(() => options.onPositionDragEnd!(options.node));
                }
                g.onDragObservable.add(() => onGizmoDragObservable.notifyObservers());
                _posGizmo = g;
                break;
            }
            case 'rotation': {
                const g = new RotationGizmo(layer);
                g.attachedNode = node;
                g.snapDistance = _snapFor('rotation');
                if (options.onRotationDragEnd) {
                    g.onDragEndObservable.add(() => options.onRotationDragEnd!(options.node));
                }
                g.onDragObservable.add(() => onGizmoDragObservable.notifyObservers());
                _rotGizmo = g;
                break;
            }
            case 'scale': {
                const g = new ScaleGizmo(layer);
                g.attachedNode = node;
                // ScaleGizmo 默认有等比缩放 corner handle（uniformScaleGizmo）
                // 无需额外启用
                g.snapDistance = _snapFor('scale');
                if (options.onScaleDragEnd) {
                    g.onDragEndObservable.add(() => options.onScaleDragEnd!(options.node));
                }
                g.onDragObservable.add(() => onGizmoDragObservable.notifyObservers());
                _scaleGizmo = g;
                break;
            }
        }
    }

    _gizmoTargetId = options.id;
    _gizmoNode = options.node;
    return true;
}

/** 移除当前 Gizmo。 */
export function detachGizmo(): void {
    if (_posGizmo) {
        _posGizmo.dispose();
        _posGizmo = null;
    }
    if (_rotGizmo) {
        _rotGizmo.dispose();
        _rotGizmo = null;
    }
    if (_scaleGizmo) {
        _scaleGizmo.dispose();
        _scaleGizmo = null;
    }
    if (_gizmoLayer) {
        _gizmoLayer.shouldRender = false;
        _gizmoLayer.dispose();
        _gizmoLayer = null;
    }
    _gizmoTargetId = null;
    _gizmoNode = null;
}

// ======== Queries ========

/** 当前是否有 Gizmo 激活。 */
export function isGizmoActive(): boolean {
    return _gizmoTargetId !== null;
}

/** 获取当前 Gizmo 绑定的实体 ID。 */
export function getGizmoTargetId(): string | null {
    return _gizmoTargetId;
}

/** 获取当前 Gizmo 绑定的实时 Node（拖拽中其 transform 已被 Babylon 实时改写，供数值滑杆读取）。 */
export function getGizmoNode(): Node | null {
    return _gizmoNode;
}

/** 获取当前激活的 Gizmo 轴类型组合（用于判断拖拽中是否在改缩放）。 */
export function getActiveGizmoTypes(): GizmoType[] {
    const types: GizmoType[] = [];
    if (_posGizmo) {
        types.push('position');
    }
    if (_rotGizmo) {
        types.push('rotation');
    }
    if (_scaleGizmo) {
        types.push('scale');
    }
    return types;
}

// ======== Grid Snap (ADR-126 Phase 3) ========

/** 设置网格吸附配置。
 *  enabled=false 时 snapDistance=0（Babylon 禁用吸附），对当前与后续 Gizmo 均生效。
 *  实时作用于当前激活的 Gizmo，无需重新 attach。 */
export function setGizmoSnapDistance(enabled: boolean, step?: number): void {
    _snapEnabled = enabled;
    if (step !== undefined) {
        _snapStep = step;
    }
    if (_posGizmo) {
        _posGizmo.snapDistance = _snapFor('position');
    }
    if (_rotGizmo) {
        _rotGizmo.snapDistance = _snapFor('rotation');
    }
    if (_scaleGizmo) {
        _scaleGizmo.snapDistance = _snapFor('scale');
    }
}

/** 读取当前网格吸附配置（enabled 默认 false，step 默认 1.0）。 */
export function getGizmoSnapConfig(): { enabled: boolean; step: number } {
    return { enabled: _snapEnabled, step: _snapStep };
}
