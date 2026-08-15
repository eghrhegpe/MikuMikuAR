// @vitest-environment node
// shortcut-app.test.ts — registerAppShortcuts 的 motion:undo 幽灵路径守卫（fix P2）
//
// 覆盖变更：popUndoSnapshot 有快照但 restoreUndoSnapshot 未注册时，
// 显式 logWarn + 提前 return（不再吞快照、不再静默失败）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const __mocks = vi.hoisted(() => ({
    logWarn: vi.fn(),
    setStatus: vi.fn(),
    getSceneAction: vi.fn(),
    getUiAction: vi.fn(),
    addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
    focusedModelId: { value: '' as string },
    mmdRuntime: null as {
        seekAnimation: ReturnType<typeof vi.fn>;
        animationDuration: number;
        currentTime: number;
    } | null,
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
    addDisposableListener: __mocks.addDisposableListener,
    dom: { btnPlayPause: { click: vi.fn() } },
}));
vi.mock('../core/dispose-helpers', () => ({ safeDispose: vi.fn(() => null) }));
vi.mock('../core/state', () => ({
    get focusedModelId() {
        return __mocks.focusedModelId.value;
    },
}));
vi.mock('../core/scene-action-bridge', () => ({ getSceneAction: __mocks.getSceneAction }));
vi.mock('../core/ui-action-bridge', () => ({ getUiAction: __mocks.getUiAction }));
vi.mock('../core/i18n/t', () => ({ t: (k: string) => k }));

