// @vitest-environment node
/**
 * pose-preset 测试 — T-pose / A-pose / rest VMD 发生器
 *
 * [review] 核心回归防护: 骨骼名必须为 Shift-JIS 编码（VMD 规范）。
 * 历史 bug: 原实现用 TextEncoder(UTF-8) 编码日文骨骼名 → VmdLoader 按 Shift-JIS
 * 读回得乱码 → 无法匹配模型骨骼 → 姿态静默失效。本测试锁死编码正确性。
 */
import { describe, it, expect } from 'vitest';
import Encoding from 'encoding-japanese';
import { generatePoseVmd } from '../motion-algos/pose-preset';

const HEADER_SIZE = 54; // 30(sig) + 20(model) + 4(boneCount)
const BONE_FRAME_SIZE = 111;
const NAME_BYTES = 15;

/** 从 VMD buffer 解码全部骨骼名（按 Shift-JIS，模拟 VmdLoader 读回）。 */
function decodeBoneNames(buf: ArrayBuffer): string[] {
    const view = new DataView(buf);
    const count = view.getUint32(50, true);
    const u8 = new Uint8Array(buf);
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
        const off = HEADER_SIZE + i * BONE_FRAME_SIZE;
        // 截取 15 字节名字段，去除尾部 \0 填充
        let end = off;
        while (end < off + NAME_BYTES && u8[end] !== 0) {
            end++;
        }
        const raw = Array.from(u8.subarray(off, end));
        const decoded = Encoding.convert(raw, { from: 'SJIS', to: 'UNICODE', type: 'string' });
        names.push(decoded as string);
    }
    return names;
}

describe('generatePoseVmd — 结构', () => {
    it('T-pose 生成合法 VMD 头（signature + 骨骼计数）', () => {
        const buf = generatePoseVmd('tpose');
        const sig = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, 25));
        expect(sig).toBe('Vocaloid Motion Data 0002');
        expect(new DataView(buf).getUint32(50, true)).toBeGreaterThan(0);
    });

    it('rest 产出空骨骼数据（0 帧）', () => {
        const buf = generatePoseVmd('rest');
        expect(new DataView(buf).getUint32(50, true)).toBe(0);
        // header + 0 骨骼 + 4(morphCount) + 16(trailer)
        expect(buf.byteLength).toBe(HEADER_SIZE + 4 + 16);
    });
});

describe('generatePoseVmd — Shift-JIS 骨骼名编码（回归防护）', () => {
    it('T-pose 骨骼名经 Shift-JIS 解码为正确日文（非 UTF-8 乱码）', () => {
        const names = decodeBoneNames(generatePoseVmd('tpose'));
        // 若误用 UTF-8 编码，Shift-JIS 解码会得到乱码，下列断言必失败
        expect(names).toContain('左腕');
        expect(names).toContain('右腕');
        expect(names).toContain('左ひじ');
        expect(names).toContain('右ひじ');
        expect(names).toContain('左肩');
        expect(names).toContain('右肩');
    });

    it('A-pose 骨骼名经 Shift-JIS 解码为正确日文', () => {
        const names = decodeBoneNames(generatePoseVmd('apose'));
        expect(names).toContain('左腕');
        expect(names).toContain('右腕');
        expect(names).toContain('左ひじ');
        expect(names).toContain('右ひじ');
    });

    it('骨骼名不含 Unicode 替换字符（\\uFFFD，乱码标志）', () => {
        for (const name of decodeBoneNames(generatePoseVmd('tpose'))) {
            expect(name.includes('\uFFFD')).toBe(false);
        }
    });

    it('日文名占用 Shift-JIS 字节数（左腕=4 字节，非 UTF-8 的 6 字节）', () => {
        const buf = generatePoseVmd('tpose');
        const u8 = new Uint8Array(buf);
        // 第 0 个骨骼帧名字段
        const off = HEADER_SIZE;
        let end = off;
        while (end < off + NAME_BYTES && u8[end] !== 0) {
            end++;
        }
        const decoded = Encoding.convert(Array.from(u8.subarray(off, end)), {
            from: 'SJIS',
            to: 'UNICODE',
            type: 'string',
        }) as string;
        // Shift-JIS 下每个全角日文字符 2 字节；UTF-8 会是 3 字节/字符
        expect(end - off).toBe(decoded.length * 2);
    });
});

// ====================================================================
// 姿态数据内容 — rotation / position / frame / morph / trailer
// 历史盲区: 原测试只验证骨骼名编码与头部结构，从不验证实际写入的旋转值。
// 若 addBone 的旋转角度/方向写错，或 tpose 与 apose 分支被误合并成相同数据，
// 旧测试抓不出。下列断言锁死每个骨骼帧的数值内容。
// ====================================================================

