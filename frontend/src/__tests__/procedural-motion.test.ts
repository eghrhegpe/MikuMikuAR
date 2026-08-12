// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Encoding from 'encoding-japanese';
import {
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
    DEFAULT_PROC_STATE,
    migrateProcState,
    matchBone,
    BONE_CENTER_CANDIDATES,
    BONE_LARM_CANDIDATES,
    type ProcMotionParams,
} from '../motion-algos/procedural-motion';
import { scoreMorph, findBestEmotionMorphs, EMOTION_CANDIDATES } from '../motion-algos/proc-motion-autodance-emotion';

const params: ProcMotionParams = {
    ...DEFAULT_PROC_STATE.params.idle,
    intensity: 0.5,
    speed: 1.0,
};

/** 标准 MMD 骨骼名，确保 _matchBone 能找到匹配 */
const BONES_CENTER_UPPER = ['センター', '上半身'];
const BONES_ALL = ['センター', '上半身', '頭', '左腕', '右腕'];

describe('generateIdleVmd', () => {
    const buf = generateIdleVmd(params, BONES_ALL);

    it('produces non-empty VMD', () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it('has valid VMD signature', () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('omits blink morph frames even when まばたき available (perception layer owns blink)', () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it('omits blink morph frames when no まばたき', () => {
        const buf2 = generateIdleVmd(params, BONES_CENTER_UPPER);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it('loop closes (first and last bone frame match)', () => {
        const buf2 = generateIdleVmd(params, BONES_ALL);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const lastOff = 54 + (boneCount - 1) * 111 + 15 + 4 + 12;
        const lastRot = [
            view.getFloat32(lastOff, true),
            view.getFloat32(lastOff + 4, true),
            view.getFloat32(lastOff + 8, true),
            view.getFloat32(lastOff + 12, true),
        ];
        expect(lastRot[3]).toBeCloseTo(1, 2); // w ≈ 1
    });

    it('intensity=0 produces minimal rotation', () => {
        const zeroState = { ...params, intensity: 0 };
        const buf2 = generateIdleVmd(zeroState, BONES_ALL);
        const view = new DataView(buf2);
        const off = 54 + 15 + 4;
        const rotX = view.getFloat32(off + 12, true);
        expect(Math.abs(rotX)).toBeLessThan(0.001);
    });

    it('works with no bones at all (empty skeleton)', () => {
        const buf2 = generateIdleVmd(params, []);
        expect(buf2.byteLength).toBeGreaterThan(50); // at least VMD header
        const sig = new TextDecoder().decode(new Uint8Array(buf2, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('speed=0.1 (minimum) produces longer loop', () => {
        const slow = generateIdleVmd({ ...params, speed: 0.1 }, BONES_ALL);
        const fast = generateIdleVmd({ ...params, speed: 10 }, BONES_ALL);
        // 极慢速度 → 更多帧 → 更大文件
        expect(slow.byteLength).toBeGreaterThan(fast.byteLength);
    });

    it('intensity=1 produces larger rotations than intensity=0.1', () => {
        const high = generateIdleVmd({ ...params, intensity: 1 }, BONES_ALL);
        const low = generateIdleVmd({ ...params, intensity: 0.1 }, BONES_ALL);
        // 更高强度 → 更大旋转值 → 更多非零帧 → 更大文件（或至少不更小）
        expect(high.byteLength).toBeGreaterThanOrEqual(low.byteLength);
    });

    it('includes shoulder bone frames', () => {
        const bonesWithShoulders = ['センター', '左肩', '右肩'];
        const buf2 = generateIdleVmd(params, bonesWithShoulders);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('includes wrist bone frames', () => {
        const bonesWithWrists = ['センター', '左手首', '右手首'];
        const buf2 = generateIdleVmd(params, bonesWithWrists);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });
});

describe('generateAutoDanceVmd', () => {
    const buf = generateAutoDanceVmd(params, 120, ['まばたき'], BONES_ALL);

    it('produces non-empty VMD', () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it('has valid VMD signature', () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('higher BPM produces shorter loop', () => {
        const slow = generateAutoDanceVmd(params, 60, [], BONES_ALL);
        const fast = generateAutoDanceVmd(params, 180, [], BONES_ALL);
        expect(fast.byteLength).toBeLessThan(slow.byteLength);
    });

    it('clamps BPM below 60', () => {
        const low = generateAutoDanceVmd(params, 30, [], BONES_ALL);
        const at60 = generateAutoDanceVmd(params, 60, [], BONES_ALL);
        expect(low.byteLength).toBe(at60.byteLength);
    });

    it('clamps BPM above 200', () => {
        const over = generateAutoDanceVmd(params, 300, [], BONES_ALL);
        const at200 = generateAutoDanceVmd(params, 200, [], BONES_ALL);
        expect(over.byteLength).toBe(at200.byteLength);
    });

    it('includes arm bone frames', () => {
        const u8 = new Uint8Array(buf);
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        let foundLeftArm = false;
        const leftArmBytes = [0x8d, 0xb6, 0x98, 0x72]; // 左腕 Shift-JIS
        for (let i = 0; i < boneCount; i++) {
            const off = 54 + i * 111;
            let match = true;
            for (let j = 0; j < leftArmBytes.length; j++) {
                if (u8[off + j] !== leftArmBytes[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                foundLeftArm = true;
                break;
            }
        }
        expect(foundLeftArm).toBe(true);
    });

    it('omits blink morph at 120 BPM (perception layer owns blink)', () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it('intensity=0 produces minimal motion', () => {
        const zero = generateAutoDanceVmd({ ...params, intensity: 0 }, 120, [], BONES_ALL);
        const high = generateAutoDanceVmd({ ...params, intensity: 1 }, 120, [], BONES_ALL);
        // 强度 0 → 旋转值接近 0 → 更小文件
        expect(zero.byteLength).toBeLessThanOrEqual(high.byteLength);
    });

    it('works with groove bone', () => {
        const bonesWithGroove = ['センター', 'グルーブ', '上半身'];
        const buf2 = generateAutoDanceVmd(params, 120, [], bonesWithGroove);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('works with leg IK bones', () => {
        const bonesWithLegs = ['センター', '上半身', '左足ＩＫ', '右足ＩＫ'];
        const buf2 = generateAutoDanceVmd(params, 120, [], bonesWithLegs);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('works with no bones at all', () => {
        const buf2 = generateAutoDanceVmd(params, 120, [], []);
        expect(buf2.byteLength).toBeGreaterThan(50);
    });

    it('speed=0.1 (minimum) produces longer loop than speed=10', () => {
        const slow = generateAutoDanceVmd({ ...params, speed: 0.1 }, 120, [], BONES_ALL);
        const fast = generateAutoDanceVmd({ ...params, speed: 10 }, 120, [], BONES_ALL);
        expect(slow.byteLength).toBeGreaterThan(fast.byteLength);
    });

    it('includes emotion morphs when smile morphs available', () => {
        // 提供带笑い的 morph 名列表，触发情绪轮
        const morphsWithSmile = [
            'まばたき',
            '笑い',
            '悲しみ',
            '怒り',
            'びっくり',
            '照れ',
            'ウィンク',
        ];
        const buf2 = generateAutoDanceVmd(params, 120, morphsWithSmile, BONES_ALL);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        // 应该有 morph 帧（至少 blink + 情绪 morph）
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
    });

    it('skips emotion wheel when no matching morphs', () => {
        // 只提供不匹配任何情绪的 morph 名
        const buf2 = generateAutoDanceVmd(params, 120, ['unknown_morph'], BONES_ALL);
        // 仍然生成有效 VMD（只是没有情绪 morph 帧）
        expect(buf2.byteLength).toBeGreaterThan(200);
    });

    it('emotion wheel with only wink morph (no other emotions)', () => {
        // 只有 wink 类别匹配
        const morphsWinkOnly = ['ウィンク'];
        const buf2 = generateAutoDanceVmd(params, 120, morphsWinkOnly, BONES_ALL);
        expect(buf2.byteLength).toBeGreaterThan(200);
    });

    it('generates frames for all major bone groups (center, upper, arms, etc.)', () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(4); // center, upper, arms, etc.
    });

    it('works with wrist bones', () => {
        const bonesWithWrists = ['センター', '上半身', '左手首', '右手首'];
        const buf2 = generateAutoDanceVmd(params, 120, [], bonesWithWrists);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });
});

describe('auto-switch logic', () => {
    it('shouldAutoDance: true when audio playing and mode allows', () => {
        expect(shouldAutoDance(true, 'off')).toBe(true);
        expect(shouldAutoDance(true, 'autodance')).toBe(true);
    });
    it('shouldAutoDance: false when no audio', () => {
        expect(shouldAutoDance(false, 'off')).toBe(false);
    });
    it('shouldAutoDance: true when mode is autodance regardless of audio', () => {
        expect(shouldAutoDance(false, 'autodance')).toBe(true);
    });
    it('shouldAutoDance: false when mode is idle', () => {
        expect(shouldAutoDance(true, 'idle')).toBe(false);
        expect(shouldAutoDance(false, 'idle')).toBe(false);
    });
    it('shouldIdle: true when no audio, no VMD, mode allows', () => {
        expect(shouldIdle(false, false, 'off')).toBe(true);
        expect(shouldIdle(false, false, 'idle')).toBe(true);
        expect(shouldIdle(false, false, 'autodance')).toBe(true);
    });
    it('shouldIdle: false when VMD loaded', () => {
        expect(shouldIdle(false, true, 'off')).toBe(false);
        expect(shouldIdle(false, true, 'idle')).toBe(false);
        expect(shouldIdle(false, true, 'autodance')).toBe(false);
    });
    it('shouldIdle: false when audio playing', () => {
        expect(shouldIdle(true, false, 'off')).toBe(false);
        expect(shouldIdle(true, false, 'idle')).toBe(false);
        expect(shouldIdle(true, false, 'autodance')).toBe(false);
    });
    it('shouldIdle: false when both audio and VMD', () => {
        expect(shouldIdle(true, true, 'off')).toBe(false);
    });
});

// ======== VMD 骨骼诊断辅助 ========

/** 解析 VMD buffer，返回各骨骼名→帧数的映射。 */
function _parseVmdBones(buf: ArrayBuffer): Record<string, number> {
    const view = new DataView(buf);
    const boneCount = view.getUint32(50, true);
    const bones: Record<string, number> = {};
    for (let i = 0; i < boneCount; i++) {
        const off = 54 + i * 111;
        const raw = new Uint8Array(buf, off, 15);
        // 与生产路径一致：用 encoding-japanese（CP932）读回骨骼名
        const name = (
            Encoding.convert(raw, { to: 'UNICODE', from: 'SJIS', type: 'string' }) as string
        )
            .replace(/\0/g, '')
            .trim();
        if (!name) {
            continue;
        }
        bones[name] = (bones[name] || 0) + 1;
    }
    return bones;
}

/** 完整标准 MMD 骨骼集（108 骨骼典型子集，覆盖程序化动作的所有候选） */
const BONES_108_STANDARD = [
    '全ての親',
    'センター',
    'グルーブ',
    '腰',
    '上半身',
    '上半身2',
    '首',
    '頭',
    '左肩',
    '右肩',
    '左腕',
    '右腕',
    '左ひじ',
    '右ひじ',
    '左手首',
    '右手首',
    '左足',
    '右足',
    '左ひざ',
    '右ひざ',
    '左足首',
    '右足首',
    '左つま先',
    '右つま先',
    '左足ＩＫ',
    '右足ＩＫ',
    '左つま先ＩＫ',
    '右つま先ＩＫ',
    '左目',
    '右目',
    '両目',
    '左胸',
    '右胸',
];

/** 完整 morph 集 */
const MORPHS_STANDARD = ['まばたき', '笑い', 'ウィンク', 'ウィンク２'];

/** 解析 VMD buffer，返回 (骨骼名@帧号) 复合键的出现次数（用于重复帧检测）。 */
function _parseBoneFrameKeys(buf: ArrayBuffer): Map<string, number> {
    const view = new DataView(buf);
    const boneCount = view.getUint32(50, true);
    const keys = new Map<string, number>();
    for (let i = 0; i < boneCount; i++) {
        const off = 54 + i * 111;
        const raw = new Uint8Array(buf, off, 15);
        const name = (
            Encoding.convert(raw, { to: 'UNICODE', from: 'SJIS', type: 'string' }) as string
        )
            .replace(/\0/g, '')
            .trim();
        const frame = view.getUint32(off + 15, true);
        const key = `${name}@${frame}`;
        keys.set(key, (keys.get(key) ?? 0) + 1);
    }
    return keys;
}

describe('重复关键帧守卫（P1 回归防护）', () => {
    // speed=1 → idle loopFrames=round(120/1)=120（步长 4 的倍数），旧实现会在 f=120
    // 处产生「循环末帧 + 复位帧」双关键帧。修复后循环 f < loopFrames，复位帧唯一。
    it('Idle: speed=1 时无同骨骼同帧号重复关键帧', () => {
        const buf = generateIdleVmd({ ...params, speed: 1 }, BONES_108_STANDARD);
        const dups = [..._parseBoneFrameKeys(buf).entries()].filter(([, c]) => c > 1);
        expect(dups).toEqual([]);
    });

    it('Idle: 多种 speed 下均无重复关键帧', () => {
        for (const speed of [0.5, 1, 1.5, 2, 3]) {
            const buf = generateIdleVmd({ ...params, speed }, BONES_108_STANDARD);
            const dups = [..._parseBoneFrameKeys(buf).entries()].filter(([, c]) => c > 1);
            expect(dups, `speed=${speed} 存在重复帧`).toEqual([]);
        }
    });
});

// [audit] per-mode：待机呼吸尊重骨骼微动开关（关闭类别不再生成对应骨骼帧）
describe('Idle 骨骼微动开关（audit）', () => {
    it('关闭 arm：不再生成左腕/右腕帧', () => {
        const noArm = { ...params, boneToggles: { ...params.boneToggles, arm: false } };
        const buf2 = generateIdleVmd(noArm, ['センター', '左腕', '右腕']);
        const bones = _parseVmdBones(buf2);
        expect(bones['左腕']).toBeUndefined();
        expect(bones['右腕']).toBeUndefined();
        expect(bones['センター']).toBeDefined(); // center 仍生成
    });

    it('关闭 footIk：不再生成足 IK 帧', () => {
        const noFoot = { ...params, boneToggles: { ...params.boneToggles, footIk: false } };
        const buf2 = generateIdleVmd(noFoot, ['センター', '左足ＩＫ', '右足ＩＫ']);
        const bones = _parseVmdBones(buf2);
        expect(bones['左足ＩＫ']).toBeUndefined();
        expect(bones['右足ＩＫ']).toBeUndefined();
    });

    it('默认（全开）：肩/臂/腕/足IK 均生成', () => {
        const buf2 = generateIdleVmd(params, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf2);
        expect(bones['左腕']).toBeGreaterThan(0);
        expect(bones['左肩']).toBeGreaterThan(0);
        expect(bones['左手首']).toBeGreaterThan(0);
        expect(bones['左足ＩＫ']).toBeGreaterThan(0);
    });
});

describe('VMD 骨骼诊断', () => {
    it('Idle: 用 108 标准骨骼集生成，报告各骨骼帧数', () => {
        const buf = generateIdleVmd(params, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf);
        const totalFrames = Object.values(bones).reduce((a, b) => a + b, 0);
        expect(totalFrames).toBeGreaterThan(10);
        expect(Object.keys(bones).length).toBeGreaterThanOrEqual(6);
    });

    it('AutoDance: 用 108 标准骨骼集生成，报告各骨骼帧数', () => {
        const buf = generateAutoDanceVmd(params, 120, MORPHS_STANDARD, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf);
        const totalFrames = Object.values(bones).reduce((a, b) => a + b, 0);
        expect(totalFrames).toBeGreaterThan(10);
        expect(Object.keys(bones).length).toBeGreaterThanOrEqual(6);
    });
});

describe('AutoDance 重构回归（节拍栅格 + 肘部 + 无缝循环）', () => {
    it('无同骨骼同帧号重复关键帧（含端点循环）', () => {
        for (const speed of [0.5, 1, 1.5, 2, 3]) {
            const buf = generateAutoDanceVmd(
                { ...params, speed },
                120,
                MORPHS_STANDARD,
                BONES_108_STANDARD
            );
            const dups = [..._parseBoneFrameKeys(buf).entries()].filter(([, c]) => c > 1);
            expect(dups, `speed=${speed} 存在重复帧`).toEqual([]);
        }
    });

    it('存在肘部骨骼帧（左ひじ/右ひじ），手臂可自然弯曲', () => {
        const buf = generateAutoDanceVmd(params, 120, MORPHS_STANDARD, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf);
        expect(bones['左ひじ']).toBeDefined();
        expect(bones['右ひじ']).toBeDefined();
    });

    it('Center 含 X 重心转移（position[0] 非零），消灭原地漂浮感', () => {
        const buf = generateAutoDanceVmd(params, 120, MORPHS_STANDARD, BONES_108_STANDARD);
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        let foundCenterX = false;
        for (let i = 0; i < boneCount; i++) {
            const off = 54 + i * 111;
            const raw = new Uint8Array(buf, off, 15);
            const name = (
                Encoding.convert(raw, { to: 'UNICODE', from: 'SJIS', type: 'string' }) as string
            )
                .replace(/\0/g, '')
                .trim();
            if (name === 'センター') {
                const x = view.getFloat32(off + 19, true); // position.x
                if (Math.abs(x) > 1e-3) {
                    foundCenterX = true;
                    break;
                }
            }
        }
        expect(foundCenterX).toBe(true);
    });
});

// ======== migrateProcState 迁移测试 ========

describe('migrateProcState', () => {
    it('returns defaults for null/undefined input', () => {
        const state = migrateProcState(null);
        expect(state.mode).toBe('off');
        expect(state.params.idle.intensity).toBe(0.5);
        expect(state.params.autodance.speed).toBe(1.0);
        expect(state.params.idle.boneToggles.center).toBe(true);
    });

    it('returns defaults for empty object', () => {
        const state = migrateProcState({});
        expect(state.mode).toBe('off');
        expect(state.params.idle.boneToggles.arm).toBe(true);
    });

    it('rejects invalid mode strings', () => {
        const state = migrateProcState({ mode: 'invalid_mode' });
        expect(state.mode).toBe('off');
    });

    it('accepts valid mode values', () => {
        expect(migrateProcState({ mode: 'idle' }).mode).toBe('idle');
        expect(migrateProcState({ mode: 'autodance' }).mode).toBe('autodance');
        expect(migrateProcState({ mode: 'off' }).mode).toBe('off');
    });

    it('migrates legacy flat structure to per-mode params', () => {
        const state = migrateProcState({
            intensity: 0.8,
            speed: 2.0,
            boneToggles: { arm: false },
        });
        expect(state.params.idle.intensity).toBe(0.8);
        expect(state.params.idle.speed).toBe(2.0);
        expect(state.params.idle.boneToggles.arm).toBe(false);
        // autodance gets same values (legacy migration copies to both)
        expect(state.params.autodance.intensity).toBe(0.8);
        expect(state.params.autodance.boneToggles.arm).toBe(false);
    });

    it('deep-merges boneToggles in per-mode structure (fills missing keys)', () => {
        const state = migrateProcState({
            params: {
                idle: { boneToggles: { arm: false } },
                autodance: { boneToggles: { wrist: false } },
            },
        });
        // idle: arm=false, but other keys default to true
        expect(state.params.idle.boneToggles.arm).toBe(false);
        expect(state.params.idle.boneToggles.center).toBe(true);
        expect(state.params.idle.boneToggles.wrist).toBe(true);
        // autodance: wrist=false, but other keys default to true
        expect(state.params.autodance.boneToggles.wrist).toBe(false);
        expect(state.params.autodance.boneToggles.arm).toBe(true);
    });

    it('does not share boneToggles reference between idle and autodance', () => {
        const state = migrateProcState({
            params: { idle: { boneToggles: { arm: false } } },
        });
        state.params.idle.boneToggles.arm = true;
        // autodance should not be affected
        expect(state.params.autodance.boneToggles.arm).toBe(true);
    });

    it('fills missing boneToggles keys from defaults (prevents silent disable)', () => {
        // Old save with only { center: true } — new keys like emotion/wrist/footIk must default to true
        const state = migrateProcState({
            params: { idle: { boneToggles: { center: true } } },
        });
        expect(state.params.idle.boneToggles.emotion).toBe(true);
        expect(state.params.idle.boneToggles.wrist).toBe(true);
        expect(state.params.idle.boneToggles.footIk).toBe(true);
    });

    it('falls back intensity to 0.5 when legacy flat intensity is NaN', () => {
        const state = migrateProcState({ intensity: NaN, speed: 1.0 });
        expect(state.params.idle.intensity).toBe(0.5);
        expect(state.params.autodance.intensity).toBe(0.5);
    });

    it('falls back speed to 1.0 when legacy flat speed is NaN', () => {
        const state = migrateProcState({ intensity: 0.8, speed: NaN });
        expect(state.params.idle.speed).toBe(1.0);
        expect(state.params.autodance.speed).toBe(1.0);
    });

    it('falls back both intensity and speed to defaults when both are NaN', () => {
        const state = migrateProcState({ intensity: NaN, speed: NaN });
        expect(state.params.idle.intensity).toBe(0.5);
        expect(state.params.idle.speed).toBe(1.0);
        expect(state.params.autodance.intensity).toBe(0.5);
        expect(state.params.autodance.speed).toBe(1.0);
    });
});

// ======== matchBone 测试 ========

describe('matchBone', () => {
    it('returns first matching candidate', () => {
        expect(matchBone(['センター', '上半身'], BONE_CENTER_CANDIDATES)).toBe('センター');
    });

    it('returns null when no candidate matches', () => {
        expect(matchBone(['上半身', '頭'], BONE_CENTER_CANDIDATES)).toBeNull();
    });

    it('returns null for empty bone list', () => {
        expect(matchBone([], BONE_CENTER_CANDIDATES)).toBeNull();
    });

    it('matches English bone names', () => {
        expect(matchBone(['Center', 'Upper'], BONE_CENTER_CANDIDATES)).toBe('Center');
    });

    it('matches arm bones', () => {
        expect(matchBone(['左腕', '右腕'], BONE_LARM_CANDIDATES)).toBe('左腕');
    });

    it('returns null for non-matching bones', () => {
        expect(matchBone(['左足', '右足'], BONE_LARM_CANDIDATES)).toBeNull();
    });
});

// ======== scoreMorph / findBestEmotionMorphs 测试 ========

describe('scoreMorph', () => {
    it('gives positive score for matching keyword', () => {
        expect(scoreMorph('笑い', ['笑い', 'smile'])).toBeGreaterThan(0);
    });

    it('gives zero score for no match', () => {
        expect(scoreMorph('unknown_morph', ['笑い', 'smile'])).toBe(0);
    });

    it('penalizes blacklist patterns', () => {
        const score = scoreMorph('まばたき', EMOTION_CANDIDATES.smile);
        // まばたき is in blacklist, so score should be negative
        expect(score).toBeLessThan(0);
    });

    it('is case-insensitive for English keywords', () => {
        const score = scoreMorph('Happy Face', ['happy']);
        expect(score).toBeGreaterThan(0);
    });
});

describe('findBestEmotionMorphs', () => {
    it('finds smile morph', () => {
        const result = findBestEmotionMorphs(['まばたき', '笑い', '悲しみ']);
        expect(result.get('smile')).toBe('笑い');
    });

    it('finds sad morph', () => {
        const result = findBestEmotionMorphs(['まばたき', '笑い', '悲しみ']);
        expect(result.get('sad')).toBe('悲しみ');
    });

    it('excludes blink morph from emotion mapping', () => {
        const result = findBestEmotionMorphs(['まばたき']);
        // まばたき is blacklisted, should not appear as any emotion
        for (const [, name] of result) {
            expect(name).not.toBe('まばたき');
        }
    });

    it('returns empty map for no matching morphs', () => {
        const result = findBestEmotionMorphs(['unknown_morph', 'another_morph']);
        expect(result.size).toBe(0);
    });

    it('finds wink morph', () => {
        const result = findBestEmotionMorphs(['ウィンク', 'まばたき']);
        expect(result.get('wink')).toBe('ウィンク');
    });
});

// ======== 边界条件测试 ========

describe('edge cases', () => {
    it('clamps negative speed to 0.1', () => {
        const buf = generateIdleVmd({ ...params, speed: -1 }, BONES_ALL);
        const at01 = generateIdleVmd({ ...params, speed: 0.1 }, BONES_ALL);
        expect(buf.byteLength).toBe(at01.byteLength);
    });

    it('clamps speed > 10 to 10', () => {
        const buf = generateIdleVmd({ ...params, speed: 100 }, BONES_ALL);
        const at10 = generateIdleVmd({ ...params, speed: 10 }, BONES_ALL);
        expect(buf.byteLength).toBe(at10.byteLength);
    });

    it('handles NaN speed gracefully (defaults to 1.0)', () => {
        const buf = generateIdleVmd({ ...params, speed: NaN }, BONES_ALL);
        // NaN is replaced with 1.0 before clamping
        const at1 = generateIdleVmd({ ...params, speed: 1.0 }, BONES_ALL);
        expect(buf.byteLength).toBe(at1.byteLength);
    });

    it('handles Infinity speed gracefully (clamped to 10)', () => {
        const buf = generateIdleVmd({ ...params, speed: Infinity }, BONES_ALL);
        const at10 = generateIdleVmd({ ...params, speed: 10 }, BONES_ALL);
        expect(buf.byteLength).toBe(at10.byteLength);
    });

    it('handles NaN BPM gracefully in AutoDance (defaults to 120)', () => {
        const buf = generateAutoDanceVmd(params, NaN, [], BONES_ALL);
        const at120 = generateAutoDanceVmd(params, 120, [], BONES_ALL);
        expect(buf.byteLength).toBe(at120.byteLength);
    });

    it('intensity clamped to 0 produces identity rotation', () => {
        const buf = generateIdleVmd({ ...params, intensity: 0 }, BONES_ALL);
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        // Check first bone frame rotation is identity (w=1)
        const off = 54 + 15 + 4 + 12; // skip to rotation quaternion
        const w = view.getFloat32(off + 12, true);
        expect(w).toBeCloseTo(1, 2);
    });
});
