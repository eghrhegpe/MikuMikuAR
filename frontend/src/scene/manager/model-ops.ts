import type { PhysicsCategory, BoneOverrideEntry, FeetState, ModelInstance } from '@/core/types';
import { logWarn } from '../../core/logger';
import {
    modelRegistry,
    focusedModelId,
    isPlaying,
    setIsPlaying,
    setAutoLoop,
    setSeekDragging,
    dom,
    mmdRuntime,
} from '@/core/config';
import { refreshWaterRenderList } from '../env/env';
import { getCameraMode, switchCameraMode, getOrbitBoneLock, setOrbitBoneLock, getFocusedModelBoneNames } from '../camera/camera';
import { updatePlaybackUI } from '../motion/playback';
import { disposeAudio } from '@/outfit/audio';
import { modelManager } from '../scene';
import { setTargetModel } from '../motion/motion-modules/registry'; // [doc:adr-116]
import { setBoneOverride } from '../motion/bone-override'; // [doc:adr-150]
import type { FormationType } from './model-manager';
import { getFormationLabels } from './model-manager';
import { registerTransformAdapter } from '../transform/transform-adapter';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { VPDBoneData, VPDMorphData } from '@/motion-algos/vpd-parser';
import { t } from '@/core/i18n/t';
import { createDefaultFeetState } from '@/core/state'; // [doc:adr-150]

// ======== Model Lifecycle ========

