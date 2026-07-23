// [doc:test] ADR-176 backend 抽象层单测
import { describe, it, expect, beforeEach, vi } from 'vitest';

// go-adapter 依赖 @bindings 运行时（Wails），测试中隔离为纯桩。
vi.mock('./go-adapter', () => ({
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
        }),
    },
}));

// idb 在 Node/happy-dom 下无 IndexedDB 实现，注入内存桩隔离浏览器存储依赖。
vi.mock('./idb', () => ({
    idbGet: async () => undefined,
    idbSet: async () => undefined,
    idbDelete: async () => undefined,
    idbKeys: async () => [],
    closeIDB: () => undefined,
}));

import { browserAdapter } from './browser-adapter';
import { isWebPlatform, isAndroidPlatform, guardExternalAction } from '../platform';

function setWindow(w: unknown): void {
    (globalThis as { window?: unknown }).window = w;
}
function clearWebFlag(): void {
    (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = false;
}

describe('browserAdapter 能力矩阵', () => {
    it('ar / externalApps / plazaWindow 等原生独占为 false', () => {
        const c = browserAdapter.capabilities();
        expect(c.ar).toBe(false);
        expect(c.externalApps).toBe(false);
        expect(c.plazaWindow).toBe(false);
        expect(c.watchDir).toBe(false);
        expect(c.proxyServer).toBe(false);
    });
    it('浏览器可真实能力为 true', () => {
        const c = browserAdapter.capabilities();
        expect(c.screenshotSave).toBe(true);
        expect(c.cacheManage).toBe(true);
        expect(c.configPersist).toBe(true);
    });
    it('readFileBytes 返回 Uint8Array | null 契约', async () => {
        const r = await browserAdapter.readFileBytes('nope');
        expect(r).toBeNull();
    });
});

describe('③ 原生独占降级契约', () => {
    const blocked = [
        'AddCustomSoftware',
        'ClosePlazaWindow',
        'DownloadFromPlaza',
        'LaunchSoftware',
        'OpenCacheDir',
        'StartProxy',
        'StopProxy',
    ] as const;
    for (const name of blocked) {
        it(`${name} 抛 NotSupportedError`, async () => {
            // @ts-expect-error 动态调用 BackendService 方法
            await expect(browserAdapter[name]()).rejects.toThrow(/浏览器环境下不可用/);
        });
    }
});

describe('guardExternalAction 三态', () => {
    beforeEach(() => {
        setWindow(undefined);
        clearWebFlag();
    });
    it('desktop 放行', () => {
        setWindow({ wails: { platform: () => 'desktop' } });
        expect(guardExternalAction('blender')).toBe(true);
    });
    it('android 拦截', () => {
        setWindow({ wails: { platform: () => 'android' } });
        expect(isAndroidPlatform()).toBe(true);
        expect(guardExternalAction('blender')).toBe(false);
    });
    it('web 拦截', () => {
        setWindow({}); // 无 wails 桥
        expect(isWebPlatform()).toBe(true);
        expect(guardExternalAction('blender')).toBe(false);
    });
});

describe('resolveBackend 三路径（异步选型，Android 冷启动竞态防护）', () => {
    beforeEach(() => {
        setWindow(undefined);
        clearWebFlag();
        vi.useRealTimers();
    });

    it('Web 入口短路 → browserAdapter', async () => {
        vi.resetModules();
        (globalThis as { __MMKU_WEB__?: boolean }).__MMKU_WEB__ = true;
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('browser');
    });

    it('window.wails 存在 → goAdapter', async () => {
        vi.resetModules();
        setWindow({ wails: { platform: () => 'desktop' } });
        const { resolveBackend } = await import('./index');
        const b = await resolveBackend();
        expect(b.kind).toBe('go');
    });

    it('无 wails 且非 web → awaitWailsBridge 超时后回退 browserAdapter', async () => {
        vi.resetModules();
        setWindow({}); // 无 wails
        vi.useFakeTimers();
        const { resolveBackend } = await import('./index');
        const p = resolveBackend();
        vi.advanceTimersByTime(3100);
        const b = await p;
        vi.useRealTimers();
        expect(b.kind).toBe('browser');
    });
});
