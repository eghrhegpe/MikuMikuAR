// [doc:adr-189] 纹理 LRU 缓存测试 — Phase 1.4
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock wails-bindings —— 提供 readFileBytes + resolveBackend 供 texture-lru 使用
// vi.mock 工厂被 hoist，不能引用外部变量，用 vi.hoisted 桥接
const __mocks = vi.hoisted(() => ({
    readFileBytes: vi.fn(),
    ListDirRecursive: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../core/wails-bindings', () => ({
    readFileBytes: __mocks.readFileBytes,
    ListDirRecursive: __mocks.ListDirRecursive,
    getCachedBackend: vi.fn(() => null),
    resolveBackend: vi.fn().mockResolvedValue({
        capabilities: () => ({}),
        readFileBytes: __mocks.readFileBytes,
    }),
}));

import {
    readTextureWithLRU,
    clearTextureLRU,
    textureLRUSize,
    _resetTextureLRUForTest,
} from '../../scene/manager/texture-lru';

const mockReadFileBytes = __mocks.readFileBytes;

describe('texture-lru', () => {
    beforeEach(() => {
        _resetTextureLRUForTest();
        mockReadFileBytes.mockReset();
    });

    it('should return null when readFileBytes returns null', async () => {
        mockReadFileBytes.mockResolvedValue(null);
        const result = await readTextureWithLRU('web://model/a', 'tex/face.png');
        expect(result).toBeNull();
        expect(textureLRUSize()).toBe(0);
    });

    it('should cache and return ArrayBuffer on first read', async () => {
        const buf = new Uint8Array([1, 2, 3]).buffer;
        const mockUint8 = new Uint8Array(buf);
        mockReadFileBytes.mockResolvedValueOnce(mockUint8);

        const result = await readTextureWithLRU('web://model/a', 'tex/face.png');
        expect(result).toBeInstanceOf(ArrayBuffer);
        expect(result).toBe(buf); // 同一底层 ArrayBuffer
        expect(textureLRUSize()).toBe(1);

        // 第二次调用不触发 readFileBytes
        mockReadFileBytes.mockResolvedValue(new Uint8Array([9, 9, 9]));
        const result2 = await readTextureWithLRU('web://model/a', 'tex/face.png');
        expect(result2).toBe(buf); // 缓存命中，返回原始 ArrayBuffer
        expect(mockReadFileBytes).toHaveBeenCalledTimes(1);
    });

    it('should use \\x00 as key separator to avoid collision with colon in path', async () => {
        const buf1 = new Uint8Array([1]).buffer;
        const buf2 = new Uint8Array([2]).buffer;
        mockReadFileBytes
            .mockResolvedValueOnce(new Uint8Array(buf1))
            .mockResolvedValueOnce(new Uint8Array(buf2));

        // modelDir="web://model/a" + relativePath="x:y" vs modelDir="web://model/a:x" + relativePath="y"
        await readTextureWithLRU('web://model/a', 'x:y');
        await readTextureWithLRU('web://model/a:x', 'y');
        expect(textureLRUSize()).toBe(2); // 两个独立条目，无碰撞
    });

    it('should evict oldest entry when LRU exceeds max entries', async () => {
        const MAX = 5 * 30; // TEXTURE_LRU_MAX_ENTRIES
        for (let i = 0; i < MAX; i++) {
            const arr = new Uint8Array([i]);
            mockReadFileBytes.mockResolvedValueOnce(arr);
            await readTextureWithLRU('web://model/a', `tex/tex${i}.png`);
        }
        expect(textureLRUSize()).toBe(MAX);

        // 再插入一条，应淘汰最旧的那条
        mockReadFileBytes.mockResolvedValueOnce(new Uint8Array([99]));
        await readTextureWithLRU('web://model/a', 'tex/overflow.png');
        expect(textureLRUSize()).toBe(MAX); // 仍在上限，旧条目被驱逐
    });

    it('should reorder LRU on hit (promote to newest)', async () => {
        const buf1 = new Uint8Array([1]).buffer;
        const buf2 = new Uint8Array([2]).buffer;
        const buf3 = new Uint8Array([3]).buffer;
        mockReadFileBytes
            .mockResolvedValueOnce(new Uint8Array(buf1))
            .mockResolvedValueOnce(new Uint8Array(buf2))
            .mockResolvedValueOnce(new Uint8Array(buf3));

        await readTextureWithLRU('web://model/a', 'tex/a.png');
        await readTextureWithLRU('web://model/a', 'tex/b.png');
        await readTextureWithLRU('web://model/a', 'tex/c.png');

        // 命中 a，将其提升到最新
        const hit = await readTextureWithLRU('web://model/a', 'tex/a.png');
        expect(hit).toBe(buf1);
        // 第 4 次调用未触发新的 readFileBytes（缓存命中）
        expect(mockReadFileBytes).toHaveBeenCalledTimes(3);

        // 填充到上限
        const fillCount = (5 * 30) - 3;
        for (let i = 0; i < fillCount; i++) {
            mockReadFileBytes.mockResolvedValueOnce(new Uint8Array([i]));
            await readTextureWithLRU('web://model/a', `tex/fill${i}.png`);
        }
        expect(textureLRUSize()).toBe(150);

        // 再插一条 → 驱逐 b（b 是最旧的未被命中的）
        mockReadFileBytes.mockResolvedValueOnce(new Uint8Array([99]));
        await readTextureWithLRU('web://model/a', 'tex/overflow.png');

        // 验证：命中过的 a 仍存在
        const aHit = await readTextureWithLRU('web://model/a', 'tex/a.png');
        expect(aHit).toBe(buf1);
    });

    it('should not cache when signal is already aborted', async () => {
        const ctrl = new AbortController();
        ctrl.abort();
        const result = await readTextureWithLRU('web://model/a', 'tex/face.png', ctrl.signal);
        expect(result).toBeNull();
        expect(mockReadFileBytes).not.toHaveBeenCalled();
        expect(textureLRUSize()).toBe(0);
    });

    it('should not cache when signal aborts after readFileBytes', async () => {
        const ctrl = new AbortController();
        const buf = new Uint8Array([1, 2, 3]).buffer;
        mockReadFileBytes.mockImplementation(async () => {
            ctrl.abort(); // 读完后立即 abort
            return new Uint8Array(buf);
        });

        const result = await readTextureWithLRU('web://model/a', 'tex/face.png', ctrl.signal);
        expect(result).toBeNull(); // 已 abort，不入缓存
        expect(textureLRUSize()).toBe(0);
    });

    it('clearTextureLRU should empty the cache', async () => {
        mockReadFileBytes.mockResolvedValue(new Uint8Array([1]));
        await readTextureWithLRU('web://model/a', 'tex/a.png');
        await readTextureWithLRU('web://model/a', 'tex/b.png');
        expect(textureLRUSize()).toBe(2);

        clearTextureLRU();
        expect(textureLRUSize()).toBe(0);
    });

    it('should isolate entries by modelDir', async () => {
        const buf1 = new Uint8Array([1]).buffer;
        const buf2 = new Uint8Array([2]).buffer;
        mockReadFileBytes
            .mockResolvedValueOnce(new Uint8Array(buf1))
            .mockResolvedValueOnce(new Uint8Array(buf2));

        // 两个不同模型目录下的同名纹理
        await readTextureWithLRU('web://model/a', 'tex/face.png');
        await readTextureWithLRU('web://model/b', 'tex/face.png');
        expect(textureLRUSize()).toBe(2); // 独立缓存

        const result = await readTextureWithLRU('web://model/a', 'tex/face.png');
        expect(result).toBe(buf1); // 各自命中
    });
});
