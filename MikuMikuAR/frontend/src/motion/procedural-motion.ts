// procedural-motion.ts — 程序化动作管理器（Idle + Auto Dance）
// [doc:architecture] 程序化动作子系统
// 生成 procedural VMD（骨骼+morph 关键帧），通过现有 loadVMDMotion 管道加载。
// 无音乐 → Idle（呼吸+眨眼）；有音乐 → Auto Dance（节拍驱动律动）。

import {
    buildVmd,
    canEncodeName,
    type BoneKeyFrame,
    type MorphKeyFrame,
    INTERP_EASE_IN_OUT,
    INTERP_EASE_OUT,
    INTERP_SHARP,
} from './vmd-writer';

export type ProcMotionMode = 'off' | 'idle' | 'autodance';

export interface ProcMotionState {
    mode: ProcMotionMode;
    intensity: number; // 0..1，默认 0.5
    speed: number; // 0.5..2，默认 1.0
    autoSwitch: boolean; // true=根据音乐自动切换 Idle/AutoDance
}

export const DEFAULT_PROC_STATE: ProcMotionState = {
    mode: 'off',
    intensity: 0.5,
    speed: 1.0,
    autoSwitch: true,
};

// ============ 骨骼候选名 ============
const BONE_CENTER_CANDIDATES = ['センター', '全ての親', 'center', 'Center', 'Root', 'root'];
const BONE_UPPER_CANDIDATES = ['上半身', 'upper', 'Upper', '上半', '上半身2'];
const BONE_UPPER2_CANDIDATES = ['上半身2', 'upper2', 'Upper2', '上半身２'];
const BONE_NECK_CANDIDATES = ['首', 'neck', 'Neck', '首元'];
const BONE_HEAD_CANDIDATES = ['頭', 'head', 'Head', '頭頂'];

// 手臂 —— 加入 W 后缀变体
const BONE_LARM_CANDIDATES = [
    '左腕', '左腕W', '左arm', '左腕捩', 'left arm', 'LeftArm', 'Left Arm'
];
const BONE_RARM_CANDIDATES = [
    '右腕', '右腕W', '右arm', '右腕捩', 'right arm', 'RightArm', 'Right Arm'
];

// 手腕（手首）—— 若有则驱动
const BONE_WRIST_L_CANDIDATES = ['左手首', '左リスト', 'left wrist', 'LeftWrist'];
const BONE_WRIST_R_CANDIDATES = ['右手首', '右リスト', 'right wrist', 'RightWrist'];

// 肩部（包含 P / C 变体）
const BONE_SHOULDER_L_CANDIDATES = [
    '左肩', '左肩P', '左肩C', '左肩捩', 'left shoulder', 'LeftShoulder', 'LeftShoulderP', 'LeftShoulderC'
];
const BONE_SHOULDER_R_CANDIDATES = [
    '右肩', '右肩P', '右肩C', '右肩捩', 'right shoulder', 'RightShoulder', 'RightShoulderP', 'RightShoulderC'
];

// 躯干辅助
const BONE_WAIST_CANDIDATES = ['腰', 'waist', 'Waist', 'hips', 'Hips', 'hip'];
const BONE_ALLPARENT_CANDIDATES = ['全ての親', 'AllParent', 'all parent', 'root', 'Root'];
const BONE_GROOVE_CANDIDATES = ['グルーブ', 'groove', 'Groove'];

// 预留足IK（未启用）
const BONE_LEG_IK_L_CANDIDATES = ['左足IK', 'left leg ik', 'LeftLegIK'];
const BONE_LEG_IK_R_CANDIDATES = ['右足IK', 'right leg ik', 'RightLegIK'];

/** 从模型骨骼名列表中查找首个匹配且可 SJIS 编码的候选名，未找到时返回 null（跳过该骨骼）。 */
function _matchBone(actualBones: string[], candidates: string[]): string | null {
    for (const c of candidates) {
        if (actualBones.includes(c)) {
            if (canEncodeName(c)) return c;
            console.warn(`[procedural-motion] 骨骼 "${c}" 无法编码为 Shift-JIS，跳过`);
            return null; // 不继续 fallback 到其他候选（名不同，对应不同骨骼）
        }
    }
    return null;
}

