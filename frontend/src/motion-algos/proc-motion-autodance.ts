/**
 * proc-motion-autodance.ts
 * 程序化舞蹈 VMD 生成 — 主入口
 *
 * 架构（ADR-XXX Phase 2 重构）：
 * - proc-motion-autodance-bones.ts  │ 骨骼帧生成 + 三角函数预计算
 * - proc-motion-autodance-emotion.ts│ 情绪引擎：morph 评分 + 帧生成
 * - proc-motion-autodance.ts  ← 本文件 │ 主入口 + 插值覆写 + VMD 组装
 */
import { buildVmd, INTERP_EASE_IN_OUT, INTERP_EASE_OUT, INTERP_SHARP } from './vmd-writer';
import {
    FPS,
    MAX_FRAMES,
    PROC_VMD_NAME_AUTODANCE,
    type ProcMotionState,
} from './proc-motion-shared';

import {
    buildTrigCache,
    type TrigCache,
    resolveBones,
    type BoneResolution,
    genCenterBone,
    genUpperBone,
    genUpper2Bone,
    genWaistBone,
    genArmBones,
    genGrooveBone,
    genShoulderBones,
    genAllParentBone,
    genWristBones,
    genFootIkBones,
    applyInterp,
    applyInterpOverride,
} from './proc-motion-autodance-bones';

import { generateEmotionMorphs } from './proc-motion-autodance-emotion';

/**
 * 生成 AutoDance VMD
 *
 * @param state       程序化运动状态（含开关/强度/速度）
 * @param bpm         节拍 BPM（clamp 60–200）
 * @param morphNames  可用的 morph 名称列表
 * @param boneNames   可用的骨骼名称列表
 */
export function generateAutoDanceVmd(
    state: ProcMotionState,
    bpm: number,
    morphNames: readonly string[] = [],
    boneNames: readonly string[] = []
): ArrayBuffer {
    // ========================================================================
    // 1. 参数计算
    // ========================================================================
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    const beatFrames = Math.min(MAX_FRAMES, Math.round(((60 / clampedBpm) * FPS) / safeSpeed));
    const loopFrames = beatFrames * 8;
    const intensity = state.intensity;

    // ========================================================================
    // 2. 骨骼解析
    // ========================================================================
    const resolution = resolveBones([...boneNames]);

    // ========================================================================
    // 3. 三角函数预计算
    // ========================================================================
    const cache = buildTrigCache(loopFrames, beatFrames);

    // ========================================================================
    // 4. 骨骼帧生成
    // ========================================================================
    const bones = [
        ...(resolution.centerBone && state.boneToggles.center
            ? genCenterBone(resolution.centerBone, state, cache, intensity)
            : []),
        ...(resolution.upperBone && state.boneToggles.upper
            ? genUpperBone(resolution.upperBone, state, cache, intensity)
            : []),
        ...(resolution.upper2Bone && state.boneToggles.upper2
            ? genUpper2Bone(resolution.upper2Bone, state, cache, intensity)
            : []),
        ...(resolution.waistBone && state.boneToggles.waist
            ? genWaistBone(resolution.waistBone, state, cache, intensity)
            : []),
        ...(resolution.larmBone && resolution.rarmBone && state.boneToggles.arm
            ? genArmBones(resolution.larmBone, resolution.rarmBone, state, cache, intensity)
            : []),
        ...(resolution.grooveBone && state.boneToggles.groove
            ? genGrooveBone(resolution.grooveBone, state, cache, intensity)
            : []),
        ...(resolution.shoulderLBone && resolution.shoulderRBone && state.boneToggles.shoulder
            ? genShoulderBones(
                  resolution.shoulderLBone,
                  resolution.shoulderRBone,
                  state,
                  cache,
                  intensity
              )
            : []),
        ...(resolution.allParentBone && state.boneToggles.allParent
            ? genAllParentBone(resolution.allParentBone, state, cache, intensity)
            : []),
        ...(resolution.wristLBone && resolution.wristRBone && state.boneToggles.wrist
            ? genWristBones(resolution.wristLBone, resolution.wristRBone, state, cache, intensity)
            : []),
        ...(state.boneToggles.footIk && resolution.legIkLBone && resolution.legIkRBone
            ? genFootIkBones(resolution.legIkLBone, resolution.legIkRBone, state, cache, intensity)
            : []),
    ];

    // ========================================================================
    // 5. 插值类型
    // ========================================================================
    let overrideInterp:
        typeof INTERP_SHARP | typeof INTERP_EASE_IN_OUT | typeof INTERP_EASE_OUT | null = null;
    if (state.interpOverride === 'sharp') {
        overrideInterp = INTERP_SHARP;
    } else if (state.interpOverride === 'ease-in-out') {
        overrideInterp = INTERP_EASE_IN_OUT;
    } else if (state.interpOverride === 'ease-out') {
        overrideInterp = INTERP_EASE_OUT;
    }

    if (overrideInterp) {
        applyInterpOverride(bones, overrideInterp);
    } else {
        applyInterp(bones, resolution, overrideInterp);
    }

    // ========================================================================
    // 6. 情绪 morph（独立模块）
    // ========================================================================
    const morphs = state.boneToggles.emotion
        ? generateEmotionMorphs(morphNames, beatFrames, loopFrames, intensity).morphs
        : [];

    // ========================================================================
    // 7. 组装 VMD
    // ========================================================================
    return buildVmd(bones, morphs, PROC_VMD_NAME_AUTODANCE);
}

// 保持向后兼容的导出（供 proc-motion-bridge.ts 等调用方使用）
export type { BoneResolution, TrigCache } from './proc-motion-autodance-bones';
export { buildTrigCache, resolveBones } from './proc-motion-autodance-bones';
export {
    scoreMorph,
    findBestEmotionMorphs,
    EMOTION_CANDIDATES,
} from './proc-motion-autodance-emotion';