import { registerAppShortcuts } from '../core/shortcut-app';
import {
    getAllShortcuts,
    initShortcutDispatcher,
    registerShortcut,
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
    __mocks.getUiAction.mockReset();
    __mocks.addDisposableListener.mockClear();
    __mocks.focusedModelId.value = '';
    __mocks.mmdRuntime = {
        seekAnimation: vi.fn().mockResolvedValue(undefined),
        animationDuration: 120,
        currentTime: 50,
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('motion:undo 幽灵路径守卫', () => {
    it('registerAppShortcuts 注册了 motion:undo', () => {
        registerAppShortcuts();
        expect(getAllShortcuts().some((s) => s.id === 'motion:undo')).toBe(true);
    });

    it('restoreUndoSnapshot 未注册 → 不弹出快照 + logWarn + return（不抛错）', () => {
        registerAppShortcuts();
        __mocks.focusedModelId.value = ''; // 跳过 motion 级撤销分支
        const pop = vi.fn(() => ({ snap: 1 })); // 有快照可弹
        __mocks.getSceneAction.mockImplementation((key: string) => {
            if (key === 'popUndoSnapshot') return pop;
            if (key === 'restoreUndoSnapshot') return undefined; // 未注册
            return undefined;
        });

        expect(() => undoHandler()).not.toThrow();
        expect(pop).not.toHaveBeenCalled(); // 幽灵路径不再吞快照
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

    it('seek-back: seekAnimation reject → catch 捕获并记录 error，不抛 unhandled rejection', async () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.seekAnimation.mockRejectedValueOnce(new Error('seek failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => seekHandler('playback:seek-back')).not.toThrow();
        await vi.waitFor(() => {
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('[shortcut-app] seek-backward failed:'),
                expect.any(Error)
            );
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

    it('seek-forward: seekAnimation reject → catch 捕获并记录 error，不抛 unhandled rejection', async () => {
        registerAppShortcuts();
        setupFocusedModel();
        __mocks.mmdRuntime!.seekAnimation.mockRejectedValueOnce(new Error('seek failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => seekHandler('playback:seek-forward')).not.toThrow();
        await vi.waitFor(() => {
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('[shortcut-app] seek-forward failed:'),
                expect.any(Error)
            );
        });
    });
});

describe('registerAppShortcuts 重复注册/清理', () => {
    it('重复调用不产生重复 id，且仍只保留一份定义', () => {
        registerAppShortcuts();
        const first = getAllShortcuts()
            .map((s) => s.id)
            .sort();
        registerAppShortcuts();
        const second = getAllShortcuts()
            .map((s) => s.id)
            .sort();

        expect(second).toEqual(first);
        expect(new Set(second).size).toBe(second.length);
    });

    it('_resetShortcutRegistry 可重复调用且清空全部注册', () => {
        registerAppShortcuts();
        _resetShortcutRegistry();
        expect(getAllShortcuts()).toHaveLength(0);

        expect(() => _resetShortcutRegistry()).not.toThrow();
        expect(getAllShortcuts()).toHaveLength(0);
    });
});

describe('ui-action 缺失依赖降级', () => {
    it('screenshot:current 在 closeAllOverlays 缺失时仍可截图', () => {
        registerAppShortcuts();
        const screenshot = vi.fn();
        __mocks.getUiAction.mockImplementation((key: string) =>
            key === 'screenshotCurrent' ? screenshot : undefined
        );

        const def = getAllShortcuts().find((s) => s.id === 'screenshot:current');
        expect(def).toBeDefined();
        expect(() => def!.handler()).not.toThrow();
        expect(screenshot).toHaveBeenCalled();
    });

    it('global:close 在 screenshotCurrent 缺失时仍可关闭 overlay', () => {
        registerAppShortcuts();
        const close = vi.fn();
        const removeClass = vi.fn();
        __mocks.getUiAction.mockImplementation((key: string) =>
            key === 'closeAllOverlays' ? close : undefined
        );
        vi.stubGlobal('document', { body: { classList: { remove: removeClass } } });

        const def = getAllShortcuts().find((s) => s.id === 'global:close');
        expect(def).toBeDefined();
        expect(() => def!.handler()).not.toThrow();
        expect(close).toHaveBeenCalled();
        expect(removeClass).toHaveBeenCalledWith('ui-hidden');
    });
});

describe('shortcut-registry handler 抛错隔离', () => {
    function dispatcherListener(): (e: unknown) => void {
        const call = __mocks.addDisposableListener.mock.calls.at(-1) as unknown[] | undefined;
        if (!call) {
            throw new Error('initShortcutDispatcher 未调用 addDisposableListener');
        }
        return call[2] as (e: unknown) => void;
    }

    it('同步 throw 被 logWarn 捕获，不冒泡到 keydown listener', () => {
        const handler = vi.fn(() => {
            throw new Error('sync boom');
        });
        registerShortcut({
            id: 'test:throw',
            label: 'x',
            defaultKey: 'KeyX',
            handler,
            group: 'g',
        });
        vi.stubGlobal('window', {});
        initShortcutDispatcher();

        const listener = dispatcherListener();
        expect(() =>
            listener({
                code: 'KeyX',
                ctrlKey: false,
                shiftKey: false,
                altKey: false,
                target: null,
                preventDefault: vi.fn(),
            })
        ).not.toThrow();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(__mocks.logWarn).toHaveBeenCalledWith(
            'shortcut-registry',
            expect.stringContaining('"test:throw" handler threw'),
            expect.any(Error)
        );
    });

    it('rejected promise 被 catch 记录，不产生 unhandled rejection', async () => {
        const handler = vi.fn(() => Promise.reject(new Error('async boom')));
        registerShortcut({
            id: 'test:reject',
            label: 'x',
            defaultKey: 'KeyX',
            handler,
            group: 'g',
        });
        vi.stubGlobal('window', {});
        initShortcutDispatcher();

        const listener = dispatcherListener();
        listener({
            code: 'KeyX',
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            target: null,
            preventDefault: vi.fn(),
        });
        await vi.waitFor(() => {
            expect(__mocks.logWarn).toHaveBeenCalledWith(
                'shortcut-registry',
                expect.stringContaining('"test:reject" handler failed'),
                expect.any(Error)
            );
        });
    });
});
