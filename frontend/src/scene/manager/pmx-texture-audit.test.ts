import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditMissingTextures } from './pmx-texture-audit';

// [feature:missing-texture-audit] 用 mock 替换 babylon-mmd 的 PmxReader，
// 避免依赖真实 PMX 字节，专注验证「声明纹理 vs 已提供纹理」的差集与规范化匹配逻辑。
vi.mock('babylon-mmd/esm/Loader/Parser/pmxReader.js', () => ({
    PmxReader: { ParseAsync: vi.fn() },
}));

import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader.js';

describe('auditMissingTextures', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns textures absent from the available set (case/separator insensitive)', async () => {
        (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }).ParseAsync.mockResolvedValue({
            textures: ['tex/face.png', 'Eye.BMP', 'missing.tga'],
        });
        const missing = await auditMissingTextures(new Uint8Array([1, 2, 3]), [
            'tex/face.png',
            'eye.bmp',
        ]);
        expect(missing).toEqual(['missing.tga']);
    });

    it('returns empty when every declared texture is available', async () => {
        (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }).ParseAsync.mockResolvedValue({
            textures: ['a.png', 'sub/b.png'],
        });
        expect(await auditMissingTextures(new Uint8Array([1]), ['a.png', 'sub/b.png'])).toEqual([]);
    });

    it('backslashes are normalized before comparison', async () => {
        (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }).ParseAsync.mockResolvedValue({
            textures: ['tex\\face.png'],
        });
        expect(await auditMissingTextures(new Uint8Array([1]), ['tex/face.png'])).toEqual([]);
    });

    it('never throws: parse failure yields empty list (non-blocking)', async () => {
        (PmxReader as unknown as { ParseAsync: ReturnType<typeof vi.fn> }).ParseAsync.mockRejectedValue(
            new Error('corrupt pmx')
        );
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
});
