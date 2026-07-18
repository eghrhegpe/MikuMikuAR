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

/** 计算右臂相对左臂的半拍错位相位（按拍交替，保证循环无缝） */
function rightShift(beatInLoop: number): number {
    return (beatInLoop % 2) * 0.5; // 0 或 0.5 拍，f=0 与 f=loopFrames 时均为 0
}

/**
 * 生成手臂骨骼帧（左右）
 * 肩抬（外展 Z + 前举 X）随踩点包络，左右半拍错位，配合肘部弯曲形成挥舞而非开合。
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

    const raiseZ = 0.5 * intensity; // 外展（抬向两侧）
    const raiseX = 0.25 * intensity; // 前举（抬向前方）

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const { beatInLoop, beatPhase } = beatInfo(cache, f);
        const bounce = beatBounce(beatPhase) * downbeatWeight(beatInLoop);
        const rShift = rightShift(beatInLoop);
        const rBounce = beatBounce((beatPhase + rShift) % 1) * downbeatWeight(beatInLoop);
        if (larmBone) {
            const lz = clamp1(bounce * raiseZ);
            const lx = clamp1(bounce * raiseX);
            const w = quatW(lx, 0, lz);
            frames.push({ name: larmBone, frame: f, position: [0, 0, 0], rotation: [lx, 0, lz, w] });
        }
        if (rarmBone) {
            const rz = clamp1(-rBounce * raiseZ);
            const rx = clamp1(rBounce * raiseX);
            const w = quatW(rx, 0, rz);
            frames.push({ name: rarmBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
    }
    return frames;
}

/**
 * 生成肘部骨骼帧（新增）
 * 手臂上抬时肘部屈曲（X 轴），与肩抬形成复合弧线——这是"手臂看起来自然"的关键。
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

    const bendAmp = 0.6 * intensity; // 肘屈幅度（随手臂上抬同步）

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const { beatInLoop, beatPhase } = beatInfo(cache, f);
        const bounce = beatBounce(beatPhase) * downbeatWeight(beatInLoop);
        const rShift = rightShift(beatInLoop);
        const rBounce = beatBounce((beatPhase + rShift) % 1) * downbeatWeight(beatInLoop);
        if (lelbowBone) {
            const lx = clamp1(bounce * bendAmp);
            const w = quatW(lx, 0, 0);
            frames.push({ name: lelbowBone, frame: f, position: [0, 0, 0], rotation: [lx, 0, 0, w] });
        }
        if (relbowBone) {
            const rx = clamp1(rBounce * bendAmp);
            const w = quatW(rx, 0, 0);
            frames.push({ name: relbowBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
        }
    }
    return frames;
}

/**
 * 生成腕部骨骼帧
 * 随同侧手臂踩点包络做翻转，保持末端联动。
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

    const wristAmpX = 0.25 * intensity;
    const wristAmpZ = 0.12 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const { beatInLoop, beatPhase } = beatInfo(cache, f);
        const bounce = beatBounce(beatPhase) * downbeatWeight(beatInLoop);
        const rShift = rightShift(beatInLoop);
        const rBounce = beatBounce((beatPhase + rShift) % 1) * downbeatWeight(beatInLoop);
        if (lBone) {
            const rx = clamp1(bounce * wristAmpX);
            const rz = clamp1(bounce * wristAmpZ);
            const w = quatW(rx, 0, rz);
            frames.push({ name: lBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
        if (rBone) {
            const rx = clamp1(rBounce * wristAmpX);
            const rz = clamp1(-rBounce * wristAmpZ);
            const w = quatW(rx, 0, rz);
            frames.push({ name: rBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
        }
    }
    return frames;
}

/**
 * 生成肩部骨骼帧
 * 随同侧手臂上抬做耸肩（Y 位移）+ 微旋（Z），形成肩→臂动力链。
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

    const upAmp = 0.06 * intensity;
    const rotAmp = 0.1 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += STEP) {
        const { beatInLoop, beatPhase } = beatInfo(cache, f);
        const bounce = beatBounce(beatPhase) * downbeatWeight(beatInLoop);
        const rShift = rightShift(beatInLoop);
        const rBounce = beatBounce((beatPhase + rShift) % 1) * downbeatWeight(beatInLoop);
        if (lBone) {
            const up = Math.abs(bounce) * upAmp;
            const rot = clamp1(bounce * rotAmp);
            const w = quatW(0, 0, rot);
            frames.push({ name: lBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
        }
        if (rBone) {
            const up = Math.abs(rBounce) * upAmp;
            const rot = clamp1(rBounce * rotAmp);
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

    const stepAmp = 0.06 * intensity;
    const liftAmp = 0.04 * intensity;
    const bounceLift = 0.02 * intensity;

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
