/**
 * proc-motion-autodance-bones.ts
 * 骨骼帧生成主入口：三角函数预计算 + 骨骼解析 + 插值设置
 * 躯干骨骼帧 → proc-motion-autodance-bones-trunk.ts
 * 四肢骨骼帧 → proc-motion-autodance-bones-limbs.ts
 */
import { type BoneKeyFrame, INTERP_EASE_IN_OUT, INTERP_EASE_OUT, INTERP_SHARP } from './vmd-writer';
import {
    BONE_CENTER_CANDIDATES,
    BONE_UPPER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_GROOVE_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
    type ProcMotionState,
} from './proc-motion-shared';

// ── re-export 子模块（保持外部导入路径不变） ──
export {
    genCenterBone,
    genUpperBone,
    genUpper2Bone,
    genWaistBone,
    genGrooveBone,
    genAllParentBone,
} from './proc-motion-autodance-bones-trunk';
export {
    genArmBones,
    genWristBones,
    genShoulderBones,
    genFootIkBones,
} from './proc-motion-autodance-bones-limbs';

export interface BoneResolution {
    centerBone: string | null;
    upperBone: string | null;
    upper2Bone: string | null;
    waistBone: string | null;
    grooveBone: string | null;
    larmBone: string | null;
    rarmBone: string | null;
    shoulderLBone: string | null;
    shoulderRBone: string | null;
    allParentBone: string | null;
    wristLBone: string | null;
    wristRBone: string | null;
    legIkLBone: string | null;
    legIkRBone: string | null;
}

/** 预计算 sin/cos 稀疏表（step=3） */
export interface TrigCache {
    sin: number[];
    cos: number[];
    beatFrames: number;
    loopFrames: number;
}

export function buildTrigCache(loopFrames: number, beatFrames: number): TrigCache {
    const sin: number[] = [];
    const cos: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        const angle = (f / beatFrames) * Math.PI;
        sin[f] = Math.sin(angle);
        cos[f] = Math.cos(angle);
    }
    return { sin, cos, beatFrames, loopFrames };
}

/** 安全读取 cache（未填充位置返回 0） */
export function sinVal(cache: TrigCache, f: number): number {
    return cache.sin[f] ?? 0;
}

/** 安全读取 cache（未填充位置返回 0） */
export function cosVal(cache: TrigCache, f: number): number {
    return cache.cos[f] ?? 0;
}

/** 解析骨骼候选名 → 实际骨骼名 */
export function resolveBones(boneNames: string[]): BoneResolution {
    return {
        centerBone: matchBone(boneNames, BONE_CENTER_CANDIDATES),
        upperBone: matchBone(boneNames, BONE_UPPER_CANDIDATES),
        upper2Bone: matchBone(boneNames, BONE_UPPER2_CANDIDATES),
        waistBone: matchBone(boneNames, BONE_WAIST_CANDIDATES),
        grooveBone: matchBone(boneNames, BONE_GROOVE_CANDIDATES),
        larmBone: matchBone(boneNames, BONE_LARM_CANDIDATES),
        rarmBone: matchBone(boneNames, BONE_RARM_CANDIDATES),
        shoulderLBone: matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES),
        shoulderRBone: matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES),
        allParentBone: matchBone(boneNames, BONE_ALLPARENT_CANDIDATES),
        wristLBone: matchBone(boneNames, BONE_WRIST_L_CANDIDATES),
        wristRBone: matchBone(boneNames, BONE_WRIST_R_CANDIDATES),
        legIkLBone: matchBone(boneNames, BONE_LEG_IK_L_CANDIDATES),
        legIkRBone: matchBone(boneNames, BONE_LEG_IK_R_CANDIDATES),
    };
}

type InterpType = typeof INTERP_SHARP | typeof INTERP_EASE_IN_OUT | typeof INTERP_EASE_OUT;

/** 根据骨骼名应用插值类型 */
export function applyInterp(
    bones: BoneKeyFrame[],
    resolution: BoneResolution,
    _override: null | typeof INTERP_SHARP
): void {
    for (const b of bones) {
        const n = b.name;
        if (n === resolution.larmBone || n === resolution.rarmBone) {
            b.interp = INTERP_EASE_OUT;
        } else if (
            n === resolution.centerBone ||
            n === resolution.waistBone ||
            n === resolution.legIkLBone ||
            n === resolution.legIkRBone
        ) {
            b.interp = INTERP_SHARP;
        } else {
            b.interp = INTERP_EASE_IN_OUT;
        }
    }
}

/** 根据用户覆写设置应用插值类型 */
export function applyInterpOverride(
    bones: BoneKeyFrame[],
    overrideInterp: InterpType | null
): void {
    if (!overrideInterp) {
        return;
    }
    for (const b of bones) {
        b.interp = overrideInterp;
    }
}
