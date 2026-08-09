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
