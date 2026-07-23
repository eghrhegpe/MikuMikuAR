// [doc:architecture] Go 后端适配器 — ADR-176
//
// 透传 Wails v3 生成的 @bindings 全量（含契约测试 139 函数）。
// 保留 wails-bindings 的 base64 解码（readFileBytes 替换原生 ReadFileBytes）。
// capabilities() 全开；Wails 生成物由 `wails3 generate bindings -ts` 维护，此处仅消费。

import * as goApp from '@bindings/mikumikuar/internal/app/app';
import type { BackendService, BackendCapabilities } from './types';

function _decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

export const goAdapter: BackendService = {
    ...goApp,
    kind: 'go',
    readFileBytes: async (path: string) => {
        const b64 = await goApp.ReadFileBytes(path);
        return b64 ? _decodeBase64(b64) : null;
    },
    capabilities: (): BackendCapabilities => ({
        ar: true,
        externalApps: true,
        plazaWindow: true,
        fsAccess: false, // 原生对话框，非 FSA
        watchDir: true,
        proxyServer: true,
        fileServer: true,
        systemDirOpen: true,
        storageMode: true,
        screenshotSave: true,
        cacheManage: true,
        configPersist: true,
        modelScan: true,
    }),
} as unknown as BackendService;
