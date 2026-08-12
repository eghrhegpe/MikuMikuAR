// [doc:architecture] AnimationRetargeter — 外部动作重定向桥接模块
// 将 Mixamo/VRM/GLB 等外部人形动画重定向到 MMD 骨骼，扩展动作来源。
//
// 工作原理：
// 1. 加载外部动画文件（FBX/GLB/GLTF）→ Babylon.js AnimationGroup
// 2. AnimationRetargeter 重映射骨骼名 → 输出等效 MMD 骨骼动画
// 3. 重定向后的 AnimationGroup 以 additive 模式播放，叠加在 VMD 之上
//
// 与 ADR-061 骨骼映射模块共享 MixamoMmdHumanoidBoneMap / VrmMmdHumanoidBoneMap 预设。

import { AnimationRetargeter } from 'babylon-mmd/esm/Loader/Util/animationRetargeter';
import {
    MixamoMmdHumanoidBoneMap,
    VrmMmdHumanoidBoneMap,
} from 'babylon-mmd/esm/Loader/Util/mmdHumanoidMapper';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Scene } from '@babylonjs/core/scene';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { modelRegistry } from '@/core/config';
import { feedbackInfo, feedbackStatus } from '@/core/feedback';
import { logWarn } from '@/core/logger';

// ======== 类型导出 ========

export type BoneMapPreset = 'mixamo' | 'vrm' | 'custom';

export interface RetargetResult {
    animationGroup: AnimationGroup;
    boneMapName: string;
}

/** 当前活跃的 retarget 动画状态（用于场景序列化）。 */
export interface RetargetPlayState {
    /** 动画源文件路径（FBX/GLB/GLTF） */
    filePath: string;
    /** 骨骼映射预设名 */
    boneMapPreset: BoneMapPreset;
}

// ======== 全局状态 ========

let _currentRetarget: RetargetPlayState | null = null;
let _stopCurrentRetarget: (() => void) | null = null;

/** 获取当前活跃的 retarget 动画播放状态，用于场景序列化。 */
export function getRetargetPlayState(): RetargetPlayState | null {
    return _currentRetarget;
}

/** 停止当前 retarget 动画并清理。 */
export function stopCurrentRetarget(): void {
    if (_stopCurrentRetarget) {
        _stopCurrentRetarget();
        _stopCurrentRetarget = null;
    }
    _currentRetarget = null;
}

// ======== 骨骼映射预设 ========

const PRESET_BONE_MAPS: Record<Exclude<BoneMapPreset, 'custom'>, Record<string, string>> = {
    mixamo: MixamoMmdHumanoidBoneMap as unknown as Record<string, string>,
    vrm: VrmMmdHumanoidBoneMap as unknown as Record<string, string>,
};

/**
 * 从外部动画文件加载并重定向到 MMD 骨骼。
 *
 * @param scene        Babylon.js 场景
 * @param url          动画文件 URL（FBX/GLB/GLTF）
 * @param targetSkeleton 目标 MMD 模型的骨骼
 * @param boneMapPreset 骨骼映射预设名
 * @param customBoneMap 自定义骨骼映射（仅 preset='custom' 时使用）
 * @returns 重定向后的 AnimationGroup + 源骨骼信息
 */
export async function loadAndRetargetAnimation(
    scene: Scene,
    url: string,
    targetSkeleton: Skeleton,
    boneMapPreset: BoneMapPreset,
    customBoneMap?: Record<string, string>
): Promise<RetargetResult | null> {
    // 1. 加载外部动画文件
    feedbackStatus('motion.retarget.loading', undefined, false);
    let result: {
        meshes: import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[];
        animationGroups: AnimationGroup[];
    };
    try {
        result = await ImportMeshAsync(url, scene);
    } catch (err) {
        logWarn('retarget', 'load animation failed:', err);
        feedbackStatus('motion.retarget.loadFailed', undefined, false);
        return null;
    }

    // 2. 提取动画组和源骨骼
    const animationGroups = result.animationGroups;
    if (!animationGroups || animationGroups.length === 0) {
        logWarn('retarget', 'no animation groups found');
        feedbackStatus('motion.retarget.noAnimation', undefined, false);
        _cleanupTempMeshes(result.meshes, result.animationGroups);
        return null;
    }

    const animationGroup = animationGroups[0];
    // 从加载的网格中查找第一个骨骼
    let sourceSkeleton: Skeleton | null = null;
    for (const mesh of result.meshes) {
        if (mesh.skeleton) {
            sourceSkeleton = mesh.skeleton;
            break;
        }
    }
    if (!sourceSkeleton) {
        logWarn('retarget', 'no skeleton found in loaded file');
        feedbackStatus('motion.retarget.noSkeleton', undefined, false);
        _cleanupTempMeshes(result.meshes, result.animationGroups);
        return null;
    }

    // 3. 获取骨骼映射
    // [fix] custom 预设仅在传入非空映射时采用；空对象（{}）或未传 → 回退 mixamo，
    // 否则空映射会产生退化重定向（空动画）。未知预设字符串同样回退 mixamo，
    // 避免 PRESET_BONE_MAPS[...] 为 undefined 导致 setBoneMap(undefined) 崩溃。
    const hasCustomMap =
        boneMapPreset === 'custom' && !!customBoneMap && Object.keys(customBoneMap).length > 0;
    const boneNameMap = hasCustomMap
        ? customBoneMap!
        : (PRESET_BONE_MAPS[boneMapPreset === 'custom' ? 'mixamo' : boneMapPreset] ??
          PRESET_BONE_MAPS.mixamo);

    // 4. 执行重定向
    feedbackStatus('motion.retarget.retargeting', undefined, false);
    try {
        const retargeter = new AnimationRetargeter();
        retargeter.setBoneMap(boneNameMap);
        retargeter.setSourceSkeleton(sourceSkeleton);
        retargeter.setTargetSkeleton(targetSkeleton);
        const retargeted = retargeter.retargetAnimation(animationGroup, {
            cloneAnimation: true,
            removeBoneRotationOffset: false,
        });
        if (!retargeted) {
            logWarn('retarget', 'retargetAnimation returned null');
            feedbackStatus('motion.retarget.failed', undefined, false);
            _cleanupTempMeshes(result.meshes, result.animationGroups);
            return null;
        }
        feedbackInfo('motion.retarget.success', undefined);
        // retarget 成功且 cloneAnimation:true 后，源 mesh 不再需要（动画已克隆到目标骨骼）
        _cleanupTempMeshes(result.meshes, result.animationGroups);
        return {
            animationGroup: retargeted,
            boneMapName: boneMapPreset,
        };
    } catch (err) {
        logWarn('retarget', 'retargetAnimation failed:', err);
        feedbackStatus('motion.retarget.failed', undefined, false);
        _cleanupTempMeshes(result.meshes, result.animationGroups);
        return null;
    }
}

