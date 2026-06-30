// [doc:architecture] Cloth Manager — 布料模拟控制器
// 从 scene-menu.ts 提取，职责: 布料创建/销毁/重建
// UI 层通过 toggleCloth / recreateCloth 调用，不再寄生菜单文件

import { SdfCollider, DEFAULT_BODY_CAPSULES } from './xpbd-collider';
import { createCloth, buildClothUpdateFn } from './xpbd-cloth';
import { scene, modelManager } from '../scene/scene';
import { focusedModelId, envState, setStatus } from '../core/config';

/** 为当前聚焦模型创建布料 */
function _createClothForFocusedModel(): void {
    const id = focusedModelId;
    if (!id || !modelManager) {
        setStatus('⚠ 请先加载模型', false);
        return;
    }

    // 防止重复创建（UI 多次点击）
    if (modelManager.clothInstances.has(id)) {
        setStatus('⚠ 布料已存在', false);
        return;
    }

    const mmd = modelManager.focusedMmdModel();
    if (!mmd) {
        setStatus('⚠ 当前模型无 MMD 数据', false);
        return;
    }

    // Build SDF collider
    const collider = new SdfCollider();
    collider.init(DEFAULT_BODY_CAPSULES);

    // Scale collider to match model size
    const model = modelManager.modelRegistry.get(id);
    if (model && model.rootMesh) {
        const boundingInfo = model.rootMesh.getBoundingInfo();
        if (boundingInfo) {
            const modelHeight =
                boundingInfo.boundingBox.maximumWorld.y - boundingInfo.boundingBox.minimumWorld.y;
            if (modelHeight > 0.001) {
                const defaultHeight = 2.0;
                const scaleFactor = modelHeight / defaultHeight;
                collider.scaleAll(Math.max(0.5, Math.min(2.0, scaleFactor)));
            }
        }
    }

    // Build anchor matrix function
    const anchorMatrixFn = (boneName: string): Float32Array | null => {
        return modelManager.getBoneWorldMatrix(boneName);
    };

    // Build bone parent map for dynamic capsule sizing
    const boneParentMap: Record<string, string> = {};
    const mmdForBones = modelManager.focusedMmdModel();
    if (mmdForBones) {
        for (const bone of mmdForBones.runtimeBones) {
            if (bone.parentBone) {
                boneParentMap[bone.name] = bone.parentBone.name;
            }
        }
    }

    // Dynamically size capsules based on actual bone distances
    collider.updateCapsuleSizes(anchorMatrixFn, boneParentMap);

    // Use config from envState
    const cfg = envState.clothConfig;

    // Create cloth
    const cloth = createCloth(scene, cfg, collider);

    // Build update function
    const updateFn = buildClothUpdateFn(cloth, anchorMatrixFn, collider);

    // Register with model manager
    modelManager.addCloth(id, cloth, updateFn);

    setStatus('✓ 布料模拟已启用', true);
}

/** 销毁当前聚焦模型的布料 */
function _destroyClothForFocusedModel(): void {
    const id = focusedModelId;
    if (!id || !modelManager) {
        return;
    }
    modelManager.removeCloth(id);
}

// ======== 公开 API ========

/** 切换布料模拟开关 */
export function toggleCloth(enabled: boolean): void {
    if (enabled) {
        _createClothForFocusedModel();
    } else {
        _destroyClothForFocusedModel();
    }
    envState.clothEnabled = enabled;
}

/** 用当前配置重建布料（参数变更后调用）
 * @returns true 表示重建成功，false 表示布料未启用
 */
export function recreateCloth(): boolean {
    if (!envState.clothEnabled) {
        return false;
    }
    _destroyClothForFocusedModel();
    _createClothForFocusedModel();
    return true;
}
