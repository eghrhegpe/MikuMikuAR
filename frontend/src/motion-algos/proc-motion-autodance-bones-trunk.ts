/**
 * proc-motion-autodance-bones-trunk.ts
 * 躯干骨骼帧生成（Center / Upper / Upper2 / Waist / Groove / AllParent）
 */
import type { BoneKeyFrame } from './vmd-writer';
import { type ProcMotionState, clamp1, quatW, closingFrame } from './proc-motion-shared';
import type { TrigCache } from './proc-motion-autodance-bones';
import { sinVal, cosVal } from './proc-motion-autodance-bones';

/**
 * 生成中心/下半身骨骼帧（Root / Center）
 */
export function genCenterBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const bodyAmp = 0.2 * intensity;
    const sideAmp = 0.12 * intensity;
    const bobAmp = 0.06 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const c = cosVal(cache, f);
        const ry = clamp1(s * bodyAmp);
        const rz = clamp1(c * sideAmp);
        const w = quatW(0, ry, rz);
        const bob = Math.abs(s) * bobAmp;
        frames.push({
            name: bone,
            frame: f,
            position: [0, bob, 0],
            rotation: [0, ry, rz, w],
        });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}

/**
 * 生成上半身骨骼帧
 */
export function genUpperBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const upperAmp = 0.15 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f + Math.round(cache.beatFrames / 2));
        const rx = clamp1(s * upperAmp);
        const w = quatW(rx, 0, 0);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}

/**
 * 生成上半身2骨骼帧
 */
export function genUpper2Bone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const amp2 = 0.06 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const ry = clamp1(s * 0.6 * amp2);
        const w = quatW(0, ry, 0);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [0, ry, 0, w] });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}

/**
 * 生成腰部骨骼帧
 */
export function genWaistBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const waistAmp = 0.2 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f + Math.round(cache.beatFrames / 4));
        const rz = clamp1(-s * waistAmp);
        const w = quatW(0, 0, rz);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}

/**
 * 生成 Groove 骨骼帧
 */
export function genGrooveBone(
    bone: string,
    state: ProcMotionState,
    cache: TrigCache,
    intensity: number
): BoneKeyFrame[] {
    const frames: BoneKeyFrame[] = [];
    const grooveAmp = 0.15 * intensity;

    for (let f = 0; f <= cache.loopFrames; f += 3) {
        const s = sinVal(cache, f);
        const bob = Math.abs(s) * 0.08 * intensity;
        const ry = clamp1(s * grooveAmp);
        const w = quatW(0, ry, 0);
        frames.push({ name: bone, frame: f, position: [0, bob, 0], rotation: [0, ry, 0, w] });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}

/**
 * 生成 AllParent 骨骼帧（步长6，低频微调）
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
        const t = (f / cache.loopFrames) * Math.PI * 2;
        const rx = clamp1(Math.sin(t * 0.7 + 1.1) * parentAmp);
        const rz = clamp1(Math.sin(t * 0.5 + 2.3) * parentAmp);
        const w = quatW(rx, 0, rz);
        frames.push({ name: bone, frame: f, position: [0, 0, 0], rotation: [rx, 0, rz, w] });
    }
    frames.push(closingFrame(bone, cache.loopFrames));
    return frames;
}
