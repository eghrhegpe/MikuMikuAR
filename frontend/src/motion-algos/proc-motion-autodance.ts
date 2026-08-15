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
    type ProcMotionParams,
} from './proc-motion-shared';

import {
    buildTrigCache,
    resolveBones,
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
    genElbowBones,
    applyInterp,
    applyInterpOverride,
} from './proc-motion-autodance-bones';

import { generateEmotionMorphs } from './proc-motion-autodance-emotion';

/**
 * 生成 AutoDance VMD
 *
 * @param params      autodance 模式专属参数（含开关/强度/速度/插值覆写）
 * @param bpm         节拍 BPM（clamp 60–200）
 * @param morphNames  可用的 morph 名称列表
 * @param boneNames   可用的骨骼名称列表
 */
export function generateAutoDanceVmd(
    params: ProcMotionParams,
    bpm: number,
    morphNames: readonly string[] = [],
    boneNames: readonly string[] = []
): ArrayBuffer {
    // ========================================================================
    // 1. 参数计算
    // ========================================================================
    const rawSpeed = Number.isNaN(params.speed) ? 1.0 : params.speed;
    const safeSpeed = Math.max(0.1, Math.min(10, rawSpeed));
    const clampedBpm = Math.max(60, Math.min(200, Number.isNaN(bpm) ? 120 : bpm));
    const beatFrames = Math.min(MAX_FRAMES, Math.round(((60 / clampedBpm) * FPS) / safeSpeed));
    // [audit:round35 P2] loopFrames 同样封顶：此前只封 beatFrames 再 ×8，极端参数
    // （speed=0.1）下可达 2400，容量封顶被静默绕开，与 idle 分支（600）语义不一致。
    const loopFrames = Math.min(MAX_FRAMES, beatFrames * 8);
    const intensity = params.intensity;

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
        ...(resolution.centerBone && params.boneToggles.center
            ? genCenterBone(resolution.centerBone, params, cache, intensity)
            : []),
        ...(resolution.upperBone && params.boneToggles.upper
            ? genUpperBone(resolution.upperBone, params, cache, intensity)
            : []),
        ...(resolution.upper2Bone && params.boneToggles.upper2
            ? genUpper2Bone(resolution.upper2Bone, params, cache, intensity)
            : []),
        ...(resolution.waistBone && params.boneToggles.waist
            ? genWaistBone(resolution.waistBone, params, cache, intensity)
            : []),
        ...(resolution.larmBone && resolution.rarmBone && params.boneToggles.arm
            ? genArmBones(resolution.larmBone, resolution.rarmBone, params, cache, intensity)
            : []),
        ...(params.boneToggles.arm
            ? genElbowBones(resolution.elbowLBone, resolution.elbowRBone, params, cache, intensity)
            : []),
        ...(resolution.grooveBone && params.boneToggles.groove
            ? genGrooveBone(resolution.grooveBone, params, cache, intensity)
            : []),
        ...(resolution.shoulderLBone && resolution.shoulderRBone && params.boneToggles.shoulder
            ? genShoulderBones(
                  resolution.shoulderLBone,
                  resolution.shoulderRBone,
                  params,
                  cache,
                  intensity
              )
            : []),
        ...(resolution.allParentBone && params.boneToggles.allParent
            ? genAllParentBone(resolution.allParentBone, params, cache, intensity)
            : []),
        ...(resolution.wristLBone && resolution.wristRBone && params.boneToggles.wrist
            ? genWristBones(resolution.wristLBone, resolution.wristRBone, params, cache, intensity)
            : []),
        ...(params.boneToggles.footIk && resolution.legIkLBone && resolution.legIkRBone
            ? genFootIkBones(resolution.legIkLBone, resolution.legIkRBone, params, cache, intensity)
            : []),
    ];

    // ========================================================================
    // 5. 插值类型
    // ========================================================================
    let overrideInterp:
        typeof INTERP_SHARP | typeof INTERP_EASE_IN_OUT | typeof INTERP_EASE_OUT | null = null;
    if (params.interpOverride === 'sharp') {
        overrideInterp = INTERP_SHARP;
    } else if (params.interpOverride === 'ease-in-out') {
        overrideInterp = INTERP_EASE_IN_OUT;
    } else if (params.interpOverride === 'ease-out') {
        overrideInterp = INTERP_EASE_OUT;
    }

    if (overrideInterp) {
        applyInterpOverride(bones, overrideInterp);
    } else {
        applyInterp(bones, resolution);
    }

    // ========================================================================
    // 6. 情绪 morph（独立模块）
    // ========================================================================
    const morphs = params.boneToggles.emotion
        ? generateEmotionMorphs(morphNames, beatFrames, loopFrames, intensity).morphs
        : [];

    // ========================================================================
    // 7. 组装 VMD
    // ========================================================================
    return buildVmd(bones, morphs, PROC_VMD_NAME_AUTODANCE);
}

// 保持向后兼容的导出（供 proc-motion-bridge.ts 等调用方使用）
