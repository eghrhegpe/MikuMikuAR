// @vitest-environment node
/**
 * VMD 帧级 NaN guard 测试 — vmd-writer [audit:fix 2026-10]
 *
 * 台账 round 74 P2「NaN 半修尾巴」：setFloat32 无 guard，NaN/±Infinity 位型
 * （NaN = 0x7FC00000）可直接写进 VMD 二进制帧；loader（vmd-loader.ts:171-173）
 * 只 clamp 总时长，救不了帧级 NaN。
 *
 * guard 语义（nanSafe）：NaN/±Infinity → 0，静默归零（与 preset-apply 侧
 * ?? 0 语义一致；本模块零 logger 依赖，不加 logWarn）。
 *
 * 帧布局（little-endian）：
 *   BoneKeyFrame 111B = 15 name + 4 frame(uint32 @15) + 7 float32 (@19,23,27,31,35,39,43)
 *                      + 64 interp（16 组 × 4 字节）
 *   MorphKeyFrame 23B = 15 name + 4 frame(uint32 @15) + 4 weight(float32 @19)
 */
import { describe, it, expect } from 'vitest';
import {
    buildBoneFrame,
    buildMorphFrame,
} from '../motion-algos/vmd-writer';
import type { BoneKeyFrame, MorphKeyFrame } from '../motion-algos/vmd-writer';

// pos3 + rot4 共 7 个 float32 的偏移（相对帧起点）
const FLOAT_OFFS = [19, 23, 27, 31, 35, 39, 43];

function boneFrame(
    position: [number, number, number],
    rotation: [number, number, number, number],
    frameNo = 0,
): ArrayBuffer {
    const f: BoneKeyFrame = { name: '頭', frame: frameNo, position, rotation };
    return buildBoneFrame(f);
}

function morphFrame(weight: number, frameNo = 0): ArrayBuffer {
    const f: MorphKeyFrame = { name: 'まばたき', frame: frameNo, weight };
    return buildMorphFrame(f);
}

function floatsAt(buf: ArrayBuffer): number[] {
    const view = new DataView(buf);
    return FLOAT_OFFS.map((o) => view.getFloat32(o, true));
}

/** 扫描整帧字节，确认 NaN 位型（小端 00 00 C0 7F）不存在。 */
function hasNaNPattern(buf: ArrayBuffer): boolean {
    const bytes = new Uint8Array(buf);
    const pattern = [0x00, 0x00, 0xc0, 0x7f];
    for (let i = 0; i + 3 < bytes.length; i++) {
        if (pattern.every((b, j) => bytes[i + j] === b)) return true;
    }
    return false;
}

describe('vmd-writer NaN guard — bone frame', () => {
    it('NaN position 归零：字节为 float 0.0 (00 00 00 00) 而非 NaN 位型 0x7FC00000', () => {
        const buf = boneFrame([Number.NaN, 0, 0], [0, 0, 0, 1]);
        const view = new DataView(buf);
        expect(view.getFloat32(19, true)).toBe(0);
        expect(Array.from(new Uint8Array(buf, 19, 4))).toEqual([0, 0, 0, 0]);
    });

    it('±Infinity/NaN position 与 rotation 全部归零（7 个 float32）', () => {
        const buf = boneFrame(
            [Infinity, -Infinity, Number.NaN],
            [Number.NaN, Infinity, -Infinity, Number.NaN],
        );
        expect(floatsAt(buf)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it('全 NaN 帧字节中不含 NaN 位型 0x7FC00000', () => {
        const buf = boneFrame(
            [Number.NaN, Number.NaN, Number.NaN],
            [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
        );
        expect(hasNaNPattern(buf)).toBe(false);
    });

    it('NaN 帧号归零（setUint32 显式 nanSafe 包裹，ToUint32(NaN)=0）', () => {
        const view = new DataView(boneFrame([0, 0, 0], [0, 0, 0, 1], Number.NaN));
        expect(view.getUint32(15, true)).toBe(0);
    });

    it('有限值原样透传（回归，float32 精度内）', () => {
        const buf = boneFrame([0.5, -2.25, 3.5], [0.1, 0.2, 0.3, 0.9], 42);
        const view = new DataView(buf);
        expect(view.getUint32(15, true)).toBe(42);
        const got = floatsAt(buf);
        expect(got[0]).toBeCloseTo(0.5);
        expect(got[1]).toBeCloseTo(-2.25);
        expect(got[2]).toBeCloseTo(3.5);
        expect(got[3]).toBeCloseTo(0.1);
        expect(got[4]).toBeCloseTo(0.2);
        expect(got[5]).toBeCloseTo(0.3);
        expect(got[6]).toBeCloseTo(0.9);
    });
});

describe('vmd-writer NaN guard — morph frame', () => {
    it('NaN weight 归零：字节为 float 0.0 而非 NaN 位型', () => {
        const buf = morphFrame(Number.NaN);
        const view = new DataView(buf);
        expect(view.getFloat32(19, true)).toBe(0);
        expect(Array.from(new Uint8Array(buf, 19, 4))).toEqual([0, 0, 0, 0]);
    });

    it('±Infinity weight 归零', () => {
        expect(new DataView(morphFrame(Infinity)).getFloat32(19, true)).toBe(0);
        expect(new DataView(morphFrame(-Infinity)).getFloat32(19, true)).toBe(0);
    });

    it('NaN 帧号归零（ToUint32 语义，未包裹亦安全）', () => {
        const view = new DataView(morphFrame(0.5, Number.NaN));
        expect(view.getUint32(15, true)).toBe(0);
    });

    it('有限 weight 原样透传（回归）', () => {
        const view = new DataView(morphFrame(0.5, 30));
        expect(view.getUint32(15, true)).toBe(30);
        expect(view.getFloat32(19, true)).toBeCloseTo(0.5);
    });
});
