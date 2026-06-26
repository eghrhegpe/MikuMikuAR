import { describe, it, expect } from "vitest";
import { parseVPDText, decodeVPDData, poseDataToVmdBuffer, loadVPDFromBuffer, buildVmdBoneFrame } from "../vpd-parser";

// ======== parseVPDText ========

describe("parseVPDText", () => {
    it("parses a simple VPD with one bone", () => {
        const text = `Vocaloid Pose Data file
{
Bone0:左肩
    -0.051100 0.000000 0.000000
    0.000000 0.069756 0.000000 0.997564
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(1);
        expect(result.bones[0].name).toBe("左肩");
        expect(result.bones[0].position).toEqual([-0.0511, 0, 0]);
        expect(result.bones[0].rotation).toEqual([0, 0.069756, 0, 0.997564]);
    });

    it("parses multiple bones", () => {
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
        expect(result.bones[1].name).toBe("右肩");
        expect(result.bones[1].position).toEqual([0.0511, 0, 0]);
        expect(result.bones[1].rotation).toEqual([0, -0.069756, 0, 0.997564]);
    });

    it("handles empty bone list (header only)", () => {
        const text = `Vocaloid Pose Data file
{
}`;
        const result = parseVPDText(text);
        expect(result.bones).toHaveLength(0);
    });
});

// ======== decodeVPDData (encoding detection) ========

describe("decodeVPDData", () => {
    it("decodes UTF-8 VPD content", () => {
        const encoder = new TextEncoder();
        const buffer = encoder.encode("Vocaloid Pose Data file\n{\nBone0:hip\n    0 0 0\n    0 0 0 1\n}").buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result).toContain("Vocaloid Pose Data file");
        expect(result).toContain("Bone0:hip");
    });

    it("falls back to shift-jis when UTF-8 fails (invalid UTF-8 bytes)", () => {
        // 0x83 0x5C is invalid UTF-8 (valid in SJIS though)
        const sjisBytes = new Uint8Array([
            0x56, 0x6F, 0x63, 0x61, 0x6C, 0x6F, 0x69, 0x64, // "Vocaloid"
            0x0A, 0x7B, 0x0A, 0x42, 0x6F, 0x6E, 0x65, 0x30, // \n{\nBone0
            0x3A, 0x83, 0x5C, 0x82, 0x8C, 0x0A,             // :<SJIS左肩>\n
            0x20, 0x20, 0x20, 0x30, 0x20, 0x30, 0x20, 0x30, // "    0 0 0
            0x0A, 0x20, 0x20, 0x20, 0x30, 0x20, 0x30, 0x20, // \n    0 0 
            0x30, 0x20, 0x31, 0x0A, 0x7D,                   // 0 1\n}
        ]);
        const result = decodeVPDData(sjisBytes.buffer as ArrayBuffer);
        expect(result).toContain("Vocaloid");
        // SJIS 0x83 0x5C = "左", 0x82 0x8C = "肩"
        // We can't assert exact chars since it depends on SJIS decoder support,
        // but the result should have readable content
        expect(result.length).toBeGreaterThan(0);
        expect(result.includes("\uFFFD")).toBe(false); // no replacement chars
    });

    it("decodes BOM-prefixed content", () => {
        const encoder = new TextEncoder();
        const text = "\uFEFFVocaloid Pose Data file\n{\nBone0:leg\n    0 0 0\n    0 0 0 1\n}";
        const buffer = encoder.encode(text).buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result).toContain("Vocaloid");
        expect(result).toContain("Bone0:leg");
    });

    it("strips BOM prefix from decoded content", () => {
        const encoder = new TextEncoder();
        const text = "\uFEFFBone0:test\n    0 0 0\n    0 0 0 1\n";
        const buffer = encoder.encode(text).buffer;
        const result = decodeVPDData(buffer as ArrayBuffer);
        expect(result.charCodeAt(0)).not.toBe(0xFEFF);
    });
});

// ======== buildVmdBoneFrame ========

describe("buildVmdBoneFrame", () => {
    it("bone name is space-padded (0x20) to 15 bytes, not null-padded", () => {
        const frame = buildVmdBoneFrame("abc", [0, 0, 0], [0, 0, 0, 1]);
        const nameBytes = new Uint8Array(frame, 0, 15);
        // First 3 bytes: "abc"
        expect(nameBytes[0]).toBe("a".charCodeAt(0));
        expect(nameBytes[1]).toBe("b".charCodeAt(0));
        expect(nameBytes[2]).toBe("c".charCodeAt(0));
        // Remaining 12 bytes: 0x20 (space), not 0x00
        for (let i = 3; i < 15; i++) {
            expect(nameBytes[i]).toBe(0x20);
        }
    });

    it("frame number is always 0 (single frame pose)", () => {
        const frame = buildVmdBoneFrame("bone", [1, 2, 3], [0, 0, 0, 1]);
        const view = new DataView(frame);
        expect(view.getUint32(15, true)).toBe(0);
    });

    it("writes position as 3 float32 LE at offset 19", () => {
        const frame = buildVmdBoneFrame("bone", [1.5, -2.5, 3.25], [0, 0, 0, 1]);
        const view = new DataView(frame);
        expect(view.getFloat32(19, true)).toBeCloseTo(1.5);
        expect(view.getFloat32(23, true)).toBeCloseTo(-2.5);
        expect(view.getFloat32(27, true)).toBeCloseTo(3.25);
    });

    it("writes rotation as 4 float32 LE at offset 31 (xyzw)", () => {
        const frame = buildVmdBoneFrame("bone", [0, 0, 0], [0, 0.7, 0, 0.7]);
        const view = new DataView(frame);
        expect(view.getFloat32(31, true)).toBeCloseTo(0);
        expect(view.getFloat32(35, true)).toBeCloseTo(0.7);
        expect(view.getFloat32(39, true)).toBeCloseTo(0);
        expect(view.getFloat32(43, true)).toBeCloseTo(0.7);
    });

    it("interpolation bytes (offset 47-62) are all 0x7F (linear)", () => {
        const frame = buildVmdBoneFrame("bone", [0, 0, 0], [0, 0, 0, 1]);
        for (let i = 47; i <= 62; i++) {
            expect(new DataView(frame).getUint8(i)).toBe(0x7F);
        }
    });

    it("reserved bytes (offset 63-65) are all 0x00", () => {
        const frame = buildVmdBoneFrame("bone", [0, 0, 0], [0, 0, 0, 1]);
        expect(new DataView(frame).getUint8(63)).toBe(0x00);
        expect(new DataView(frame).getUint8(64)).toBe(0x00);
        expect(new DataView(frame).getUint8(65)).toBe(0x00);
    });

    it("total frame size is 66 bytes", () => {
        const frame = buildVmdBoneFrame("bone", [0, 0, 0], [0, 0, 0, 1]);
        expect(frame.byteLength).toBe(66);
    });

    it("bone name \"センター\" is 6 SJIS bytes + 9 spaces, no nulls in padding", () => {
        const frame = buildVmdBoneFrame("センター", [0, 0, 0], [0, 0, 0, 1]);
        const nameBytes = new Uint8Array(frame, 0, 15);
        // All 15 bytes should be non-zero (either SJIS data or spaces)
        for (let i = 0; i < 15; i++) {
            expect(nameBytes[i]).not.toBe(0x00);
        }
        // The first bytes should be the SJIS encoding of センター (non-space)
        expect(nameBytes[0]).not.toBe(0x20);
    });
});

// ======== poseDataToVmdBuffer ========

describe("poseDataToVmdBuffer", () => {
    it("produces a valid VMD header with signature", () => {
        const buf = poseDataToVmdBuffer({ bones: [] });
        const view = new DataView(buf);
        const sig = new Uint8Array(buf, 0, 30);
        const sigStr = new TextDecoder("ascii").decode(sig);
        expect(sigStr.startsWith("Vocaloid Motion Data 0002")).toBe(true);

        // Bone keyframe count = 0
        expect(view.getUint32(50, true)).toBe(0);

        // Morph keyframe count = 0 (at end = 54)
        expect(view.getUint32(54, true)).toBe(0);
    });

    it("writes a single bone keyframe correctly", () => {
        const buf = poseDataToVmdBuffer({
            bones: [{
                name: "左肩",
                position: [1, 2, 3],
                rotation: [0, 0.7, 0, 0.7],
            }],
        });
        const view = new DataView(buf);

        expect(view.getUint32(50, true)).toBe(1);

        // Bone name at offset 54: space-padded
        const nameBytes = new Uint8Array(buf, 54, 15);
        expect(Array.from(nameBytes).some(b => b !== 0)).toBe(true);
        // Last byte should be 0x20 (space), not 0x00
        expect(nameBytes[14]).toBe(0x20);

        // Frame number = 0
        expect(view.getUint32(54 + 15, true)).toBe(0);

        // Position
        expect(view.getFloat32(54 + 19, true)).toBeCloseTo(1);
        expect(view.getFloat32(54 + 23, true)).toBeCloseTo(2);
        expect(view.getFloat32(54 + 27, true)).toBeCloseTo(3);

        // Rotation
        expect(view.getFloat32(54 + 31, true)).toBeCloseTo(0);
        expect(view.getFloat32(54 + 35, true)).toBeCloseTo(0.7);
        expect(view.getFloat32(54 + 39, true)).toBeCloseTo(0);
        expect(view.getFloat32(54 + 43, true)).toBeCloseTo(0.7);

        // Interpolation at offset 47-62 within frame = 54+47 = 101
        for (let i = 0; i < 16; i++) {
            expect(view.getUint8(54 + 47 + i)).toBe(0x7F);
        }
        // Reserved at 54+63 = 117
        expect(view.getUint8(54 + 63)).toBe(0x00);
        expect(view.getUint8(54 + 64)).toBe(0x00);
        expect(view.getUint8(54 + 65)).toBe(0x00);

        // Morph keyframe count at end
        const totalBoneSize = 54 + 1 * 66;
        expect(view.getUint32(totalBoneSize, true)).toBe(0);
    });

    it("writes multiple bone keyframes", () => {
        const buf = poseDataToVmdBuffer({
            bones: [
                { name: "a", position: [1, 0, 0], rotation: [0, 0, 0, 1] },
                { name: "b", position: [0, 2, 0], rotation: [0, 0, 0, 1] },
            ],
        });
        const view = new DataView(buf);
        expect(view.getUint32(50, true)).toBe(2);

        // Second bone frame at offset 54 + 66
        expect(view.getUint32(54 + 66 + 15, true)).toBe(0);
        expect(view.getFloat32(54 + 66 + 19, true)).toBeCloseTo(0);
        expect(view.getFloat32(54 + 66 + 23, true)).toBeCloseTo(2);
        expect(view.getFloat32(54 + 66 + 27, true)).toBeCloseTo(0);
    });

    it("output total buffer size = 54 + N*66 + 4", () => {
        const buf = poseDataToVmdBuffer({
            bones: [
                { name: "a", position: [0, 0, 0], rotation: [0, 0, 0, 1] },
                { name: "b", position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            ],
        });
        expect(buf.byteLength).toBe(54 + 2 * 66 + 4);
    });
});

// ======== loadVPDFromBuffer (integration) ========

describe("loadVPDFromBuffer", () => {
    it("converts a full VPD file to a valid VMD buffer", () => {
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

        // Verify bone name is space-padded
        const nameBytes = new Uint8Array(vmdBuffer, 54, 15);
        expect(Array.from(nameBytes).some(b => b !== 0)).toBe(true);
        expect(nameBytes[14]).toBe(0x20); // last byte = space

        // Verify position
        expect(view.getFloat32(54 + 19, true)).toBeCloseTo(0);
        expect(view.getFloat32(54 + 23, true)).toBeCloseTo(5);
        expect(view.getFloat32(54 + 27, true)).toBeCloseTo(0);

        // Verify interpolation present
        for (let i = 0; i < 16; i++) {
            expect(view.getUint8(54 + 47 + i)).toBe(0x7F);
        }
    });

    it("returns header-only VMD for empty VPD", () => {
        const encoder = new TextEncoder();
        const vpdBuffer = encoder.encode("Vocaloid Pose Data file\n{\n}").buffer;

        const vmdBuffer = loadVPDFromBuffer(vpdBuffer as ArrayBuffer);
        expect(vmdBuffer.byteLength).toBe(54 + 0 * 66 + 4); // 58
        const view = new DataView(vmdBuffer);
        expect(view.getUint32(50, true)).toBe(0);
    });
});