// 骨骼帧内相对偏移（111 字节）: 15 name + 4 frame + 12 pos + 16 rot + 64 interp
const ROT_OFFSET = 31;
const POS_OFFSET = 19;
const FRAME_OFFSET = 15;

/** 读取第 i 个骨骼帧的 rotation [x,y,z,w]。 */
function decodeRotation(buf: ArrayBuffer, i: number): number[] {
    const view = new DataView(buf);
    const off = HEADER_SIZE + i * BONE_FRAME_SIZE + ROT_OFFSET;
    return [
        view.getFloat32(off, true),
        view.getFloat32(off + 4, true),
        view.getFloat32(off + 8, true),
        view.getFloat32(off + 12, true),
    ];
}

/** 读取第 i 个骨骼帧的 position [x,y,z]。 */
function decodePosition(buf: ArrayBuffer, i: number): number[] {
    const view = new DataView(buf);
    const off = HEADER_SIZE + i * BONE_FRAME_SIZE + POS_OFFSET;
    return [
        view.getFloat32(off, true),
        view.getFloat32(off + 4, true),
        view.getFloat32(off + 8, true),
    ];
}

/** 读取第 i 个骨骼帧的帧号。 */
function decodeFrameNum(buf: ArrayBuffer, i: number): number {
    return new DataView(buf).getUint32(HEADER_SIZE + i * BONE_FRAME_SIZE + FRAME_OFFSET, true);
}

/** 读取骨骼帧计数（VMD 头 offset 50）。 */
function boneCount(buf: ArrayBuffer): number {
    return new DataView(buf).getUint32(50, true);
}

describe('generatePoseVmd — 姿态数值内容', () => {
    it('骨骼帧计数精确: T-pose=6, A-pose=6, rest=0', () => {
        expect(boneCount(generatePoseVmd('tpose'))).toBe(6);
        expect(boneCount(generatePoseVmd('apose'))).toBe(6);
        expect(boneCount(generatePoseVmd('rest'))).toBe(0);
    });

    it('T-pose 左腕绕 Z 轴 -90°（水平外展，q=[0,0,-√2/2,√2/2]）', () => {
        // 所有帧 frame=0，buildVmd 排序稳定 → 第 0 帧即插入顺序的首个骨骼「左腕」
        const [x, y, z, w] = decodeRotation(generatePoseVmd('tpose'), 0);
        expect(x).toBeCloseTo(0);
        expect(y).toBeCloseTo(0);
        expect(z).toBeCloseTo(-Math.SQRT1_2);
        expect(w).toBeCloseTo(Math.SQRT1_2);
    });

    it('A-pose 左腕绕 Z 轴 -45°（下垂，q=[0,0,-sin22.5°,cos22.5°]）', () => {
        const [, , z, w] = decodeRotation(generatePoseVmd('apose'), 0);
        expect(z).toBeCloseTo(-Math.sin(Math.PI / 8));
        expect(w).toBeCloseTo(Math.cos(Math.PI / 8));
    });

    it('T-pose 与 A-pose 左腕旋转不同（类型分支确实生效，非重复数据）', () => {
        const t = decodeRotation(generatePoseVmd('tpose'), 0);
        const a = decodeRotation(generatePoseVmd('apose'), 0);
        expect(t[2]).not.toBeCloseTo(a[2]);
    });

    it('所有骨骼帧 position 全 0（不产生位移）', () => {
        for (const type of ['tpose', 'apose'] as const) {
            const buf = generatePoseVmd(type);
            for (let i = 0; i < boneCount(buf); i++) {
                expect(decodePosition(buf, i)).toEqual([0, 0, 0]);
            }
        }
    });

    it('所有骨骼帧 frame 号全 0（仅第 0 帧）', () => {
        for (const type of ['tpose', 'apose'] as const) {
            const buf = generatePoseVmd(type);
            for (let i = 0; i < boneCount(buf); i++) {
                expect(decodeFrameNum(buf, i)).toBe(0);
            }
        }
    });

    it('morph 计数为 0，trailer 四段（camera/light/selfShadow/ik）计数全 0', () => {
        const buf = generatePoseVmd('tpose');
        const view = new DataView(buf);
        const morphOff = HEADER_SIZE + boneCount(buf) * BONE_FRAME_SIZE;
        expect(view.getUint32(morphOff, true)).toBe(0); // morph 计数 0
        const trailerOff = morphOff + 4;
        for (let s = 0; s < 4; s++) {
            expect(view.getUint32(trailerOff + s * 4, true)).toBe(0);
        }
    });
});
