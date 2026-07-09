import {
    buildVmd,
    canEncodeName,
    type BoneKeyFrame,
    type MorphKeyFrame,
    INTERP_EASE_IN_OUT,
    INTERP_EASE_OUT,
    INTERP_SHARP,
} from './vmd-writer';
import {
    BONE_CENTER_CANDIDATES,
    BONE_UPPER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_GROOVE_CANDIDATES,
    BONE_LARM_CANDIDATES,
    BONE_RARM_CANDIDATES,
    BONE_SHOULDER_L_CANDIDATES,
    BONE_SHOULDER_R_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    BONE_WRIST_L_CANDIDATES,
    BONE_WRIST_R_CANDIDATES,
    BONE_LEG_IK_L_CANDIDATES,
    BONE_LEG_IK_R_CANDIDATES,
    FPS,
    MAX_FRAMES,
    matchBone,
    clamp1,
    PROC_VMD_NAME_AUTODANCE,
    type ProcMotionState,
} from './proc-motion-shared';

export function generateAutoDanceVmd(
    state: ProcMotionState,
    bpm: number,
    morphNames: string[] = [],
    boneNames: string[] = []
): ArrayBuffer {
    const safeSpeed = Math.max(0.1, Math.min(10, state.speed));
    const clampedBpm = Math.max(60, Math.min(200, bpm));
    const beatFrames = Math.min(MAX_FRAMES, Math.round(((60 / clampedBpm) * FPS) / safeSpeed));
    const loopFrames = beatFrames * 8;
    const intensity = state.intensity;
    const bones: BoneKeyFrame[] = [];
    const morphs: MorphKeyFrame[] = [];

    const centerBone = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upperBone = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const upper2Bone = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistBone = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const grooveBone = matchBone(boneNames, BONE_GROOVE_CANDIDATES);
    const larmBone = matchBone(boneNames, BONE_LARM_CANDIDATES);
    const rarmBone = matchBone(boneNames, BONE_RARM_CANDIDATES);
    const shoulderLBone = matchBone(boneNames, BONE_SHOULDER_L_CANDIDATES);
    const shoulderRBone = matchBone(boneNames, BONE_SHOULDER_R_CANDIDATES);
    const allParentBone = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);
    const wristLBone = matchBone(boneNames, BONE_WRIST_L_CANDIDATES);
    const wristRBone = matchBone(boneNames, BONE_WRIST_R_CANDIDATES);
    const legIkLBone = matchBone(boneNames, BONE_LEG_IK_L_CANDIDATES);
    const legIkRBone = matchBone(boneNames, BONE_LEG_IK_R_CANDIDATES);

    const sinVals: number[] = [];
    const cosVals: number[] = [];
    for (let f = 0; f <= loopFrames; f += 3) {
        const angle = (f / beatFrames) * Math.PI;
        sinVals[f] = Math.sin(angle);
        cosVals[f] = Math.cos(angle);
    }

    if (centerBone && state.boneToggles.center) {
        const bodyAmp = 0.2 * intensity;
        const sideAmp = 0.12 * intensity;
        const bobAmp = 0.06 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const c = cosVals[f];
            const ry = clamp1(s * bodyAmp);
            const rz = clamp1(c * sideAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry - rz * rz));
            const bob = Math.abs(s) * bobAmp;
            bones.push({
                name: centerBone,
                frame: f,
                position: [0, bob, 0],
                rotation: [0, ry, rz, w],
            });
        }
        bones.push({
            name: centerBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if (upperBone && state.boneToggles.upper) {
        const upperAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f + Math.round(beatFrames / 2)] || 0;
            const rx = clamp1(s * upperAmp);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx));
            bones.push({ name: upperBone, frame: f, position: [0, 0, 0], rotation: [rx, 0, 0, w] });
        }
        bones.push({
            name: upperBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if (upper2Bone && state.boneToggles.upper2) {
        const amp2 = 0.06 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const ry = clamp1(s * 0.6 * amp2);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            bones.push({
                name: upper2Bone,
                frame: f,
                position: [0, 0, 0],
                rotation: [0, ry, 0, w],
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
        const waistAmp = 0.2 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f + Math.round(beatFrames / 4)] || 0;
            const rz = clamp1(-s * waistAmp);
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

    if ((larmBone || rarmBone) && state.boneToggles.arm) {
        const armAmpZ = 0.55 * intensity;
        const armAmpX = 0.3 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const phase2 = cosVals[f + Math.round(beatFrames / 4)] || 0;
            if (larmBone) {
                const lz = clamp1(s * armAmpZ);
                const lx = clamp1(phase2 * armAmpX);
                const w = Math.sqrt(Math.max(0, 1 - lz * lz - lx * lx));
                bones.push({
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
                bones.push({
                    name: rarmBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, rz, w],
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

    if (grooveBone && state.boneToggles.groove) {
        const grooveAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const bob = Math.abs(s) * 0.08 * intensity;
            const ry = clamp1(s * grooveAmp);
            const w = Math.sqrt(Math.max(0, 1 - ry * ry));
            bones.push({
                name: grooveBone,
                frame: f,
                position: [0, bob, 0],
                rotation: [0, ry, 0, w],
            });
        }
        bones.push({
            name: grooveBone,
            frame: loopFrames,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        });
    }

    if ((shoulderLBone || shoulderRBone) && state.boneToggles.shoulder) {
        const shoulderUpAmp = 0.1 * intensity;
        const shoulderRotAmp = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const up = Math.abs(s) * shoulderUpAmp;
            const rot = clamp1(s * shoulderRotAmp);
            const w = Math.sqrt(Math.max(0, 1 - rot * rot));
            if (shoulderLBone) {
                bones.push({
                    name: shoulderLBone,
                    frame: f,
                    position: [0, up, 0],
                    rotation: [0, 0, rot, w],
                });
            }
            if (shoulderRBone) {
                bones.push({
                    name: shoulderRBone,
                    frame: f,
                    position: [0, up, 0],
                    rotation: [0, 0, rot, w],
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

    if (allParentBone && state.boneToggles.allParent) {
        const parentAmp = 0.02 * intensity;
        for (let f = 0; f <= loopFrames; f += 6) {
            const t = (f / loopFrames) * Math.PI * 2;
            const rx = clamp1(Math.sin(t * 0.7 + 1.1) * parentAmp);
            const rz = clamp1(Math.sin(t * 0.5 + 2.3) * parentAmp);
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

    if ((wristLBone || wristRBone) && state.boneToggles.wrist) {
        const wristAmpX = 0.35 * intensity;
        const wristAmpZ = 0.15 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            const rx = clamp1(Math.abs(s) * wristAmpX);
            const rz = clamp1(cosVals[f] * wristAmpZ);
            const w = Math.sqrt(Math.max(0, 1 - rx * rx - rz * rz));
            if (wristLBone) {
                bones.push({
                    name: wristLBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, rz, w],
                });
            }
            if (wristRBone) {
                const rzR = clamp1(-cosVals[f] * wristAmpZ);
                const wR = Math.sqrt(Math.max(0, 1 - rx * rx - rzR * rzR));
                bones.push({
                    name: wristRBone,
                    frame: f,
                    position: [0, 0, 0],
                    rotation: [rx, 0, rzR, wR],
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

    if (state.boneToggles.footIk && (legIkLBone || legIkRBone)) {
        const stepAmp = 0.08 * intensity;
        const liftAmp = 0.03 * intensity;
        for (let f = 0; f <= loopFrames; f += 3) {
            const s = sinVals[f];
            if (legIkLBone) {
                const lz = clamp1(s * stepAmp);
                const ly = Math.max(0, s) * liftAmp;
                bones.push({
                    name: legIkLBone,
                    frame: f,
                    position: [0, ly, lz],
                    rotation: [0, 0, 0, 1],
                });
            }
            if (legIkRBone) {
                const rz = clamp1(-s * stepAmp);
                const ry = Math.max(0, -s) * liftAmp;
                bones.push({
                    name: legIkRBone,
                    frame: f,
                    position: [0, ry, rz],
                    rotation: [0, 0, 0, 1],
                });
            }
        }
        if (legIkLBone) {
            bones.push({
                name: legIkLBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
        if (legIkRBone) {
            bones.push({
                name: legIkRBone,
                frame: loopFrames,
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
            });
        }
    }

    if (!state.boneToggles.emotion) {
    } else {
        const BLACKLIST_PATTERNS = [
            'まばたき',
            'blink',
            '眨眼',
            'wink',
            'ウィンク',
            'あ',
            'い',
            'う',
            'え',
            'お',
            'a ',
            'i ',
            'u ',
            'e ',
            'o ',
        ];

        function _scoreMorph(name: string, keywords: string[]): number {
            const nameLC = name.toLowerCase();
            let score = 0;
            for (const kw of keywords) {
                if (name.includes(kw) || nameLC.includes(kw.toLowerCase())) {
                    score += 10;
                }
            }
            for (const bp of BLACKLIST_PATTERNS) {
                if (name.includes(bp)) {
                    score -= 10;
                }
            }
            return score;
        }

        const EMOTION_CANDIDATES: Record<string, string[]> = {
            smile: ['にこり', '笑い', 'smile', 'えがお', 'happy', '喜び', '嬉しい', 'よろこび'],
            sad: ['悲しみ', 'sad', 'cry', '泣き', '哀しみ', 'かなしみ'],
            angry: ['怒り', 'angry', 'いかり', 'むっ', 'まゆ'],
            surprise: ['びっくり', 'surprise', 'おどろき', '驚き', 'wonder', 'わお'],
            worry: ['困る', 'worry', 'こまる', '悩み', 'なやみ', '困惑'],
            serious: ['真面目', 'serious', 'まじめ', 'じと目', 'じと'],
            shy: ['照れ', 'shy', 'てれ', 'はにかみ', '恥ずかしい'],
            wink: ['ウィンク', 'wink', 'ういんく', 'win'],
        };

        const emotionMorphs = new Map<string, string>();
        for (const [category, keywords] of Object.entries(EMOTION_CANDIDATES)) {
            let bestName: string | null = null;
            let bestScore = 0;
            for (const mName of morphNames) {
                const score = _scoreMorph(mName, keywords);
                if (score > bestScore) {
                    bestScore = score;
                    bestName = mName;
                }
            }
            if (bestName) {
                emotionMorphs.set(category, bestName);
            }
        }

        for (const [k, n] of emotionMorphs) {
            if (!canEncodeName(n)) {
                console.log(
                    `[procedural-motion] 表情 morph "${k}=${n}" 无法编码为 Shift-JIS，跳过`
                );
                emotionMorphs.delete(k);
            }
        }

        const foundEmotions = Array.from(emotionMorphs.entries()).filter(([k]) => k !== 'wink');
        if (foundEmotions.length > 0) {
            console.log(
                `[procedural-motion] 表情 morph 匹配: [${foundEmotions.map(([k, n]) => `${k}=${n}`).join(', ')}]`
            );
            const surpriseMorph = emotionMorphs.get('surprise') ?? null;
            const winkMorph = emotionMorphs.get('wink') ?? null;

            const cycleBeats = 4;
            const cycleFrames = beatFrames * cycleBeats;
            const cycleCount = Math.min(foundEmotions.length, Math.floor(loopFrames / cycleFrames));
            const availEmo = foundEmotions.slice(0, cycleCount);

            for (let ci = 0; ci < availEmo.length; ci++) {
                const [_, morphName] = availEmo[ci];
                const start = cycleFrames * ci;
                const end = Math.min(start + cycleFrames - 1, loopFrames);
                const fadeIn = Math.floor(beatFrames * 0.3);
                const fadeOut = Math.max(end - Math.floor(beatFrames * 0.3), start + fadeIn);
                const weight = 0.5 + 0.3 * intensity;
                morphs.push({ name: morphName, frame: start, weight: 0 });
                morphs.push({ name: morphName, frame: start + fadeIn, weight: weight });
                morphs.push({ name: morphName, frame: fadeOut, weight: weight });
                morphs.push({ name: morphName, frame: end, weight: 0 });
            }

            const accentMorph = surpriseMorph ?? winkMorph;
            if (accentMorph) {
                const measureCount = Math.min(4, Math.floor(loopFrames / (beatFrames * 2)));
                for (let m = 0; m < measureCount; m++) {
                    const base = m * beatFrames * 2;
                    const rand = (m * 7 + 3) % 10;
                    if (rand < 3) {
                        const t = base + Math.floor(beatFrames * 0.2);
                        if (t + 6 <= loopFrames) {
                            const w = 0.5 + 0.3 * intensity;
                            morphs.push({ name: accentMorph, frame: t, weight: 0 });
                            morphs.push({ name: accentMorph, frame: t + 1, weight: w });
                            morphs.push({ name: accentMorph, frame: t + 3, weight: w });
                            morphs.push({ name: accentMorph, frame: t + 6, weight: 0 });
                        }
                    }
                }
            }

            const shyMorph = emotionMorphs.get('shy') ?? null;
            if (shyMorph) {
                const shyStart = loopFrames - beatFrames * 4;
                if (shyStart > 0) {
                    morphs.push({ name: shyMorph, frame: shyStart, weight: 0 });
                    morphs.push({
                        name: shyMorph,
                        frame: shyStart + Math.floor(beatFrames * 0.5),
                        weight: 0.6 * intensity,
                    });
                    morphs.push({
                        name: shyMorph,
                        frame: shyStart + beatFrames * 2,
                        weight: 0.6 * intensity,
                    });
                    morphs.push({
                        name: shyMorph,
                        frame: shyStart + beatFrames * 2 + 2,
                        weight: 0,
                    });
                }
            }
        } else {
            console.warn('[procedural-motion] 未找到任何表情 morph，跳过情绪轮');
        }
    }
    const _override = state.interpOverride;
    let _overrideInterp: typeof INTERP_SHARP | null = null;
    if (_override === 'sharp') {
        _overrideInterp = INTERP_SHARP;
    } else if (_override === 'ease-in-out') {
        _overrideInterp = INTERP_EASE_IN_OUT;
    } else if (_override === 'ease-out') {
        _overrideInterp = INTERP_EASE_OUT;
    }

    for (const b of bones) {
        if (_overrideInterp) {
            b.interp = _overrideInterp;
            continue;
        }
        const n = b.name;
        if (n === larmBone || n === rarmBone) {
            b.interp = INTERP_EASE_OUT;
        } else if (n === centerBone || n === waistBone || n === legIkLBone || n === legIkRBone) {
            b.interp = INTERP_SHARP;
        } else {
            b.interp = INTERP_EASE_IN_OUT;
        }
    }
    return buildVmd(bones, morphs, PROC_VMD_NAME_AUTODANCE);
}
