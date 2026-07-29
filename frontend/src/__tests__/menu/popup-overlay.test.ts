import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { dom } from '../../core/config';
import { showPopupMenu } from '../../menus/menu-factory';
import { makeTestLevel } from '../fixtures/menu';

// ─── showPopupMenu 测试：overlay class 切换 + 菜单创建与复用 ───

describe('showPopupMenu — overlay class 切换', () => {
    let sceneOverlay: HTMLElement;

    beforeEach(() => {
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        sceneOverlay.classList.add('sceneOverlay-model');
        document.body.appendChild(sceneOverlay);
        (dom as any).sceneOverlay = sceneOverlay;
    });

    afterEach(() => {
        sceneOverlay.remove();
        (dom as any).sceneOverlay = null;
    });

    it('初始 overlay class 被清除', () => {
        expect(sceneOverlay.classList.contains('sceneOverlay-model')).toBe(true);
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => null,
            setMenu: () => {},
        });
        expect(sceneOverlay.classList.contains('sceneOverlay-model')).toBe(false);
    });

    it('设置新的 overlayClass', () => {
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            overlayClass: 'sceneOverlay-motion',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => null,
            setMenu: () => {},
        });
        expect(sceneOverlay.classList.contains('sceneOverlay-motion')).toBe(true);
    });

    it('切换 overlayClass 时清除旧的 sceneOverlay-* class', () => {
        sceneOverlay.classList.add('sceneOverlay-settings');
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            overlayClass: 'sceneOverlay-motion',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => null,
            setMenu: () => {},
        });
        // 旧的被清除
        expect(sceneOverlay.classList.contains('sceneOverlay-model')).toBe(false);
        expect(sceneOverlay.classList.contains('sceneOverlay-settings')).toBe(false);
        // 新的被添加
        expect(sceneOverlay.classList.contains('sceneOverlay-motion')).toBe(true);
    });

    it('popupType 被设置到 dataset', () => {
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'my-popup',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => null,
            setMenu: () => {},
        });
        expect(sceneOverlay.dataset.popupType).toBe('my-popup');
    });
});

describe('showPopupMenu — 菜单创建与复用', () => {
    let sceneOverlay: HTMLElement;
    let wrapper: HTMLElement;
    let storedMenu: SlideMenu | null = null;

    beforeEach(() => {
        sceneOverlay = document.createElement('div');
        sceneOverlay.id = 'sceneOverlay';
        document.body.appendChild(sceneOverlay);
        (dom as any).sceneOverlay = sceneOverlay;

        wrapper = document.createElement('div');
        wrapper.id = 'menu-wrapper-test-show';
        document.body.appendChild(wrapper);
    });

    afterEach(() => {
        storedMenu?.dispose();
        storedMenu = null;
        sceneOverlay.remove();
        wrapper.remove();
        (dom as any).sceneOverlay = null;
    });

    it('首次调用创建 SlideMenu 实例', async () => {
        let created = false;
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => storedMenu,
            setMenu: (m) => {
                storedMenu = m;
            },
            onShow: () => {
                created = true;
            },
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(created).toBe(true);
        expect(storedMenu).not.toBeNull();
        expect(storedMenu?.levelCount).toBe(1);
    });

    it('再次调用时复用已有菜单，resetToRoot', async () => {
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {
                onFolderEnter: () => makeTestLevel('子级'),
            },
            getMenu: () => storedMenu,
            setMenu: (m) => {
                storedMenu = m;
            },
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));

        // 推入子级
        storedMenu!.push(makeTestLevel('子级'));
        expect(storedMenu?.levelCount).toBe(2);

        // 再次调用 → resetToRoot
        showPopupMenu({
            wrapperKey: 'test-show',
            popupType: 'test',
            buildRoot: () => makeTestLevel('根'),
            handlers: {},
            getMenu: () => storedMenu,
            setMenu: (m) => {
                storedMenu = m;
            },
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(storedMenu?.levelCount).toBe(1);
        expect(storedMenu?.currentLevel?.label).toBe('根');
    });

    // onClose 由 SlideMenu 内部在点击关闭按钮时触发（已在 SlideMenu describe 块中覆盖）
});