export function removeModel(id: string): void {
    modelManager?.remove(id);
    dom.canvas.setAttribute('aria-label', t('menu.canvasLabel'));
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

export function setModelRotation(id: string, rotation: Vector3): void {
    modelManager?.setRotation(id, rotation);
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

// ======== Transform Adapter (ADR-126: actor + stage 共用同一适配器) ========

registerTransformAdapter({
    kinds: ['actor', 'stage'],
    getNode: (id) => modelRegistry.get(id)?.meshes[0] ?? null,
    gizmoTypes: () => ['position', 'scale', 'rotation'],
    onPositionDragEnd: (id, n) => {
        const v = (n as unknown as { position: Vector3 }).position;
        modelManager?.setPosition(id, v.x, v.y, v.z);
    },
    onScaleDragEnd: (id, n) => {
        const v = (n as unknown as { scaling: Vector3 }).scaling;
        modelManager?.setScaling(id, v.x);
    },
    onRotationDragEnd: (id, n) => {
        const v = (n as unknown as { rotation: Vector3 }).rotation;
        modelManager?.setRotation(id, v);
    },
    capabilities: ['slider-scale', 'slider-opacity'],
    getScale: (id) => modelRegistry.get(id)?.scaling ?? 1,
    setScale: (id, v) => setModelScaling(id, v),
    getOpacity: (id) => modelRegistry.get(id)?.opacity ?? 1,
    setOpacity: (id, v) => {
        setModelOpacity(id, v);
        if (v > 0) {
            setModelVisibility(id, true);
        }
    },
});

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

// ======== [doc:adr-150] 模型替换状态继承 ========

/** [doc:adr-150] 替换模型时从旧模型捕获、应用到新模型的可继承状态快照。
 *  不含 outfit（重置）、VMD 文件数据（通过 sceneMotionId 引用场景动作库）。 */
export interface ReplaceSnapshot {
    visible: boolean;
    opacity: number;
    wireframe: boolean;
    showBoneLines: boolean;
    showBoneJoints: boolean;
    physicsEnabled: boolean;
    scaling: number;
    rotation: [number, number, number];
    positionMode: 'cartesian' | 'orbit';
    /** 仅 positionMode==='orbit' 时有意义 */
    orbitAzimuth?: number;
    orbitElevation?: number;
    orbitDistance?: number;
    /** 直角坐标，仅 positionMode==='cartesian' 时应用；orbit 模式由 orbit 三参数定位 */
    position: [number, number, number];
    boneOverrides: BoneOverrideEntry[];
    feet: FeetState;
    /** [doc:adr-167] 场景动作库引用；undefined=继承默认动作 */
    sceneMotionId?: string;
    /** [doc:adr-150] 轨道相机骨骼锁定骨名；新模型无同名骨则解锁 */
    boneLockBoneName?: string;
}

/** [doc:adr-150] 从旧 ModelInstance 提取可继承状态（深拷贝，不引用原 inst 字段）。 */
export function captureInheritedState(inst: ModelInstance): ReplaceSnapshot {
    const rootMesh = inst.meshes[0];
    return {
        visible: inst.visible,
        opacity: inst.opacity,
        wireframe: inst.wireframe,
        showBoneLines: inst.showBoneLines,
        showBoneJoints: inst.showBoneJoints,
        physicsEnabled: inst.physicsEnabled,
        scaling: inst.scaling,
        rotation: [...inst.rotation] as [number, number, number],
        positionMode: inst.positionMode ?? 'cartesian',
        orbitAzimuth: inst.orbitAzimuth,
        orbitElevation: inst.orbitElevation,
        orbitDistance: inst.orbitDistance,
        position: rootMesh?.position
            ? [rootMesh.position.x, rootMesh.position.y, rootMesh.position.z]
            : [0, 0, 0],
        boneOverrides: inst.boneOverrides.map((b) => ({
            ...b,
            euler: [...b.euler] as [number, number, number],
        })),
        feet: inst.feet ? { ...inst.feet } : createDefaultFeetState(),
        sceneMotionId: inst.motionSlots?.primary?.sceneMotionId,
        boneLockBoneName: getOrbitBoneLock().boneName ?? undefined,
    };
}

/** [doc:adr-150] 将状态快照应用到新模型（通过 modelManager setter + setBoneOverride）。
 *  必须在新模型已注册到 modelRegistry 后调用。boneOverrides 仅对新模型存在的骨骼应用。 */
export function applyInheritedState(newId: string, snap: ReplaceSnapshot): void {
    const mm = modelManager;
    if (!mm) {
        logWarn('adr-150', 'applyInheritedState: modelManager unavailable');
        return;
    }

    // 1. 基础可见性 / 物理开关
    mm.setVisibility(newId, snap.visible);
    mm.setOpacity(newId, snap.opacity);
    mm.setWireframe(newId, snap.wireframe);
    mm.setBoneLinesVis(newId, snap.showBoneLines);
    mm.setBoneJointsVis(newId, snap.showBoneJoints);
    mm.setPhysics(newId, snap.physicsEnabled);

    // 2. 变换
    mm.setScaling(newId, snap.scaling);
    mm.setRotation(newId, new Vector3(snap.rotation[0], snap.rotation[1], snap.rotation[2]));
    if (
        snap.positionMode === 'orbit' &&
        snap.orbitAzimuth !== undefined &&
        snap.orbitElevation !== undefined &&
        snap.orbitDistance !== undefined
    ) {
        mm.setPositionMode(newId, 'orbit');
        mm.setOrbit(newId, snap.orbitAzimuth, snap.orbitElevation, snap.orbitDistance);
    } else {
        mm.setPositionMode(newId, 'cartesian');
        mm.setPosition(newId, snap.position[0], snap.position[1], snap.position[2]);
    }

    // 3. Bone Overrides — 仅对新模型存在的骨骼应用，避免 store 堆积无效条目
    const newBoneNames = new Set(getFocusedModelBoneNames());
    for (const b of snap.boneOverrides) {
        if (newBoneNames.has(b.boneName)) {
            setBoneOverride(b.boneName, b.euler, b.weight, b.enabled, newId, b.absolute);
        }
    }

    // 4. Feet State + sceneMotionId — 直接写入 ModelInstance
    const newInst = modelRegistry.get(newId);
    if (newInst) {
        newInst.feet = { ...snap.feet };
        // sceneMotionId 继承：赋值后由 ADR-167 既有广播链路自动应用 VMD
        if (snap.sceneMotionId !== undefined) {
            newInst.motionSlots = {
                primary: {
                    source: 'inherit',
                    status: 'compatible',
                    sceneMotionId: snap.sceneMotionId,
                },
            };
        }
    }

    // 5. Bone Lock — 同名骨匹配，失败静默不锁
    if (snap.boneLockBoneName && newBoneNames.has(snap.boneLockBoneName)) {
        setOrbitBoneLock(true, snap.boneLockBoneName);
    } else if (snap.boneLockBoneName) {
        logWarn(
            'adr-150',
            `bone lock '${snap.boneLockBoneName}' not found on new model, lock cleared`
        );
    }
}
