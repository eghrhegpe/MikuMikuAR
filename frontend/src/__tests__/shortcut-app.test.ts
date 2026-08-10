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
}));

vi.mock('../core/logger', () => ({ logWarn: __mocks.logWarn }));
vi.mock('../core/config', () => ({
    dom: { btnPlayPause: { click: vi.fn() } },
    mmdRuntime: undefined,
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

beforeEach(() => {
    _resetShortcutRegistry();
    __mocks.logWarn.mockClear();
    __mocks.setStatus.mockClear();
    __mocks.getSceneAction.mockReset();
    __mocks.focusedModelId.value = '';
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
