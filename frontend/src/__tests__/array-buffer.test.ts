// @vitest-environment node
// [audit:fix 2026-10] toArrayBuffer（core/array-buffer 叶）单测：
// 对齐/偏移/共享大 buffer/零长度四档语义，对应全仓裸 .buffer 强转收口。
import { describe, it, expect } from 'vitest';
import { toArrayBuffer } from '@/core/array-buffer';

describe('toArrayBuffer', () => {
    it('对齐全长 view → 返回同一 buffer 引用（零语义变化）', () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        expect(toArrayBuffer(bytes)).toBe(bytes.buffer);
    });

    it('带 byteOffset 的 subarray → 返回拷贝且 byteLength/字节内容正确', () => {
        const base = new Uint8Array([0, 9, 8, 7, 6, 5, 4, 3]);
        const view = base.subarray(3, 6); // byteOffset=3, byteLength=3
        const out = toArrayBuffer(view);
        expect(out).not.toBe(view.buffer);
        expect(out.byteLength).toBe(3);
        expect(Array.from(new Uint8Array(out))).toEqual([7, 6, 5]);
    });

    it('共享大 buffer 的子视图 → 返回拷贝且字节内容正确', () => {
        const big = new ArrayBuffer(64);
        const all = new Uint8Array(big);
        all[10] = 0xaa;
        all[11] = 0xbb;
        const view = new Uint8Array(big, 10, 2); // 64B 共享 buffer 的偏移子视图
        const out = toArrayBuffer(view);
        expect(out).not.toBe(big);
        expect(out.byteLength).toBe(2);
        expect(Array.from(new Uint8Array(out))).toEqual([0xaa, 0xbb]);
    });

    it('零长度 → 返回同一空 buffer（byteLength=0）', () => {
        const empty = new Uint8Array(0);
        expect(toArrayBuffer(empty)).toBe(empty.buffer);
        expect(toArrayBuffer(empty).byteLength).toBe(0);
    });
});
