/**
 * proc-motion-autodance-bones.ts
 * 骨骼帧生成主入口：节拍栅格辅助 + 骨骼解析 + 插值设置
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
    BONE_ELBOW_L_CANDIDATES,
    BONE_ELBOW_R_CANDIDATES,
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    matchBone,
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
    genElbowBones,
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
    elbowLBone: string | null;
    elbowRBone: string | null;
    legIkLBone: string | null;
    legIkRBone: string | null;
}

export interface TrigCache {
    beatFrames: number;
    loopFrames: number;
}

export function buildTrigCache(loopFrames: number, beatFrames: number): TrigCache {
    return { beatFrames, loopFrames };
}

/**
 * 节拍信息：给定帧号，返回它在拍/循环中的相位。
 * 是「节拍栅格」模型的核心——所有生成器据此踩点，而非裸正弦。
 */
export interface BeatInfo {
    /** 全局拍号（从 0 起） */
    beatIndex: number;
    /** 循环内拍号（0..7，8 拍为一循环） */
    beatInLoop: number;
    /** 当前拍内相位 [0,1) */
    beatPhase: number;
    /** 循环内相位 [0,1) */
    loopPhase: number;
}

export function beatInfo(cache: TrigCache, f: number): BeatInfo {
    const beatFrames = cache.beatFrames;
    const loopFrames = cache.loopFrames;
    const beatIndex = Math.floor(f / beatFrames);
    const beatInLoop = ((beatIndex % 8) + 8) % 8;
    const beatPhase = (f % beatFrames) / beatFrames;
    const loopPhase = f / loopFrames;
    return { beatIndex, beatInLoop, beatPhase, loopPhase };
}

/**
 * 每拍弹跳包络：拍头 0 → 拍中峰值 1 → 拍尾 0。
 * 让位移/旋转在「拍点」达到极值，制造踩点感（替代旧的无拍点连续正弦）。
 */
export function beatBounce(beatPhase: number): number {
    return Math.sin(Math.PI * beatPhase);
}

/**
 * 强拍权重：0/4 为强拍、2/6 为次强、其余为弱拍。
 * 制造节奏层次，打破「每拍都一样」的机械重复。
 */
export function downbeatWeight(beatInLoop: number): number {
    if (beatInLoop % 4 === 0) return 1.0;
    if (beatInLoop % 2 === 0) return 0.8;
    return 0.55;
}

/**
 * 重心左右摆动（2 拍周期，period = 2 * beatFrames）：
 * +1 偏左、-1 偏右。用于重心转移与上下半身联动。
 * 在 f=0 与 f=loopFrames 处均为 0（周期整除循环长度），保证无缝循环。
 */
export function swayAt(cache: TrigCache, f: number): number {
    return Math.sin((2 * Math.PI * f) / (2 * cache.beatFrames));
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
        elbowLBone: matchBone(boneNames, BONE_ELBOW_L_CANDIDATES),
        elbowRBone: matchBone(boneNames, BONE_ELBOW_R_CANDIDATES),
        legIkLBone: matchBone(boneNames, BONE_LEG_IK_L_CANDIDATES),
        legIkRBone: matchBone(boneNames, BONE_LEG_IK_R_CANDIDATES),
    };
}

type InterpType = typeof INTERP_SHARP | typeof INTERP_EASE_IN_OUT | typeof INTERP_EASE_OUT;

/** 根据骨骼名应用插值类型 */
export function applyInterp(bones: BoneKeyFrame[], resolution: BoneResolution): void {
    for (const b of bones) {
        const n = b.name;
        if (
            n === resolution.larmBone ||
            n === resolution.rarmBone ||
            n === resolution.elbowLBone ||
            n === resolution.elbowRBone
        ) {
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
