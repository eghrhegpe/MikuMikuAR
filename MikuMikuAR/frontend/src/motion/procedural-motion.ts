// procedural-motion.ts — 程序化动作管理器（Idle + Auto Dance）
// [doc:architecture] 程序化动作子系统
// 生成 procedural VMD（骨骼+morph 关键帧），通过现有 loadVMDMotion 管道加载。
// 无音乐 → Idle（呼吸+眨眼）；有音乐 → Auto Dance（节拍驱动律动）。

import { buildVmd, type BoneKeyFrame, type MorphKeyFrame } from './vmd-writer';

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

// ============ 骨骼候选名（扩充 Layer 1 + 肩部） ============
const BONE_CENTER_CANDIDATES = ['センター', '全ての親', 'center', 'Center', 'Root', 'root'];
const BONE_UPPER_CANDIDATES = ['上半身', 'upper', 'Upper', '上半', '上半身2'];
const BONE_UPPER2_CANDIDATES = ['上半身2', 'upper2', 'Upper2', '上半身２'];   // 全角数字也匹配
const BONE_NECK_CANDIDATES = ['首', 'neck', 'Neck', '首元'];
const BONE_HEAD_CANDIDATES = ['頭', 'head', 'Head', '頭頂'];
const BONE_LARM_CANDIDATES = ['左腕', '左arm', '左腕捩', 'left arm', 'LeftArm', 'Left Arm'];
const BONE_RARM_CANDIDATES = ['右腕', '右arm', '右腕捩', 'right arm', 'RightArm', 'Right Arm'];
// 肩部（扩充变体）
const BONE_SHOULDER_L_CANDIDATES = [
    '左肩', '左肩P', '左肩C', '左肩捩', 'left shoulder', 'LeftShoulder', 'LeftShoulderP', 'LeftShoulderC'
];
const BONE_SHOULDER_R_CANDIDATES = [
    '右肩', '右肩P', '右肩C', '右肩捩', 'right shoulder', 'RightShoulder', 'RightShoulderP', 'RightShoulderC'
];
// 新增 Layer 1
const BONE_WAIST_CANDIDATES = ['腰', 'waist', 'Waist', 'hips', 'Hips', 'hip'];
const BONE_ALLPARENT_CANDIDATES = ['全ての親', 'AllParent', 'all parent', 'root', 'Root'];
const BONE_GROOVE_CANDIDATES = ['グルーブ', 'groove', 'Groove'];
// 预留足IK
const BONE_LEG_IK_L_CANDIDATES = ['左足IK', 'left leg ik', 'LeftLegIK'];
const BONE_LEG_IK_R_CANDIDATES = ['右足IK', 'right leg ik', 'RightLegIK'];

