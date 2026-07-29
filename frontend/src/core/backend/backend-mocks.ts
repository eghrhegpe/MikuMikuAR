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
