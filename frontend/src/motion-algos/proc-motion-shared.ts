import { canEncodeName, type BoneKeyFrame } from './vmd-writer';
import { clamp } from '@/core/clamp';
import { logWarn } from '@/core/logger';

export type ProcMotionMode = 'off' | 'idle' | 'autodance';

/** 可编辑参数的程序化模式（'off' 无参数）。每个模式独立一套 ProcMotionParams。 */
export type ProcModeKey = Exclude<ProcMotionMode, 'off'>;

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

/** [audit] per-mode 可调参数：待机呼吸 / 自动舞蹈 各自独立一套 */
export interface ProcMotionParams {
    intensity: number;
    speed: number;
    boneToggles: Record<ProcMotionBoneCategory, boolean>;
    vpdApplyEnabled: boolean;
    interpOverride: 'auto' | 'sharp' | 'ease-in-out' | 'ease-out';
}

export interface ProcMotionState {
    /** 当前激活的程序化模式（与 VMD 互斥的单一指针） */
    mode: ProcMotionMode;
    /** 节拍量化（全局运行时设置，仅 autodance 消费） */
    bpmQuantizeEnabled: boolean;
    /** 感知层：眼部跟随（全局，不随程序化动作切换） */
    eyeTrackingEnabled: boolean;
    /** 感知层：头部跟随（全局） */
    headTrackingEnabled: boolean;
    /** [audit] per-mode 参数：idle / autodance 各自独立 */
    params: Record<ProcModeKey, ProcMotionParams>;
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

const _defaultParams: ProcMotionParams = {
    intensity: 0.5,
    speed: 1.0,
    boneToggles: { ..._defaultBoneToggles },
    vpdApplyEnabled: false,
    interpOverride: 'auto',
};

export const DEFAULT_PROC_STATE: ProcMotionState = {
    mode: 'off',
    bpmQuantizeEnabled: true,
    eyeTrackingEnabled: true,
    headTrackingEnabled: true,
    params: {
        idle: { ..._defaultParams, boneToggles: { ..._defaultBoneToggles } },
        autodance: { ..._defaultParams, boneToggles: { ..._defaultBoneToggles } },
    },
};

/** 迁移兜底默认（不依赖 DEFAULT_PROC_STATE，避免测试 mock 为 {} 时崩溃） */
const _fallbackParams: ProcMotionParams = {
    intensity: 0.5,
    speed: 1.0,
    boneToggles: { ..._defaultBoneToggles },
    vpdApplyEnabled: false,
    interpOverride: 'auto',
};

/**
 * [audit] 旧扁平 ProcMotionState → per-mode 嵌套迁移。
 * 旧值（intensity/speed/boneToggles/...）拆到 params.idle 与 params.autodance（两边同值，等价旧行为）；
 * 新结构（含 params）原样归一。对 Partial / 测试 mock 的缺失字段取默认。
 */
export function migrateProcState(raw: unknown): ProcMotionState {
    const r = (raw ?? {}) as Partial<ProcMotionState> &
        Partial<ProcMotionParams> & { params?: Record<ProcModeKey, Partial<ProcMotionParams>> };
    const base = {
        mode: r.mode ?? 'off',
        bpmQuantizeEnabled: r.bpmQuantizeEnabled ?? true,
        eyeTrackingEnabled: r.eyeTrackingEnabled ?? true,
        headTrackingEnabled: r.headTrackingEnabled ?? true,
    };
    if (r.params) {
        // [fix:P3#1] 深合并 boneToggles：逐类别补默认（缺键用默认 true，防部分覆盖静默关闭其他类别），
        // 且不共享 _fallbackParams.boneToggles 引用（与旧扁平分支的拷贝行为对齐，防两模式互相污染）。
        const mergeParams = (p?: Partial<ProcMotionParams>): ProcMotionParams => ({
            ..._fallbackParams,
            ...p,
            boneToggles: { ..._fallbackParams.boneToggles, ...(p?.boneToggles ?? {}) },
        });
        return {
            ...base,
            params: {
                idle: mergeParams(r.params.idle),
                autodance: mergeParams(r.params.autodance),
            },
        };
    }
    const per = {
        intensity: r.intensity ?? _fallbackParams.intensity,
        speed: r.speed ?? _fallbackParams.speed,
        // [fix:P2#1] 与新结构分支对称：逐类别补默认，防旧存档缺 emotion/wrist/footIk 键时
        // 消费侧 `if (params.boneToggles.wrist)` 读到 undefined 而静默关闭该类别。
        boneToggles: { ..._fallbackParams.boneToggles, ...(r.boneToggles ?? {}) },
        vpdApplyEnabled: r.vpdApplyEnabled ?? _fallbackParams.vpdApplyEnabled,
        interpOverride: r.interpOverride ?? _fallbackParams.interpOverride,
    };
    return {
        ...base,
        params: {
            idle: { ...per, boneToggles: { ...per.boneToggles } },
            autodance: { ...per, boneToggles: { ...per.boneToggles } },
        },
    };
}

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

// [doc:adr-085 方案C] 大腿骨候选（两骨骼 IK 的 hip 端）
// 注意：MMD 命名「足」=大腿（thigh），「足首」=脚踝（ankle），「ひざ」=膝（knee）。
// 英文变体中 "leg" 通常指整条腿，但 PMX 导出常将大腿直接命名为 "leg"/"Leg"，故保留。
export const BONE_THIGH_L_CANDIDATES = [
    '左足',
    '左太もも',
    'left thigh',
    'LeftThigh',
    'left leg',
    'LeftLeg',
    'L_Thigh',
];
export const BONE_THIGH_R_CANDIDATES = [
    '右足',
    '右太もも',
    'right thigh',
    'RightThigh',
    'right leg',
    'RightLeg',
    'R_Thigh',
];

// [doc:adr-085 方案C] 膝盖骨候选（两骨骼 IK 的 knee 端）
export const BONE_KNEE_L_CANDIDATES = [
    '左ひざ',
    '左膝',
    'left knee',
    'LeftKnee',
    'L_Knee',
    '左ひざＩＫ', // 极少出现，但兼容
];
export const BONE_KNEE_R_CANDIDATES = [
    '右ひざ',
    '右膝',
    'right knee',
    'RightKnee',
    'R_Knee',
    '右ひざＩＫ',
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