/** 从模型骨骼名列表中查找首个匹配的候选名，未找到时返回 null（跳过该骨骼）。 */
function _matchBone(actualBones: string[], candidates: string[]): string | null {
    for (const c of candidates) {
        if (actualBones.includes(c)) return c;
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

/** Idle 动作 VMD 生成：呼吸 + 眨眼 + 轻微侧摆 + 腰/上半身2/全ての親微动 + 肩部自然耸肩。
 *  循环长度 = 4s / speed (120 帧 @ speed=1)。
 *  @param state 强度/速度
 *  @param morphNames 模型可用的 morph 名集合（用于检测是否有眨眼 morph）
 *  @param boneNames 模型可用的骨骼名集合（用于匹配非标准命名）
 *  @returns VMD ArrayBuffer */
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

    // ---------- 眨眼 ----------
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (blinkMorph) {
        const blinkA = Math.round(45 / safeSpeed); // ~1.5s
        const blinkB = Math.round(150 / safeSpeed); // ~5s
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

    // ---------- 上半身2（独立微动） ----------
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

    // ---------- 腰（臀部微摆，与上半身错相） ----------
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

    // ---------- 全ての親（极微晃动） ----------
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

    // ---------- センター：侧摆 + 上下浮动 ----------
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

    // ---------- 頭：微摇头晃脑 ----------
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

    // ---------- 手臂：自然钟摆（水平 Z 轴） ----------
    // 双手自然下垂时，钟摆式前后微摆，与呼吸同周期但延迟半拍
    const larmBone = _matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = _matchBone(boneNames, BONE_RARM_CANDIDATES);
    if (larmBone || rarmBone) {
        const armAmp = 0.025 * intensity;
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

    // ---------- 肩部（自然呼吸耸肩） ----------
    // 左右肩独立，轻微上下浮动 + 小幅度旋转，体现呼吸时锁骨微动
    if (shoulderLBone || shoulderRBone) {
        const shoulderAmp = 0.015 * intensity;   // 上下位移幅度
        const rotAmp = 0.01 * intensity;         // 旋转幅度
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            // 与上半身同相，但稍有延迟
            const breath = Math.sin(phase + 0.3);
            const yOffset = breath * shoulderAmp;
            const rz = _clamp1(Math.sin(phase + 0.1) * rotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            if (shoulderLBone) {
                bones.push({
                    name: shoulderLBone,
                    frame: f,
                    position: [0, yOffset, 0],
                    rotation: [0, 0, rz, w]
                });
            }
            if (shoulderRBone) {
                // 右肩可略不同相，或对称
                const rOffset = Math.sin(phase + 0.5) * shoulderAmp;
                const rrz = _clamp1(Math.sin(phase + 0.4) * rotAmp);
                const rw = Math.sqrt(Math.max(0, 1 - rrz * rrz));
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, rOffset, 0],
                    rotation: [0, 0, rrz, rw]
                });
            }
        }
        if (shoulderLBone) bones.push({ name: shoulderLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (shoulderRBone) bones.push({ name: shoulderRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    return buildVmd(bones, morphs, 'IdleMotion');
}

/** Auto Dance VMD 生成：节拍驱动身体律动 + 头部摆动 + 手臂摆动 + グルーブ弹跳 + 肩部耸肩。
 *  循环长度 = 2 beat 周期 @ bpm。
 *  @param state 强度/速度
 *  @param bpm 节拍 BPM
 *  @param morphNames 可用 morph 名
 *  @param boneNames 可用骨骼名 */
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

    // ---------- 眨眼（同 idle，每拍一次） ----------
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (blinkMorph) {
        for (let b = 0; b < 8; b++) {
            const t = b * beatFrames;
            if (t <= loopFrames) {
                morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            }
            if (t + 1 <= loopFrames) {
                morphs.push({ name: blinkMorph, frame: t + 1, weight: 1 });
            }
            if (t + 4 <= loopFrames) {
                morphs.push({ name: blinkMorph, frame: t + 4, weight: 0 });
            }
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    // ---------- 骨骼匹配 ----------
    const centerBone = _matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const headBone = _matchBone(boneNames, BONE_HEAD_CANDIDATES);
    const larmBone = _matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = _matchBone(boneNames, BONE_RARM_CANDIDATES);
    const grooveBone = _matchBone(boneNames, BONE_GROOVE_CANDIDATES);
    const shoulderLBone = _matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = _matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);

    // 预计算 sin 值，多个骨骼复用
    const sinVals: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        sinVals[f] = Math.sin((f / beatFrames) * Math.PI);
    }

    // ---------- センター（身体律动） ----------
    if (centerBone) {
        const bodyAmp = 0.08 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const ry = _clamp1(s * bodyAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            const bob = Math.abs(s) * 0.02 * intensity;
            bones.push({
                name: centerBone,
                frame: f,
                position: [0, bob, 0],
                rotation: [0, ry, 0, w],
            });
        }
        bones.push({
            name: centerBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    // ---------- 頭（反相摆动） ----------
    if (headBone) {
        const headAmp = 0.06 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const rz = _clamp1(-s * headAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            bones.push({
                name: headBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [0, 0, rz, w],
            });
        }
        bones.push({ name: headBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 手臂（交替） ----------
    if (larmBone || rarmBone) {
        const armAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            if (larmBone) {
                const lz = _clamp1(s * armAmp);
                const wl = Math.sqrt(Math.max(0, 1 - lz * lz));
                bones.push({ name: larmBone, frame: f, position: [0, 0, 0], rotation: [0, 0, lz, wl] });
            }
            if (rarmBone) {
                const rz = _clamp1(-s * armAmp);
                const wr = Math.sqrt(Math.max(0, 1 - rz * rz));
                bones.push({ name: rarmBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, wr] });
            }
        }
        if (larmBone) bones.push({ name: larmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (rarmBone) bones.push({ name: rarmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- グルーブ（Groove 弹跳 + 扭动） ----------
    if (grooveBone) {
        const grooveAmp = 0.06 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const bob = Math.abs(s) * 0.04 * intensity;
            const ry = _clamp1(s * grooveAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            bones.push({
                name: grooveBone,
                frame: f,
                position: [0, bob, 0],
                rotation: [0, ry, 0, w],
            });
        }
        bones.push({ name: grooveBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // ---------- 肩部（节拍驱动耸肩） ----------
    // 左右肩在强拍时向上提（Y轴位移）并绕Z轴旋转（耸肩），幅度中等
    if (shoulderLBone || shoulderRBone) {
        const shoulderUpAmp = 0.04 * intensity;   // Y轴提升幅度
        const shoulderRotAmp = 0.06 * intensity;  // Z轴旋转幅度（耸肩）
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            // 取绝对值，强拍时向上
            const up = Math.abs(s) * shoulderUpAmp;
            const rot = _clamp1(s * shoulderRotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rot * rot));
            if (shoulderLBone) {
                bones.push({
                    name: shoulderLBone,
                    frame: f,
                    position: [0, up, 0],
                    rotation: [0, 0, rot, w]
                });
            }
            if (shoulderRBone) {
                // 右肩可与左肩同向或反向，这里同向（同时耸肩）
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, up, 0],
                    rotation: [0, 0, rot, w]
                });
            }
        }
        if (shoulderLBone) bones.push({ name: shoulderLBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        if (shoulderRBone) bones.push({ name: shoulderRBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    return buildVmd(bones, morphs, 'AutoDance');
}

/** 判断是否应切换到 Auto Dance（有音乐在播放）。
 *  'off' = 自动模式：有音乐→AutoDance，无音乐→Idle
 *  'autodance' = 强制 AutoDance（即使无音乐也保持）
 *  'idle' = 强制 Idle */
export function shouldAutoDance(audioPlaying: boolean, mode: ProcMotionMode): boolean {
    if (mode === 'idle') {
        return false;
    }
    if (mode === 'autodance') {
        return true;
    }
    return audioPlaying; // 'off' = auto mode
}

/** 判断是否应切换到 Idle（无音乐，未加载用户 VMD）。
 *  当音乐停止时 allow autodance→idle 降级。 */
export function shouldIdle(
    audioPlaying: boolean,
    hasUserVmd: boolean,
    mode: ProcMotionMode
): boolean {
    return (
        !audioPlaying && !hasUserVmd && (mode === 'idle' || mode === 'off' || mode === 'autodance')
    );
}
