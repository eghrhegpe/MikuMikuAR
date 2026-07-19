import { canEncodeName, type BoneKeyFrame } from './vmd-writer';
import { clamp, logWarn } from '@/core/utils';

export type ProcMotionMode = 'off' | 'idle' | 'autodance';

export const PROC_VMD_NAME_IDLE = 'IdleMotion';
export const PROC_VMD_NAME_AUTODANCE = 'AutoDance';

export const PROC_MOTION_BONE_CATEGORIES = [
    'center',
    'upper',
    'upper2',
    'waist',
    'head',
    'arm',
    'groove',
    'shoulder',
    'allParent',
    'wrist',
    'footIk',
    'blink',
    // lifelike 的情绪 morph 已迁入感知层（ADR-079 Phase 1）；autodance 仍使用此 toggle
    'emotion',
] as const;
export type ProcMotionBoneCategory = (typeof PROC_MOTION_BONE_CATEGORIES)[number];

export function getProcMotionBoneCategories(): ProcMotionBoneCategory[] {
    return [...PROC_MOTION_BONE_CATEGORIES];
}

export interface ProcMotionState {
    mode: ProcMotionMode;
    intensity: number;
    speed: number;
    boneToggles: Record<ProcMotionBoneCategory, boolean>;
    bpmQuantizeEnabled: boolean;
    vpdApplyEnabled: boolean;
    interpOverride: 'auto' | 'sharp' | 'ease-in-out' | 'ease-out';
    multiMorphEnabled: boolean;
    eyeTrackingEnabled: boolean;
    headTrackingEnabled: boolean;
}

const _defaultBoneToggles: Record<ProcMotionBoneCategory, boolean> = {
    center: true,
    upper: true,
    upper2: true,
    waist: true,
    head: true,
    arm: true,
    groove: true,
    shoulder: true,
    allParent: true,
    wrist: true,
    footIk: true,
    blink: true,
    emotion: true,
};

export const DEFAULT_PROC_STATE: ProcMotionState = {
    mode: 'off',
    intensity: 0.5,
    speed: 1.0,
    boneToggles: { ..._defaultBoneToggles },
    bpmQuantizeEnabled: true,
    vpdApplyEnabled: false,
    interpOverride: 'auto',
    multiMorphEnabled: false,
    eyeTrackingEnabled: true,
    headTrackingEnabled: true,
};

export const BONE_CENTER_CANDIDATES = ['センター', '全ての親', 'center', 'Center', 'Root', 'root'];
export const BONE_UPPER_CANDIDATES = ['上半身', 'upper', 'Upper', '上半', '上半身2'];
export const BONE_UPPER2_CANDIDATES = ['上半身2', 'upper2', 'Upper2', '上半身２'];
export const BONE_NECK_CANDIDATES = ['首', 'neck', 'Neck', '首元'];
export const BONE_HEAD_CANDIDATES = ['頭', 'head', 'Head', '頭頂'];

export const BONE_LARM_CANDIDATES = [
    '左腕',
    '左腕W',
    '左arm',
    '左腕捩',
    'left arm',
    'LeftArm',
    'Left Arm',
];
export const BONE_RARM_CANDIDATES = [
    '右腕',
    '右腕W',
    '右arm',
    '右腕捩',
    'right arm',
    'RightArm',
    'Right Arm',
];

export const BONE_WRIST_L_CANDIDATES = ['左手首', '左リスト', 'left wrist', 'LeftWrist'];
export const BONE_WRIST_R_CANDIDATES = ['右手首', '右リスト', 'right wrist', 'RightWrist'];

// 肘部（下腕）候选：手臂弯曲的关键骨，缺它手臂只能是"两节棍"直摆（ADR-021 程序化跳舞怪异感主因）
export const BONE_ELBOW_L_CANDIDATES = ['左ひじ', '左肘', 'left elbow', 'LeftElbow', '左ひじ捩'];
export const BONE_ELBOW_R_CANDIDATES = ['右ひじ', '右肘', 'right elbow', 'RightElbow', '右ひじ捩'];

export const BONE_SHOULDER_L_CANDIDATES = [
    '左肩',
    '左肩P',
    '左肩C',
    '左肩捩',
    'left shoulder',
    'LeftShoulder',
    'LeftShoulderP',
    'LeftShoulderC',
];
export const BONE_SHOULDER_R_CANDIDATES = [
    '右肩',
    '右肩P',
    '右肩C',
    '右肩捩',
    'right shoulder',
    'RightShoulder',
    'RightShoulderP',
    'RightShoulderC',
];

export const BONE_WAIST_CANDIDATES = ['腰', 'waist', 'Waist', 'hips', 'Hips', 'hip'];
export const BONE_ALLPARENT_CANDIDATES = ['全ての親', 'AllParent', 'all parent', 'root', 'Root'];
export const BONE_GROOVE_CANDIDATES = ['グルーブ', 'groove', 'Groove'];

// 候选覆盖半角/全角 IK 与常见英文变体（MMD 标准名为全角「左足ＩＫ」）
export const BONE_LEG_IK_L_CANDIDATES = [
    '左足IK',
    '左足ＩＫ',
    'left leg ik',
    'left foot ik',
    'LeftLegIK',
    'LeftFootIK',
];
export const BONE_LEG_IK_R_CANDIDATES = [
    '右足IK',
    '右足ＩＫ',
    'right leg ik',
    'right foot ik',
    'RightLegIK',
    'RightFootIK',
];

// 手臂 IK 候选（与腿部同构）：左腕IK/右腕IK 是手臂 IK 目标骨。
// 移动它并 solve 可让整条手臂（上腕→ひじ→手首）跟随，符合 IK 直觉
// （ADR-116 手部位置偏移：直接偏移手腕骨只浮起手，偏移 IK 目标骨才带动整臂）。
// 候选覆盖半角/全角 IK 与常见英文变体（MMD 标准名为全角「左腕ＩＫ」）。
export const BONE_ARM_IK_L_CANDIDATES = [
    '左腕IK',
    '左腕ＩＫ',
    'left arm ik',
    'left wrist ik',
    'LeftArmIK',
    'LeftWristIK',
];
export const BONE_ARM_IK_R_CANDIDATES = [
    '右腕IK',
    '右腕ＩＫ',
    'right arm ik',
    'right wrist ik',
    'RightArmIK',
    'RightWristIK',
];

export function matchBone(actualBones: string[], candidates: string[]): string | null {
    for (const c of candidates) {
        if (actualBones.includes(c)) {
            if (canEncodeName(c)) {
                return c;
            }
            logWarn('procedural-motion', `骨骼 "${c}" 无法编码为 Shift-JIS，跳过`);
            return null;
        }
    }
    return null;
}

export const MORPH_BLINK_CANDIDATES = [
    'まばたき',
    'blink',
    'Blink',
    '眨眼',
    'wink',
    'eye close',
    'EyeClose',
    '眼',
    '目',
    '閉眼',
];

export const FPS = 30;
export const MAX_FRAMES = 600;

export const clamp1 = (v: number) => clamp(v, -1, 1);

/** 四元数 w 分量：sqrt(max(0, 1 - x² - y² - z²)) */
export const quatW = (x: number, y: number, z: number): number =>
    Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));

/** 循环末尾的 identity 闭合帧（确保动画无缝循环） */
export const closingFrame = (bone: string, frame: number): BoneKeyFrame => ({
    name: bone,
    frame,
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
});
