// [doc:architecture] Outfit Overlay — FBX 布料叠加层加载/骨骼重定向/生命周期
// 职责: 从 MD 导出的 FBX 加载叠加 mesh，绑定到 PMX skeleton，管理隐藏/恢复

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Scene } from '@babylonjs/core/scene';

import { type ModelInstance } from '../core/config';

// ============================================================
// URL helpers
// ============================================================

function _encodePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .split('/')
        .map((p) => encodeURIComponent(p))
        .join('/');
}

// ============================================================
// Skeleton retargeting
// ============================================================

/**
 * 将 FBX skeleton 的 bone 按 name 匹配到 PMX runtimeBones，
 * 重建 bone weight index 映射，使 FBX mesh 跟随 PMX 骨骼动画。
 *
 * @returns true = 成功重定向，false = 匹配率过低，应降级为静态叠加
 */
function retargetSkeleton(inst: ModelInstance, fbxMeshes: Mesh[]): boolean {
    const pmxModel = inst.mmdModel;
    if (!pmxModel) {
        return false;
    }
    // 找到第一个有 skeleton 的 FBX mesh
    // eslint-disable-next-line eqeqeq -- 惯用法:同时排除 null 与 undefined
    const skinned = fbxMeshes.find((m) => m.skeleton != null);
    if (!skinned || !skinned.skeleton) {
        return false;
    }
    const fbxSkeleton = skinned.skeleton;

    // 建立 FBX bone name → PMX runtimeBone 索引的映射
    const pmxRuntimeBones = pmxModel.runtimeBones;
    const pmxBoneNameToIdx = new Map<string, number>();
    for (let i = 0; i < pmxRuntimeBones.length; i++) {
        pmxBoneNameToIdx.set(pmxRuntimeBones[i].name, i);
    }

    // 匹配 FBX bones 到 PMX bones
    const fbxToPmxBoneIdx = new Map<number, number>(); // fbx bone index → pmx bone index
    let matchCount = 0;
    for (let i = 0; i < fbxSkeleton.bones.length; i++) {
        const fbxBone = fbxSkeleton.bones[i];
        const pmxIdx = pmxBoneNameToIdx.get(fbxBone.name);
        if (pmxIdx !== undefined) {
            fbxToPmxBoneIdx.set(i, pmxIdx);
            matchCount++;
        }
    }

    const matchRate = matchCount / fbxSkeleton.bones.length;
    if (matchRate < 0.5) {
        console.warn(
            `[outfit-overlay] Skeleton retarget failed: only ${matchCount}/${fbxSkeleton.bones.length} bones matched (${Math.round(matchRate * 100)}%)`
        );
        return false;
    }

    console.info(
        `[outfit-overlay] Skeleton retarget: ${matchCount}/${fbxSkeleton.bones.length} bones matched (${Math.round(matchRate * 100)}%)`
    );

    // 获取 PMX 的 Babylon.js skeleton（从 rootMesh metadata 获取）
    const rootMeta = inst.rootMesh.metadata as { skeleton?: Skeleton } | undefined;
    const pmxSkeleton = rootMeta?.skeleton;
    if (!pmxSkeleton) {
        console.warn('[outfit-overlay] PMX model has no skeleton in metadata');
        return false;
    }

    // 对每个 skinned mesh：重建 bone weight index 映射
    for (const mesh of fbxMeshes) {
        if (!mesh.skeleton) {
            continue;
        }

        // 获取 mesh 的 bone weight buffer
        const matricesWeights = mesh.getVerticesData('matricesWeights');
        const matricesIndices = mesh.getVerticesData('matricesIndices');
        if (!matricesWeights || !matricesIndices) {
            continue;
        }

        // 重建 matricesIndices：FBX bone index → PMX bone index
        const newIndices = new Float32Array(matricesIndices.length);
        let remapped = 0;
        for (let i = 0; i < matricesIndices.length; i++) {
            const fbxIdx = matricesIndices[i];
            const pmxIdx = fbxToPmxBoneIdx.get(fbxIdx);
            if (pmxIdx !== undefined) {
                newIndices[i] = pmxIdx;
                remapped++;
            } else {
                // 未匹配的 bone → 映射到根 bone (index 0)
                newIndices[i] = 0;
            }
        }

        // 更新 vertex buffer
        mesh.setVerticesData('matricesIndices', newIndices);

        // 切换 skeleton 引用
        mesh.skeleton = pmxSkeleton;
    }

    // 释放 FBX 原 skeleton（不再被任何 mesh 引用）
    try {
        fbxSkeleton.dispose();
    } catch {
        // ignore disposal errors
    }

    return true;
}

