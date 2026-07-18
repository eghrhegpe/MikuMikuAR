/**
 * proc-motion-autodance-bones-trunk.ts
 * 躯干骨骼帧生成（Center / Upper / Upper2 / Waist / Groove / AllParent）
 *
 * 节拍栅格模型（替代旧的无拍点单轴正弦）：
 * - 每拍弹跳包络 beatBounce 让位移在拍点达极值（踩点感）
 * - 强拍权重 downbeatWeight 制造 0/4 强拍、2/6 次强、其余弱拍的节奏层次
 * - 重心摆动 swayAt 驱动上下半身联动（动力链）
 * - 循环含端点 f=loopFrames（值=周期起点），保证无缝循环、无重复关键帧
 */
import type { BoneKeyFrame } from './vmd-writer';
import { type ProcMotionState, clamp1, quatW } from './proc-motion-shared';
import type { TrigCache } from './proc-motion-autodance-bones';
import { swayAt } from './proc-motion-autodance-bones';

const STEP = 3;

/**
 * 生成中心/下半身骨骼帧（Root / Center）
 * groove 原则：单一相干源（swayAt）驱动重心转移。
 * 垂直弹跳（Y）已移除——Center 是根骨骼，Y 位移会让整具身体上下蹦、且
 * 与 groove 的骨盆微起伏叠加显跳；垂直生命完全交由 groove 负责。
 * Center 仅保留：X 左右重心转移 + Ry 根扭转 + Rz 根侧倾（跳舞的重心流动）。
 */
export function genCenterBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const shiftAmp = 0.1 * intensity; // 左右重心转移幅度
    const leanAmp = 0.12 * intensity; // 侧倾（roll）
    const twistAmp = 0.14 * intensity; // 扭转（yaw）

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const sway = swayAt(cache, f);
        const x = clamp1(sway * shiftAmp);
        const ry = clamp1(sway * twistAmp);
        const rz = clamp1(sway * leanAmp);
        const w = quatW(0, ry, rz);
        frames.push({ name: bone, frame: f, position: [x, 0, 0], rotation: [0, ry, rz, w] });
    }
    return frames;
}

/**
 * 生成上半身骨骼帧
 * 随同一重心摆动做俯仰 + 侧倾（单一 swayAt 源，动力链：中心→上半身）。
 * 去掉 beatBounce 脉冲耦合，使脊柱与重心同节奏运动（消 incoherent 变味）。
 */
export function genUpperBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const pitchAmp = 0.09 * intensity;
    const rollAmp = 0.06 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const sway = swayAt(cache, f);
        const rx = clamp1(sway * pitchAmp);
        const rz = clamp1(sway * rollAmp);
        const w = quatW(rx, 0, rz);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
    }
    return frames;
}

/**
 * 生成上半身2骨骼帧
 * 跟随上半身做更小幅度同向联动（单一 swayAt 源，无脉冲）。
 */
export function genUpper2Bone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const amp = 0.05 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const sway = swayAt(cache, f);
        const rx = clamp1(sway * amp * 0.5);
        const ry = clamp1(sway * amp * 0.6);
        const w = quatW(rx, ry, 0);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [rx, ry, 0, w] });
    }
    return frames;
}

/**
 * 生成腰部骨骼帧
 * 随重心反向扭转（follow-through），制造躯干螺旋联动而非各自为政。
 */
export function genWaistBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const twistAmp = 0.16 * intensity;
    const rollAmp = 0.1 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const sway = swayAt(cache, f);
        const ry = clamp1(-sway * twistAmp);
        const rz = clamp1(sway * rollAmp);
        const w = quatW(0, ry, rz);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [0, ry, rz, w] });
    }
    return frames;
}

/**
 * 生成 Groove 骨骼帧
 * 骨盆微动，强化重心转移的"踩实"感。
 */
export function genGrooveBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const grooveAmp = 0.12 * intensity;
    const bobAmp = 0.05 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const sway = swayAt(cache, f);
        const ry = clamp1(sway * grooveAmp);
        const y = Math.abs(sway) * bobAmp;
        const w = quatW(0, ry, 0);
        frames.push({ name: bone, frame: f, position: [0, y, 0], rotation: [0, ry, 0, w] });
    }
    return frames;
}

/**
 * 生成 AllParent 骨骼帧（步长6，低频微调）
 * 修复：频率锁定到 4 拍整数周期，不再用 t*0.7/t*0.5 漂移（旧实现与节拍错位产生低频蠕变）。
 */
export function genAllParentBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const parentAmp = 0.02 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 6) {
        const t = (2 * Math.PI * f) / (4 * cache.beatFrames); // 周期 = 4 拍，整除循环长度
        const rx = clamp1(Math.sin(t) * parentAmp);
        const rz = clamp1(Math.sin(t * 0.5 + 1.0) * parentAmp);
        const w = quatW(rx, 0, rz);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
    }
    return frames;
}
