import { buildVmd, type BoneKeyFrame, type MorphKeyFrame, INTERP_EASE_IN_OUT } from './vmd-writer';
import {
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    MAX_FRAMES,
    matchBone,
    clamp1,
    quatW,
    closingFrame,
    PROC_VMD_NAME_IDLE,
    type ProcMotionState,
} from './proc-motion-shared';

export function generateIdleVmd(state: ProcMotionState, boneNames: string[] = []): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const loopFrames = Math.min(MAX_FRAMES, Math.round(120 / safeSpeed));
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    const shoulderLBone = matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const larmBone = matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = matchBone(boneNames, BONE_RARM_CANDIDATES);
    const wristLBone = matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = matchBone(boneNames, BONE_WRIST_R_CANDIDATES);

    // 躯干微晃（center/upper2/waist/allParent）已迁入感知层 _applyBalanceSway，此处不再生成 VMD 关键帧

    if (larmBone || rarmBone) {
        const armAmp = 0.04 * intensity;
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = clamp1(Math.sin(phase + 1.5) * armAmp);
            const w = quatW(0, 0, rz);
            if (larmBone) {
                bones.push({
                    name: larmBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [0, 0, rz, w],
                });
            }
            if (rarmBone) {
                bones.push({
                    name: rarmBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [0, 0, -rz, w],
                });
            }
        }
        if (larmBone) {
            bones.push(closingFrame(larmBone, loopFrames));
        }
        if (rarmBone) {
            bones.push(closingFrame(rarmBone, loopFrames));
        }
    }

    if (shoulderLBone || shoulderRBone) {
        const shoulderAmp = 0.015 * intensity;
        const rotAmp = 0.01 * intensity;
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const breath = Math.sin(phase + 0.3);
            const yOffset = breath * shoulderAmp;
            const rz = clamp1(Math.sin(phase + 0.1) * rotAmp);
            const w = quatW(0, 0, rz);
            if (shoulderLBone) {
                bones.push({
                    name: shoulderLBone,
                    frame: f,
                    position: [0, yOffset, 0],
                    rotation: [0, 0, rz, w],
                });
            }
            if (shoulderRBone) {
                const rOffset = Math.sin(phase + 0.5) * shoulderAmp;
                const rrz = clamp1(Math.sin(phase + 0.4) * rotAmp);
                const rw = quatW(0, 0, rrz);
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, rOffset, 0],
                    rotation: [0, 0, rrz, rw],
                });
            }
        }
        if (shoulderLBone) {
            bones.push(closingFrame(shoulderLBone, loopFrames));
        }
        if (shoulderRBone) {
            bones.push(closingFrame(shoulderRBone, loopFrames));
        }
    }

    if (wristLBone || wristRBone) {
        const wristAmp = 0.015 * intensity;
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(phase + 0.8) * wristAmp);
            const w = quatW(rx, 0, 0);
            if (wristLBone) {
                bones.push({
                    name: wristLBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, 0, w],
                });
            }
            if (wristRBone) {
                const rxR = clamp1(Math.sin(phase + 1.1) * wristAmp);
                const wR = quatW(rxR, 0, 0);
                bones.push({
                    name: wristRBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rxR, 0, 0, wR],
                });
            }
        }
        if (wristLBone) {
            bones.push(closingFrame(wristLBone, loopFrames));
        }
        if (wristRBone) {
            bones.push(closingFrame(wristRBone, loopFrames));
        }
    }

    for (const b of bones) {
        b.interp = INTERP_EASE_IN_OUT;
    }
    return buildVmd(bones, morphs, PROC_VMD_NAME_IDLE);
}