/**
 * 播放重定向后的动画（additive 模式，叠加在 VMD 之上）。
 * 自动停止前一个 retarget 动画，并保存播放状态供场景序列化使用。
 *
 * @param scene   Babylon.js 场景
 * @param result  重定向结果
 * @param filePath 动画源文件路径（用于状态记录）
 * @param loop    是否循环播放
 * @returns stop 函数
 */
export function playRetargetedAnimation(
    _scene: Scene,
    result: RetargetResult,
    filePath: string,
    loop = true
): () => void {
    // 停止前一个 retarget 动画
    stopCurrentRetarget();

    const { animationGroup, boneMapName } = result;
    animationGroup.isAdditive = true;
    animationGroup.weight = 1;
    animationGroup.play(loop);

    // 保存状态
    _currentRetarget = {
        filePath,
        boneMapPreset: boneMapName as BoneMapPreset,
    };

    let stopped = false;
    _stopCurrentRetarget = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        animationGroup.stop();
        animationGroup.dispose();
        _currentRetarget = null;
        _stopCurrentRetarget = null;
    };

    return _stopCurrentRetarget;
}

/** 清理加载动画时创建的临时网格。 */
function _cleanupTempMeshes(
    meshes: import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[],
    animationGroups?: AnimationGroup[]
): void {
    // [fix P2] mesh.dispose() 不释放其 skeleton：源文件加载的临时骨骼
    // （retarget 用 cloneAnimation:true 后动画已克隆到目标骨骼）必须显式 dispose，
    // 否则每次 loadAndRetargetAnimation 都在场景累积一组源骨骼 + 动画组。
    // 用 Set 去重：GLB/FBX 通常多个 mesh 共享同一骨架，避免二次 dispose。
    const skeletons = new Set<Skeleton>();
    for (const mesh of meshes) {
        if (mesh.skeleton) {
            skeletons.add(mesh.skeleton);
        }
        mesh.dispose();
    }
    for (const sk of skeletons) {
        sk.dispose();
    }
    if (animationGroups) {
        for (const group of animationGroups) {
            // [fix P2] 源 AnimationGroup 泄漏：retargeted 是 cloneAnimation:true 的克隆，
            // 源 group 生命周期结束，须显式 dispose（dispose 克隆不影响）。
            group.dispose();
        }
    }
}

/**
 * 从已加载的模型恢复 retarget 动画（场景反序列化用）。
 * 自动停止前一个 retarget 动画，查找目标模型的骨骼，加载并播放。
 *
 * @param filePath      动画源文件路径
 * @param boneMapPreset 骨骼映射预设
 * @param modelId       目标模型运行时 ID
 * @returns 恢复成功返回 true
 */
export async function restoreRetargetAnimation(
    filePath: string,
    boneMapPreset: BoneMapPreset,
    modelId: string
): Promise<boolean> {
    const inst = modelRegistry.get(modelId);
    if (!inst || !inst.mmdModel) {
        logWarn('retarget', 'restore: model not found or no mmdModel, id=', modelId);
        return false;
    }

    const mesh = inst.mmdModel.mesh;
    if (!mesh || !mesh.skeleton) {
        logWarn('retarget', 'restore: model has no skeleton, id=', modelId);
        return false;
    }

    const scene = mesh.getScene();
    const result = await loadAndRetargetAnimation(scene, filePath, mesh.skeleton, boneMapPreset);
    if (!result) {
        return false;
    }

    playRetargetedAnimation(scene, result, filePath);
    return true;
}
