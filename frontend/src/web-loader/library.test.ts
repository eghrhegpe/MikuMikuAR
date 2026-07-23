// ADR-176 Phase 3 — Web 模型库单测
// idb 注入内存桩（Node/happy-dom 无 IndexedDB），验证键规约与配对删除语义。

import { describe, it, expect, vi, beforeEach } from 'vitest';

// —— 内存桩：模拟 core/backend/idb ——
const mem = new Map<string, unknown>();
const mk = (store: string, key: string): string => `${store}/${key}`;

vi.mock('../core/backend/idb', () => ({
    idbGet: vi.fn(async (store: string, key: string) => mem.get(mk(store, key))),
    idbSet: vi.fn(async (store: string, key: string, value: unknown) => {
        mem.set(mk(store, key), value);
    }),
    idbDelete: vi.fn(async (store: string, key: string) => {
        mem.delete(mk(store, key));
    }),
    idbKeys: vi.fn(async (store: string) =>
        [...mem.keys()].filter((k) => k.startsWith(`${store}/`)).map((k) => k.slice(store.length + 1))
    ),
    closeIDB: vi.fn(),
}));

import {
    saveModel,
    listModels,
    loadModelBytes,
    getModelEntry,
    deleteModel,
    setLastModel,
    getLastModel,
    formatSize,
} from './library';

describe('web-loader 模型库（ADR-176 Phase 3）', () => {
    beforeEach(() => {
        mem.clear();
    });

    it('saveModel 写入 entry: + file: 双键，去扩展名作库内名', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const entry = await saveModel('Miku.zip', bytes, 'zip');
        expect(entry.name).toBe('Miku');
        expect(entry.fileName).toBe('Miku.zip');
        expect(entry.size).toBe(3);
        expect(mem.has('models/entry:Miku')).toBe(true);
        expect(mem.has('models/file:Miku')).toBe(true);
    });

    it('listModels 仅列 entry: 前缀且按 savedAt 倒序', async () => {
        await saveModel('A.pmx', new Uint8Array([1]), 'pmx');
        // 人工做时间差
        const b = await saveModel('B.zip', new Uint8Array([2]), 'zip');
        b.savedAt += 1000;
        mem.set('models/entry:B', b);
        // 库内混入非 entry 键（recent 等）不应干扰
        mem.set('models/recent', [{ fake: true }]);

        const list = await listModels();
        expect(list.map((m) => m.name)).toEqual(['B', 'A']);
    });

    it('loadModelBytes / getModelEntry 读取配对数据', async () => {
        const bytes = new Uint8Array([9, 8, 7]);
        await saveModel('X.pmx', bytes, 'pmx');
        expect(await loadModelBytes('X')).toEqual(bytes);
        expect((await getModelEntry('X'))?.kind).toBe('pmx');
        expect(await loadModelBytes('不存在')).toBeNull();
        expect(await getModelEntry('不存在')).toBeNull();
    });

    it('deleteModel 配对删除 entry+file，且清除指向它的 lastModel', async () => {
        await saveModel('Y.zip', new Uint8Array([1]), 'zip');
        await setLastModel('Y');
        expect(await getLastModel()).toBe('Y');

        await deleteModel('Y');
        expect(mem.has('models/entry:Y')).toBe(false);
        expect(mem.has('models/file:Y')).toBe(false);
        expect(await getLastModel()).toBeNull();
    });

    it('deleteModel 不误伤指向其他模型的 lastModel', async () => {
        await saveModel('A.pmx', new Uint8Array([1]), 'pmx');
        await saveModel('B.pmx', new Uint8Array([2]), 'pmx');
        await setLastModel('B');
        await deleteModel('A');
        expect(await getLastModel()).toBe('B');
    });

    it('同名覆盖：二次 saveModel 更新原档与元数据', async () => {
        await saveModel('Z.zip', new Uint8Array([1]), 'zip');
        await saveModel('Z.zip', new Uint8Array([1, 2, 3, 4]), 'zip');
        const list = await listModels();
        expect(list).toHaveLength(1);
        expect(list[0].size).toBe(4);
    });

    it('formatSize 人类可读', () => {
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(2048)).toBe('2.0 KB');
        expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
    });
});
