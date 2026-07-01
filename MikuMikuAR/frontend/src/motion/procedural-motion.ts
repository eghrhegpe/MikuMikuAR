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
const BONE_HEAD = '頭';
const BONE_LARM = '左腕';
const BONE_RARM = '右腕';

// 标准 MMD morph 名候选（按优先级，第一个匹配即生效）
const MORPH_BLINK_CANDIDATES = ['まばたき', 'blink', 'Blink', '眨眼', 'wink'];

const FPS = 30;
const MAX_FRAMES = 600; // 硬上限 20s，防止极端 speed/bpm 组合导致内存爆炸

/** 钳位旋转分量的安全辅助（四元数 w 计算前） */
const _clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Idle 动作 VMD 生成：呼吸 + 眨眼 + 轻微侧摆。
 *  循环长度 = 4s / speed (120 帧 @ speed=1)。
 *  @param state 强度/速度
 *  @param morphNames 模型可用的 morph 名集合（用于检测是否有眨眼 morph）
 *  @returns VMD ArrayBuffer */
export function generateIdleVmd(state: ProcMotionState, morphNames: string[] = []): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const loopFrames = Math.min(MAX_FRAMES, Math.round(120 / safeSpeed)); // 4s @ 30fps
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (!blinkMorph) {
        console.debug('proc-motion: no blink morph found');
    }

    // 呼吸：上半身 X 轴旋转（前倾后仰），正弦曲线
    const breathAmp = 0.03 * intensity;
    for (let f = 0; f <= loopFrames; f += 6) {
        const phase = (f / loopFrames) * Math.PI * 2;
        const rx = _clamp1(Math.sin(phase) * breathAmp);
        const w = Math.sqrt(Math.max(0, 1 - rx * rx));
        bones.push({
            name: BONE_UPPER,
            frame: f,
            position: [0, 0, 0],
            rotation: [rx, 0, 0, w],
        });
    }
    bones.push({
        name: BONE_UPPER,
        frame: loopFrames,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
    });

    // 轻微侧摆：センター Z 轴旋转
    const swayAmp = 0.015 * intensity;
    for (let f = 0; f <= loopFrames; f += 6) {
        const phase = (f / loopFrames) * Math.PI * 2;
        const rz = _clamp1(Math.sin(phase * 0.5) * swayAmp);
        const w = Math.sqrt(Math.max(0, 1 - rz * rz));
        bones.push({
            name: BONE_CENTER,
            frame: f,
            position: [0, 0, 0],
            rotation: [0, 0, rz, w],
        });
    }
    bones.push({
        name: BONE_CENTER,
        frame: loopFrames,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
    });

    // 眨眼：每 ~2.5s 一次，裁剪不超出循环长度
    if (blinkMorph) {
        const blinkInterval = Math.round(75 / safeSpeed);
        for (let t = 0; t + 5 <= loopFrames; t += blinkInterval) {
            morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            morphs.push({ name: blinkMorph, frame: t + 2, weight: 1 });
            morphs.push({ name: blinkMorph, frame: t + 5, weight: 0 });
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    return buildVmd(bones, morphs, 'IdleMotion');
}

/** Auto Dance VMD 生成：节拍驱动身体律动 + 头部摆动 + 手臂摆动。
 *  循环长度 = 2 beat 周期 @ bpm。
 *  @param state 强度/速度
 *  @param bpm 节拍 BPM
 *  @param morphNames 可用 morph 名 */
export function generateAutoDanceVmd(
    state: ProcMotionState,
    bpm: number,
    morphNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    const beatFrames = Math.min(MAX_FRAMES, Math.round(((60 / clampedBpm) * FPS) / safeSpeed));
    const loopFrames = beatFrames * 2; // 2 拍循环，上限 1200
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];
    const blinkMorph = MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c));
    if (!blinkMorph) {
        console.debug('proc-motion: no blink morph found');
    }

    // 预计算 sin 值，3 个骨骼循环复用
    const sinVals: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        sinVals[f] = Math.sin((f / beatFrames) * Math.PI);
    }

    // 身体律动：センター Y 轴旋转，每拍交替方向
    const bodyAmp = 0.08 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const s = sinVals[f];
        const ry = _clamp1(s * bodyAmp);
        const w = Math.sqrt(Math.max(0, 1 - ry * ry));
        const bob = Math.abs(s) * 0.02 * intensity;
        bones.push({
            name: BONE_CENTER,
            frame: f,
            position: [0, bob, 0],
            rotation: [0, ry, 0, w],
        });
    }
    bones.push({
        name: BONE_CENTER,
        frame: loopFrames,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
    });

    // 头部摆动：頭 Z 轴，反相于身体
    const headAmp = 0.06 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const s = sinVals[f];
        const rz = _clamp1(-s * headAmp);
        const w = Math.sqrt(Math.max(0, 1 - rz * rz));
        bones.push({
            name: BONE_HEAD,
            frame: f,
            position: [0, 0, 0],
            rotation: [0, 0, rz, w],
        });
    }
    bones.push({ name: BONE_HEAD, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });

    // 手臂摆动：左右臂 Z 轴交替
    const armAmp = 0.15 * intensity;
    for (let f = 0; f <= loopFrames; f += 3) {
        const s = sinVals[f];
        const lz = _clamp1(s * armAmp);
        const rz = _clamp1(-s * armAmp);
        const wl = Math.sqrt(Math.max(0, 1 - lz * lz));
        const wr = Math.sqrt(Math.max(0, 1 - rz * rz));
        bones.push({
            name: BONE_LARM,
            frame: f,
            position: [0, 0, 0],
            rotation: [0, 0, lz, wl],
        });
        bones.push({
            name: BONE_RARM,
            frame: f,
            position: [0, 0, 0],
            rotation: [0, 0, rz, wr],
        });
    }
    bones.push({ name: BONE_LARM, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    bones.push({ name: BONE_RARM, frame: loopFrames, position: [0, 0, 0], rotation: [0, 0, 0, 1] });

    // 眨眼：每拍一次，裁剪不超出循环长度
    if (blinkMorph) {
        for (let b = 0; b < 2; b++) {
            const t = b * beatFrames;
            if (t <= loopFrames) morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            if (t + 1 <= loopFrames) morphs.push({ name: blinkMorph, frame: t + 1, weight: 1 });
            if (t + 4 <= loopFrames) morphs.push({ name: blinkMorph, frame: t + 4, weight: 0 });
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
    if (mode === 'idle') return false;
    if (mode === 'autodance') return true;
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
