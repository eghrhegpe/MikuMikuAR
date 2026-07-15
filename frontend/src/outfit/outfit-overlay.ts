// [doc:architecture] Outfit Overlay — FBX 布料叠加层加载/骨骼重定向/生命周期
// 职责: 从 MD 导出的 FBX 加载叠加 mesh，绑定到 PMX skeleton，管理隐藏/恢复

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Scene } from '@babylonjs/core/scene';

import { type ModelInstance } from '../core/config';
import { encodeFileRef } from '../core/fileservice';
import { normPath, logWarn } from '../core/utils';

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
        logWarn(
            'outfit-overlay',
            `Skeleton retarget failed: only ${matchCount}/${fbxSkeleton.bones.length} bones matched (${Math.round(matchRate * 100)}%)`
        );
        return false;
    }

    console.info(
        `[outfit-overlay] Skeleton retarget: ${matchCount}/${fbxSkeleton.bones.length} bones matched (${Math.round(matchRate * 100)}%)`
    );

    // 预计算：每个 FBX bone 的有效 PMX 索引
    // 自身已匹配 → 用自身；否则向上回溯父骨骼链寻找第一个已匹配祖先；都无 → null（权重清空）
    const boneToIndex = new Map<Bone, number>();
    for (let i = 0; i < fbxSkeleton.bones.length; i++) {
        boneToIndex.set(fbxSkeleton.bones[i], i);
    }
    const effectivePmxIdx: (number | null)[] = new Array(fbxSkeleton.bones.length).fill(null);
    for (let i = 0; i < fbxSkeleton.bones.length; i++) {
        let curBone: Bone | null = fbxSkeleton.bones[i];
        let resolved: number | null = null;
        while (curBone) {
            const ci = boneToIndex.get(curBone);
            if (ci !== undefined) {
                const pmx = fbxToPmxBoneIdx.get(ci);
                if (pmx !== undefined) {
                    resolved = pmx;
                    break;
                }
            }
            curBone = curBone.getParent();
        }
        effectivePmxIdx[i] = resolved;
    }

    // 获取 PMX 的 Babylon.js skeleton（从 rootMesh metadata 获取）
    const rootMeta = inst.rootMesh.metadata as { skeleton?: Skeleton } | undefined;
    const pmxSkeleton = rootMeta?.skeleton;
    if (!pmxSkeleton) {
        logWarn('outfit-overlay', 'PMX model has no skeleton in metadata');
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

        // 重建 matricesIndices：FBX bone index → PMX bone index（含父链回退）
        // 无匹配祖先的权重槽置 0 并重归一化，避免误映射到根骨骼导致严重变形
        const newIndices = new Float32Array(matricesIndices.length);
        const newWeights = new Float32Array(matricesWeights); // 复制原权重，仅供 dropped 槽重归一化
        const vertexCount = matricesIndices.length / 4;
        let _remapped = 0;
        let unmatched = 0;
        let meshDropped = false;
        for (let v = 0; v < vertexCount; v++) {
            const base = v * 4;
            let anyDropped = false;
            for (let s = 0; s < 4; s++) {
                const slot = base + s;
                const fbxIdx = matricesIndices[slot];
                const eff = effectivePmxIdx[fbxIdx];
                if (eff !== null) {
                    newIndices[slot] = eff;
                    _remapped++;
                } else {
                    // 无匹配祖先：该权重槽失效，置 0 并将骨骼指向占位（权重为 0 不影响形变）
                    newIndices[slot] = 0;
                    newWeights[slot] = 0;
                    anyDropped = true;
                    unmatched++;
                }
            }
            if (anyDropped) {
                meshDropped = true;
                let totalW = 0;
                for (let s = 0; s < 4; s++) {
                    totalW += newWeights[base + s];
                }
                if (totalW > 1e-5) {
                    const inv = 1 / totalW;
                    for (let s = 0; s < 4; s++) {
                        newWeights[base + s] *= inv;
                    }
                }
            }
        }
        if (unmatched > 0) {
            logWarn(
                'outfit-overlay',
                `${unmatched}/${matricesIndices.length} bone weights unmatched on mesh "${mesh.name}", mapped to parent chain / zeroed (no longer root bone)`
            );
        }

        // 更新 vertex buffer
        mesh.setVerticesData('matricesIndices', newIndices);
        if (meshDropped) {
            mesh.setVerticesData('matricesWeights', newWeights);
        }

        // 切换 skeleton 引用
        mesh.skeleton = pmxSkeleton;
    }

    // 释放 FBX 原 skeleton：仅当确认没有 mesh 仍引用它时（防止悬空指针）
    const stillReferenced = fbxMeshes.some((m) => m.skeleton === fbxSkeleton);
    if (!stillReferenced) {
        try {
            fbxSkeleton.dispose();
        } catch {
            // ignore disposal errors
        }
    } else {
        logWarn(
            'outfit-overlay',
            'FBX skeleton still referenced by a mesh; skip dispose to avoid dangling pointer'
        );
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
 * @returns { meshes, retargetOk } — meshes 为加载的 mesh 列表（失败为空数组），retargetOk 表示骨骼重定向是否成功
 */
export async function loadOverlay(
    inst: ModelInstance,
    meshFile: string,
    scene: Scene
): Promise<{ meshes: Mesh[]; retargetOk: boolean }> {
    // meshFile 必须是相对路径（相对模型目录），拒绝绝对路径与路径穿越
    if (
        /^[A-Za-z]:[\\/]/.test(meshFile) ||
        meshFile.startsWith('/') ||
        meshFile.startsWith('\\\\')
    ) {
        console.error(
            `[outfit-overlay] meshFile must be a relative path (got "${meshFile}"). Use a path relative to the model directory, e.g. "subdir/dress.fbx"`
        );
        return { meshes: [], retargetOk: false };
    }
    // 防御纵深：拒绝 `..` 路径穿越（Go 侧 IsolateModelDir 已兜底，TS 侧提前拒绝便于诊断）
    if (/(^|\/)\.\.(\/|$)/.test(normPath(meshFile))) {
        console.error(
            `[outfit-overlay] meshFile must not contain parent directory traversal (got "${meshFile}")`
        );
        return { meshes: [], retargetOk: false };
    }
    // [doc:adr-057] meshFile 是相对模型目录的路径（可能含子目录）
    // 先 normalize 反斜杠→正斜杠，再 base64url 编码为查询参数
    const normalizedMeshFile = normPath(meshFile);
    const url = `http://127.0.0.1:${inst.port}/?f=${encodeFileRef(normalizedMeshFile)}`;
    console.info(`[outfit-overlay] Loading FBX overlay: ${meshFile}`);

    try {
        const result = await ImportMeshAsync(url, scene);
        const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);

        if (meshes.length === 0) {
            logWarn('outfit-overlay', 'FBX loaded but no meshes found');
            return { meshes: [], retargetOk: false };
        }

        // 尝试骨骼重定向
        let skeletonOk = false;
        if (inst.mmdModel) {
            skeletonOk = retargetSkeleton(inst, meshes);
        }

        if (!skeletonOk) {
            // Fail-Fast: 骨骼重定向失败，直接抛错
            throw new Error('outfit-overlay: 骨骼重定向匹配率过低，无法叠加');
        }

        // 标记为 overlay（避免被 outfit 纹理替换逻辑处理）
        for (const m of meshes) {
            m.metadata = { ...(m.metadata ?? {}), outfitOverlay: true };
        }

        inst._overlayMeshes = meshes;
        return { meshes, retargetOk: skeletonOk };
    } catch (err) {
        console.error('[outfit-overlay] Failed to load FBX overlay:', err);
        return { meshes: [], retargetOk: false };
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
            const meshSkeleton = mesh.skeleton;
            mesh.skeleton = null; // 清空引用，避免 mesh.dispose() 内部访问已释放的 skeleton
            if (
                meshSkeleton &&
                meshSkeleton !== pmxSkeleton &&
                !disposedSkeletons.has(meshSkeleton)
            ) {
                disposedSkeletons.add(meshSkeleton);
                meshSkeleton.dispose();
            }
            mesh.dispose();
        } catch (err) {
            // 记录但继续释放其余 mesh，避免单个失败中断整循环
            logWarn('outfit-overlay', 'mesh dispose failed', err);
        }
    }
    inst._overlayMeshes = undefined;
}
