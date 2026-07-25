// [doc:test-strategy] browser-adapter 回归测试
// 聚焦两处 P1 修复：
//  1) [bugfix:tex-stem-collision] 不同目录同名 PMX 的纹理键互不碰撞（A/miku.pmx 与 B/miku.pmx）
//  2) GetCacheStats 返回真实 CacheStats 9 字段结构（旧实现硬编码 size:0 且字段不符 → 面板 undefined）
//
// 通过 vi.mock('./idb') 注入内存 store，绕过 IndexedDB，纯逻辑验证键命名空间与统计聚合。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mem } = vi.hoisted(() => {
    const mem = new Map<string, Map<string, unknown>>();
    return { mem };
});

vi.mock('./idb', () => ({
    idbGet: async (store: string, key: string) => mem.get(store)?.get(key) ?? undefined,
    idbSet: async (store: string, key: string, value: unknown) => {
        if (!mem.has(store)) mem.set(store, new Map());
        mem.get(store)!.set(key, value);
    },
    idbKeys: async (store: string) => [...(mem.get(store)?.keys() ?? [])],
    idbDelete: async (store: string, key: string) => {
        mem.get(store)?.delete(key);
    },
    openDB: async () => ({}) as unknown,
    closeIDB: () => {},
}));

import { browserAdapter, getFsaAuthState, isFsaAuthPromptDismissed, dismissFsaAuthPrompt } from './browser-adapter';

function setStore(store: string, entries: Record<string, unknown>): void {
    mem.set(store, new Map(Object.entries(entries)));
}

const eqBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
    !!a && a.length === b.length && a.every((v, i) => v === b[i]);

