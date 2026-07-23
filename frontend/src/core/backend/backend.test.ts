// [doc:test] ADR-176 / ADR-177 backend 抽象层单测
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

// idb 在 Node/happy-dom 下无 IndexedDB 实现，注入内存 Map 桩隔离浏览器存储依赖。
// 用 Map 使 idbGet/idbSet/idbDelete/idbKeys 可按 store/key 精确配置返回值（ADR-177 Phase 2）。
const _idbStore = new Map<string, unknown>();
vi.mock('./idb', () => ({
    idbGet: vi.fn(async (_store: string, key: string) => _idbStore.get(key)),
    idbSet: vi.fn(async (_store: string, key: string, val: unknown) => {
        _idbStore.set(key, val);
    }),
    idbDelete: vi.fn(async (_store: string, key: string) => {
        _idbStore.delete(key);
    }),
    idbKeys: vi.fn(async (_store: string) => Array.from(_idbStore.keys())),
    closeIDB: vi.fn(),
}));

import { browserAdapter } from './browser-adapter';
import type { UIState, EnvState } from '@bindings/mikumikuar/internal/app/models';
import { isWebPlatform, isAndroidPlatform, guardExternalAction } from '../platform';

// [doc:adr-177] browser-adapter 扩展方法（Partial 签名便利方法，不在统一 BackendService 接口；
// Go 侧用 SetConfig 统一持久化，浏览器侧提供细粒度 GetUIState/SetUIState/SetEnvState）
interface BrowserAdapterExt {
    GetUIState(): Promise<UIState>;
    SetUIState(s: Partial<UIState>): Promise<void>;
    SetEnvState(e: Partial<EnvState>): Promise<void>;
}
const ext = browserAdapter as unknown as BrowserAdapterExt;

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

// [doc:adr-177] Phase 2 A4：path 映射 + 默认值 + Delete* + SetEnvState 单源
describe('ADR-177 Phase 2 A4：browser-adapter 数据链补齐', () => {
    beforeEach(() => {
        _idbStore.clear();
    });

    describe('_resolveIdbKey path 映射（readFileBytes）', () => {
        it('绝对路径 → file:<name>（去扩展名）', async () => {
            const bytes = new Uint8Array([1, 2, 3]);
            _idbStore.set('file:Miku', bytes);
            const r = await browserAdapter.readFileBytes('D:/models/Miku.pmx');
            expect(r).toBe(bytes);
        });

        it('已是 file: 前缀 → 原样查', async () => {
            const bytes = new Uint8Array([4, 5]);
            _idbStore.set('file:foo', bytes);
            const r = await browserAdapter.readFileBytes('file:foo');
            expect(r).toBe(bytes);
        });

        it('entry: / recent: 前缀 → 原样查（元数据）', async () => {
            _idbStore.set('entry:Miku', { name: 'Miku', kind: 'pmx' });
            const r = await browserAdapter.readFileBytes('entry:Miku');
            expect(r).toEqual({ name: 'Miku', kind: 'pmx' });
        });

        it('反斜杠路径 → 提取文件名', async () => {
            const bytes = new Uint8Array([6, 7]);
            _idbStore.set('file:test', bytes);
            const r = await browserAdapter.readFileBytes('C:\\models\\test.zip');
            expect(r).toBe(bytes);
        });

        it('查不到 → 返回 null', async () => {
            const r = await browserAdapter.readFileBytes('D:/nonexistent/ghost.pmx');
            expect(r).toBeNull();
        });

        it('FileExists 经 path 映射', async () => {
            _idbStore.set('file:bar', new Uint8Array([1]));
            expect(await browserAdapter.FileExists('D:/models/bar.pmx')).toBe(true);
            expect(await browserAdapter.FileExists('D:/models/missing.pmx')).toBe(false);
        });
    });

    describe('_defaultConfig / _defaultUIState 默认值', () => {
        it('GetConfig 首次启动返回完整默认值（非 {version:1}）', async () => {
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.config_version).toBe(1);
            expect(cfg.ui_state).toBeDefined();
            expect(cfg.ui_state.scale).toBe(1.0);
            expect(cfg.resource_root).toBe('');
            expect(cfg.storage_mode).toBe('web');
            expect(cfg.override_paths).toBeDefined();
            expect(cfg.override_paths.pmx).toBe('');
        });

        it('GetUIState 首次启动返回完整默认值（非空对象）', async () => {
            const s = await ext.GetUIState();
            expect(s.scale).toBe(1.0);
            expect(s.popupWidth).toBe(280);
            expect(s.accent).toBe('#4a6cf7');
            expect(s.animations).toBe(true);
            expect(s.performanceMode).toBe('balanced');
        });

        it('SetUIState 双写 Config.ui_state + uistate store', async () => {
            await ext.SetUIState({ scale: 1.3 });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.ui_state.scale).toBe(1.3);
            expect(_idbStore.get('state')).toMatchObject({ scale: 1.3 });
        });
    });

    describe('SetEnvState 单源（Config.env）', () => {
        it('写入 Config.env（非 uistate/envState）', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env).toBeDefined();
            expect(cfg.env.skyMode).toBe('sunset');
            // 旧键 uistate/envState 不应存在
            expect(_idbStore.has('envState')).toBe(false);
        });

        it('重复写入合并而非覆盖', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            await ext.SetEnvState({ groundVisible: false });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env.skyMode).toBe('sunset');
            expect(cfg.env.groundVisible).toBe(false);
        });
    });

    describe('Delete*Preset 真实删除', () => {
        it('DeleteEnvPreset 从 presets store 删除', async () => {
            _idbStore.set('env:sunset', new Uint8Array([1]));
            await browserAdapter.DeleteEnvPreset('sunset');
            expect(_idbStore.has('env:sunset')).toBe(false);
        });

        it('DeleteModelPreset 从 presets store 删除', async () => {
            _idbStore.set('model:default', new Uint8Array([2]));
            await browserAdapter.DeleteModelPreset('default');
            expect(_idbStore.has('model:default')).toBe(false);
        });

        it('DeletePresetScene 从 presets store 删除', async () => {
            _idbStore.set('scene:test', new Uint8Array([3]));
            await browserAdapter.DeletePresetScene('test');
            expect(_idbStore.has('scene:test')).toBe(false);
        });
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
