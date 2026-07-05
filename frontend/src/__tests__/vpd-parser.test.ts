import { describe, it, expect } from 'vitest';
import {
    parseVPDText,
    decodeVPDData,
    poseDataToVmdBuffer,
    loadVPDFromBuffer,
} from '../motion-algos/vpd-parser';
import { BONE_FRAME_SIZE } from '../motion-algos/vmd-writer';

// ======== parseVPDText ========

describe('parseVPDText', () => {
    it('parses a simple VPD with one bone', () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].name).toBe('左肩');
        expect(result.bones[0].position).toEqual([-0.0511, 0, 0]);
        expect(result.bones[0].rotation).toEqual([0, 0.069756, 0, 0.997564]);
    });

    it('parses multiple bones', () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
Bone1:右肩
    0.051100 0.000000 0.000000
    0.000000 -0.069756 0.000000 0.997564
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(2);
        expect(result.bones[1].name).toBe('右肩');
        expect(result.bones[1].position).toEqual([0.0511, 0, 0]);
        expect(result.bones[1].rotation).toEqual([0, -0.069756, 0, 0.997564]);
    });

    it('handles empty bone list (header only)', () => {
        const text = `Vocaloid Pose Data file
{
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });

    it('parses morph data (MorphN:name + weight)', () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
Morph0:あ
    0.800000
Morph1:笑い
    0.500000
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.morphs).toHaveLength(2);
        expect(result.morphs[0]).toEqual({ name: 'あ', weight: 0.8 });
        expect(result.morphs[1]).toEqual({ name: '笑い', weight: 0.5 });
    });

    it('returns empty morphs array when no morph data', () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
}`;
        const result = parseVPDText(text);
        expect(result.morphs).toHaveLength(0);
    });

    it('parses modelName from model "..." header line', () => {
        const text = `Vocaloid Pose Data file
model "TestModel"
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
}`;
        const result = parseVPDText(text);
        expect(result.modelName).toBe('TestModel');
    });

    it('skips unrecognized lines gracefully (fallthrough i++ path)', () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
some_unrecognized_line_here
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.morphs).toHaveLength(0);
    });
});

// ======== decodeVPDData (encoding detection) ========

describe('decodeVPDData', () => {
    it('decodes UTF-8 VPD content', () => {
        const encoder = new TextEncoder();
        const buffer = encoder.encode(
            'Vocaloid Pose Data file\n{\nBone0:hip\n    0 0 0\n    0 0 0 1\n}'
        ).buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result).toContain('Vocaloid Pose Data file');
        expect(result).toContain('Bone0:hip');
    });

    it('decodes UTF-16LE BOM content', () => {
        // UTF-16LE BOM (0xFF 0xFE) + "test" in UTF-16LE
        const u16 = new Uint16Array([0xfeff, 0x74, 0x65, 0x73, 0x74]); // BOM + "test"
        const buffer = u16.buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result).toContain('test');
    });

    it('falls back to shift-jis when UTF-8 fails (invalid UTF-8 bytes)', () => {
        // 0x83 0x5C is invalid UTF-8 (valid in SJIS though)
        const sjisBytes = new Uint8Array([
            0x56,
            0x6f,
            0x63,
            0x61,
            0x6c,
            0x6f,
            0x69,
            0x64, // "Vocaloid"
            0x0a,
            0x7b,
            0x0a,
            0x42,
            0x6f,
            0x6e,
            0x65,
            0x30, // \n{\nBone0
            0x3a,
            0x83,
            0x5c,
            0x82,
            0x8c,
            0x0a, // :<SJIS左肩>\n
            0x20,
            0x20,
            0x20,
            0x30,
            0x20,
            0x30,
            0x20,
            0x30, // "    0 0 0
            0x0a,
            0x20,
            0x20,
            0x20,
            0x30,
            0x20,
            0x30,
            0x20, // \n    0 0
            0x30,
            0x20,
            0x31,
            0x0a,
            0x7d, // 0 1\n}
        ]);
        const result = decodeVPDData(sjisBytes.buffer as ArrayBuffer);
        expect(result).toContain('Vocaloid');
        expect(result.length).toBeGreaterThan(0);
        expect(result.includes('\uFFFD')).toBe(false);
    });

    it('decodes BOM-prefixed content', () => {
        const encoder = new TextEncoder();
        const text = '\uFEFFVocaloid Pose Data file\n{\nBone0:leg\n    0 0 0\n    0 0 0 1\n}';
        const buffer = encoder.encode(text).buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result).toContain('Vocaloid');
        expect(result).toContain('Bone0:leg');
    });

    it('strips BOM prefix from decoded content', () => {
        const encoder = new TextEncoder();
        const text = '\uFEFFBone0:test\n    0 0 0\n    0 0 0 1\n';
        const buffer = encoder.encode(text).buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result.charCodeAt(0)).not.toBe(0xfeff);
    });
});

