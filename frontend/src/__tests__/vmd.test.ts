/**
 * VMD 格式测试 — vmd-writer（二进制打包） + vpd-parser（VPD 文本解析 → VMD Buffer）
 */
import { describe, it, expect } from 'vitest';
import { parseVPDText, decodeVPDData, poseDataToVmdBuffer, loadVPDFromBuffer } from '../motion-algos/vpd-parser';
import { buildVmd, buildBoneFrame, buildMorphFrame, BONE_FRAME_SIZE, MORPH_FRAME_SIZE } from '../motion-algos/vmd-writer';
import type { BoneKeyFrame } from '../motion-algos/vmd-writer';

// ====================================================================
// vmd-writer — 二进制帧打包
// ====================================================================

describe('vmd-writer frame sizes', () => {
    it('bone frame is 111 bytes', () => {
        const f: BoneKeyFrame = { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        expect(buildBoneFrame(f).byteLength).toBe(BONE_FRAME_SIZE);
        expect(BONE_FRAME_SIZE).toBe(111);
    });
    it('morph frame is 23 bytes', () => {
        const f = { name: 'まばたき', frame: 0, weight: 0.5 };
        expect(buildMorphFrame(f).byteLength).toBe(MORPH_FRAME_SIZE);
        expect(MORPH_FRAME_SIZE).toBe(23);
    });
});

describe('vmd-writer buildVmd structure', () => {
    const boneFrames: BoneKeyFrame[] = [
        { name: '上半身', frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { name: '上半身', frame: 30, position: [0, 0, 0], rotation: [0, 0.05, 0, 0.999] },
        { name: '上半身', frame: 60, position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    ];
    const morphFrames = [
        { name: 'まばたき', frame: 0, weight: 0 },
        { name: 'まばたき', frame: 60, weight: 1 },
    ];
    const buf = buildVmd(boneFrames, morphFrames);

    it('total size = 54 + 3*111 + 4 + 2*23 + 16', () => {
        expect(buf.byteLength).toBe(54 + 3 * 111 + 4 + 2 * 23 + 16);
    });
    it('starts with VMD signature', () => {
        const sig = new TextDecoder().decode(new Uint8Array(buf, 0, 20));
        expect(sig).toBe('Vocaloid Motion Data');
    });
    it('bone count is 3 at offset 50', () => {
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(3);
    });
    it('morph count is 2 after bone frames', () => {
        const view = new DataView(buf);
        expect(view.getUint32(54 + 3 * 111, true)).toBe(2);
    });
    it('frame numbers are readable at correct offsets', () => {
        const view = new DataView(buf);
        expect(view.getUint32(69, true)).toBe(0);
        expect(view.getUint32(180, true)).toBe(30);
        expect(view.getUint32(291, true)).toBe(60);
    });
    it('trailer counts are all zero', () => {
        const view = new DataView(buf);
        const trailerOff = 54 + 3 * 111 + 4 + 2 * 23;
        expect(view.getUint32(trailerOff, true)).toBe(0);
        expect(view.getUint32(trailerOff + 4, true)).toBe(0);
        expect(view.getUint32(trailerOff + 8, true)).toBe(0);
        expect(view.getUint32(trailerOff + 12, true)).toBe(0);
    });
    it('empty frames produces valid minimal VMD', () => {
        const empty = buildVmd([], []);
        const view = new DataView(empty);
        expect(view.getUint32(50, true)).toBe(0);
        expect(empty.byteLength).toBe(54 + 4 + 16);
    });
});

describe('vmd-writer interpolation', () => {
    it('interpolation bytes are linear default (20,20,107,107)', () => {
        const f: BoneKeyFrame = { name: '頭', frame: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1] };
        const buf = new DataView(buildBoneFrame(f));
        expect(buf.getUint8(47)).toBe(20);
        expect(buf.getUint8(48)).toBe(20);
        expect(buf.getUint8(49)).toBe(107);
        expect(buf.getUint8(50)).toBe(107);
        expect(buf.getUint8(47 + 64 - 1)).toBe(107);
    });
});

// ====================================================================
// vpd-parser — VPD 文本解析
// ====================================================================

describe('parseVPDText', () => {
    it('parses a simple VPD with one bone', () => {
        const text = `Vocaloid Pose Data file\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\n}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].name).toBe('左肩');
        expect(result.bones[0].position).toEqual([-0.0511, 0, 0]);
        expect(result.bones[0].rotation).toEqual([0, 0.069756, 0, 0.997564]);
    });
    it('parses multiple bones', () => {
        const text = `Vocaloid Pose Data file\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\nBone1:右肩\n    0.051100 0.000000 0.000000\n    0.000000 -0.069756 0.000000 0.997564\n}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(2);
        expect(result.bones[1].name).toBe('右肩');
    });
    it('handles empty bone list', () => {
        const text = `Vocaloid Pose Data file\n{\n}`;
        expect(parseVPDText(text).bones).toHaveLength(0);
    });
    it('parses morph data (MorphN:name + weight)', () => {
        const text = `Vocaloid Pose Data file\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\nMorph0:あ\n    0.800000\nMorph1:笑い\n    0.500000\n}`;
        const r = parseVPDText(text);
        expect(r.morphs).toHaveLength(2);
        expect(r.morphs[0]).toEqual({ name: 'あ', weight: 0.8 });
    });
    it('returns empty morphs when no morph data', () => {
        const text = `Vocaloid Pose Data file\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\n}`;
        expect(parseVPDText(text).morphs).toHaveLength(0);
    });
    it('parses modelName from model "..." header', () => {
        const text = `Vocaloid Pose Data file\nmodel "TestModel"\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\n}`;
        expect(parseVPDText(text).modelName).toBe('TestModel');
    });
    it('skips unrecognized lines gracefully', () => {
        const text = `Vocaloid Pose Data file\n{\nBone0:左肩\n    -0.051100 0.000000 0.000000\n    0.000000 0.069756 0.000000 0.997564\nsome_unrecognized_line_here\n}`;
        const r = parseVPDText(text);
        expect(r.bones).toHaveLength(1);
        expect(r.morphs).toHaveLength(0);
    });
});

describe('decodeVPDData', () => {
    it('decodes UTF-8 VPD content', () => {
        const buf = new TextEncoder().encode('Vocaloid Pose Data file\n{\nBone0:hip\n    0 0 0\n    0 0 0 1\n}').buffer;
        expect(decodeVPDData(buf as ArrayBuffer)).toContain('Vocaloid Pose Data file');
    });
    it('decodes UTF-16LE BOM content', () => {
        const u16 = new Uint16Array([0xfeff, 0x74, 0x65, 0x73, 0x74]);
        const result = decodeVPDData(u16.buffer as ArrayBuffer);
        expect(result).toContain('test');
    });
    it('falls back to shift-jis when UTF-8 fails', () => {
        const sjisBytes = new Uint8Array([0x56, 0x6f, 0x63, 0x61, 0x6c, 0x6f, 0x69, 0x64, 0x0a, 0x7b, 0x0a, 0x42, 0x6f, 0x6e, 0x65, 0x30, 0x3a, 0x83, 0x5c, 0x82, 0x8c, 0x0a, 0x20, 0x20, 0x20, 0x30, 0x20, 0x30, 0x20, 0x30, 0x0a, 0x20, 0x20, 0x20, 0x30, 0x20, 0x30, 0x20, 0x30, 0x20, 0x31, 0x0a, 0x7d]);
        const result = decodeVPDData(sjisBytes.buffer as ArrayBuffer);
        expect(result).toContain('Vocaloid');
        expect(result.includes('\uFFFD')).toBe(false);
    });
    it('decodes BOM-prefixed content and strips BOM', () => {
        const buf = new TextEncoder().encode('\uFEFFVocaloid Pose Data file\n{\nBone0:leg\n    0 0 0\n    0 0 0 1\n}').buffer;
        const result = decodeVPDData(buf as ArrayBuffer);
        expect(result).toContain('Vocaloid');
        expect(result.charCodeAt(0)).not.toBe(0xfeff);
    });
});

describe('poseDataToVmdBuffer', () => {
    const HEADER_SIZE = 54;
    it('produces a valid VMD header with signature', () => {
        const buf = poseDataToVmdBuffer({ modelName: 'test', bones: [], morphs: [] });
        const sigStr = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, 30));
        expect(sigStr.startsWith('Vocaloid Motion Data 0002')).toBe(true);
        expect(new DataView(buf).getUint32(50, true)).toBe(0);
    });
    it('writes a single bone keyframe correctly', () => {
        const buf = poseDataToVmdBuffer({ modelName: 'test', bones: [{ name: '左肩', position: [1, 2, 3], rotation: [0, 0.7, 0, 0.7] }], morphs: [] });
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(1);
        expect(view.getFloat32(HEADER_SIZE + 19, true)).toBeCloseTo(1);
        expect(view.getFloat32(HEADER_SIZE + 23, true)).toBeCloseTo(2);
    });
    it('writes multiple bone keyframes', () => {
        const buf = poseDataToVmdBuffer({ modelName: 'test', bones: [{ name: 'a', position: [1, 0, 0], rotation: [0, 0, 0, 1] }, { name: 'b', position: [0, 2, 0], rotation: [0, 0, 0, 1] }], morphs: [] });
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(2);
    });
    it('total buffer size = header + N*boneSize + 4 + trailer', () => {
        const buf = poseDataToVmdBuffer({ modelName: 'test', bones: [{ name: 'a', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { name: 'b', position: [0, 0, 0], rotation: [0, 0, 0, 1] }], morphs: [] });
        expect(buf.byteLength).toBe(54 + 2 * 111 + 4 + 16);
    });
});

describe('loadVPDFromBuffer', () => {
    it('converts a full VPD file to a valid VMD buffer', () => {
        const buf = new TextEncoder().encode(`Vocaloid Pose Data file\n{\nBone0:胸\n    0.0 5.0 0.0\n    0.0 0.0 0.0 1.0\n}`).buffer;
        const vmd = loadVPDFromBuffer(buf as ArrayBuffer);
        expect(vmd.byteLength).toBeGreaterThan(54);
        expect(new DataView(vmd).getUint32(50, true)).toBe(1);
        expect(new DataView(vmd).getFloat32(54 + 23, true)).toBeCloseTo(5);
    });
    it('throws for empty VPD', () => {
        const buf = new TextEncoder().encode('Vocaloid Pose Data file\n{\n}').buffer;
        expect(() => loadVPDFromBuffer(buf as ArrayBuffer)).toThrow('VPD: no bone data found');
    });
});