// ============================================================
// Load overlay
// ============================================================

/**
 * 加载 FBX overlay 并尝试绑定到模型 skeleton。
 * @param inst 模型实例
 * @param meshFile FBX 相对路径（相对模型目录）
 * @param scene Babylon scene
 * @returns 加载的 mesh 列表，失败返回空数组
 */
export async function loadOverlay(
    inst: ModelInstance,
    meshFile: string,
    scene: Scene
): Promise<Mesh[]> {
    const url = `http://127.0.0.1:${inst.port}/${_encodePath(meshFile)}`;
    console.info(`[outfit-overlay] Loading FBX overlay: ${meshFile}`);

    try {
        const result = await ImportMeshAsync(url, scene);
        const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);

        if (meshes.length === 0) {
            console.warn('[outfit-overlay] FBX loaded but no meshes found');
            return [];
        }

        // 尝试骨骼重定向
        let skeletonOk = false;
        if (inst.mmdModel) {
            skeletonOk = retargetSkeleton(inst, meshes);
        }

        if (!skeletonOk) {
            // 降级：静态叠加，parent 到 rootMesh
            console.info('[outfit-overlay] Falling back to static overlay (parent rootMesh)');
            for (const m of meshes) {
                m.parent = inst.rootMesh;
            }
        }

        // 标记为 overlay（避免被 outfit 纹理替换逻辑处理）
        for (const m of meshes) {
            m.metadata = { ...(m.metadata ?? {}), outfitOverlay: true };
        }

        inst._overlayMeshes = meshes;
        return meshes;
    } catch (err) {
        console.error('[outfit-overlay] Failed to load FBX overlay:', err);
        return [];
    }
}

// ============================================================
// Material hide/restore
// ============================================================

/**
 * 隐藏指定材质名的 PMX mesh（保存原始可见性用于恢复）。
 */
export function hideMaterials(inst: ModelInstance, materialNames: string[]): void {
    if (!materialNames || materialNames.length === 0) {
        return;
    }

    const nameSet = new Set(materialNames.map((n) => n.toLowerCase()));

    if (!inst._origMaterialVisibility) {
        inst._origMaterialVisibility = new Map();
    }

    for (let i = 0; i < inst.meshes.length; i++) {
        const mesh = inst.meshes[i];
        const mat = mesh.material;
        if (!mat) {
            continue;
        }

        // 按材质名匹配
        if (nameSet.has(mat.name.toLowerCase())) {
            // 只在第一次保存原始可见性
            if (!inst._origMaterialVisibility.has(i)) {
                inst._origMaterialVisibility.set(i, mesh.isEnabled());
            }
            mesh.setEnabled(false);
        }
    }
}

/**
 * 恢复被 hideMaterials 隐藏的 PMX mesh 可见性。
 */
export function restoreMaterials(inst: ModelInstance): void {
    if (!inst._origMaterialVisibility) {
        return;
    }

    for (const [idx, wasVisible] of inst._origMaterialVisibility) {
        if (idx < inst.meshes.length) {
            inst.meshes[idx].setEnabled(wasVisible);
        }
    }
    inst._origMaterialVisibility = undefined;
}

// ============================================================
// Dispose
// ============================================================

/**
 * 释放 overlay mesh 并清理引用。
 */
export function disposeOverlay(inst: ModelInstance): void {
    if (!inst._overlayMeshes) {
        return;
    }

    // 获取 PMX skeleton 用于比较（避免误释放共享 skeleton）
    const rootMeta = inst.rootMesh.metadata as { skeleton?: Skeleton } | undefined;
    const pmxSkeleton = rootMeta?.skeleton;

    const disposedSkeletons = new Set<Skeleton>();
    for (const mesh of inst._overlayMeshes) {
        try {
            // 如果 mesh 有独立 skeleton（未重定向成功），先释放
            if (
                mesh.skeleton &&
                mesh.skeleton !== pmxSkeleton &&
                !disposedSkeletons.has(mesh.skeleton)
            ) {
                disposedSkeletons.add(mesh.skeleton);
                mesh.skeleton.dispose();
            }
            mesh.dispose();
        } catch {
            // ignore disposal errors
        }
    }
    inst._overlayMeshes = undefined;
}
