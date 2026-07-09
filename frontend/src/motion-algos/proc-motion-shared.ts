import { canEncodeName } from './vmd-writer';

export type ProcMotionMode = 'off' | 'idle' | 'autodance';

export const PROC_VMD_NAME_IDLE = 'IdleMotion';
export const PROC_VMD_NAME_AUTODANCE = 'AutoDance';
export const PROC_VMD_NAME_LIFELIKE = 'LifelikeMotion';

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
    autoSwitch: boolean;
    boneToggles: Record<ProcMotionBoneCategory, boolean>;
    bpmQuantizeEnabled: boolean;
    vpdApplyEnabled: boolean;
    interpOverride: 'auto' | 'sharp' | 'ease-in-out' | 'ease-out';
    multiMorphEnabled: boolean;
    eyeTrackingEnabled: boolean;
    headTrackingEnabled: boolean;
    lifelikeEnabled: boolean;
    lifelikeIntensity: number;
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
    autoSwitch: true,
    boneToggles: { ..._defaultBoneToggles },
    bpmQuantizeEnabled: true,
    vpdApplyEnabled: false,
    interpOverride: 'auto',
    multiMorphEnabled: false,
    eyeTrackingEnabled: true,
    headTrackingEnabled: true,
    lifelikeEnabled: false,
    lifelikeIntensity: 0.3,
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

export const BONE_LEG_IK_L_CANDIDATES = ['左足IK', 'left leg ik', 'LeftLegIK'];
export const BONE_LEG_IK_R_CANDIDATES = ['右足IK', 'right leg ik', 'RightLegIK'];

export function matchBone(actualBones: string[], candidates: string[]): string | null {
    for (const c of candidates) {
        if (actualBones.includes(c)) {
            if (canEncodeName(c)) {
                return c;
            }
            console.warn(`[procedural-motion] 骨骼 "${c}" 无法编码为 Shift-JIS，跳过`);
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

export const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
