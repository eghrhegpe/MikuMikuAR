// action-defs.test.ts — action-defs（settings/motion/env）同构注册分支行为测试
// 目标：低洼区 core/action-defs（覆盖率 2.3%）——经 action-registry 全链路验证
// execute 转发正确，为「同构样板抽 helper」重构提供安全网（基线绿 → 重构 → 零回归）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── settings-actions 依赖 mock ──
vi.mock('@/core/wails-bindings', () => ({
    ClearExtractCache: vi.fn(),
    ClearThumbnailCache: vi.fn(),
    ClearAllCaches: vi.fn(),
}));
vi.mock('@/core/feedback', () => ({ feedbackInfo: vi.fn() }));
vi.mock('@/core/ui-action-bridge', () => ({ getUiAction: vi.fn() }));
vi.mock('@/core/i18n/locale', () => ({ setLang: vi.fn() }));

// ── motion-actions 依赖 mock ──
vi.mock('@/core/config', () => ({ triggerAutoSave: vi.fn() }));
vi.mock('@/core/toast', () => ({ showInfoToast: vi.fn() }));
vi.mock('@/core/dialog', () => ({ showConfirm: vi.fn() }));
vi.mock('@/core/playback-state', () => ({ isPlaying: false, setIsPlaying: vi.fn() }));
vi.mock('@/core/scene-state', () => ({ mmdRuntime: null }));
vi.mock('@/core/i18n/t', () => ({ t: vi.fn((k: string) => k) }));
vi.mock('@/core/load-manager', () => ({ loadManager: { load: vi.fn() } }));
vi.mock('@/core/scene-action-bridge', () => ({ getSceneAction: vi.fn() }));

import { getAction, _resetActionRegistry } from '../core/action-registry';
import { registerSettingsActions } from '../core/action-defs/settings-actions';
import { registerMotionActions } from '../core/action-defs/motion-actions';
import { registerEnvActions } from '../core/action-defs/env-actions';
import { getUiAction } from '../core/ui-action-bridge';
import { getSceneAction } from '../core/scene-action-bridge';
import { ClearExtractCache, ClearThumbnailCache, ClearAllCaches } from '../core/wails-bindings';
import { setLang } from '../core/i18n/locale';
import { feedbackInfo } from '../core/feedback';
import { showConfirm } from '../core/dialog';
import { showInfoToast } from '../core/toast';
import { loadManager } from '../core/load-manager';
import { triggerAutoSave } from '../core/config';