describe('纹理键命名空间（bugfix:tex-stem-collision）', () => {
    beforeEach(() => {
        mem.clear();
    });

    it('不同目录同名 PMX 的纹理键互不碰撞，且各自精确解析', async () => {
        const aTex = new Uint8Array([10, 20, 30]);
        const bTex = new Uint8Array([40, 50, 60]);
        // 模拟 _scanDirIntoIDB 写入的新格式键：编码 stem 含路径维度
        setStore('models', {
            'file:A/miku': new Uint8Array([1, 2, 3]),
            'file:B/miku': new Uint8Array([4, 5, 6]),
            'dir:A%2Fmiku:tex/face.png': aTex,
            'dir:B%2Fmiku:tex/face.png': bTex,
        });

        const aDir = await browserAdapter.IsolateModelDir('web://selected-dir/PMX/A/miku.pmx');
        const bDir = await browserAdapter.IsolateModelDir('web://selected-dir/PMX/B/miku.pmx');

        // ① stem 编码后路径维度被保留（不再是裸文件名）
        expect(aDir).toBe('web://model/A%2Fmiku');
        expect(bDir).toBe('web://model/B%2Fmiku');

        // ② 两个键字符串本就不同 —— 旧实现（dir:miku:...）会在此相撞
        expect('dir:A%2Fmiku:tex/face.png').not.toBe('dir:B%2Fmiku:tex/face.png');

        // ③ A 的目录只列出 A 的纹理
        const aEntries = await browserAdapter.ListDirRecursive(aDir);
        expect(aEntries.map((e) => e.relativePath)).toContain('tex/face.png');

        // ④ 读取 A 的纹理必须命中 A，而非被 B 覆盖
        const gotA = await browserAdapter.readFileBytes(`${aDir}/tex/face.png`);
        expect(eqBytes(gotA, aTex)).toBe(true);
        expect(eqBytes(gotA, bTex)).toBe(false);

        // ⑤ B 同理
        const gotB = await browserAdapter.readFileBytes(`${bDir}/tex/face.png`);
        expect(eqBytes(gotB, bTex)).toBe(true);
    });

    it('根目录（裸文件名）模型保持向后兼容', async () => {
        const rootTex = new Uint8Array([7, 8, 9]);
        // 根级 pmx 编码 stem == 裸文件名，键形态与旧实现一致
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
    beforeEach(() => {
        mem.clear();
    });

    it('返回 CacheStats 9 字段，且 totalBytes 为各 store 字节之和', async () => {
        const pmxBytes = new Uint8Array(100); // 100 B
        const texBytes = new Uint8Array(50); // 50 B
        const thumbBytes = new Uint8Array(20); // 20 B
        const cacheBytes = new Uint8Array(5); // 5 B
        setStore('models', {
            'file:miku': pmxBytes,
            'dir:miku:tex/face.png': texBytes,
            'entry:miku': { name: 'miku', kind: 'pmx', size: 100, savedAt: 0 }, // 元数据对象不计字节
        });
        setStore('thumbnails', { 'file:miku': thumbBytes });
        setStore('caches', { 'extract:x': cacheBytes });

        const stats = await browserAdapter.GetCacheStats();

        // 字段齐全（旧实现仅 {count,size}，此处为 undefined）
        expect(stats.extractedBytes).toBe(5);
        expect(stats.extractedCount).toBe(1);
        expect(stats.thumbnailBytes).toBe(20);
        expect(stats.thumbnailCount).toBe(1);
        expect(stats.serveBytes).toBe(0);
        expect(stats.serveCount).toBe(0);
        expect(stats.resourceBytes).toBe(150); // 100 + 50（仅 Uint8Array，排除 entry 对象）
        expect(stats.resourceCount).toBe(2);
        expect(stats.totalBytes).toBe(150 + 5 + 20);
    });

    it('空库时所有计数与字节为 0，不抛错', async () => {
        mem.clear();
        const stats = await browserAdapter.GetCacheStats();
        expect(stats.totalBytes).toBe(0);
        expect(stats.resourceCount).toBe(0);
        expect(stats.thumbnailCount).toBe(0);
        expect(stats.extractedCount).toBe(0);
    });
});

describe('getFsaAuthState 四态（adr-177 启动引导）', () => {
    const realWindow = (globalThis as { window?: unknown }).window;
    beforeEach(() => {
        mem.clear();
    });
    afterEach(() => {
        // 还原 window，避免污染其他测试
        if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else (globalThis as { window?: unknown }).window = realWindow;
    });

    it('unsupported: 有 window 但不暴露 FSA API → 不引导', async () => {
        // 真实环境（旧浏览器/桌面 WebView2 不暴露 FSA）总有 window，仅缺 FSA 方法
        (globalThis as { window?: unknown }).window = { addEventListener: () => {} };
        expect(await getFsaAuthState()).toBe('unsupported');
    });

    it('none: 有 FSA API 且无持久化句柄 → 应引导', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        expect(await getFsaAuthState()).toBe('none');
    });

    it('granted: 句柄 queryPermission 返回 granted → 不引导', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: { queryPermission: async () => 'granted' } });
        expect(await getFsaAuthState()).toBe('granted');
    });

    it('revoked: 句柄 queryPermission 返回 prompt → 应提示重设', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: { queryPermission: async () => 'prompt' } });
        expect(await getFsaAuthState()).toBe('revoked');
    });

    it('revoked: 老实现无 queryPermission → 保守视为需重选', async () => {
        (globalThis as { window?: unknown }).window = {
            showDirectoryPicker: () => {},
            showOpenFilePicker: () => {},
        };
        setStore('config', { fsaRootHandle: {} });
        expect(await getFsaAuthState()).toBe('revoked');
    });
});

describe('fsaAuthPrompt dismissed 标志（adr-177 跳过不再弹）', () => {
    beforeEach(() => {
        mem.clear();
    });
    it('默认未跳过；dismiss 后记为已跳过', async () => {
        expect(await isFsaAuthPromptDismissed()).toBe(false);
        await dismissFsaAuthPrompt();
        expect(await isFsaAuthPromptDismissed()).toBe(true);
    });
});
