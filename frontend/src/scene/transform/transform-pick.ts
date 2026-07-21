import type { Scene } from '@babylonjs/core/scene';
import type { Node } from '@babylonjs/core/node';
import type { ResourceKind } from '@/core/load-manager';
import { attachGizmoForKind, getGizmoTargetId } from './transform-adapter';

export interface TransformPickResult {
    kind: ResourceKind;
    id: string;
}

interface TransformMetadata {
    transformKind: ResourceKind;
    transformId: string;
}

export function getTransformMetadata(node: Node | null): TransformMetadata | null {
    let current: Node | null = node;
    while (current) {
        const meta = current.metadata as TransformMetadata | null;
        if (meta?.transformKind && meta?.transformId) {
            return meta;
        }
        current = current.parent;
    }
    return null;
}

export function setTransformMetadata(node: Node, kind: ResourceKind, id: string): void {
    node.metadata = { ...node.metadata, transformKind: kind, transformId: id };
}

export function pickTransformTarget(
    scene: Scene,
    x: number,
    y: number
): TransformPickResult | null {
    const pickInfo = scene.pick(x, y, (mesh) => {
        if (mesh.isPickable) {
            return true;
        }
        return getTransformMetadata(mesh) !== null;
    });
    if (!pickInfo?.hit || !pickInfo.pickedMesh) {
        return null;
    }
    const meta = getTransformMetadata(pickInfo.pickedMesh);
    if (!meta) {
        return null;
    }
    return { kind: meta.transformKind, id: meta.transformId };
}

export function tryAttachGizmoFromPick(scene: Scene, x: number, y: number): boolean {
    const result = pickTransformTarget(scene, x, y);
    if (!result) {
        return false;
    }
    if (getGizmoTargetId() === result.id) {
        return true;
    }
    return attachGizmoForKind(result.kind, result.id);
}
