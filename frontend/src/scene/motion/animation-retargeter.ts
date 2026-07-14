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
import { logWarn, setStatus } from '@/core/config';
import { t } from '@/core/i18n/t';

// ======== 类型导出 ========

export type BoneMapPreset = 'mixamo' | 'vrm' | 'custom';

export interface RetargetResult {
    animationGroup: AnimationGroup;
    sourceSkeleton: Skeleton;
    boneMapName: string;
}

// ======== 骨骼映射预设 ========

const PRESET_BONE_MAPS: Record<Exclude<BoneMapPreset, 'custom'>, Record<string, string>> = {
    mixamo: MixamoMmdHumanoidBoneMap as unknown as Record<string, string>,
    vrm: VrmMmdHumanoidBoneMap as unknown as Record<string, string>,
};

/** 获取可用骨骼映射预设列表。 */
export function getBoneMapPresets(): Array<{ id: string; label: string }> {
    return [
        { id: 'mixamo', label: 'Mixamo' },
        { id: 'vrm', label: 'VRM' },
        { id: 'custom', label: t('motion.retarget.customMap') },
    ];
}

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
    setStatus(t('motion.retarget.loading'), false);
    let result: {
        meshes: import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[];
        animationGroups: AnimationGroup[];
    };
    try {
        // 根据扩展名推断 pluginExtension
        const ext = url.split('.').pop()?.toLowerCase();
        const _pluginExtension = ext === 'fbx' ? '.fbx' : ext === 'glb' ? '.glb' : '.gltf';
        result = await ImportMeshAsync(url, scene, {
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    // 可选：显示加载进度
                }
            },
        });
    } catch (err) {
        logWarn('retarget', 'load animation failed:', err);
        setStatus(t('motion.retarget.loadFailed'), false);
        return null;
    }

    // 2. 提取动画组和源骨骼
    const animationGroups = result.animationGroups;
    if (!animationGroups || animationGroups.length === 0) {
        logWarn('retarget', 'no animation groups found');
        setStatus(t('motion.retarget.noAnimation'), false);
        _cleanupTempMeshes(result.meshes);
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
        setStatus(t('motion.retarget.noSkeleton'), false);
        _cleanupTempMeshes(result.meshes);
        return null;
    }

    // 3. 获取骨骼映射
    let boneNameMap: Record<string, string>;
    if (boneMapPreset === 'custom' && customBoneMap) {
        boneNameMap = customBoneMap;
    } else {
        boneNameMap = PRESET_BONE_MAPS[boneMapPreset === 'custom' ? 'mixamo' : boneMapPreset];
    }

    // 4. 执行重定向
    setStatus(t('motion.retarget.retargeting'), false);
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
            setStatus(t('motion.retarget.failed'), false);
            _cleanupTempMeshes(result.meshes);
            return null;
        }
        setStatus(t('motion.retarget.success'), true);
        return {
            animationGroup: retargeted,
            sourceSkeleton,
            boneMapName: boneMapPreset,
        };
    } catch (err) {
        logWarn('retarget', 'retargetAnimation failed:', err);
        setStatus(t('motion.retarget.failed'), false);
        _cleanupTempMeshes(result.meshes);
        return null;
    }
}

/**
 * 播放重定向后的动画（additive 模式，叠加在 VMD 之上）。
 * 返回 stop 函数，调用后停止动画并清理临时资源。
 */
export function playRetargetedAnimation(
    scene: Scene,
    result: RetargetResult,
    loop = true
): () => void {
    const { animationGroup } = result;
    animationGroup.isAdditive = true;
    animationGroup.weight = 1;
    animationGroup.play(loop ? undefined : null); // null = play once, undefined = loop

    // 返回 stop 函数
    let stopped = false;
    return () => {
        if (stopped) {
            return;
        }
        stopped = true;
        animationGroup.stop();
        animationGroup.dispose();
    };
}

/** 清理加载动画时创建的临时网格。 */
function _cleanupTempMeshes(
    meshes: import('@babylonjs/core/Meshes/abstractMesh').AbstractMesh[]
): void {
    for (const mesh of meshes) {
        mesh.dispose();
    }
}
