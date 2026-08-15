import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PopupRow } from '../../core/config';
import { dom } from '../../core/config';
import { registerPopupMenu } from '../../menus/menu-factory';
import { getOpenMenus } from '../../menus/menu';
import { disposeMenuWrapper } from '../../menus/menu-overlay';
import { makeTestLevel } from '../fixtures/menu';

// ─── registerPopupMenu 生命周期测试：注册、显示、刷新、关闭 ───

describe('registerPopupMenu — 生命周期', () => {
    let sceneOverlay: HTMLElement;

    beforeEach(() => {
        // 确保 dom.sceneOverlay 存在（registerPopupMenu 依赖）
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        document.body.appendChild(sceneOverlay);
        (dom as any).sceneOverlay = sceneOverlay;
    });

    afterEach(() => {
        // 每个用例都可能创建/复用菜单，统一释放存活实例和 wrapper 注册表，避免跨用例泄漏。
        for (const m of getOpenMenus()) {
            m.dispose();
        }
        disposeMenuWrapper('test-menu');
        sceneOverlay.remove();
        (dom as any).sceneOverlay = null;
    });

    it('getMenu 初始返回 null', () => {
        const { getMenu } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        expect(getMenu()).toBeNull();
    });

    it('show 创建菜单实例', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        // 等待 requestAnimationFrame（buildPanel 异步）
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(getMenu()).not.toBeNull();
        expect(getMenu()?.levelCount).toBe(1);
    });

    it('show 多次调用不重复创建菜单', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const firstMenu = getMenu();

        show(); // 再次调用
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const secondMenu = getMenu();

        expect(secondMenu).toBe(firstMenu); // 同一实例
    });

    it('show 多次调用时重置到根层级', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {
                onFolderEnter: () => makeTestLevel('子级'),
            },
        });
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));

        // 推入子层级
        getMenu()?.push(makeTestLevel('子级'));
        expect(getMenu()?.levelCount).toBe(2);

        // 再次 show 应重置到根
        show();
        expect(getMenu()?.levelCount).toBe(1);
        expect(getMenu()?.currentLevel?.label).toBe('根');
    });

    it('refreshRoot 更新根级 items', async () => {
        let rootItems: PopupRow[] = [{ kind: 'action', label: 'A', icon: 'i', target: 'a' }];
        const { getMenu, show, refreshRoot } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => ({
                label: '根',
                dir: '',
                items: rootItems,
            }),
            buildRootItems: () => rootItems,
            handlers: {},
        });
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(getMenu()?.currentLevel?.items.length).toBe(1);

        // 更新 items
        rootItems = [
            { kind: 'action', label: 'A', icon: 'i', target: 'a' },
            { kind: 'action', label: 'B', icon: 'i', target: 'b' },
        ];
        refreshRoot();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(getMenu()?.currentLevel?.items.length).toBe(2);
        // 不仅状态数组更新，已渲染 DOM 也必须同步刷新
        const labels = Array.from(sceneOverlay.querySelectorAll('.slide-label')).map(
            (el) => el.textContent
        );
        expect(labels).toEqual(['A', 'B']);
    });

    it('refreshRoot 在无菜单时静默返回', () => {
        const { getMenu, refreshRoot } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            buildRootItems: () => [],
            handlers: {},
        });
        expect(getMenu()).toBeNull();
        // 不应抛异常，也不应创建菜单
        expect(() => refreshRoot()).not.toThrow();
        expect(getMenu()).toBeNull();
    });

    it('onShow 回调在每次 show 时调用', () => {
        const onShow = vi.fn();
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            onShow,
        });
        show();
        const firstMenu = getMenu();
        expect(firstMenu).not.toBeNull();
        expect(onShow).toHaveBeenCalledTimes(1);
        expect(onShow).toHaveBeenCalledWith(firstMenu);

        show(); // 再次调用
        expect(onShow).toHaveBeenCalledTimes(2);
        expect(onShow).toHaveBeenCalledWith(firstMenu);
    });

    it('菜单 dispose 后 SlideMenu 实例被清理', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const menu = getMenu();
        expect(menu).not.toBeNull();

        // dispose 应成功执行且不抛异常，并同步清空内部引用/存活集合
        expect(() => menu?.dispose()).not.toThrow();
        expect(getMenu()).toBeNull();
        expect(getOpenMenus()).not.toContain(menu);
    });

    it('菜单 dispose 后可以重新 show', async () => {
        const { getMenu, show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const firstMenu = getMenu();

        // dispose 后重新 show 应创建新实例
        firstMenu?.dispose();
        expect(getMenu()).toBeNull();
        show();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const secondMenu = getMenu();

        expect(secondMenu).not.toBeNull();
        expect(secondMenu).not.toBe(firstMenu);
    });

    it('overlayClass 在 show 时正确设置', async () => {
        const { show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'test',
            overlayClass: 'sceneOverlay-test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        expect(sceneOverlay.classList.contains('sceneOverlay-test')).toBe(true);
    });

    it('popupType 在 show 时正确设置', async () => {
        const { show } = registerPopupMenu({
            wrapperKey: 'test-menu',
            popupType: 'my-custom-type',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
        });
        show();
        expect(sceneOverlay.dataset.popupType).toBe('my-custom-type');
    });
});
