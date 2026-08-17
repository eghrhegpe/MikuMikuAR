// @vitest-environment node
// browser-adapter.plaza-config.test.ts — SavePlazaConfig 载荷健壮性
//
// 回归背景：web 端 SavePlazaConfig 曾直接 `JSON.parse(sites || '[]')` 裸解析，
// 非法载荷会抛在写盘之前，但更糟的写法（解析失败后兜底空数组）会把用户已保存的
// 广场配置清空。这里锁住两条不变量：
//   1. 合法 JSON 正常往返（creators/sites 不串位）；
//   2. 非法 JSON 抛错，且旧缓存原样保留——绝不落盘空数组。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mem, resetMem } from './browser-adapter-mocks';

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

describe('SavePlazaConfig — 载荷健壮性', () => {
    beforeEach(() => resetMem());

    it('合法 JSON 正常落盘，creators / sites 不串位', async () => {
        await browserAdapter.SavePlazaConfig('[{"name":"creator-a"}]', '[{"id":"site-1"}]');

        // GetCachedPlazaConfig 返回顺序对齐 Go 端：(creators, sites)
        const [creators, sites] = await browserAdapter.GetCachedPlazaConfig();
        expect(JSON.parse(creators)).toEqual([{ name: 'creator-a' }]);
        expect(JSON.parse(sites)).toEqual([{ id: 'site-1' }]);
    });

    it('非法 JSON 抛错，且旧缓存原样保留（不清空用户配置）', async () => {
        await browserAdapter.SavePlazaConfig('[]', '[{"id":"site-1"}]');

        await expect(browserAdapter.SavePlazaConfig('[]', '{not-json')).rejects.toThrow(
            /not valid JSON/
        );

        const [, sites] = await browserAdapter.GetCachedPlazaConfig();
        expect(JSON.parse(sites)).toEqual([{ id: 'site-1' }]);
    });

    it('空串走 "[]" 兜底，不抛错', async () => {
        await browserAdapter.SavePlazaConfig('', '');
        const [creators, sites] = await browserAdapter.GetCachedPlazaConfig();
        expect(JSON.parse(creators)).toEqual([]);
        expect(JSON.parse(sites)).toEqual([]);
    });
});
