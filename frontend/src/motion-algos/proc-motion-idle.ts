import {
    buildVmd,
    type BoneKeyFrame,
    type MorphKeyFrame,
    INTERP_EASE_IN_OUT,
} from './vmd-writer';
import {
    BONE_CENTER_CANDIDATES,
    BONE_UPPER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_NECK_CANDIDATES,
    BONE_HEAD_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    MORPH_BLINK_CANDIDATES,
    FPS,
    MAX_FRAMES,
    matchBone,
    clamp1,
    PROC_VMD_NAME_IDLE,
    type ProcMotionState,
} from './proc-motion-shared';

export function generateIdleVmd(
    state: ProcMotionState,
    morphNames: string[] = [],
    boneNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const loopFrames = Math.min(MAX_FRAMES, Math.round(120 / safeSpeed));
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    const blinkMorph = state.boneToggles.blink
        ? MORPH_BLINK_CANDIDATES.find((c) => morphNames.includes(c))
        : null;
    if (blinkMorph) {
        const blinkA = Math.round(60 / safeSpeed);
        const blinkB = Math.round(240 / safeSpeed);
        for (let t = blinkA, i = 0; t + 5 <= loopFrames; i++) {
            morphs.push({ name: blinkMorph, frame: t, weight: 0 });
            morphs.push({ name: blinkMorph, frame: t + 2, weight: 1 });
            morphs.push({ name: blinkMorph, frame: t + 5, weight: 0 });
            const step = blinkA + ((i * 17 + 3) % (blinkB - blinkA));
            t += Math.max(blinkA, step);
        }
        morphs.push({ name: blinkMorph, frame: loopFrames, weight: 0 });
    }

    const centerBone = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upperBone = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const upper2Bone = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const neckBone = matchBone(boneNames, BONE_NECK_CANDIDATES);
    const headBone = matchBone(boneNames, BONE_HEAD_CANDIDATES);
    const waistBone = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentBone = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);
    const shoulderLBone = matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const larmBone = matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = matchBone(boneNames, BONE_RARM_CANDIDATES);
    const wristLBone = matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = matchBone(boneNames, BONE_WRIST_R_CANDIDATES);

    const breathAmp = 0.03 * intensity;
    if ((upperBone || neckBone) && state.boneToggles.upper) {
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(phase) * breathAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            if (upperBone) {
                bones.push({
                    name: upperBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, 0, w],
                });
            }
            if (neckBone) {
                const nrx = clamp1(Math.sin(phase) * breathAmp * 0.6);
                const nw = Math.sqrt(Math.max(0, 1 - nrx * nrx));
                bones.push({
                    name: neckBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [nrx, 0, 0, nw],
                });
            }
        }
        if (upperBone) {
            bones.push({
                name: upperBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
        if (neckBone) {
            bones.push({
                name: neckBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
    }

    if (upper2Bone && state.boneToggles.upper2) {
        const amp2 = 0.015 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(phase * 0.7 + 0.3) * amp2);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            bones.push({
                name: upper2Bone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, 0, w],
            });
        }
        bones.push({
            name: upper2Bone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if (waistBone && state.boneToggles.waist) {
        const waistAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = clamp1(Math.sin(phase + 0.5) * waistAmp);
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

    if (allParentBone && state.boneToggles.allParent) {
        const parentAmp = 0.005 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(t * 0.2 + 1.1) * parentAmp);
            const rz = clamp1(Math.sin(t * 0.3 + 2.3) * parentAmp);
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

    if (centerBone && state.boneToggles.center) {
        const hasBreath = !!(upperBone || neckBone);
        const swayAmp = (hasBreath ? 0.04 : 0.1) * intensity;
        const microAmp = 0.03 * intensity;
        const bobAmp = (hasBreath ? 0.005 : 0.04) * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const slowPhase = phase * 0.5;
            const rz = clamp1(Math.sin(slowPhase) * swayAmp);
            const rw = Math.sqrt(Math.max(0, 1 - rz * rz));
            const rx = clamp1(Math.sin(phase * 0.37 + 0.5) * microAmp);
            const w = clamp1(Math.sqrt(Math.max(0, 1 - rx * rx - rz * rz)));
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

    if (headBone) {
        const headMicroAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rz = clamp1(Math.sin(t * 0.43 + 1.2) * headMicroAmp);
            const rx = clamp1(Math.sin(t * 0.29 + 3.7) * headMicroAmp * 0.7);
            const ry = clamp1(Math.sin(t * 0.19 + 0.8) * headMicroAmp * 0.4);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz - rx * rx - ry * ry));
            bones.push({
                name: headBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, ry, rz, w],
            });
        }
        bones.push({
            name: headBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if (larmBone || rarmBone) {
        const armAmp = 0.04 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = clamp1(Math.sin(phase + 1.5) * armAmp);
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

    if (shoulderLBone || shoulderRBone) {
        const shoulderAmp = 0.015 * intensity;
        const rotAmp = 0.01 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const breath = Math.sin(phase + 0.3);
            const yOffset = breath * shoulderAmp;
            const rz = clamp1(Math.sin(phase + 0.1) * rotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rz * rz));
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
                const rw = Math.sqrt(Math.max(0, 1 - rrz * rrz));
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, rOffset, 0],
                    rotation: [0, 0, rrz, rw],
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

    if (wristLBone || wristRBone) {
        const wristAmp = 0.015 * intensity;
        for (let f = 0; f <= loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(phase + 0.8) * wristAmp);
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
                const rxR = clamp1(Math.sin(phase + 1.1) * wristAmp);
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

    for (const b of bones) {
        b.interp = INTERP_EASE_IN_OUT;
    }
    return buildVmd(bones, morphs, PROC_VMD_NAME_IDLE);
}
