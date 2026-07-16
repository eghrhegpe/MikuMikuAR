import type { PhysicsCategory } from '@/core/types';
import { logWarn } from '../../core/utils';
import {
    modelRegistry,
    focusedModelId,
    isPlaying,
    setIsPlaying,
    setAutoLoop,
    setSeekDragging,
    dom,
    setPendingVmd,
    mmdRuntime,
} from '@/core/config';
import { refreshWaterRenderList } from '../env/env';
import { getCameraMode, switchCameraMode } from '../camera/camera';
import { updatePlaybackUI } from '../motion/playback';
import { disposeAudio } from '@/outfit/audio';
import { modelManager } from '../scene';
import { setTargetModel } from '../motion/motion-modules/registry'; // [doc:adr-116]
import type { FormationType } from './model-manager';
import { getFormationLabels } from './model-manager';
import {
    attachGizmo,
    detachGizmo,
    isGizmoActive,
    getGizmoTargetId,
} from '../render/transform-gizmo';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { VPDBoneData, VPDMorphData } from '@/motion-algos/vpd-parser';

// ======== Model Lifecycle ========

export function removeModel(id: string): void {
    modelManager?.remove(id);
    refreshWaterRenderList();

    if (focusedModelId === null && getCameraMode() === 'concert') {
        switchCameraMode('orbit');
    }
    if (modelRegistry.size === 0) {
        setIsPlaying(false);
        setAutoLoop(true);
        setSeekDragging(false);
        dom.playbackBar.style.display = 'none';
        disposeAudio();
    }
}

export function removeFocusedModel(): void {
    if (!focusedModelId) {
        return;
    }
    removeModel(focusedModelId);
    setPendingVmd(null);
}

export function focusModel(id: string): void {
    modelManager?.focus(id);
    // [doc:adr-116] 切换目标模型时同步 motion module 作用域
    // （禁用旧模型模块覆盖、启用新模型已保存的模块状态）
    setTargetModel(id);
    if (!mmdRuntime) {
        return;
    }
    updatePlaybackUI();
}

export function focusedMmdModel() {
    return modelManager?.focusedMmdModel() ?? null;
}
export function focusedModel() {
    return modelManager?.focused() ?? null;
}

export function arrangeModels(): void {
    modelManager?.arrange();
}

export function setModelFormation(type: FormationType, spacing?: number): void {
    modelManager?.setFormation(type, spacing);
}

export function getActiveFormation(): FormationType | null {
    return modelManager?.getActiveFormation() ?? null;
}

export function getActiveFormationSpacing(): number {
    return modelManager?.getActiveFormationSpacing() ?? 3;
}

export { getFormationLabels };
export type { FormationType };

// ======== Visibility / Material / Debug ========

export function setModelVisibility(id: string, visible: boolean): void {
    modelManager?.setVisibility(id, visible);
}

export function setModelOpacity(id: string, opacity: number): void {
    modelManager?.setOpacity(id, opacity);
}

export function setModelWireframe(id: string, wireframe: boolean): void {
    modelManager?.setWireframe(id, wireframe);
}

export function setModelBoneLinesVis(id: string, show: boolean): void {
    modelManager?.setBoneLinesVis(id, show);
}

export function setModelBoneJointsVis(id: string, show: boolean): void {
    modelManager?.setBoneJointsVis(id, show);
}

// ======== Physics ========

export function setModelPhysics(id: string, enabled: boolean): void {
    modelManager?.setPhysics(id, enabled);
}

export function getPhysicsCategories(id: string): PhysicsCategory[] {
    return modelManager?.getPhysicsCategories(id) ?? [];
}

export function getPhysicsCatState(id: string): Record<string, boolean> | null {
    return modelManager?.getPhysicsCatState(id) ?? null;
}

export function isPhysicsCategoryEnabled(id: string, cat: string): boolean {
    return modelManager?.isPhysicsCategoryEnabled(id, cat) ?? false;
}

export function setPhysicsCategory(id: string, cat: string, enabled: boolean): void {
    modelManager?.setPhysicsCategory(id, cat, enabled);
}

// ======== Transform ========

export function setModelScaling(id: string, scaling: number): void {
    modelManager?.setScaling(id, scaling);
}

export function setModelRotationY(id: string, rotationY: number): void {
    modelManager?.setRotationY(id, rotationY);
}

export function setModelPosition(id: string, x: number, y: number, z: number): void {
    modelManager?.setPosition(id, x, y, z);
}

export function getModelPosition(id: string): [number, number, number] {
    return modelManager?.getPosition(id) ?? [0, 0, 0];
}

// ======== [doc:adr-049] 球面坐标轨道控制 ========

export function setModelOrbit(
    id: string,
    azimuth: number,
    elevation: number,
    distance: number
): void {
    modelManager?.setOrbit(id, azimuth, elevation, distance);
}

