// @vitest-environment node
// shortcut-app.test.ts — registerAppShortcuts 的 motion:undo 幽灵路径守卫（fix P2）
//
// 覆盖变更：popUndoSnapshot 有快照但 restoreUndoSnapshot 未注册时，
// 显式 logWarn + 提前 return（不再吞快照、不再静默失败）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const __mocks = vi.hoisted(() => ({
    logWarn: vi.fn(),
    setStatus: vi.fn(),
    getSceneAction: vi.fn(),
    focusedModelId: { value: '' as string },
    mmdRuntime: null as { seekAnimation: ReturnType<typeof vi.fn>; animationDuration: number; currentTime: number } | null,
}));

vi.mock('../core/logger', () => ({ logWarn: __mocks.logWarn }));
vi.mock('../core/config', () => ({
    dom: { btnPlayPause: { click: vi.fn() } },
    get mmdRuntime() {
        return __mocks.mmdRuntime;
    },
    setStatus: __mocks.setStatus,
}));
vi.mock('../core/dom', () => ({
    addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
    dom: { btnPlayPause: { click: vi.fn() } },
}));
vi.mock('../core/dispose-helpers', () => ({ safeDispose: vi.fn((x: unknown) => x) }));
vi.mock('../core/state', () => ({
    get focusedModelId() {
        return __mocks.focusedModelId.value;
    },
}));
vi.mock('../core/scene-action-bridge', () => ({ getSceneAction: __mocks.getSceneAction }));
vi.mock('../core/i18n/t', () => ({ t: (k: string) => k }));

import { registerAppShortcuts } from '../core/shortcut-app';
import {
    getAllShortcuts,
    _resetShortcutRegistry,
} from '../core/shortcut-registry';

function undoHandler() {
    const def = getAllShortcuts().find((s) => s.id === 'motion:undo');
    if (!def) throw new Error('motion:undo 未注册');
    return def.handler();
}

function seekHandler(id: 'playback:seek-back' | 'playback:seek-forward') {
    const def = getAllShortcuts().find((s) => s.id === id);
    if (!def) throw new Error(`${id} 未注册`);
    return def.handler();
}

beforeEach(() => {
    _resetShortcutRegistry();
    __mocks.logWarn.mockClear();
    __mocks.setStatus.mockClear();
    __mocks.getSceneAction.mockReset();
    __mocks.focusedModelId.value = '';
    __mocks.mmdRuntime = {
        seekAnimation: vi.fn().mockResolvedValue(undefined),
        animationDuration: 120,
        currentTime: 50,
    };
});

describe('motion:undo 幽灵路径守卫', () => {
    it('registerAppShortcuts 注册了 motion:undo', () => {
        registerAppShortcuts();
        expect(getAllShortcuts().some((s) => s.id === 'motion:undo')).toBe(true);
    });

    it('popUndoSnapshot 有快照但 restoreUndoSnapshot 未注册 → logWarn + return（不抛错）', () => {
        registerAppShortcuts();
        __mocks.focusedModelId.value = ''; // 跳过 motion 级撤销分支
        __mocks.getSceneAction.mockImplementation((key: string) => {
            if (key === 'popUndoSnapshot') return () => ({ snap: 1 }); // 有快照
            if (key === 'restoreUndoSnapshot') return undefined; // 未注册
            return undefined;
        });

        expect(() => undoHandler()).not.toThrow();
        expect(__mocks.logWarn).toHaveBeenCalledWith(
            'undo',
            expect.stringContaining('restoreUndoSnapshot 未注册')
        );
        expect(__mocks.setStatus).not.toHaveBeenCalled();
    });

    it('restoreUndoSnapshot 已注册 → 调用 restore(snap) 且成功时 setStatus', async () => {
        registerAppShortcuts();
        const restore = vi.fn(() => Promise.resolve(true));
        __mocks.focusedModelId.value = '';
        const snap = { snap: 2 };
        __mocks.getSceneAction.mockImplementation((key: string) => {
            if (key === 'popUndoSnapshot') return () => snap;
            if (key === 'restoreUndoSnapshot') return restore;
            return undefined;
        });

        undoHandler();
        // 等待 void restore(snap).then(...) 微任务
        await Promise.resolve();
        await Promise.resolve();

        expect(restore).toHaveBeenCalledWith(snap);
        expect(__mocks.setStatus).toHaveBeenCalledWith('scene.undoApplied', true);
    });

    it('restoreUndoSnapshot 返回 false → 不 setStatus（覆盖 .then 否定分支）', async () => {
        registerAppShortcuts();
        const restore = vi.fn(() => Promise.resolve(false));
        __mocks.focusedModelId.value = '';
        const snap = { snap: 3 };
        __mocks.getSceneAction.mockImplementation((key: string) => {
            if (key === 'popUndoSnapshot') return () => snap;
            if (key === 'restoreUndoSnapshot') return restore;
            return undefined;
        });

        undoHandler();
        await Promise.resolve();
        await Promise.resolve();

        expect(restore).toHaveBeenCalledWith(snap);
        expect(__mocks.setStatus).not.toHaveBeenCalled();
    });
});

