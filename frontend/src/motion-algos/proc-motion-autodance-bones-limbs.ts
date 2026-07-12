/**
 * proc-motion-autodance-bones-limbs.ts
 * 四肢骨骼帧生成（Arm / Shoulder / Wrist / FootIK）
 */
import type { BoneKeyFrame } from './vmd-writer';
import { type ProcMotionState, clamp1 } from './proc-motion-shared';
import type { TrigCache } from './proc-motion-autodance-bones';
import { sinVal, cosVal } from './proc-motion-autodance-bones';

/**
 * 生成手臂骨骼帧（左右对称）
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

    const armAmpZ = 0.55 * intensity;
    const armAmpX = 0.3 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const phase2 = cosVal(cache, f + Math.round(cache.beatFrames / 4));
        if (larmBone) {
            const lz = clamp1(s * armAmpZ);
            const lx = clamp1(phase2 * armAmpX);
            const w = Math.sqrt(Math.max(0, 1 - lz * lz - lx * lx));
            frames.push({
                name: larmBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [lx, 0, lz, w],
            });
        }
        if (rarmBone) {
            const rz = clamp1(-s * armAmpZ);
            const rx = clamp1(phase2 * armAmpX);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz - rx * rx));
            frames.push({
                name: rarmBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, rz, w],
            });
        }
    }
    if (larmBone) {
        frames.push({
            name: larmBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    if (rarmBone) {
        frames.push({
            name: rarmBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    return frames;
}

/**
 * 生成腕部骨骼帧
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

    const wristAmpX = 0.35 * intensity;
    const wristAmpZ = 0.15 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const rx = clamp1(Math.abs(s) * wristAmpX);
        const rzL = cosVal(cache, f);
        const rzR = clamp1(-cosVal(cache, f) * wristAmpZ);
        const wL = Math.sqrt(Math.max(0, 1 - rx * rx - rzL * rzL));
        const wR = Math.sqrt(Math.max(0, 1 - rx * rx - rzR * rzR));
        if (lBone) {
            frames.push({
                name: lBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, clamp1(rzL * wristAmpZ), wL],
            });
        }
        if (rBone) {
            frames.push({ name: rBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rzR, wR] });
        }
    }
    if (lBone) {
        frames.push({
            name: lBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    if (rBone) {
        frames.push({
            name: rBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    return frames;
}

/**
 * 生成肩部骨骼帧
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

    const shoulderUpAmp = 0.1 * intensity;
    const shoulderRotAmp = 0.15 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const up = Math.abs(s) * shoulderUpAmp;
        const rot = clamp1(s * shoulderRotAmp);
        const w = Math.sqrt(Math.max(0, 1 - rot * rot));
        if (lBone) {
            frames.push({ name: lBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
        }
        if (rBone) {
            frames.push({ name: rBone, frame: f, position: [0, up, 0], rotation: [0, 0, rot, w] });
        }
    }
    if (lBone) {
        frames.push({
            name: lBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    if (rBone) {
        frames.push({
            name: rBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    return frames;
}

/**
 * 生成足部 IK 骨骼帧
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

    const stepAmp = 0.08 * intensity;
    const liftAmp = 0.03 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        if (lBone) {
            const lz = clamp1(s * stepAmp);
            const ly = Math.max(0, s) * liftAmp;
            frames.push({ name: lBone, frame: f, position: [0, ly, lz], rotation: [0, 0, 0, 1] });
        }
        if (rBone) {
            const rz = clamp1(-s * stepAmp);
            const ry = Math.max(0, -s) * liftAmp;
            frames.push({ name: rBone, frame: f, position: [0, ry, rz], rotation: [0, 0, 0, 1] });
        }
    }
    if (lBone) {
        frames.push({
            name: lBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    if (rBone) {
        frames.push({
            name: rBone,
            frame: cache.loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }
    return frames;
}
