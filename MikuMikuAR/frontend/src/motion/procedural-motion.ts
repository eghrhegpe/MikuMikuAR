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

// 标准 MMD 骨骼名
const BONE_CENTER = 'センター';
const BONE_UPPER = '上半身';
const BONE_NECK = '首';
const BONE_HEAD = '頭';
const BONE_LARM = '左腕';
const BONE_RARM = '右腕';

// 骨骼名候选（按优先级），用于匹配非标准命名的模型
const BONE_CENTER_CANDIDATES = [BONE_CENTER, '全ての親', 'center', 'Center', 'Root', 'root'];
const BONE_UPPER_CANDIDATES = [BONE_UPPER, 'upper', 'Upper', '上半', '上半身2'];
const BONE_NECK_CANDIDATES = [BONE_NECK, 'neck', 'Neck', '首元'];
const BONE_HEAD_CANDIDATES = [BONE_HEAD, 'head', 'Head', '頭頂'];
const BONE_LARM_CANDIDATES = [BONE_LARM, '左arm', '左腕捩', 'left arm', 'LeftArm', 'Left Arm', '左肩', '左肩P'];
const BONE_RARM_CANDIDATES = [BONE_RARM, '右arm', '右腕捩', 'right arm', 'RightArm', 'Right Arm', '右肩', '右肩P'];

/** 从模型骨骼名列表中查找首个匹配的候选名，未找到时返回 null（跳过该骨骼）。 */
function _matchBone(actualBones: string[], candidates: string[]): string | null {
    for (const c of candidates) {
        if (actualBones.includes(c)) return c;
    }
    return null;
}

// 标准 MMD morph 名候选（按优先级，第一个匹配即生效）
const MORPH_BLINK_CANDIDATES = ['まばたき', 'blink', 'Blink', '眨眼', 'wink', 'eye close', 'EyeClose'];

const FPS = 30;
const MAX_FRAMES = 600; // 硬上限 20s，防止极端 speed/bpm 组合导致内存爆炸

/** 钳位旋转分量的安全辅助（四元数 w 计算前） */
const _clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Idle 动作 VMD 生成：呼吸 + 眨眼 + 轻微侧摆。
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
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (!blinkMorph) {
        console.info('proc-motion: no blink morph found');
    }

    const centerBone = _matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upperBone = _matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const neckBone = _matchBone(boneNames, BONE_NECK_CANDIDATES);
    const headBone = _matchBone(boneNames, BONE_HEAD_CANDIDATES);

    // 呼吸：上半身 X 轴旋转（前倾后仰），正弦曲线
    // DanceXR 风格：躯干 + 颈部同步呼吸
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
                // 颈部微动：幅度减半，与上半身同相
                const nrx = _clamp1(Math.sin(phase) * breathAmp * 0.6);
                const nw = Math.sqrt(Math.max(0, 1 - nrx * nrx));
                bones.push({ name: neckBone, frame: f, position: [0, 0, 0], rotation: [nrx, 0, 0, nw] });
            }
        }
        if (upperBone) {
            bones.push({ name: upperBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        }
        if (neckBone) {
            bones.push({ name: neckBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        }
    }

    // 轻微侧摆 + 微動 + 上下呼吸动：センター Z 轴旋转 + X 轴微倾 + Y 轴浮动
    // 当模型没有上半身/首骨骼时，センター 承担呼吸律动 + 重心摆动双重职责
    if (centerBone) {
        // 有上半身时侧摆减小（上半身负责主要呼吸），无时则加大
        const hasBreath = !!(upperBone || neckBone);
        const swayAmp = (hasBreath ? 0.04 : 0.1) * intensity;   // 侧摆
        const microAmp = 0.03 * intensity;                        // 微倾
        const bobAmp = (hasBreath ? 0.005 : 0.04) * intensity;   // 上下浮动（无上半身时模拟呼吸）
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

    // 微动：头部微小随机摆动（DanceXR Head Micro）
    if (headBone) {
        const headMicroAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            // 用不同频率的叠加模拟"随机"
            const t = (f / loopFrames) * Math.PI * 2;
            const rz = _clamp1(Math.sin(t * 0.43 + 1.2) * headMicroAmp);
            const rx = _clamp1(Math.sin(t * 0.29 + 3.7) * headMicroAmp * 0.7);
            const ry = _clamp1(Math.sin(t * 0.19 + 0.8) * headMicroAmp * 0.4);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz - rx * rx - ry * ry));
            bones.push({ name: headBone, frame: f, position: [0, 0, 0], rotation: [rx, ry, rz, w] });
        }
        bones.push({ name: headBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    }

    // 眨眼：DanceXR 风格，2-10s 随机间隔（确定性伪随机）
    if (blinkMorph) {
        // 用帧索引的哈希生成伪随机间隔
        const blinkA = Math.round(45 / safeSpeed); // ~1.5s
        const blinkB = Math.round(150 / safeSpeed); // ~5s
        for (let t = blinkA, i = 0; t + 5 <= loopFrames; i++) {
            morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            morphs.push({ name: blinkMorph, frame: t + 2, weight: 1 });
            morphs.push({ name: blinkMorph, frame: t + 5, weight: 0 });
            // 伪随机间隔，介于 blinkA ~ blinkB
            const step = blinkA + ((i * 17 + 3) % (blinkB - blinkA));
            t += Math.max(blinkA, step);
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    return buildVmd(bones, morphs, 'IdleMotion');
}

/** Auto Dance VMD 生成：节拍驱动身体律动 + 头部摆动 + 手臂摆动。
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
    const loopFrames = beatFrames * 8; // 8 拍循环（2 小节），提供足够变化
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (!blinkMorph) {
        console.info('proc-motion: no blink morph found');
    }
    const centerBone = _matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const headBone = _matchBone(boneNames, BONE_HEAD_CANDIDATES);
    const larmBone = _matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = _matchBone(boneNames, BONE_RARM_CANDIDATES);

    // 预计算 sin 值，3 个骨骼循环复用
    const sinVals: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        sinVals[f] = Math.sin((f / beatFrames) * Math.PI);
    }

    // 身体律动：センター Y 轴旋转，每拍交替方向
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

    // 头部摆动：頭 Z 轴，反相于身体
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

    // 手臂摆动：左右臂 Z 轴交替
    if (larmBone || rarmBone) {
        const armAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            if (larmBone) {
                const lz = _clamp1(s * armAmp);
                const wl = Math.sqrt(Math.max(0, 1 - lz * lz));
                bones.push({
                    name: larmBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [0, 0, lz, wl],
                });
            }
            if (rarmBone) {
                const rz = _clamp1(-s * armAmp);
                const wr = Math.sqrt(Math.max(0, 1 - rz * rz));
                bones.push({
                    name: rarmBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [0, 0, rz, wr],
                });
            }
        }
        if (larmBone) {
            bones.push({ name: larmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        }
        if (rarmBone) {
            bones.push({ name: rarmBone, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
        }
    }

    // 眨眼：每拍一次，裁剪不超出循环长度
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
