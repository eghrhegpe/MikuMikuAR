// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditMissingTextures, parsePmxTexturePaths } from './pmx-texture-audit';

// [feature:missing-texture-audit] 用 mock 替换 babylon-mmd 的 PmxReader，
// 避免依赖真实 PMX 字节，专注验证「声明纹理 vs 已提供纹理」的差集与规范化匹配逻辑。
vi.mock('babylon-mmd/esm/Loader/Parser/pmxReader.js', () => ({
    PmxReader: { ParseAsync: vi.fn() },
}));

import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader.js';

describe('auditMissingTextures', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns textures absent from the available set (case/separator insensitive)', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockResolvedValue({
            textures: ['tex/face.png', 'Eye.BMP', 'missing.tga'],
        });
        const missing = await auditMissingTextures(new Uint8Array([1, 2, 3]), [
            'tex/face.png',
            'eye.bmp',
        ]);
        expect(missing).toEqual(['missing.tga']);
    });

    it('returns empty when every declared texture is available', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockResolvedValue({
            textures: ['a.png', 'sub/b.png'],
        });
        expect(await auditMissingTextures(new Uint8Array([1]), ['a.png', 'sub/b.png'])).toEqual([]);
    });

    it('backslashes are normalized before comparison', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockResolvedValue({
            textures: ['tex\\face.png'],
        });
        expect(await auditMissingTextures(new Uint8Array([1]), ['tex/face.png'])).toEqual([]);
    });

    it('never throws: parse failure yields empty list (non-blocking)', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockRejectedValue(new Error('corrupt pmx'));
        const missing = await auditMissingTextures(new Uint8Array([1]), ['a.png']);
        expect(missing).toEqual([]);
    });

    it('abort: 加载取消后丢弃审计，不报缺失（避免对新场景误报）', async () => {
        const aborted = new AbortController();
        aborted.abort();
        const missing = await auditMissingTextures(new Uint8Array([1]), ['a.png'], aborted.signal);
        expect(missing).toEqual([]);
        expect(PmxReader.ParseAsync).not.toHaveBeenCalled();
    });

    // [audit:fix 2026-10] 触达 L49 toArrayBuffer 调用行：
    // 证明 readFileBytes→toArrayBuffer→PmxReader.ParseAsync 链已执行
    it('toArrayBuffer chain: PmxReader.ParseAsync receives ArrayBuffer (not Uint8Array)', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockResolvedValue({ textures: [] });

        const fakeBytes = new Uint8Array(new ArrayBuffer(8)).fill(1);
        await auditMissingTextures(fakeBytes, []);

        const parseSpy = (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> })
            .ParseAsync;
        expect(parseSpy).toHaveBeenCalledTimes(1);
        const arg = (parseSpy.mock.calls[0] as unknown[])[0];
        expect(arg).toBeInstanceOf(ArrayBuffer);
        expect((arg as ArrayBuffer).byteLength).toBe(8);
    });

    it('toArrayBuffer chain: catch path also reaches L49 (ParseAsync rejects after toArrayBuffer)', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockRejectedValue(new Error('unexpected'));

        const fakeBytes = new Uint8Array(new ArrayBuffer(4)).fill(2);
        const missing = await auditMissingTextures(fakeBytes, ['a.png']);

        expect(missing).toEqual([]);
        // ParseAsync WAS called (toArrayBuffer at L49 executed before the reject)
        const parseSpy = (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> })
            .ParseAsync;
        expect(parseSpy).toHaveBeenCalledTimes(1);
        const arg = (parseSpy.mock.calls[0] as unknown[])[0];
        expect(arg).toBeInstanceOf(ArrayBuffer);
    });
});

describe('parsePmxTexturePaths [audit:fix 2026-10]', () => {
    beforeEach(() => vi.clearAllMocks());

    it('解析成功 → 原样返回纹理清单（触达 L27 toArrayBuffer 调用行）', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockResolvedValue({ textures: ['a.tga', 'b.tga'] });
        const paths = await parsePmxTexturePaths(new Uint8Array([1, 2, 3]));
        expect(paths).toEqual(['a.tga', 'b.tga']);
        const parseSpy = (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> })
            .ParseAsync;
        expect((parseSpy.mock.calls[0] as unknown[])[0]).toBeInstanceOf(ArrayBuffer);
    });

    it('解析失败 → 返回空数组（catch 路径 L29-30）', async () => {
        (
            PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }
        ).ParseAsync.mockRejectedValue(new Error('bad pmx'));
        expect(await parsePmxTexturePaths(new Uint8Array([1]))).toEqual([]);
    });
});
