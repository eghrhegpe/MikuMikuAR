import { buildVmd, type BoneKeyFrame, type MorphKeyFrame, INTERP_EASE_IN_OUT } from './vmd-writer';
import {
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
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

    // ── 足 IK ──
    const legIkLBone = matchBone(boneNames, BONE_LEG_IK_L_CANDIDATES);
    const legIkRBone = matchBone(boneNames, BONE_LEG_IK_R_CANDIDATES);

    // ── 躯干微晃（center/upper2/waist/allParent）─ 从感知层迁回程序化 idle ──
    const centerBone = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Bone = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistBone = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentBone = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    // 重心微动振幅（从感知层原值缩减 50%，避免过晃）
    const swayAmp = {
        centerRz: 0.025, // center 左右摆（原 0.05）
        centerRx: 0.01, // center 前后倾（原 0.02）
        centerBobY: 0.015, // center 上下浮动（原 0.03）
        upper2Rx: 0.008, // 上半身2 前后倾（原 0.015）
        waistRz: 0.008, // 腰 左右摆（原 0.015）
        allParentRx: 0.003, // 全ての親 微倾（原 0.005）
        allParentRz: 0.003, // 全ての親 微摆（原 0.005）
    };

    if (centerBone) {
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const slowPhase = phase * 0.5;
            const bobY = Math.sin(phase) * swayAmp.centerBobY * intensity;
            const rz = Math.sin(slowPhase) * swayAmp.centerRz * intensity;
            const rx = Math.sin(phase * 0.37 + 0.5) * swayAmp.centerRx * intensity;
            const w = quatW(rx, 0, rz);
            bones.push({
                name: centerBone,
                frame: f,
                position: [0, bobY, 0],
                rotation: [rx, 0, rz, w],
            });
        }
        bones.push(closingFrame(centerBone, loopFrames));
    }

    if (upper2Bone) {
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = Math.sin(phase * 0.7 + 0.3) * swayAmp.upper2Rx * intensity;
            const w = quatW(rx, 0, 0);
            bones.push({
                name: upper2Bone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, 0, w],
            });
        }
        bones.push(closingFrame(upper2Bone, loopFrames));
    }

    if (waistBone) {
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rz = Math.sin(phase + 0.5) * swayAmp.waistRz * intensity;
            const w = quatW(0, 0, rz);
            bones.push({
                name: waistBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [0, 0, rz, w],
            });
        }
        bones.push(closingFrame(waistBone, loopFrames));
    }

    if (allParentBone) {
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            const rx = Math.sin(phase * 0.2 + 1.1) * swayAmp.allParentRx * intensity;
            const rz = Math.sin(phase * 0.3 + 2.3) * swayAmp.allParentRz * intensity;
            const w = quatW(rx, 0, rz);
            bones.push({
                name: allParentBone,
                frame: f,
                position: [0, 0, 0],
                rotation: [rx, 0, rz, w],
            });
        }
        bones.push(closingFrame(allParentBone, loopFrames));
    }

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

    // ── 足 IK 微动（呼吸起伏 + 重心微摆）──
    if (legIkLBone || legIkRBone) {
        const legIkAmp = 0.012 * intensity; // Y 轴起伏振幅
        const legSwayAmp = 0.005 * intensity; // Z 轴微摆
        for (let f = 0; f < loopFrames; f += 4) {
            const phase = (f / loopFrames) * Math.PI * 2;
            // 用较慢的呼吸相位，与 center 的上下浮动错位制造自然感
            const breathPhase = phase * 0.5;
            const ly = Math.sin(breathPhase + 0.5) * legIkAmp;
            const ry = Math.sin(breathPhase + 0.8) * legIkAmp;
            // 微小 Z 轴摆幅，模拟重心交换
            const lz = Math.sin(breathPhase) * legSwayAmp;
            const rz = Math.sin(breathPhase + Math.PI) * legSwayAmp;
            if (legIkLBone) {
                bones.push({
                    name: legIkLBone,
                    frame: f,
                    position: [0, ly, lz],
                    rotation: [0, 0, 0, 1],
                });
            }
            if (legIkRBone) {
                bones.push({
                    name: legIkRBone,
                    frame: f,
                    position: [0, ry, rz],
                    rotation: [0, 0, 0, 1],
                });
            }
        }
        if (legIkLBone) {
            bones.push(closingFrame(legIkLBone, loopFrames));
        }
        if (legIkRBone) {
            bones.push(closingFrame(legIkRBone, loopFrames));
        }
    }

    for (const b of bones) {
        b.interp = INTERP_EASE_IN_OUT;
    }
    return buildVmd(bones, morphs, PROC_VMD_NAME_IDLE);
}
