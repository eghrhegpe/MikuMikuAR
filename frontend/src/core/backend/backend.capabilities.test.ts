// [doc:test] ADR-176 backend 能力矩阵 + 降级契约（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setWindow, clearWebFlag } from './backend-mocks';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));

import { browserAdapter } from './browser-adapter';
import { isWebPlatform, isAndroidPlatform, guardExternalAction } from '../platform';

// setWindow 会把全局 window 换成桩对象，no-isolate 单 worker 下 window 跨文件共享，
// 必须 afterEach 恢复，否则污染其后收集期（ADR-219 治理）。
const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
    if (realWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
    } else {
        (globalThis as { window?: unknown }).window = realWindow;
    }
});

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
    it('[adr-190] 安装/更新能力键：浏览器侧固定 false（fsSelectDir 跟随 fsAccess）', () => {
        const c = browserAdapter.capabilities();
        expect(c.installApk).toBe(false);
        expect(c.installLocal).toBe(false);
        expect(c.inAppBrowser).toBe(false);
        expect(c.localStaging).toBe(false);
        expect(c.androidStorageMode).toBe(false);
        expect(c.fsSelectDir).toBe(c.fsAccess);
    });
    it('readFileBytes 返回 Uint8Array | null 契约', async () => {
        const r = await browserAdapter.readFileBytes('nope');
        expect(r).toBeNull();
    });
    it('[adr-178] 宿主运行时键：crossOriginIsolated / clipboardReliable / arScope 读运行时自报', () => {
        // 与 browser-adapter `_cap()` 运行时判定完全对齐（不硬编码环境假设）。
        const c = browserAdapter.capabilities();
        const crossOriginIsolatedAtRuntime =
            typeof window !== 'undefined' &&
            (window as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
        const clipboardReliableAtRuntime =
            typeof navigator !== 'undefined' && !!navigator.clipboard;
        const arScopeAtRuntime =
            typeof navigator !== 'undefined' && 'xr' in navigator ? 'webxr' : 'none';
        expect(c.crossOriginIsolated).toBe(crossOriginIsolatedAtRuntime);
        expect(c.clipboardReliable).toBe(clipboardReliableAtRuntime);
        expect(c.arScope).toBe(arScopeAtRuntime);
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
