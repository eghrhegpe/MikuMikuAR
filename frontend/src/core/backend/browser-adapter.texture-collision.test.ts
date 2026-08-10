// @vitest-environment node
// browser-adapter.texture-collision.test.ts — 纹理键命名空间 + 缓存统计（拆自 browser-adapter.test.ts）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mem, setStore, eqBytes, resetMem } from './browser-adapter-mocks';

vi.mock('./idb', () => ({
    idbGet: async (store: string, key: string) => mem.get(store)?.get(key) ?? undefined,
    idbSet: async (store: string, key: string, value: unknown) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        mem.get(store)!.set(key, value);
    },
    idbKeys: async (store: string) => [...(mem.get(store)?.keys() ?? [])],
    idbDelete: async (store: string, key: string) => {
        mem.get(store)?.delete(key);
    },
    idbBatchSet: async (store: string, entries: [string, unknown][]) => {
        if (!mem.has(store)) {
            mem.set(store, new Map());
        }
        for (const [k, v] of entries) {
            mem.get(store)!.set(k, v);
        }
    },
    openDB: async () => ({}) as unknown,
    closeIDB: () => {},
}));

import { browserAdapter } from './browser-adapter';

describe('纹理键命名空间（bugfix:tex-stem-collision）', () => {
    beforeEach(() => resetMem());

    it('不同目录同名 PMX 的纹理键互不碰撞，且各自精确解析', async () => {
        const aTex = new Uint8Array([10, 20, 30]);
        const bTex = new Uint8Array([40, 50, 60]);
        setStore('models', {
            'file:A/miku': new Uint8Array([1, 2, 3]),
            'file:B/miku': new Uint8Array([4, 5, 6]),
            'dir:A%2Fmiku:tex/face.png': aTex,
            'dir:B%2Fmiku:tex/face.png': bTex,
        });

        const aDir = await browserAdapter.IsolateModelDir('web://selected-dir/PMX/A/miku.pmx');
        const bDir = await browserAdapter.IsolateModelDir('web://selected-dir/PMX/B/miku.pmx');

        expect(aDir).toBe('web://model/A%2Fmiku');
        expect(bDir).toBe('web://model/B%2Fmiku');
        expect('dir:A%2Fmiku:tex/face.png').not.toBe('dir:B%2Fmiku:tex/face.png');

        const aEntries = await browserAdapter.ListDirRecursive(aDir);
        expect(aEntries.map((e) => e.relativePath)).toContain('tex/face.png');

        const gotA = await browserAdapter.readFileBytes(`${aDir}/tex/face.png`);
        expect(eqBytes(gotA, aTex)).toBe(true);
        expect(eqBytes(gotA, bTex)).toBe(false);

        const gotB = await browserAdapter.readFileBytes(`${bDir}/tex/face.png`);
        expect(eqBytes(gotB, bTex)).toBe(true);
    });

    it('根目录（裸文件名）模型保持向后兼容', async () => {
        const rootTex = new Uint8Array([7, 8, 9]);
        setStore('models', {
            'file:miku': new Uint8Array([1]),
            'dir:miku:tex/face.png': rootTex,
        });

        const dir = await browserAdapter.IsolateModelDir('miku.pmx');
        expect(dir).toBe('web://model/miku');

        const entries = await browserAdapter.ListDirRecursive(dir);
        expect(entries.map((e) => e.relativePath)).toContain('tex/face.png');

        const got = await browserAdapter.readFileBytes(`${dir}/tex/face.png`);
        expect(eqBytes(got, rootTex)).toBe(true);
    });
});

describe('GetCacheStats 真实结构（修复面板 undefined）', () => {
    beforeEach(() => resetMem());

    it('返回 CacheStats 9 字段，且 totalBytes 为各 store 字节之和', async () => {
        const pmxBytes = new Uint8Array(100);
        const texBytes = new Uint8Array(50);
        const thumbBytes = new Uint8Array(20);
        const cacheBytes = new Uint8Array(5);
        setStore('models', {
            'file:miku': pmxBytes,
            'dir:miku:tex/face.png': texBytes,
            'entry:miku': { name: 'miku', kind: 'pmx', size: 100, savedAt: 0 },
        });
        setStore('thumbnails', { 'file:miku': thumbBytes });
        setStore('caches', { 'extract:x': cacheBytes });

        const stats = await browserAdapter.GetCacheStats();

        expect(stats.extractedBytes).toBe(5);
        expect(stats.extractedCount).toBe(1);
        expect(stats.thumbnailBytes).toBe(20);
        expect(stats.thumbnailCount).toBe(1);
        expect(stats.serveBytes).toBe(0);
        expect(stats.serveCount).toBe(0);
        expect(stats.resourceBytes).toBe(150);
        expect(stats.resourceCount).toBe(2);
        expect(stats.totalBytes).toBe(150 + 5 + 20);
    });

    it('空库时所有计数与字节为 0，不抛错', async () => {
        resetMem();
        const stats = await browserAdapter.GetCacheStats();
        expect(stats.totalBytes).toBe(0);
        expect(stats.resourceCount).toBe(0);
        expect(stats.thumbnailCount).toBe(0);
        expect(stats.extractedCount).toBe(0);
    });
});
