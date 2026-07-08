// [doc:architecture] Accessory — 道具骨骼锚定系统
// 职责: 将外部 mesh 挂载到指定骨骼，随骨骼变换实时跟随
// 依赖: Babylon mesh.attachToBone（POC 验证通过：standard PMX linkedBone 即为原生 Bone）

import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { propRegistry, modelRegistry, setStatus, triggerAutoSave } from '../../core/config';
import { scene } from '../scene';
import { t } from '../../core/i18n/t';

/**
 * 将道具挂载到指定模型的骨骼上。
 * @param propId 道具实例 ID
 * @param boneName 目标骨骼名
 * @param targetModelId 目标模型 ID
 * @param offset 相对骨骼的局部偏移 (x, y, z)
 * @param rotation 欧拉角（度）[pitch, yaw, roll]
 * @returns 是否成功
 */
export function attachPropToBone(
    propId: string,
    boneName: string,
    targetModelId: string,
    offset: [number, number, number] = [0, 0, 0],
    rotation: [number, number, number] = [0, 0, 0]
): boolean {
    const prop = propRegistry.get(propId);
    if (!prop) {
        console.warn('[accessory] prop not found:', propId);
        return false;
    }

    const inst = modelRegistry.get(targetModelId);
    if (!inst?.mmdModel) {
        console.warn('[accessory] target model not found or no mmd runtime:', targetModelId);
        return false;
    }

    // 查找骨骼
    const rb = inst.mmdModel.runtimeBones.find((b) => b.name === boneName);
    if (!rb) {
        console.warn('[accessory] bone not found:', boneName);
        setStatus(t('scene.accessory.boneNotFound', { bone: boneName }), false);
        return false;
    }

    // linkedBone: babylon-mmd 的 runtimeBone 有 linkedBone 属性指向原生 Bone
    // POC 验证：standard PMX 下 linkedBone instanceof Bone === true
    const linkedBone = (rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone }).linkedBone;
    if (!linkedBone) {
        console.warn('[accessory] bone has no linkedBone (HumanoidMmd path untested):', boneName);
        setStatus(t('scene.accessory.boneNoLink'), false);
        return false;
    }

    // 更新 prop 实例的骨骼锚定信息
    prop.boneName = boneName;
    prop.targetModelId = targetModelId;
    prop.boneOffset = offset;
    prop.boneRotation = rotation;

    // 选择附着目标：优先用 container（多网格父级），否则用 rootMesh
    const target = prop.container ?? prop.rootMesh;

    // 断开现有父子关系（如果是场景坐标模式）
    if (target.parent && !(target.parent instanceof TransformNode && target.parent.name.startsWith('prop_container'))) {
        target.parent = null;
    }

    // 设置局部偏移/旋转
    target.position.set(offset[0], offset[1], offset[2]);
    const rotQ = Quaternion.FromEulerAngles(
        rotation[0] * Math.PI / 180,
        rotation[1] * Math.PI / 180,
        rotation[2] * Math.PI / 180
    );
    target.rotationQuaternion = rotQ;

    // Babylon 原生 attachToBone — POC 已验证通过
    target.attachToBone(linkedBone, inst.rootMesh);

    setStatus(t('scene.accessory.attached', { name: prop.name, bone: boneName }), true);
    triggerAutoSave();
    return true;
}

/**
 * 从骨骼上解除道具挂载，回到场景坐标模式。
 * @param propId 道具实例 ID
 */
export function detachPropFromBone(propId: string): void {
    const prop = propRegistry.get(propId);
    if (!prop) return;

    // 获取当前世界矩阵，以便 detach 后保持视觉位置
    const target = prop.container ?? prop.rootMesh;
    const worldMat = target.getWorldMatrix().clone();

    // 断开骨骼父子关系（attachToBone 内部创建了 skeleton-less bone binding）
    target.detachFromBone();

    // 恢复场景坐标模式
    prop.boneName = undefined;
    prop.targetModelId = undefined;
    prop.boneOffset = undefined;
    prop.boneRotation = undefined;

    // 用原来的世界矩阵保持视觉位置不变
    target.position = worldMat.getTranslation();
    target.rotationQuaternion = Quaternion.FromRotationMatrix(worldMat.getRotationMatrix());

    setStatus(t('scene.accessory.detached', { name: prop.name }), true);
    triggerAutoSave();
}

/**
 * 重新挂载所有骨骼锚定的道具（场景恢复时调用）。
 * 在模型完全加载后调用此函数恢复骨骼绑定。
 */
export function reattachAllAccessories(): void {
    for (const [propId, prop] of propRegistry) {
        if (prop.boneName && prop.targetModelId) {
            const target = prop.container ?? prop.rootMesh;
            // 先 detach 以防残留绑定
            try { target.detachFromBone(); } catch { /* ignore */ }
            
            attachPropToBone(
                propId,
                prop.boneName,
                prop.targetModelId,
                prop.boneOffset ?? [0, 0, 0],
                prop.boneRotation ?? [0, 0, 0]
            );
        }
    }
}

/**
 * 移除指定模型的所有骨骼锚定道具（模型卸载时调用）。
 */
export function detachModelAccessories(modelId: string): void {
    for (const [propId, prop] of propRegistry) {
        if (prop.targetModelId === modelId) {
            detachPropFromBone(propId);
        }
    }
}
