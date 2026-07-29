// fixtures/backend.ts — 统一 Wails 绑定桩（ADR-204 P2）
// 场景级组装工厂：替代各测试文件里重复手拼的 resolveBackend 桩。
// 约束（ADR-204 §四）：只做无逻辑组装，不含断言、不含分支。
//
// 用法：
//   vi.mock('../../core/backend', async () => ({
//       resolveBackend: () => Promise.resolve(makeMockBackend({ SetEnvState: mySpy })),
//   }));

import { vi } from 'vitest';
import type { BackendCapabilities } from '../../core/backend/types';

/** 全关能力矩阵（按需用 overrides 打开单项）。 */
export function makeMockCapabilities(
    overrides: Partial<BackendCapabilities> = {}
): BackendCapabilities {
    return {
        ar: false,
        externalApps: false,
        plazaWindow: false,
        fsAccess: false,
        watchDir: false,
        proxyServer: false,
        fileServer: false,
        systemDirOpen: false,
        storageMode: false,
        screenshotSave: false,
        cacheManage: false,
        configPersist: false,
        modelScan: false,
        crossOriginIsolated: false,
        clipboardReliable: false,
        arScope: 'none',
        ktx2Supported: false,
        ktx2PreferredFormat: null,
        installApk: false,
        installLocal: false,
        inAppBrowser: false,
        fsSelectDir: false,
        localStaging: false,
        androidStorageMode: false,
        ...overrides,
    };
}

/**
 * 最小 BackendService 桩：常用方法默认 resolved vi.fn()，
 * 其余方法按需通过 overrides 注入（键名与 Go 绑定一致）。
 */
export function makeMockBackend(overrides: Record<string, unknown> = {}) {
    return {
        kind: 'go' as const,
        capabilities: vi.fn(() => makeMockCapabilities()),
        readFileBytes: vi.fn().mockResolvedValue(null),
        SetEnvState: vi.fn().mockResolvedValue(undefined),
        SetUIState: vi.fn().mockResolvedValue(undefined),
        GetConfig: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}