// ============ Morph 候选名（扩充眨眼） ============
const MORPH_BLINK_CANDIDATES = [
    'まばたき', 'blink', 'Blink', '眨眼', 'wink',
    'eye close', 'EyeClose', '眼', '目', '閉眼'
];

const FPS = 30;
const MAX_FRAMES = 600; // 硬上限 20s，防止极端 speed/bpm 组合导致内存爆炸

/** 钳位旋转分量的安全辅助（四元数 w 计算前） */
const _clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

// ============================================================================
//  Idle 生成（保持不变，柔和呼吸）
// ============================================================================
export function generateIdleVmd(
    state: ProcMotionState,
    morphNames: string[] = [],
    boneNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const loopFrames = Math.min(MAX_FRAMES, Math.round(120 / safeSpeed)); // 4s @ 30fps
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    // ---------- 眨眼（伪随机间隔 2~8s，自然频率） ----------
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (blinkMorph) {
        const blinkA = Math.round(60 / safeSpeed);
        const blinkB = Math.round(240 / safeSpeed);
        for (let t = blinkA, i = 0; t + 5 <= loopFrames; i++) {
            morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            morphs.push({ name: blinkMorph, frame: t + 2, weight: 1 });
            morphs.push({ name: blinkMorph, frame: t + 5, weight: 0 });
            const step = blinkA + ((i * 17 + 3) % (blinkB - blinkA));
            t += Math.max(blinkA, step);
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    // ---------- 骨骼匹配 ----------
    const centerBone = _matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upperBone = _matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const upper2Bone = _matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const neckBone = _matchBone(boneNames, BONE_NECK_CANDIDATES);
    const headBone = _matchBone(boneNames, BONE_HEAD_CANDIDATES);
    const waistBone = _matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentBone = _matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);
    const shoulderLBone = _matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = _matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const larmBone = _matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = _matchBone(boneNames, BONE_RARM_CANDIDATES);
    const wristLBone = _matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = _matchBone(boneNames, BONE_WRIST_R_CANDIDATES);

    // ---------- 上半身呼吸 ----------
    const breathAmp = 0.03 * intensity;
    if (upperBone || neckBone) {
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = _clamp1(Math.sin(phase) * breathAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            if (upperBone) {
                bones.push({ name: upperBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
            }
            if (neckBone) {
                const nrx = _clamp1(Math.sin(phase) * breathAmp * 0.6);
                const nw = Math.sqrt(Math.max(0, 1 - nrx * nrx));
                bones.push({ name: neckBone, frame: f, position: [0, 0, 0], rotation: [nrx, 0, 0, nw] });
            }
        }
        if (upperBone) bones.push({ name: upperBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (neckBone) bones.push({ name: neckBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 上半身2 ----------
    if (upper2Bone) {
        const amp2 = 0.015 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = _clamp1(Math.sin(phase * 0.7 + 0.3) * amp2);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            bones.push({ name: upper2Bone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
        }
        bones.push({ name: upper2Bone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 腰 ----------
    if (waistBone) {
        const waistAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = _clamp1(Math.sin(phase + 0.5) * waistAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            bones.push({ name: waistBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
        }
        bones.push({ name: waistBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 全ての親 ----------
    if (allParentBone) {
        const parentAmp = 0.005 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rx = _clamp1(Math.sin(t * 0.2 + 1.1) * parentAmp);
            const rz = _clamp1(Math.sin(t * 0.3 + 2.3) * parentAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx*rx - rz*rz));
            bones.push({ name: allParentBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
        bones.push({ name: allParentBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- センター ----------
    if (centerBone) {
        const hasBreath = !!(upperBone || neckBone);
        const swayAmp = (hasBreath ? 0.04 : 0.1) * intensity;
        const microAmp = 0.03 * intensity;
        const bobAmp = (hasBreath ? 0.005 : 0.04) * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const slowPhase = phase * 0.5;
            const rz = _clamp1(Math.sin(slowPhase) * swayAmp);
            const rw = Math.sqrt(Math.max(0, 1 - rz * rz));
            const rx = _clamp1(Math.sin(phase * 0.37 + 0.5) * microAmp);
            const w = _clamp1(Math.sqrt(Math.max(0, 1 - rx * rx - rz * rz)));
            const bobY = Math.sin(phase) * bobAmp;
            bones.push({
                name: centerBone,
                frame: f,
                position: [0, bobY, 0],
                rotation: [rx, 0, rz, w],
            });
        }
        bones.push({
            name: centerBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    // ---------- 頭 ----------
    if (headBone) {
        const headMicroAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rz = _clamp1(Math.sin(t * 0.43 + 1.2) * headMicroAmp);
            const rx = _clamp1(Math.sin(t * 0.29 + 3.7) * headMicroAmp * 0.7);
            const ry = _clamp1(Math.sin(t * 0.19 + 0.8) * headMicroAmp * 0.4);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz - rx * rx - ry * ry));
            bones.push({ name: headBone, frame: f, position: [0, 0, 0], rotation: [rx, ry, rz, w] });
        }
        bones.push({ name: headBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 手臂（自然钟摆） ----------
    if (larmBone || rarmBone) {
        const armAmp = 0.04 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = _clamp1(Math.sin(phase + 1.5) * armAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            if (larmBone) {
                bones.push({ name: larmBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
            }
            if (rarmBone) {
                bones.push({ name: rarmBone, frame: f, position: [0, 0, 0], rotation: [0, 0, -rz, w] });
            }
        }
        if (larmBone) bones.push({ name: larmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (rarmBone) bones.push({ name: rarmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 肩部 ----------
    if (shoulderLBone || shoulderRBone) {
        const shoulderAmp = 0.015 * intensity;
        const rotAmp = 0.01 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const breath = Math.sin(phase + 0.3);
            const yOffset = breath * shoulderAmp;
            const rz = _clamp1(Math.sin(phase + 0.1) * rotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            if (shoulderLBone) {
                bones.push({ name: shoulderLBone, frame: f, position: [0, yOffset, 0], rotation: [0, 0, rz, w] });
            }
            if (shoulderRBone) {
                const rOffset = Math.sin(phase + 0.5) * shoulderAmp;
                const rrz = _clamp1(Math.sin(phase + 0.4) * rotAmp);
                const rw = Math.sqrt(Math.max(0, 1 - rrz * rrz));
                bones.push({ name: shoulderRBone, frame: f, position: [0, rOffset, 0], rotation: [0, 0, rrz, rw] });
            }
        }
        if (shoulderLBone) bones.push({ name: shoulderLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (shoulderRBone) bones.push({ name: shoulderRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 手腕（若有） ----------
    if (wristLBone || wristRBone) {
        const wristAmp = 0.015 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = _clamp1(Math.sin(phase + 0.8) * wristAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            if (wristLBone) {
                bones.push({ name: wristLBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
            }
            if (wristRBone) {
                const rxR = _clamp1(Math.sin(phase + 1.1) * wristAmp);
                const wR = Math.sqrt(Math.max(0, 1 - rxR * rxR));
                bones.push({ name: wristRBone, frame: f, position: [0, 0, 0], rotation: [rxR, 0, 0, wR] });
            }
        }
        if (wristLBone) bones.push({ name: wristLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (wristRBone) bones.push({ name: wristRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // Idle 全部用 EASE_IN_OUT（柔和呼吸感）
    for (const b of bones) {
        b.interp = INTERP_EASE_IN_OUT;
    }
    return buildVmd(bones, morphs, 'IdleMotion');
}

// ============================================================================
//  Auto Dance 生成（显眼增强版）
// ============================================================================
export function generateAutoDanceVmd(
    state: ProcMotionState,
    bpm: number,
    morphNames: string[] = [],
    boneNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    const beatFrames = Math.min(MAX_FRAMES, Math.round(((60 / clampedBpm) * FPS) / safeSpeed));
    const loopFrames = beatFrames * 8; // 8 拍循环（2 小节）
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    // ---------- 眨眼（伪随机间隔 2~8s，同 idle） ----------
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (blinkMorph) {
        const blinkA = Math.round(60 / safeSpeed);  // ~2s
        const blinkB = Math.round(240 / safeSpeed); // ~8s
        for (let t = blinkA, i = 0; t + 5 <= loopFrames; i++) {
            morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            morphs.push({ name: blinkMorph, frame: t + 2, weight: 1 });
            morphs.push({ name: blinkMorph, frame: t + 5, weight: 0 });
            const step = blinkA + ((i * 17 + 3) % (blinkB - blinkA));
            t += Math.max(blinkA, step);
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    // ---------- 骨骼匹配 ----------
    const centerBone = _matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upperBone = _matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const upper2Bone = _matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistBone = _matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const grooveBone = _matchBone(boneNames, BONE_GROOVE_CANDIDATES);
    const headBone = _matchBone(boneNames, BONE_HEAD_CANDIDATES);
    const larmBone = _matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = _matchBone(boneNames, BONE_RARM_CANDIDATES);
    const shoulderLBone = _matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = _matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const allParentBone = _matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);
    const wristLBone = _matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = _matchBone(boneNames, BONE_WRIST_R_CANDIDATES);
    const legIkLBone = _matchBone(boneNames, BONE_LEG_IK_L_CANDIDATES);
    const legIkRBone = _matchBone(boneNames, BONE_LEG_IK_R_CANDIDATES);

    // 预计算 sin/cos
    const sinVals: number[] = [];
    const cosVals: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        const angle = (f / beatFrames) * Math.PI;
        sinVals[f] = Math.sin(angle);
        cosVals[f] = Math.cos(angle);
    }

    // ---------- 1. センター（大幅侧摆 + 旋转 + 弹跳） ----------
    if (centerBone) {
        const bodyAmp = 0.20 * intensity;      // Y轴扭动
        const sideAmp = 0.12 * intensity;      // Z轴侧摆（新增）
        const bobAmp = 0.06 * intensity;       // 弹跳
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const c = cosVals[f];
            const ry = _clamp1(s * bodyAmp);
            const rz = _clamp1(c * sideAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry*ry - rz*rz));
            const bob = Math.abs(s) * bobAmp;
            bones.push({
                name: centerBone,
                frame: f,
                position: [0, bob, 0],
                rotation: [0, ry, rz, w],
            });
        }
        bones.push({ name: centerBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 2. 上半身（前倾后仰） ----------
    if (upperBone) {
        const upperAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f + Math.round(beatFrames / 2)] || 0;
            const rx = _clamp1(s * upperAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            bones.push({ name: upperBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
        }
        bones.push({ name: upperBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 3. 上半身2（扭转） ----------
    if (upper2Bone) {
        const amp2 = 0.06 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const ry = _clamp1(s * 0.6 * amp2);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            bones.push({ name: upper2Bone, frame: f, position: [0, 0, 0], rotation: [0, ry, 0, w] });
        }
        bones.push({ name: upper2Bone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 4. 腰（扭胯） ----------
    if (waistBone) {
        const waistAmp = 0.20 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f + Math.round(beatFrames / 4)] || 0;
            const rz = _clamp1(-s * waistAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            bones.push({ name: waistBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
        }
        bones.push({ name: waistBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 5. 頭 ----------
    if (headBone) {
        const headAmp = 0.12 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const rz = _clamp1(-s * headAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            bones.push({ name: headBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
        }
        bones.push({ name: headBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 6. 手臂（大幅外展 + 前后甩动） ----------
    if (larmBone || rarmBone) {
        const armAmpZ = 0.55 * intensity;      // 外展幅度（Z轴）
        const armAmpX = 0.30 * intensity;      // 前后甩动（X轴）
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const phase2 = cosVals[f + Math.round(beatFrames / 4)] || 0;
            if (larmBone) {
                const lz = _clamp1(s * armAmpZ);
                const lx = _clamp1(phase2 * armAmpX);
                const w = Math.sqrt(Math.max(0, 1 - lz*lz - lx*lx));
                bones.push({ name: larmBone, frame: f, position: [0, 0, 0], rotation: [lx, 0, lz, w] });
            }
            if (rarmBone) {
                const rz = _clamp1(-s * armAmpZ);
                const rx = _clamp1(phase2 * armAmpX);
                const w = Math.sqrt(Math.max(0, 1 - rz*rz - rx*rx));
                bones.push({ name: rarmBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
            }
        }
        if (larmBone) bones.push({ name: larmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (rarmBone) bones.push({ name: rarmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 7. グルーブ ----------
    if (grooveBone) {
        const grooveAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const bob = Math.abs(s) * 0.08 * intensity;
            const ry = _clamp1(s * grooveAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            bones.push({ name: grooveBone, frame: f, position: [0, bob, 0], rotation: [0, ry, 0, w] });
        }
        bones.push({ name: grooveBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 8. 肩部（耸肩） ----------
    if (shoulderLBone || shoulderRBone) {
        const shoulderUpAmp = 0.10 * intensity;
        const shoulderRotAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const up = Math.abs(s) * shoulderUpAmp;
            const rot = _clamp1(s * shoulderRotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rot * rot));
            if (shoulderLBone) {
                bones.push({ name: shoulderLBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
            }
            if (shoulderRBone) {
                bones.push({ name: shoulderRBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
            }
        }
        if (shoulderLBone) bones.push({ name: shoulderLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (shoulderRBone) bones.push({ name: shoulderRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 9. 全ての親 ----------
    if (allParentBone) {
        const parentAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rx = _clamp1(Math.sin(t * 0.7 + 1.1) * parentAmp);
            const rz = _clamp1(Math.sin(t * 0.5 + 2.3) * parentAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx*rx - rz*rz));
            bones.push({ name: allParentBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
        bones.push({ name: allParentBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 10. 手腕（节拍下压 + 侧摆） ----------
    if (wristLBone || wristRBone) {
        const wristAmpX = 0.35 * intensity;
        const wristAmpZ = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const rx = _clamp1(Math.abs(s) * wristAmpX);
            const rz = _clamp1(cosVals[f] * wristAmpZ);
            const w = Math.sqrt(Math.max(0, 1 - rx*rx - rz*rz));
            if (wristLBone) {
                bones.push({ name: wristLBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
            }
            if (wristRBone) {
                const rzR = _clamp1(-cosVals[f] * wristAmpZ);
                const wR = Math.sqrt(Math.max(0, 1 - rx*rx - rzR*rzR));
                bones.push({ name: wristRBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rzR, wR] });
            }
        }
        if (wristLBone) bones.push({ name: wristLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (wristRBone) bones.push({ name: wristRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 11. 足IK（基础踏步） ----------
    if (legIkLBone || legIkRBone) {
        const stepAmp = 0.08 * intensity;  // Z轴前后位移
        const liftAmp = 0.03 * intensity;  // Y轴抬脚（只抬不沉，防穿地）
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            if (legIkLBone) {
                const lz = _clamp1(s * stepAmp);
                const ly = Math.max(0, s) * liftAmp; // 只抬不沉
                bones.push({ name: legIkLBone, frame: f, position: [0, ly, lz], rotation: [0, 0, 0, 1] });
            }
            if (legIkRBone) {
                const rz = _clamp1(-s * stepAmp);
                const ry = Math.max(0, -s) * liftAmp; // 反相
                bones.push({ name: legIkRBone, frame: f, position: [0, ry, rz], rotation: [0, 0, 0, 1] });
            }
        }
        if (legIkLBone) bones.push({ name: legIkLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (legIkRBone) bones.push({ name: legIkRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

      // ========== 🎭 表情情绪轮（动态扫描可用 morph） ==========
    // 不再硬编码少数模型专有名字，而是按语义自动分类可用 morph

    // 忽略纯口型/音素/眨眼 morph，专注表情 morph
    const BLACKLIST_PATTERNS = [
        'まばたき', 'blink', '眨眼', 'wink', 'ウィンク', 'あ', 'い', 'う', 'え', 'お',
        'a ', 'i ', 'u ', 'e ', 'o ',
    ];

    // 按候选关键词给每个 morph 打分，选出最可能的"表情型" morph
    function _scoreMorph(name: string, keywords: string[]): number {
        const nameLC = name.toLowerCase();
        let score = 0;
        for (const kw of keywords) {
            if (name.includes(kw) || nameLC.includes(kw.toLowerCase())) {
                score += 10;
            }
        }
        // 惩罚音素/眨眼这类非表情 morph
        for (const bp of BLACKLIST_PATTERNS) {
            if (name.includes(bp)) score -= 10;
        }
        return score;
    }

    // 候选表情映射：luc (表情类别) → 候选关键词列表
    const EMOTION_CANDIDATES: Record<string, string[]> = {
        smile:   ['にこり', '笑い', 'smile', 'えがお', 'happy', '喜び', '嬉しい', 'よろこび'],
        sad:     ['悲しみ', 'sad', 'cry', '泣き', '哀しみ', 'かなしみ'],
        angry:   ['怒り', 'angry', 'いかり', 'むっ', 'まゆ'],
        surprise: ['びっくり', 'surprise', 'おどろき', '驚き', 'wonder', 'わお'],
        worry:   ['困る', 'worry', 'こまる', '悩み', 'なやみ', '困惑'],
        serious: ['真面目', 'serious', 'まじめ', 'じと目', 'じと'],
        shy:     ['照れ', 'shy', 'てれ', 'はにかみ', '恥ずかしい'],
        wink:    ['ウィンク', 'wink', 'ういんく', 'win'],
    };

    // 为每个表情类别选出得分最高的 morph
    const emotionMorphs = new Map<string, string>();
    for (const [category, keywords] of Object.entries(EMOTION_CANDIDATES)) {
        let bestName: string | null = null;
        let bestScore = 0;
        for (const mName of morphNames) {
            const score = _scoreMorph(mName, keywords);
            if (score > bestScore) {
                bestScore = score;
                bestName = mName;
            }
        }
        if (bestName) {
            emotionMorphs.set(category, bestName);
        }
    }

    // 验证 morph 名能否被 Shift-JIS 编码（不能编码的在 VMD 中会乱码，babylon-mmd 找不到匹配）
    for (const [k, n] of emotionMorphs) {
        if (!canEncodeName(n)) {
            console.log(`[procedural-motion] 表情 morph "${k}=${n}" 无法编码为 Shift-JIS，跳过`);
            emotionMorphs.delete(k);
        }
    }

    // 如果没有找到任何表情 morph，跳过所有情绪逻辑
    const foundEmotions = Array.from(emotionMorphs.entries()).filter(([k]) => k !== 'wink');
    if (foundEmotions.length > 0) {
        console.log(`[procedural-motion] 表情 morph 匹配: [${foundEmotions.map(([k, n]) => `${k}=${n}`).join(', ')}]`);
        // 微表情专用（surprise 和 wink 短闪用，不加入主轮换）
        const surpriseMorph = emotionMorphs.get('surprise') ?? null;
        const winkMorph = emotionMorphs.get('wink') ?? null;

        // 1. 主表情轮换：每 1 小节（4 拍）切换一种情绪，权重 0.5~0.8
        const cycleBeats = 4; // 4 拍切换一次
        const cycleFrames = beatFrames * cycleBeats;
        const cycleCount = Math.min(foundEmotions.length, Math.floor(loopFrames / cycleFrames));
        const availEmo = foundEmotions.slice(0, cycleCount);

        for (let ci = 0; ci < availEmo.length; ci++) {
            const [_, morphName] = availEmo[ci];
            const start = cycleFrames * ci;
            const end = Math.min(start + cycleFrames - 1, loopFrames);
            // 顺滑切入切出：1/4 周期淡入，1/4 周期淡出
            const fadeIn = Math.floor(beatFrames * 0.3);
            const fadeOut = Math.max(end - Math.floor(beatFrames * 0.3), start + fadeIn);
            const weight = 0.5 + 0.3 * intensity;
            // 淡入段
            morphs.push({ name: morphName, frame: start, weight: 0 });
            morphs.push({ name: morphName, frame: start + fadeIn, weight: weight });
            // 维持段
            morphs.push({ name: morphName, frame: fadeOut, weight: weight });
            // 淡出段
            morphs.push({ name: morphName, frame: end, weight: 0 });
        }

        // 2. 微表情点缀：在每小节强拍附近随机闪现 surprise 或 wink（仅 6~8 帧）
        const accentMorph = surpriseMorph ?? winkMorph;
        if (accentMorph) {
            const measureCount = Math.min(4, Math.floor(loopFrames / (beatFrames * 2)));
            for (let m = 0; m < measureCount; m++) {
                const base = m * beatFrames * 2;
                const rand = (m * 7 + 3) % 10;
                if (rand < 3) {
                    const t = base + Math.floor(beatFrames * 0.2);
                    if (t + 6 <= loopFrames) {
                        const w = 0.5 + 0.3 * intensity;
                        morphs.push({ name: accentMorph, frame: t, weight: 0 });
                        morphs.push({ name: accentMorph, frame: t + 1, weight: w });
                        morphs.push({ name: accentMorph, frame: t + 3, weight: w });
                        morphs.push({ name: accentMorph, frame: t + 6, weight: 0 });
                    }
                }
            }
        }

        // 3. 害羞表情在副歌位置（倒数 2 小节）插入
        const shyMorph = emotionMorphs.get('shy') ?? null;
        if (shyMorph) {
            const shyStart = loopFrames - beatFrames * 4;
            if (shyStart > 0) {
                morphs.push({ name: shyMorph, frame: shyStart, weight: 0 });
                morphs.push({ name: shyMorph, frame: shyStart + Math.floor(beatFrames * 0.5), weight: 0.6 * intensity });
                morphs.push({ name: shyMorph, frame: shyStart + beatFrames * 2, weight: 0.6 * intensity });
                morphs.push({ name: shyMorph, frame: shyStart + beatFrames * 2 + 2, weight: 0 });
            }
        }
    } else {
        console.warn('[procedural-motion] 未找到任何表情 morph，跳过情绪轮');
    }
    // 按骨骼类型分配插值曲线
    for (const b of bones) {
        const n = b.name;
        // 手臂摆动 → EASE_OUT（快速启动慢停）
        if (n === larmBone || n === rarmBone) {
            b.interp = INTERP_EASE_OUT;
        }
        // 中心弹跳 / 腰扭转 / 足IK踏步 → SHARP（锐利节拍感）
        else if (n === centerBone || n === waistBone || n === legIkLBone || n === legIkRBone) {
            b.interp = INTERP_SHARP;
        }
        // 其余（肩/手腕/头/上半身/上半身2/全親/グルーブ）→ EASE_IN_OUT
        else {
            b.interp = INTERP_EASE_IN_OUT;
        }
    }
    return buildVmd(bones, morphs, 'AutoDance');
}

// ============================================================================
//  状态判断函数（不变）
// ============================================================================
export function shouldAutoDance(audioPlaying: boolean, mode: ProcMotionMode): boolean {
    if (mode === 'idle') {
        return false;
    }
    if (mode === 'autodance') {
        return true;
    }
    return audioPlaying; // 'off' = auto mode
}

export function shouldIdle(
    audioPlaying: boolean,
    hasUserVmd: boolean,
    mode: ProcMotionMode
): boolean {
    return (
        !audioPlaying && !hasUserVmd && (mode === 'idle' || mode === 'off' || mode === 'autodance')
    );
}