describe('seek-backward/forward .catch 守卫', () => {
    function setupFocusedModel(duration = 120) {
        __mocks.getSceneAction.mockImplementation((key: string) => {
            if (key === 'focusedModel') return () => ({ animationDuration: duration });
            if (key === 'updatePlaybackUI') return vi.fn();
            return undefined;
        });
    }

    it('seek-back: no-op when mmdRuntime is null', () => {
        registerAppShortcuts();
        __mocks.mmdRuntime = null;
        expect(() => seekHandler('playback:seek-back')).not.toThrow();
    });

    it('seek-back: no-op when focusedModel is missing', () => {
        registerAppShortcuts();
        __mocks.getSceneAction.mockReturnValue(undefined);
        expect(() => seekHandler('playback:seek-back')).not.toThrow();
        expect(__mocks.mmdRuntime!.seekAnimation).not.toHaveBeenCalled();
    });

    it('seek-back: no-op when duration <= 0', () => {
        registerAppShortcuts();
        setupFocusedModel(0);
        expect(() => seekHandler('playback:seek-back')).not.toThrow();
        expect(__mocks.mmdRuntime!.seekAnimation).not.toHaveBeenCalled();
    });

    it('seek-back: normal path calls seekAnimation with clamped time', () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.currentTime = 50;
        seekHandler('playback:seek-back');
        // max(0, 50 - 5) = 45
        expect(__mocks.mmdRuntime!.seekAnimation).toHaveBeenCalledWith(45, true);
    });

    it('seek-back: seekAnimation reject → catch 捕获，不抛 unhandled rejection', async () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.seekAnimation.mockRejectedValueOnce(new Error('seek failed'));

        expect(() => seekHandler('playback:seek-back')).not.toThrow();
        await vi.waitFor(() => {
            expect(__mocks.mmdRuntime!.seekAnimation).toHaveBeenCalled();
        });
    });

    it('seek-forward: no-op when mmdRuntime is null', () => {
        registerAppShortcuts();
        __mocks.mmdRuntime = null;
        expect(() => seekHandler('playback:seek-forward')).not.toThrow();
    });

    it('seek-forward: no-op when focusedModel is missing', () => {
        registerAppShortcuts();
        __mocks.getSceneAction.mockReturnValue(undefined);
        expect(() => seekHandler('playback:seek-forward')).not.toThrow();
        expect(__mocks.mmdRuntime!.seekAnimation).not.toHaveBeenCalled();
    });

    it('seek-forward: no-op when duration <= 0', () => {
        registerAppShortcuts();
        setupFocusedModel(0);
        expect(() => seekHandler('playback:seek-forward')).not.toThrow();
        expect(__mocks.mmdRuntime!.seekAnimation).not.toHaveBeenCalled();
    });

    it('seek-forward: normal path calls seekAnimation with clamped time', () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.currentTime = 50;
        seekHandler('playback:seek-forward');
        // min(120, 50 + 5) = 55
        expect(__mocks.mmdRuntime!.seekAnimation).toHaveBeenCalledWith(55, true);
    });

    it('seek-forward: seekAnimation reject → catch 捕获，不抛 unhandled rejection', async () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.seekAnimation.mockRejectedValueOnce(new Error('seek failed'));

        expect(() => seekHandler('playback:seek-forward')).not.toThrow();
        await vi.waitFor(() => {
            expect(__mocks.mmdRuntime!.seekAnimation).toHaveBeenCalled();
        });
    });
});