beforeEach(() => {
    _resetActionRegistry();
    vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════
// settings — 路径选择器（同构分支）+ 缓存清理 + 语言切换
// ═══════════════════════════════════════════════════════
describe('action-defs/settings', () => {
    it('7 个 override path action 存在且 execute 转发对应 kind', async () => {
        registerSettingsActions();
        const selectOverridePath = vi.fn();
        vi.mocked(getUiAction).mockImplementation((name: string) =>
            name === 'selectOverridePath' ? (selectOverridePath as never) : undefined
        );
        const cases: Array<[string, string]> = [
            ['settings:set:path:pmx', 'pmx'],
            ['settings:set:path:vmd', 'vmd'],
            ['settings:set:path:audio', 'audio'],
            ['settings:set:path:stage', 'stage'],
            ['settings:set:path:environment', 'environment'],
            ['settings:set:path:md_dress', 'md_dress'],
            ['settings:set:path:setting', 'setting'],
        ];
        for (const [id, kind] of cases) {
            const def = getAction(id);
            expect(def, id).toBeTruthy();
            expect(def!.domain).toBe('settings');
            expect(def!.uiOnly).toBe(true);
            await def!.execute({});
            expect(selectOverridePath).toHaveBeenLastCalledWith(kind);
        }
    });

    it('resourceRoot action 转发 selectResourceRoot', async () => {
        registerSettingsActions();
        const selectResourceRoot = vi.fn();
        vi.mocked(getUiAction).mockImplementation((name: string) =>
            name === 'selectResourceRoot' ? (selectResourceRoot as never) : undefined
        );
        await getAction('settings:set:resourceroot')!.execute({});
        expect(selectResourceRoot).toHaveBeenCalled();
    });

    it('3 个缓存清理 action 调用对应 wails 绑定并派发 cache-cleared 事件', async () => {
        registerSettingsActions();
        const eventSpy = vi.fn();
        window.addEventListener('mmar:cache-cleared', eventSpy);
        await getAction('settings:set:clearextractcache')!.execute({});
        await getAction('settings:set:clearthumbnail')!.execute({});
        await getAction('settings:set:clearallcache')!.execute({});
        expect(ClearExtractCache).toHaveBeenCalledTimes(1);
        expect(ClearThumbnailCache).toHaveBeenCalledTimes(1);
        expect(ClearAllCaches).toHaveBeenCalledTimes(1);
        expect(feedbackInfo).toHaveBeenCalledTimes(3);
        expect(eventSpy).toHaveBeenCalledTimes(3);
    });

    it('set-lang action 调用 setLang(code)', async () => {
        registerSettingsActions();
        await getAction('settings:set-lang')!.execute({ code: 'en' });
        expect(setLang).toHaveBeenCalledWith('en');
    });
});

// ═══════════════════════════════════════════════════════
// motion — 模型动作 + retarget（同构分支）
// ═══════════════════════════════════════════════════════
describe('action-defs/motion', () => {
    it('4 个模型动作 action 转发 handleModelAction 且元数据正确', async () => {
        registerMotionActions();
        const handleModelAction = vi.fn();
        vi.mocked(getUiAction).mockImplementation((name: string) =>
            name === 'handleModelAction' ? (handleModelAction as never) : undefined
        );
        const cases: Array<[string, string, boolean]> = [
            ['motion:model:pause', 'pause', false],
            ['motion:model:reset', 'reset', true],
            ['motion:model:pose', 'pose', false],
            ['motion:model:loop', 'loop', false],
        ];
        for (const [id, action, destructive] of cases) {
            const def = getAction(id);
            expect(def, id).toBeTruthy();
            expect(def!.destructive).toBe(destructive);
            await def!.execute({ modelId: 'm-1' });
            expect(handleModelAction).toHaveBeenLastCalledWith(action, 'm-1');
        }
    });

    it('3 个 retarget action 转发 importExternalAnimation(kind)', async () => {
        registerMotionActions();
        const importExternalAnimation = vi.fn();
        vi.mocked(getUiAction).mockImplementation((name: string) =>
            name === 'importExternalAnimation' ? (importExternalAnimation as never) : undefined
        );
        const cases: Array<[string, string]> = [
            ['motion:retarget:mixamo', 'mixamo'],
            ['motion:retarget:vrm', 'vrm'],
            ['motion:retarget:custom', 'custom'],
        ];
        for (const [id, kind] of cases) {
            const def = getAction(id);
            expect(def, id).toBeTruthy();
            expect(def!.uiOnly).toBe(true);
            await def!.execute({});
            expect(importExternalAnimation).toHaveBeenLastCalledWith(kind);
        }
    });

    it('model action 的 entity resolve 经 findSceneModelByName 查场景', async () => {
        registerMotionActions();
        const findSceneModelByName = vi.fn(() => Promise.resolve({ id: 'm-9' }));
        vi.mocked(getSceneAction).mockImplementation((name: string) =>
            name === 'findSceneModelByName' ? (findSceneModelByName as never) : undefined
        );
        const def = getAction('motion:model:pause');
        expect(def!.params?.[0]).toMatchObject({ name: 'modelId', type: 'entity' });
        const resolved = await (def!.params![0] as { resolve?: (n: string) => Promise<unknown> })
            .resolve?.('初音ミク');
        expect(findSceneModelByName).toHaveBeenCalledWith('初音ミク');
        expect(resolved).toEqual({ id: 'm-9' });
    });

    // [audit:round4] 原 mega it 103 行串测 11 个 action，含脆索引（menuGetLevel i===0、
    // menuPush.mock.calls[0][0]、browseCalls[len-1]），中途失败仅报一个 it 定位差。
    // 拆分：共享 mock 装配抽 beforeEach，每 action 独立 it（mock 调用互不污染）。
    let ui: Map<string, ReturnType<typeof vi.fn>>;
    let scene: Map<string, ReturnType<typeof vi.fn>>;
    let menuPush: ReturnType<typeof vi.fn>;
    let menuGetLevel: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        registerMotionActions();
        ui = new Map<string, ReturnType<typeof vi.fn>>();
        scene = new Map<string, ReturnType<typeof vi.fn>>();
        menuPush = vi.fn();
        menuGetLevel = vi.fn((i: number) => (i === 0 ? { items: [] } : undefined));
        ui.set('getMotionMenu', vi.fn(() => ({ push: menuPush, getLevel: menuGetLevel })));
        ui.set('buildBrowseLevel', vi.fn(() => ({ level: 1 })));
        ui.set('getBrowseDir', vi.fn((kind: string) => `/lib/${kind}`));
        ui.set('buildMotionRootItems', vi.fn(() => ['root-a']));
        ui.set('buildActionBindingLevel', vi.fn(() => ({ itemBuilder: () => [], items: ['i'] })));
        ui.set('buildMotionDetailLevel', vi.fn(() => ({ itemBuilder: () => [] })));
        ui.set('resetFocusedLayerId', vi.fn());
        ui.set('refreshMotionRoot', vi.fn());
        scene.set('setLipSyncEnabled', vi.fn());
        scene.set('getLipSyncState', vi.fn(() => ({ enabled: false })));
        scene.set('setProcMotionMode', vi.fn());
        scene.set('regenerateProcMotion', vi.fn());
        scene.set('addSceneMotion', vi.fn());
        scene.set('replaceDefaultMotion', vi.fn());
        scene.set('loadVPDPose', vi.fn());
        scene.set('getAudioName', vi.fn(() => 'bgm.mp3'));
        scene.set('pushUndoSnapshot', vi.fn(() => ({ snap: 1 })));
        scene.set('clearAllSceneMotions', vi.fn());
        scene.set('updatePlaybackUI', vi.fn());
        scene.set('offerSceneUndoAndRefresh', vi.fn());
        vi.mocked(getUiAction).mockImplementation(
            (name: string) => (ui.get(name) ?? undefined) as never
        );
        vi.mocked(getSceneAction).mockImplementation(
            (name: string) => (scene.get(name) ?? undefined) as never
        );
        vi.mocked(showConfirm).mockResolvedValue(true);
    });

    it('motion:lipsync:toggle：enabled=false → setLipSyncEnabled(true)', async () => {
        await getAction('motion:lipsync:toggle')!.execute({});
        expect(scene.get('setLipSyncEnabled')).toHaveBeenCalledWith(true);
    });

    it('motion:clear-all：确认后清空场景并撤销快照', async () => {
        await getAction('motion:clear-all')!.execute({});
        expect(showConfirm).toHaveBeenCalled();
        expect(scene.get('clearAllSceneMotions')).toHaveBeenCalled();
        expect(triggerAutoSave).toHaveBeenCalled();
        expect(scene.get('offerSceneUndoAndRefresh')).toHaveBeenCalled();
    });

    it('motion:procmotion:set-mode：设置模式并重生成', async () => {
        await getAction('motion:procmotion:set-mode')!.execute({ mode: 'dancing' });
        expect(scene.get('setProcMotionMode')).toHaveBeenCalledWith('dancing');
        expect(scene.get('regenerateProcMotion')).toHaveBeenCalled();
    });

    it('motion:load-camera-vmd / load-vpd：转发 loadManager / loadVPDPose', async () => {
        await getAction('motion:load-camera-vmd')!.execute({ path: '/a/c.vmd' });
        expect(loadManager.load).toHaveBeenCalledWith({ kind: 'camera-vmd', path: '/a/c.vmd' });
        await getAction('motion:load-vpd')!.execute({ path: '/a/p.vpd' });
        expect(scene.get('loadVPDPose')).toHaveBeenCalledWith('/a/p.vpd');
    });

    it('motion:add-scene-vmd：带 name 直传', async () => {
        await getAction('motion:add-scene-vmd')!.execute({ path: '/a/m.vmd', name: 'M' });
        expect(scene.get('addSceneMotion')).toHaveBeenCalledWith(
            expect.objectContaining({ vmdPath: '/a/m.vmd', vmdName: 'M', source: 'vmd' })
        );
    });

    it('motion:load-audio：转发 loadManager + toast（名称来自 getAudioName）', async () => {
        await getAction('motion:load-audio')!.execute({ path: '/a/bgm.mp3' });
        expect(loadManager.load).toHaveBeenCalledWith({ kind: 'audio', path: '/a/bgm.mp3' });
        expect(showInfoToast).toHaveBeenCalled();
    });

    it('motion:open-binding：构建层级后推入菜单（itemBuilder 惰性刷新）', async () => {
        await getAction('motion:open-binding')!.execute({ modelId: 'm-1' });
        expect(ui.get('resetFocusedLayerId')).toHaveBeenCalled();
        expect(ui.get('buildActionBindingLevel')).toHaveBeenCalledWith('m-1');
        expect(menuPush).toHaveBeenCalled();
        const bindingLevel = menuPush.mock.calls[0][0] as { itemBuilder?: () => unknown[] };
        bindingLevel.itemBuilder?.(); // 触发惰性 itemBuilder
        expect(ui.get('buildActionBindingLevel')).toHaveBeenCalledTimes(2);
    });

    it('motion:browse-music：目录层级推入菜单', async () => {
        await getAction('motion:browse-music')!.execute({});
        expect(ui.get('getBrowseDir')).toHaveBeenCalledWith('audio');
        expect(ui.get('buildBrowseLevel')).toHaveBeenCalled();
    });

    it('motion:browse-scene-motions：outcome 回调 onVmdPick / onVmdReplace 刷新根菜单', async () => {
        await getAction('motion:browse-scene-motions')!.execute({});
        const browseCalls = ui.get('buildBrowseLevel').mock.calls;
        const browseArg = browseCalls[browseCalls.length - 1][0] as {
            outcome?: { onVmdPick?: (p: string, n: string) => void; onVmdReplace?: (p: string, n: string) => void };
        };
        expect(browseArg.outcome).toBeDefined();
        browseArg.outcome?.onVmdPick?.('/x/1.vmd', '1.vmd');
        expect(scene.get('addSceneMotion')).toHaveBeenLastCalledWith(
            expect.objectContaining({ vmdPath: '/x/1.vmd', vmdName: '1' })
        );
        expect(ui.get('buildMotionRootItems')).toHaveBeenCalled();
        browseArg.outcome?.onVmdReplace?.('/x/2.vmd', '2.vmd');
        expect(scene.get('replaceDefaultMotion')).toHaveBeenCalledWith(
            expect.objectContaining({ vmdPath: '/x/2.vmd', vmdName: '2' })
        );
        expect(menuGetLevel).toHaveBeenCalledWith(0);
    });

    it('motion:open-detail：详情层级推入菜单（itemBuilder 惰性求值）', async () => {
        await getAction('motion:open-detail')!.execute({ sceneMotionId: 'sm-1' });
        expect(ui.get('buildMotionDetailLevel')).toHaveBeenCalledWith('sm-1');
        expect(menuPush).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════
// env — 纹理绑定（同构分支）
// ═══════════════════════════════════════════════════════
describe('action-defs/env', () => {
    it('3 个 bind-texture action 转发 setEnvState 对应键', async () => {
        registerEnvActions();
        const setEnvState = vi.fn();
        vi.mocked(getSceneAction).mockImplementation((name: string) =>
            name === 'setEnvState' ? (setEnvState as never) : undefined
        );
        const cases: Array<[string, string]> = [
            ['env:bind-particle-texture', 'particleCustomTexture'],
            ['env:bind-sky-texture', 'skyTexture'],
            ['env:bind-stars-texture', 'starsTexture'],
        ];
        for (const [id, key] of cases) {
            const def = getAction(id);
            expect(def, id).toBeTruthy();
            expect(def!.uiOnly).toBe(true);
            await def!.execute({ filePath: '/a/b.png' });
            expect(setEnvState).toHaveBeenLastCalledWith({ [key]: '/a/b.png' });
        }
    });
});
