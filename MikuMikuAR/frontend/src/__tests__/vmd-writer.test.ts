import { describe, it, expect } from 'vitest';
import {
    buildVmd,
    buildBoneFrame,
    buildMorphFrame,
    BONE_FRAME_SIZE,
    MORPH_FRAME_SIZE,
    type BoneKeyFrame,
} from '../motion/vmd-writer';

describe('vmd-writer frame sizes', () => {
    it('bone frame is 111 bytes', () => {
        const f: BoneKeyFrame = {
            name: '上半身',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
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

    it('total size = 54 + 3*111 + 4 + 2*23 + 12', () => {
        expect(buf.byteLength).toBe(54 + 3 * 111 + 4 + 2 * 23 + 12);
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
        const morphCountOff = 54 + 3 * 111;
        expect(view.getUint32(morphCountOff, true)).toBe(2);
    });

    it('frame numbers are readable at correct offsets', () => {
        const view = new DataView(buf);
        // frame 1 bone: offset 54 + 15(name) = 69
        expect(view.getUint32(69, true)).toBe(0);
        // frame 2 bone: offset 54 + 111 + 15 = 180
        expect(view.getUint32(180, true)).toBe(30);
        // frame 3 bone: offset 54 + 222 + 15 = 291
        expect(view.getUint32(291, true)).toBe(60);
    });

    it('trailer counts are all zero', () => {
        const view = new DataView(buf);
        const trailerOff = 54 + 3 * 111 + 4 + 2 * 23;
        expect(view.getUint32(trailerOff, true)).toBe(0); // camera
        expect(view.getUint32(trailerOff + 4, true)).toBe(0); // light
        expect(view.getUint32(trailerOff + 8, true)).toBe(0); // shadow
    });

    it('empty frames produces valid minimal VMD', () => {
        const empty = buildVmd([], []);
        const view = new DataView(empty);
        expect(view.getUint32(50, true)).toBe(0); // 0 bones
        expect(empty.byteLength).toBe(54 + 4 + 12); // header + morphCount + trailer
    });
});

describe('vmd-writer interpolation', () => {
    it('interpolation bytes are linear default (20,20,107,107)', () => {
        const f: BoneKeyFrame = {
            name: '頭',
            frame: 0,
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
        };
        const buf = new DataView(buildBoneFrame(f));
        // interpolation starts at offset 15+4+12+16 = 47
        expect(buf.getUint8(47)).toBe(20);
        expect(buf.getUint8(48)).toBe(20);
        expect(buf.getUint8(49)).toBe(107);
        expect(buf.getUint8(50)).toBe(107);
        // pattern repeats 16 times (64 bytes)
        expect(buf.getUint8(47 + 64 - 1)).toBe(107);
    });
});
