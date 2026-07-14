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
        while (end < off + NAME_BYTES && u8[end] !== 0) end++;
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
        while (end < off + NAME_BYTES && u8[end] !== 0) end++;
        const decoded = Encoding.convert(Array.from(u8.subarray(off, end)), {
            from: 'SJIS',
            to: 'UNICODE',
            type: 'string',
        }) as string;
        // Shift-JIS 下每个全角日文字符 2 字节；UTF-8 会是 3 字节/字符
        expect(end - off).toBe(decoded.length * 2);
    });
});
