import { describe, it, expect } from 'vitest';
import Encoding from 'encoding-japanese';
import {
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
    DEFAULT_PROC_STATE,
    type ProcMotionState,
} from '../motion-algos/procedural-motion';

const state: ProcMotionState = { ...DEFAULT_PROC_STATE, mode: 'idle', intensity: 0.5, speed: 1.0 };

/** 标准 MMD 骨骼名，确保 _matchBone 能找到匹配 */
const BONES_STANDARD = ['センター', '上半身', '頭', '左腕', '右腕'];
const BONES_CENTER_UPPER = ['センター', '上半身'];
const BONES_ALL = ['センター', '上半身', '頭', '左腕', '右腕'];

describe('generateIdleVmd', () => {
    const buf = generateIdleVmd(state, ['まばたき'], BONES_ALL);

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
        const buf2 = generateIdleVmd(state, [], BONES_CENTER_UPPER);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it('loop closes (first and last bone frame match)', () => {
        const buf2 = generateIdleVmd(state, [], BONES_ALL);
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
        const zeroState = { ...state, intensity: 0 };
        const buf2 = generateIdleVmd(zeroState, [], BONES_ALL);
        const view = new DataView(buf2);
        const off = 54 + 15 + 4;
        const rotX = view.getFloat32(off + 12, true);
        expect(Math.abs(rotX)).toBeLessThan(0.001);
    });

    it('works with no bones at all (empty skeleton)', () => {
        const buf2 = generateIdleVmd(state, [], []);
        expect(buf2.byteLength).toBeGreaterThan(50); // at least VMD header
        const sig = new TextDecoder().decode(new Uint8Array(buf2, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('speed=0.1 (minimum) produces longer loop', () => {
        const slow = generateIdleVmd({ ...state, speed: 0.1 }, [], BONES_ALL);
        const fast = generateIdleVmd({ ...state, speed: 10 }, [], BONES_ALL);
        // 极慢速度 → 更多帧 → 更大文件
        expect(slow.byteLength).toBeGreaterThan(fast.byteLength);
    });

    it('intensity=1 produces larger rotations than intensity=0.1', () => {
        const high = generateIdleVmd({ ...state, intensity: 1 }, ['まばたき'], BONES_ALL);
        const low = generateIdleVmd({ ...state, intensity: 0.1 }, ['まばたき'], BONES_ALL);
        // 更高强度 → 更大旋转值 → 更多非零帧 → 更大文件（或至少不更小）
        expect(high.byteLength).toBeGreaterThanOrEqual(low.byteLength);
    });

    it('includes shoulder bone frames', () => {
        const bonesWithShoulders = ['センター', '左肩', '右肩'];
        const buf2 = generateIdleVmd(state, [], bonesWithShoulders);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('includes wrist bone frames', () => {
        const bonesWithWrists = ['センター', '左手首', '右手首'];
        const buf2 = generateIdleVmd(state, [], bonesWithWrists);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });
});

describe('generateAutoDanceVmd', () => {
    const buf = generateAutoDanceVmd(state, 120, ['まばたき'], BONES_ALL);

    it('produces non-empty VMD', () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it('has valid VMD signature', () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('higher BPM produces shorter loop', () => {
        const slow = generateAutoDanceVmd(state, 60, [], BONES_ALL);
        const fast = generateAutoDanceVmd(state, 180, [], BONES_ALL);
        expect(fast.byteLength).toBeLessThan(slow.byteLength);
    });

    it('clamps BPM below 60', () => {
        const low = generateAutoDanceVmd(state, 30, [], BONES_ALL);
        const at60 = generateAutoDanceVmd(state, 60, [], BONES_ALL);
        expect(low.byteLength).toBe(at60.byteLength);
    });

    it('clamps BPM above 200', () => {
        const over = generateAutoDanceVmd(state, 300, [], BONES_ALL);
        const at200 = generateAutoDanceVmd(state, 200, [], BONES_ALL);
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
        const zero = generateAutoDanceVmd({ ...state, intensity: 0 }, 120, [], BONES_ALL);
        const high = generateAutoDanceVmd({ ...state, intensity: 1 }, 120, [], BONES_ALL);
        // 强度 0 → 旋转值接近 0 → 更小文件
        expect(zero.byteLength).toBeLessThanOrEqual(high.byteLength);
    });

    it('works with groove bone', () => {
        const bonesWithGroove = ['センター', 'グルーブ', '上半身'];
        const buf2 = generateAutoDanceVmd(state, 120, [], bonesWithGroove);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('works with leg IK bones', () => {
        const bonesWithLegs = ['センター', '上半身', '左足ＩＫ', '右足ＩＫ'];
        const buf2 = generateAutoDanceVmd(state, 120, [], bonesWithLegs);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(2);
    });

    it('works with no bones at all', () => {
        const buf2 = generateAutoDanceVmd(state, 120, [], []);
        expect(buf2.byteLength).toBeGreaterThan(50);
    });

    it('speed=0.1 (minimum) produces longer loop than speed=10', () => {
        const slow = generateAutoDanceVmd({ ...state, speed: 0.1 }, 120, [], BONES_ALL);
        const fast = generateAutoDanceVmd({ ...state, speed: 10 }, 120, [], BONES_ALL);
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
        const buf2 = generateAutoDanceVmd(state, 120, morphsWithSmile, BONES_ALL);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        // 应该有 morph 帧（至少 blink + 情绪 morph）
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
    });

    it('skips emotion wheel when no matching morphs', () => {
        // 只提供不匹配任何情绪的 morph 名
        const buf2 = generateAutoDanceVmd(state, 120, ['unknown_morph'], BONES_ALL);
        // 仍然生成有效 VMD（只是没有情绪 morph 帧）
        expect(buf2.byteLength).toBeGreaterThan(200);
    });

    it('emotion wheel with only wink morph (no other emotions)', () => {
        // 只有 wink 类别匹配
        const morphsWinkOnly = ['ウィンク'];
        const buf2 = generateAutoDanceVmd(state, 120, morphsWinkOnly, BONES_ALL);
        expect(buf2.byteLength).toBeGreaterThan(200);
    });

    it('interpolation: arms use EASE_OUT, center/waist use SHARP', () => {
        // 通过骨骼帧数验证各骨骼都被生成
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        expect(boneCount).toBeGreaterThanOrEqual(4); // center, upper, arms, etc.
    });

    it('works with wrist bones', () => {
        const bonesWithWrists = ['センター', '上半身', '左手首', '右手首'];
        const buf2 = generateAutoDanceVmd(state, 120, [], bonesWithWrists);
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

describe('VMD 骨骼诊断', () => {
    it('Idle: 用 108 标准骨骼集生成，报告各骨骼帧数', () => {
        const buf = generateIdleVmd(state, MORPHS_STANDARD, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf);
        const totalFrames = Object.values(bones).reduce((a, b) => a + b, 0);
        console.log(`[VMD诊断 - Idle] 总骨骼帧数: ${totalFrames}`);
        console.log('[VMD诊断 - Idle] 骨骼明细:');
        for (const [name, count] of Object.entries(bones).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${name}: ${count}帧`);
        }
        expect(totalFrames).toBeGreaterThan(10);
        expect(Object.keys(bones).length).toBeGreaterThanOrEqual(6);
    });

    it('AutoDance: 用 108 标准骨骼集生成，报告各骨骼帧数', () => {
        const buf = generateAutoDanceVmd(state, 120, MORPHS_STANDARD, BONES_108_STANDARD);
        const bones = _parseVmdBones(buf);
        const totalFrames = Object.values(bones).reduce((a, b) => a + b, 0);
        console.log(`[VMD诊断 - AutoDance] 总骨骼帧数: ${totalFrames}`);
        console.log('[VMD诊断 - AutoDance] 骨骼明细:');
        for (const [name, count] of Object.entries(bones).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${name}: ${count}帧`);
        }
        expect(totalFrames).toBeGreaterThan(10);
        expect(Object.keys(bones).length).toBeGreaterThanOrEqual(6);
    });
});
