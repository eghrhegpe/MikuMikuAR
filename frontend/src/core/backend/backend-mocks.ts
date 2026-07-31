// backend-mocks.ts — 共享 vi.mock 工厂（ADR-206 Phase 4 拆自 backend.test.ts）
// go-adapter 依赖 @bindings 运行时（Wails），测试中隔离为纯桩。
// idb 在 Node/happy-dom 下无 IndexedDB 实现，注入内存 Map 桩隔离浏览器存储依赖。

import { vi } from 'vitest';

export const idbStore = new Map<string, unknown>();

export function setWindow(w: unknown): void {
    (globalThis as { window?: unknown }).window = w;
}

export function clearWebFlag(): void {
    (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = false;
    delete (globalThis as { __MMKU_BACKEND__?: string }).__MMKU_BACKEND__;
}

export function resetIdb(): void {
    idbStore.clear();
}

// [doc:adr-219] Phase 2 单源 idb mock 工厂——收口 backend.* 系列各自飘移的
// vi.mock('./idb') 形状。isolate=false 下共享 worker 仅解析 ./idb 一次，形状不一
// 致会互相踩踏（后跑者拿到错误 mock → [idb] IndexedDB 不可用）。此处基于
// 单层 idbStore 提供统一形状，并补齐真实 idb.ts 的全 7 个导出（idbBatchSet /
// openDB 原先多数文件漏 mock，被调用会穿透真实模块）。需分 store 隔离语义的
// browser-adapter.* 系列保留自己的双层 mem（browser-adapter-mocks.ts）。
export function makeIdbMock() {
    return {
        idbGet: vi.fn(async (_store: string, key: string) => idbStore.get(key)),
        idbSet: vi.fn(async (_store: string, key: string, val: unknown) => {
            idbStore.set(key, val);
        }),
        idbDelete: vi.fn(async (_store: string, key: string) => {
            idbStore.delete(key);
        }),
        idbBatchSet: vi.fn(async (_store: string, entries: [string, unknown][]) => {
            for (const [k, v] of entries) idbStore.set(k, v);
        }),
        idbKeys: vi.fn(async (_store: string) => Array.from(idbStore.keys())),
        openDB: vi.fn(async () => ({}) as unknown),
        closeIDB: vi.fn(),
    };
}

export const goAdapterMock = {
    goAdapter: {
        kind: 'go',
        capabilities: () => ({
            ar: true,
            externalApps: true,
            plazaWindow: true,
            fsAccess: false,
            watchDir: true,
            proxyServer: true,
            fileServer: true,
            systemDirOpen: true,
            storageMode: true,
            screenshotSave: true,
            cacheManage: true,
            configPersist: true,
            modelScan: true,
            crossOriginIsolated: true,
            clipboardReliable: true,
            arScope: 'none',
        }),
    },
};
