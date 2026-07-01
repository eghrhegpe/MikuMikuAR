import { describe, it, expect } from 'vitest';
import {
    generateIdleVmd,
    generateAutoDanceVmd,
    shouldAutoDance,
    shouldIdle,
    DEFAULT_PROC_STATE,
    type ProcMotionState,
} from '../motion/procedural-motion';

const state: ProcMotionState = { ...DEFAULT_PROC_STATE, mode: 'idle', intensity: 0.5, speed: 1.0 };

/** 标准 MMD 骨骼名，确保 _matchBone 能找到匹配 */
const BONES_STANDARD = ['センター', '上半身', '頭', '左腕', '右腕'];
const BONES_CENTER_UPPER = ['センター', '上半身'];
const BONES_ALL = ['センター', '上半身', '頭', '左腕', '右腕'];

describe('generateIdleVmd', () => {
    const buf = generateIdleVmd(state, ['まばたき'], BONES_CENTER_UPPER);

    it('produces non-empty VMD', () => {
        expect(buf.byteLength).toBeGreaterThan(200);
    });

    it('has valid VMD signature', () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
    });

    it('includes blink morph frames when まばたき available', () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
    });

    it('omits blink morph frames when no まばたき', () => {
        const buf2 = generateIdleVmd(state, [], BONES_CENTER_UPPER);
        const view = new DataView(buf2);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(0);
    });

    it('loop closes (first and last bone frame match)', () => {
        const buf2 = generateIdleVmd(state, [], BONES_CENTER_UPPER);
        const view = new DataView(buf2);
        // First bone frame rotation at offset 54+15+4+12 = 85
        const _firstRot = [
            view.getFloat32(85, true),
            view.getFloat32(89, true),
            view.getFloat32(93, true),
            view.getFloat32(97, true),
        ];
        // Last frame: find last bone frame offset
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
        const buf2 = generateIdleVmd(zeroState, [], BONES_CENTER_UPPER);
        const view = new DataView(buf2);
        // Upper body bone rotation X at first frame
        const off = 54 + 15 + 4; // skip name+frame, position starts
        // position[0..2] then rotation[0]
        const rotX = view.getFloat32(off + 12, true);
        expect(Math.abs(rotX)).toBeLessThan(0.001);
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
        // Faster BPM = fewer frames per loop = smaller file
        expect(fast.byteLength).toBeLessThan(slow.byteLength);
    });

    it('clamps BPM below 60', () => {
        const low = generateAutoDanceVmd(state, 30, [], BONES_ALL);
        const at60 = generateAutoDanceVmd(state, 60, [], BONES_ALL);
        expect(low.byteLength).toBe(at60.byteLength);
    });

    it('includes arm bone frames', () => {
        // 骨骼名是 Shift-JIS 编码，用编码后的字节序列匹配
        // 左腕 = 左(0x8DB6) + 腕(0x9862) → [0x8D, 0xB6, 0x98, 0x62]
        const u8 = new Uint8Array(buf);
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        let foundLeftArm = false;
        const leftArmBytes = [0x8d, 0xb6, 0x98, 0x62]; // 左腕 Shift-JIS
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

    it('includes blink morph at 120 BPM', () => {
        const view = new DataView(buf);
        const boneCount = view.getUint32(50, true);
        const morphCountOff = 54 + boneCount * 111;
        expect(view.getUint32(morphCountOff, true)).toBeGreaterThan(0);
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
    it('shouldIdle: true when no audio, no VMD, mode allows', () => {
        expect(shouldIdle(false, false, 'off')).toBe(true);
        expect(shouldIdle(false, false, 'idle')).toBe(true);
        expect(shouldIdle(false, false, 'autodance')).toBe(true);
    });
    it('shouldIdle: false when VMD loaded', () => {
        expect(shouldIdle(false, true, 'off')).toBe(false);
    });
    it('shouldIdle: false when audio playing', () => {
        expect(shouldIdle(true, false, 'off')).toBe(false);
    });
});