export function getModelOrbit(
    id: string
): { azimuth: number; elevation: number; distance: number } | null {
    return modelManager?.getOrbit(id) ?? null;
}

export function setModelPositionMode(id: string, mode: 'cartesian' | 'orbit'): void {
    modelManager?.setPositionMode(id, mode);
}

export function getModelPositionMode(id: string): 'cartesian' | 'orbit' {
    return modelManager?.getPositionMode(id) ?? 'cartesian';
}

export function resetModelTransform(id: string): void {
    modelManager?.resetTransform(id);
}

// ======== Model Gizmo (→ transform-gizmo.ts) ========

/**
 * 为模型激活 3D 拖拽 Gizmo。
 * - PositionGizmo：拖拽坐标轴移动模型位置
 * - ScaleGizmo（等比）：拖拽缩放手柄统一缩放
 * 拖拽结束后自动通过 modelManager 持久化。
 */
export function attachModelGizmo(id: string): boolean {
    const inst = modelRegistry.get(id);
    if (!inst || inst.meshes.length === 0) {
        return false;
    }
    const node = inst.meshes[0];

    return attachGizmo({
        id,
        node,
        types: ['position', 'scale'],
        onPositionDragEnd: (n) => {
            const v = (n as unknown as { position: Vector3 }).position;
            modelManager?.setPosition(id, v.x, v.y, v.z);
        },
        onScaleDragEnd: (n) => {
            const v = (n as unknown as { scaling: Vector3 }).scaling;
            modelManager?.setScaling(id, v.x);
        },
    });
}

export {
    detachGizmo as detachModelGizmo,
    isGizmoActive as isModelGizmoActive,
    getGizmoTargetId as getModelGizmoTargetId,
};

// ======== VMD ========

export function stopVMD(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    if (inst.mmdModel && mmdRuntime) {
        inst.mmdModel.setRuntimeAnimation(null);
    }
    modelManager?.clearVmdData(id);
    if (isPlaying) {
        mmdRuntime.pauseAnimation();
        setIsPlaying(false);
    }
    updatePlaybackUI();
}

// ======== Morph / Expression ========

export function getModelMorphs(id: string): Array<{ name: string; type: number }> {
    return modelManager?.getMorphs(id) ?? [];
}

export function setModelMorphWeight(id: string, morphName: string, weight: number): void {
    modelManager?.setMorphWeight(id, morphName, weight);
}

export function getModelMorphWeight(id: string, morphName: string): number {
    return modelManager?.getMorphWeight(id, morphName) ?? 0;
}

export function resetModelMorphs(id: string): void {
    modelManager?.resetMorphs(id);
}

// ======== VPD Pose ========

/**
 * 应用 VPD 姿势到模型（静态姿势，停掉 VMD 播放）。
 * 停掉动画后直接写 linkedBone.position / rotationQuaternion，
 * WASM runtime 无动画输入时不覆盖。
 *
 * @param id       模型 ID
 * @param bones    VPD 解析出的骨骼数据（position + rotation quaternion）
 * @param morphs   VPD 解析出的表情数据（name + weight）
 */
export function applyVPDPose(id: string, bones: VPDBoneData[], morphs: VPDMorphData[]): void {
    const inst = modelRegistry.get(id);
    if (!inst || !inst.mmdModel) {
        logWarn('applyVPDPose', '模型未找到:', id);
        return;
    }

    // 1. 停掉 VMD 播放（程序化动作 + 用户 VMD）
    stopVMD(id);

    // 2. 构建骨骼名 → runtimeBone 索引映射
    const runtimeBones = inst.mmdModel.runtimeBones;
    const boneNameToIdx = new Map<string, number>();
    for (let i = 0; i < runtimeBones.length; i++) {
        boneNameToIdx.set(runtimeBones[i].name, i);
    }

    // 3. 应用骨骼变换（写 linkedBone.position / rotationQuaternion）
    for (const b of bones) {
        const idx = boneNameToIdx.get(b.name);
        if (idx === undefined) {
            continue;
        }
        const linked = runtimeBones[idx].linkedBone;
        // position: VPD 是局部坐标（米），直接写入
        linked.position = new Vector3(b.position[0], b.position[1], b.position[2]);
        // rotation: VPD 是四元数 [x, y, z, w]
        linked.rotationQuaternion = new Quaternion(
            b.rotation[0],
            b.rotation[1],
            b.rotation[2],
            b.rotation[3]
        );
    }

    // 4. 应用表情权重
    for (const m of morphs) {
        setModelMorphWeight(id, m.name, m.weight);
    }

    logWarn('applyVPDPose', `已应用 ${bones.length} 骨骼 + ${morphs.length} 表情到模型 ${id}`);
}
