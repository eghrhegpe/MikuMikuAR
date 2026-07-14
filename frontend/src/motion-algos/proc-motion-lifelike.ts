import { buildVmd, type BoneKeyFrame, type MorphKeyFrame, INTERP_EASE_IN_OUT } from './vmd-writer';
import {
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    FPS,
    MAX_FRAMES,
    matchBone,
    clamp1,
    PROC_VMD_NAME_LIFELIKE,
    type ProcMotionState,
} from './proc-motion-shared';

export function generateLifelikeVmd(
    state: ProcMotionState,
    morphNames: string[] = [],
    boneNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const intensity = state.lifelikeIntensity;
    const loopFrames = Math.min(MAX_FRAMES, Math.round(300 / safeSpeed));
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    const centerBone = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Bone = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistBone = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentBone = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);
    const shoulderLBone = matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const larmBone = matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = matchBone(boneNames, BONE_RARM_CANDIDATES);
    const wristLBone = matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = matchBone(boneNames, BONE_WRIST_R_CANDIDATES);

    if (upper2Bone && state.boneToggles.upper2) {
        const amp2 = 0.008 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const rx = clamp1(Math.sin(t * Math.PI * 2 * 0.43 + 1.2) * amp2);
            const ry = clamp1(Math.sin(t * Math.PI * 2 * 0.31 + 0.5) * amp2 * 0.6);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry));
            bones.push({
                name: upper2Bone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, ry, 0, w],
            });
        }
        bones.push({
            name: upper2Bone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if (centerBone && state.boneToggles.center) {
        const driftAmp = 0.012 * intensity;
        const bobAmp = 0.003 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const rz = clamp1(
                Math.sin(t * Math.PI * 2 * 0.15 + 0.3) * driftAmp * 0.6 +
                    Math.sin(t * Math.PI * 2 * 0.23 + 1.7) * driftAmp * 0.3 +
                    Math.sin(t * Math.PI * 2 * 0.37 + 2.9) * driftAmp * 0.1
            );
            const rx = clamp1(Math.sin(t * Math.PI * 2 * 0.11 + 0.9) * driftAmp * 0.3);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx - rz * rz));
            const bobY = Math.sin(t * Math.PI * 2 * 0.5) * bobAmp;
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

    if (waistBone && state.boneToggles.waist) {
        const waistAmp = 0.008 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const rz = clamp1(Math.sin(t * Math.PI * 2 * 0.17 + 1.1) * waistAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
            bones.push({ name: waistBone, frame: f, position: [0, 0, 0], rotation: [0, 0, rz, w] });
        }
        bones.push({
            name: waistBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if ((shoulderLBone || shoulderRBone) && state.boneToggles.shoulder) {
        const shoulderAmp = 0.006 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const yL = Math.sin(t * Math.PI * 2 + 0.3) * shoulderAmp;
            const yR = Math.sin(t * Math.PI * 2 + 0.7) * shoulderAmp * 0.8;
            const rzL = clamp1(Math.sin(t * Math.PI * 2 * 0.5 + 0.1) * shoulderAmp * 0.3);
            const rzR = clamp1(Math.sin(t * Math.PI * 2 * 0.5 + 0.5) * shoulderAmp * 0.3);
            const wL = Math.sqrt(Math.max(0, 1 - rzL * rzL));
            const wR = Math.sqrt(Math.max(0, 1 - rzR * rzR));
            if (shoulderLBone) {
                bones.push({
                    name: shoulderLBone,
                    frame: f,
                    position: [0, yL, 0],
                    rotation: [0, 0, rzL, wL],
                });
            }
            if (shoulderRBone) {
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, yR, 0],
                    rotation: [0, 0, rzR, wR],
                });
            }
        }
        if (shoulderLBone) {
            bones.push({
                name: shoulderLBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
        if (shoulderRBone) {
            bones.push({
                name: shoulderRBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
    }

    if ((larmBone || rarmBone) && state.boneToggles.arm) {
        const armAmp = 0.012 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const rz = clamp1(Math.sin(t * Math.PI * 2 * 0.25 + 1.5) * armAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
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
            bones.push({
                name: larmBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
        if (rarmBone) {
            bones.push({
                name: rarmBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
    }

    if ((wristLBone || wristRBone) && state.boneToggles.wrist) {
        const wristAmp = 0.008 * intensity;
        for (let f = 0; f < loopFrames; f += 3) {
            const t = f / loopFrames;
            const rx = clamp1(Math.sin(t * Math.PI * 2 * 0.33 + 0.8) * wristAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            if (wristLBone) {
                bones.push({
                    name: wristLBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, 0, w],
                });
            }
            if (wristRBone) {
                const rxR = clamp1(Math.sin(t * Math.PI * 2 * 0.33 + 1.1) * wristAmp);
                const wR = Math.sqrt(Math.max(0, 1 - rxR * rxR));
                bones.push({
                    name: wristRBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rxR, 0, 0, wR],
                });
            }
        }
        if (wristLBone) {
            bones.push({
                name: wristLBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
        if (wristRBone) {
            bones.push({
                name: wristRBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
    }

    if (allParentBone && state.boneToggles.allParent) {
        const parentAmp = 0.003 * intensity;
        for (let f = 0; f < loopFrames; f += 4) {
            const t = f / loopFrames;
            const rx = clamp1(Math.sin(t * Math.PI * 2 * 0.08 + 1.1) * parentAmp);
            const rz = clamp1(Math.sin(t * Math.PI * 2 * 0.12 + 2.3) * parentAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx - rz * rz));
            bones.push({
                name: allParentBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, rz, w],
            });
        }
        bones.push({
            name: allParentBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    for (const b of bones) {
        b.interp = INTERP_EASE_IN_OUT;
    }
    return buildVmd(bones, morphs, PROC_VMD_NAME_LIFELIKE);
}
