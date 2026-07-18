/**
 * proc-motion-autodance-bones-limbs.ts
 * 四肢骨骼帧生成（Arm / Elbow / Shoulder / Wrist / FootIK）
 *
 * 节拍栅格模型改进：
 * - 新增肘部（Elbow）生成：肩抬→肘屈复合弧线，消灭"两节棍直摆/转向灯对称开合"
 * - 左右臂半拍错位（按 beatInLoop 交替）+ 踩点包络，打破机械对称
 * - 肩/腕随同侧手臂联动（动力链）
 * - FootIK 随重心摆动制造换脚感
 */
import type { BoneKeyFrame } from './vmd-writer';
import { type ProcMotionState, clamp1, quatW } from './proc-motion-shared';
import type { TrigCache } from './proc-motion-autodance-bones';
import { beatInfo, beatBounce, downbeatWeight, swayAt } from './proc-motion-autodance-bones';

const STEP = 3;

/**
 * 生成手臂骨骼帧（左右）
 * 关键修复：改回平滑连续摆动（2 拍周期正弦），而非逐拍脉冲包络（beatBounce）。
 * 逐拍脉冲是"机器人感"的根因——每拍猛抬猛落、EASE_OUT 每帧急停急起。
 * 平滑连续正弦 + 4 拍"呼吸"幅度调制，接近旧版自然观感，同时保留肘部与联动。
 */
export function genArmBones(
    larmBone: string | null,
    rarmBone: string | null,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    if (!larmBone && !rarmBone) {
        return frames;
    }

    const ampZ = 0.5 * intensity; // 外展（抬向两侧）
    const ampX = 0.28 * intensity; // 前举（抬向前方）
    const slowPeriod = 4 * cache.beatFrames; // 4 拍呼吸，打破机械重复

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        // 平滑连续摆动（2 拍周期），f=0 与 f=loopFrames 处 value=0 → 无缝循环
        const base = Math.sin((Math.PI * f) / cache.beatFrames);
        const fwd = Math.cos((Math.PI * f) / cache.beatFrames + Math.PI / 4);
        const slow = 0.7 + 0.3 * Math.sin((2 * Math.PI * f) / slowPeriod);
        if (larmBone) {
            const lz = clamp1(base * ampZ * slow);
            const lx = clamp1(fwd * ampX * slow);
            const w = quatW(lx, 0, lz);
            frames.push({ name: larmBone, frame: f, position: [0, 0, 0], rotation: [lx, 0, lz, w] });
        }
        if (rarmBone) {
            const rz = clamp1(-base * ampZ * slow);
            const rx = clamp1(fwd * ampX * slow);
            const w = quatW(rx, 0, rz);
            frames.push({ name: rarmBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
    }
    return frames;
}

/**
 * 生成肘部骨骼帧（新增）
 * 肘部随同侧手臂上抬而屈曲（X 轴），并滞后于肩形成 follow-through。
 * 与手臂共用平滑连续波，故不再"逐拍猛屈"——自然的关键。
 */
export function genElbowBones(
    lelbowBone: string | null,
    relbowBone: string | null,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    if (!lelbowBone && !relbowBone) {
        return frames;
    }

    const bendAmp = 0.5 * intensity; // 肘屈幅度（随手臂上抬同步）
    const lag = Math.round(cache.beatFrames * 0.12); // 滞后于肩 → follow-through
    const slowPeriod = 4 * cache.beatFrames;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const baseL = Math.sin((Math.PI * (f - lag)) / cache.beatFrames); // 滞后样本
        const slow = 0.7 + 0.3 * Math.sin((2 * Math.PI * f) / slowPeriod);
        if (lelbowBone) {
            // 左臂在 base>0（外摆）半周期屈曲
            const lx = clamp1(Math.max(0, baseL) * bendAmp * slow);
            const w = quatW(lx, 0, 0);
            frames.push({ name: lelbowBone, frame: f, position: [0, 0, 0], rotation: [lx, 0, 0, w] });
        }
        if (relbowBone) {
            const rx = clamp1(Math.max(0, -baseL) * bendAmp * slow);
            const w = quatW(rx, 0, 0);
            frames.push({ name: relbowBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
        }
    }
    return frames;
}

/**
 * 生成腕部骨骼帧
 * 随同侧手臂平滑摆动（共用连续波），保持末端联动，不再逐拍脉冲。
 */
export function genWristBones(
    lBone: string | null,
    rBone: string | null,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    if (!lBone && !rBone) {
        return frames;
    }

    const wristAmpX = 0.22 * intensity;
    const wristAmpZ = 0.12 * intensity;
    const slowPeriod = 4 * cache.beatFrames;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const base = Math.sin((Math.PI * f) / cache.beatFrames);
        const slow = 0.7 + 0.3 * Math.sin((2 * Math.PI * f) / slowPeriod);
        const rx = clamp1(Math.abs(base) * wristAmpX * slow);
        const rz = clamp1(Math.cos((Math.PI * f) / cache.beatFrames) * wristAmpZ * slow);
        if (lBone) {
            const w = quatW(rx, 0, rz);
            frames.push({ name: lBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
        if (rBone) {
            const w = quatW(rx, 0, -rz);
            frames.push({ name: rBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, -rz, w] });
        }
    }
    return frames;
}

/**
 * 生成肩部骨骼帧
 * 随同侧手臂平滑摆动做耸肩（Y 位移）+ 微旋（Z），形成肩→臂动力链。
 */
export function genShoulderBones(
    lBone: string | null,
    rBone: string | null,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    if (!lBone && !rBone) {
        return frames;
    }

    const upAmp = 0.05 * intensity;
    const rotAmp = 0.08 * intensity;
    const slowPeriod = 4 * cache.beatFrames;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const base = Math.sin((Math.PI * f) / cache.beatFrames);
        const slow = 0.7 + 0.3 * Math.sin((2 * Math.PI * f) / slowPeriod);
        if (lBone) {
            const up = Math.abs(base) * upAmp * slow;
            const rot = clamp1(base * rotAmp * slow);
            const w = quatW(0, 0, rot);
            frames.push({ name: lBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
        }
        if (rBone) {
            const up = Math.abs(base) * upAmp * slow;
            const rot = clamp1(-base * rotAmp * slow); // 右肩反向，对称耸肩
            const w = quatW(0, 0, rot);
            frames.push({ name: rBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
        }
    }
    return frames;
}

/**
 * 生成足部 IK 骨骼帧
 * 随重心摆动：重心偏右时左足抬起（step touch），配合 Center 的 X 重心转移制造换脚感。
 */
export function genFootIkBones(
    lBone: string | null,
    rBone: string | null,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    if (!lBone && !rBone) {
        return frames;
    }

    const stepAmp = 2.0 * intensity;
    const liftAmp = 1.0 * intensity;
    const bounceLift = 0.5 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const { beatInLoop, beatPhase } = beatInfo(cache, f);
        const sway = swayAt(cache, f);
        const bounce = beatBounce(beatPhase) * downbeatWeight(beatInLoop);
        if (lBone) {
            const lz = clamp1(sway * stepAmp);
            const ly = Math.max(0, -sway) * liftAmp + bounce * bounceLift;
            frames.push({ name: lBone, frame: f, position: [0, ly, lz], rotation: [0, 0, 0, 1] });
        }
        if (rBone) {
            const rz = clamp1(-sway * stepAmp);
            const ry = Math.max(0, sway) * liftAmp + bounce * bounceLift;
            frames.push({ name: rBone, frame: f, position: [0, ry, rz], rotation: [0, 0, 0, 1] });
        }
    }
    return frames;
}