// ======== poseDataToVmdBuffer ========

describe('poseDataToVmdBuffer', () => {
    const HEADER_SIZE = 30 + 20 + 4; // sig + model + boneCount
    const BONE_SIZE = BONE_FRAME_SIZE;
    const _MORPH_COUNT_OFFSET = HEADER_SIZE + BONE_SIZE + 4; // +4 for morph count field

    it('produces a valid VMD header with signature', () => {
        const buf = poseDataToVmdBuffer({ modelName: 'test', bones: [], morphs: [] });
        const view = new DataView(buf);
        const sig = new Uint8Array(buf, 0, 30);
        const sigStr = new TextDecoder('ascii').decode(sig);
        expect(sigStr.startsWith('Vocaloid Motion Data 0002')).toBe(true);
        expect(view.getUint32(50, true)).toBe(0);
    });

    it('writes a single bone keyframe correctly', () => {
        const buf = poseDataToVmdBuffer({
            modelName: 'test',
            bones: [
                {
                    name: '左肩',
                    position: [1, 2, 3],
                    rotation: [0, 0.7, 0, 0.7],
                },
            ],
            morphs: [],
        });
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(1);

        const frameOff = HEADER_SIZE;
        const nameBytes = new Uint8Array(buf, frameOff, 15);
        expect(Array.from(nameBytes).some((b) => b !== 0)).toBe(true);
        expect(nameBytes[14]).toBe(0x00);

        expect(view.getUint32(frameOff + 15, true)).toBe(0); // frame number
        expect(view.getFloat32(frameOff + 19, true)).toBeCloseTo(1);
        expect(view.getFloat32(frameOff + 23, true)).toBeCloseTo(2);
        expect(view.getFloat32(frameOff + 27, true)).toBeCloseTo(3);
        expect(view.getFloat32(frameOff + 31, true)).toBeCloseTo(0);
        expect(view.getFloat32(frameOff + 35, true)).toBeCloseTo(0.7);
    });

    it('writes multiple bone keyframes', () => {
        const buf = poseDataToVmdBuffer({
            modelName: 'test',
            bones: [
                { name: 'a', position: [1, 0, 0], rotation: [0, 0, 0, 1] },
                { name: 'b', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
            ],
            morphs: [],
        });
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(2);
        const frame2Off = HEADER_SIZE + BONE_SIZE;
        expect(view.getUint32(frame2Off + 15, true)).toBe(0);
        expect(view.getFloat32(frame2Off + 23, true)).toBeCloseTo(2);
    });

    it('total buffer size = header + N*boneSize + 4(morphCount) + trailer', () => {
        const buf = poseDataToVmdBuffer({
            modelName: 'test',
            bones: [
                { name: 'a', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                { name: 'b', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            ],
            morphs: [],
        });
        // header(54) + 2*111 + 4(morphCount) + 4*4(trailer) = 54+222+4+16 = 296
        expect(buf.byteLength).toBe(HEADER_SIZE + 2 * BONE_SIZE + 4 + 16);
    });
});

// ======== loadVPDFromBuffer (integration) ========

describe('loadVPDFromBuffer', () => {
    it('converts a full VPD file to a valid VMD buffer', () => {
        const encoder = new TextEncoder();
        const vpdBuffer = encoder.encode(`Vocaloid Pose Data file
{
Bone0:胸
    0.0 5.0 0.0
    0.0 0.0 0.0 1.0
}`).buffer;

        const vmdBuffer = loadVPDFromBuffer(vpdBuffer as ArrayBuffer);
        expect(vmdBuffer.byteLength).toBeGreaterThan(54);

        const view = new DataView(vmdBuffer);
        expect(view.getUint32(50, true)).toBe(1);

        const nameBytes = new Uint8Array(vmdBuffer, 54, 15);
        expect(Array.from(nameBytes).some((b) => b !== 0)).toBe(true);
        expect(nameBytes[14]).toBe(0x00);

        expect(view.getFloat32(54 + 19, true)).toBeCloseTo(0);
        expect(view.getFloat32(54 + 23, true)).toBeCloseTo(5);
    });

    it('throws for empty VPD (no bone data)', () => {
        const encoder = new TextEncoder();
        const vpdBuffer = encoder.encode('Vocaloid Pose Data file\n{\n}').buffer;
        expect(() => loadVPDFromBuffer(vpdBuffer as ArrayBuffer)).toThrow(
            'VPD: no bone data found'
        );
    });
});
