// [doc:test] ADR-177 Phase 2 A4 数据链补齐（拆自 backend.test.ts）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { idbStore, resetIdb } from './backend-mocks';

vi.mock('./go-adapter', () => ({ goAdapter: {} }));
vi.mock('./idb', () => ({
    idbGet: vi.fn(async (_store: string, key: string) => idbStore.get(key)),
    idbSet: vi.fn(async (_store: string, key: string, val: unknown) => { idbStore.set(key, val); }),
    idbDelete: vi.fn(async (_store: string, key: string) => { idbStore.delete(key); }),
    idbKeys: vi.fn(async (_store: string) => Array.from(idbStore.keys())),
    closeIDB: vi.fn(),
}));

import { browserAdapter } from './browser-adapter';
import type { UIState, EnvState } from '@bindings/mikumikuar/internal/app/models';

// [doc:adr-177] browser-adapter 扩展方法（Partial 签名便利方法）
interface BrowserAdapterExt {
    GetUIState(): Promise<UIState>;
    SetUIState(s: Partial<UIState>): Promise<void>;
    SetEnvState(e: Partial<EnvState>): Promise<void>;
}
const ext = browserAdapter as unknown as BrowserAdapterExt;

// [doc:adr-177] Phase 2 A4：path 映射 + 默认值 + Delete* + SetEnvState 单源
describe('ADR-177 Phase 2 A4：browser-adapter 数据链补齐', () => {
    beforeEach(() => {
        resetIdb();
    });

    describe('_resolveIdbKey path 映射（readFileBytes）', () => {
        it('绝对路径 → file:<name>（去扩展名）', async () => {
            const bytes = new Uint8Array([1, 2, 3]);
            idbStore.set('file:Miku', bytes);
            const r = await browserAdapter.readFileBytes('D:/models/Miku.pmx');
            expect(r).toBe(bytes);
        });

        it('已是 file: 前缀 → 原样查', async () => {
            const bytes = new Uint8Array([4, 5]);
            idbStore.set('file:foo', bytes);
            const r = await browserAdapter.readFileBytes('file:foo');
            expect(r).toBe(bytes);
        });

        it('entry: / recent: 前缀 → 原样查（元数据）', async () => {
            idbStore.set('entry:Miku', { name: 'Miku', kind: 'pmx' });
            const r = await browserAdapter.readFileBytes('entry:Miku');
            expect(r).toEqual({ name: 'Miku', kind: 'pmx' });
        });

        it('反斜杠路径 → 提取文件名', async () => {
            const bytes = new Uint8Array([6, 7]);
            idbStore.set('file:test', bytes);
            const r = await browserAdapter.readFileBytes('C:\\models\\test.zip');
            expect(r).toBe(bytes);
        });

        it('查不到 → 返回 null', async () => {
            const r = await browserAdapter.readFileBytes('D:/nonexistent/ghost.pmx');
            expect(r).toBeNull();
        });

        it('web://selected-dir/ 路径 → 剥离类别段后 file:<relIdStem>', async () => {
            const bytes = new Uint8Array([8, 8]);
            idbStore.set('file:分类1/miku', bytes);
            const r = await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx');
            expect(r).toBe(bytes);
        });

        it('web://selected-dir/ 深层同名 → 各层 key 不冲突', async () => {
            const b1 = new Uint8Array([1, 1]);
            const b2 = new Uint8Array([2, 2]);
            idbStore.set('file:分类1/miku', b1);
            idbStore.set('file:分类1/sub/miku', b2);
            expect(
                await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/miku.pmx')
            ).toBe(b1);
            expect(
                await browserAdapter.readFileBytes('web://selected-dir/PMX/分类1/sub/miku.pmx')
            ).toBe(b2);
        });

        it('FileExists 经 path 映射', async () => {
            idbStore.set('file:bar', new Uint8Array([1]));
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
            expect(idbStore.get('state')).toMatchObject({ scale: 1.3 });
        });
    });

    describe('SetEnvState 单源（Config.env）', () => {
        it('写入 Config.env（非 uistate/envState）', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env).toBeDefined();
            expect(cfg.env.skyMode).toBe('sunset');
            // 旧键 uistate/envState 不应存在
            expect(idbStore.has('envState')).toBe(false);
        });

        it('重复写入合并而非覆盖', async () => {
            await ext.SetEnvState({ skyMode: 'sunset' });
            await ext.SetEnvState({ groundVisibleEnabled: false });
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.env.skyMode).toBe('sunset');
            expect(cfg.env.groundVisibleEnabled).toBe(false);
        });
    });

    // [bugfix:web-config-not-persisted] 细粒度 setter 写入路径必须能被
    // 恢复侧 GetConfig()/GetUIState() 读回（round-trip），防止写读路径脱节回归。
    describe('细粒度 setter → Config round-trip（对齐恢复侧读取路径）', () => {
        it('SetUIAccent/Scale/Font 等写入 ui_state，GetUIState 可读回', async () => {
            await browserAdapter.SetUIAccent('#ff0000');
            await browserAdapter.SetUIScale(1.5);
            await browserAdapter.SetUIFontFamily('noto');
            await browserAdapter.SetUIPopupWidth(320);
            await browserAdapter.SetUIAnimations(false);
            await browserAdapter.SetUIBlurBg(false);
            await browserAdapter.SetUIAutoUpdate(true);
            const s = await ext.GetUIState();
            expect(s.accent).toBe('#ff0000');
            expect(s.scale).toBe(1.5);
            expect(s.fontFamily).toBe('noto');
            expect(s.popupWidth).toBe(320);
            expect(s.animations).toBe(false);
            expect(s.blurBg).toBe(false);
            expect(s.autoUpdateEnabled).toBe(true);
        });

        it('SetPerformanceMode(string) 写入 ui_state.performanceMode', async () => {
            await browserAdapter.SetPerformanceMode('performance');
            const s = await ext.GetUIState();
            expect(s.performanceMode).toBe('performance');
        });

        it('SetBlenderPath/SetMMDPath/SetDisplayNamePriority 写入 Config 顶层字段', async () => {
            await browserAdapter.SetBlenderPath('C:/blender.exe');
            await browserAdapter.SetMMDPath('C:/mmd.exe');
            await browserAdapter.SetDisplayNamePriority('name_en');
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.blender_path).toBe('C:/blender.exe');
            expect(cfg.mmd_path).toBe('C:/mmd.exe');
            expect(cfg.display_name_priority).toBe('name_en');
        });

        it('SetOverridePath(category, path) 双参写入 override_paths[category]', async () => {
            await browserAdapter.SetOverridePath('pmx', 'D:/models');
            await browserAdapter.SetOverridePath('vmd', 'D:/motions');
            const cfg = await browserAdapter.GetConfig();
            expect(cfg.override_paths.pmx).toBe('D:/models');
            expect(cfg.override_paths.vmd).toBe('D:/motions');
        });
    });

    describe('Delete*Preset 真实删除', () => {
        it('DeleteEnvPreset 从 presets store 删除', async () => {
            idbStore.set('env:sunset', new Uint8Array([1]));
            await browserAdapter.DeleteEnvPreset('sunset');
            expect(idbStore.has('env:sunset')).toBe(false);
        });

        it('DeleteModelPreset 从 presets store 删除', async () => {
            idbStore.set('model:default', new Uint8Array([2]));
            await browserAdapter.DeleteModelPreset('default');
            expect(idbStore.has('model:default')).toBe(false);
        });

        it('DeletePresetScene 从 presets store 删除', async () => {
            idbStore.set('scene:test', new Uint8Array([3]));
            await browserAdapter.DeletePresetScene('test');
            expect(idbStore.has('scene:test')).toBe(false);
        });
    });
});
