// transform-mode.test.ts — 拖拽开关状态机（localStorage 持久化 + 早退守卫 + 全局刷新调度）
// 目标：transform-mode.ts 覆盖率 37.5% → ~90%。模块级状态无 reset API，
// 用 vi.resetModules + 动态 import 隔离模块加载期 localStorage 读取。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    scheduleRefresh: vi.fn(),
}));

vi.mock('@/core/reactivity', () => ({ scheduleRefresh: mocks.scheduleRefresh }));

const STORAGE_KEY = 'miku.dragModeEnabled';
type ModeModule = typeof import('./transform-mode');

/** 重新加载模块（重置模块级 _dragModeEnabled，模拟冷启动读取 localStorage）。 */
async function reload(): Promise<ModeModule> {
    vi.resetModules();
    return import('./transform-mode');
}

describe('transform-mode（拖拽开关状态机）', () => {
    let mod: ModeModule;

    beforeEach(async () => {
        localStorage.clear();
        mocks.scheduleRefresh.mockClear();
        mod = await reload();
    });

    it('无存储时初始为关闭', () => {
        expect(mod.isDragModeEnabled()).toBe(false);
    });

    it('存储为 1 时初始为开启（持久化恢复）', async () => {
        localStorage.setItem(STORAGE_KEY, '1');
        const fresh = await reload();
        expect(fresh.isDragModeEnabled()).toBe(true);
    });

    it('setDragModeEnabled(true) 翻转、写存储并触发全局刷新', () => {
        mod.setDragModeEnabled(true);
        expect(mod.isDragModeEnabled()).toBe(true);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
        expect(mocks.scheduleRefresh).toHaveBeenCalledTimes(1);
    });

    it('setDragModeEnabled(false) 写入 0', () => {
        mod.setDragModeEnabled(true);
        mocks.scheduleRefresh.mockClear();
        mod.setDragModeEnabled(false);
        expect(mod.isDragModeEnabled()).toBe(false);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
        expect(mocks.scheduleRefresh).toHaveBeenCalledTimes(1);
    });

    it('同值重复设置早退：不写存储、不触发刷新', () => {
        mod.setDragModeEnabled(true);
        mocks.scheduleRefresh.mockClear();
        mod.setDragModeEnabled(true);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
        expect(mocks.scheduleRefresh).not.toHaveBeenCalled();
    });

    it('开启后重新加载模块，状态从存储恢复', async () => {
        mod.setDragModeEnabled(true);
        const fresh = await reload();
        expect(fresh.isDragModeEnabled()).toBe(true);
    });
});
