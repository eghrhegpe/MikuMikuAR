import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlideMenu } from '../../menus/menu';
import type { PopupLevel } from '../../core/config';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── SlideMenu 测试：键盘导航 + 触屏手势守卫与平台适配 ───

describe('SlideMenu — 键盘导航', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    async function waitForRender(m: SlideMenu): Promise<void> {
        return new Promise((resolve) => {
            const orig = (m as any).onAfterRender;
            (m as any).onAfterRender = () => {
                (m as any).onAfterRender = orig;
                orig?.();
                resolve();
            };
        });
    }

    it('focusNext 在正序/循环', async () => {
        const p = waitForRender(menu);
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });
        await p;
        // setupFocus() 将 focusIndex 设为 0
        expect((menu as any).focusIndex).toBe(0);

        (menu as any).focusNext();
        expect((menu as any).focusIndex).toBe(1);

        (menu as any).focusNext(); // 循环到 0
        expect((menu as any).focusIndex).toBe(0);
    });

    it('focusPrev 反向循环', async () => {
        const p = waitForRender(menu);
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });
        await p;

        (menu as any).focusPrev(); // 循环到最后一个
        expect((menu as any).focusIndex).toBe(1);
    });
});

describe('SlideMenu — 触屏手势守卫与平台适配', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        menu.dispose();
    });

    it('单指 touchstart 置 _swipeActive=true，右滑触发 pop', () => {
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        (menu as any).transitioning = false;
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', { value: [{ clientX: 0, clientY: 0 }] });
        container.dispatchEvent(touchStart);
        expect((menu as any)._swipeActive).toBe(true);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before - 1);
    });

    it('双指触摸置 _swipeActive=false，不触发 pop', () => {
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        (menu as any).transitioning = false;
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [
                { clientX: 0, clientY: 0 },
                { clientX: 10, clientY: 10 },
            ],
        });
        container.dispatchEvent(touchStart);
        expect((menu as any)._swipeActive).toBe(false);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 200, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before);
    });

    it('_isOpen 构造后为 true，close/dispose 后变 false', () => {
        expect((menu as any)._isOpen).toBe(true);
        menu.close();
        expect((menu as any)._isOpen).toBe(false);

        const m2 = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        expect((m2 as any)._isOpen).toBe(true);
        m2.dispose();
        expect((m2 as any)._isOpen).toBe(false);
    });

    it('isVisible 在 close 后为 false，即便容器有布局尺寸（_isOpen 短路，不误判）', () => {
        // 模拟旧实现会误判为可见的场景：容器有布局尺寸
        vi.spyOn(container, 'getClientRects').mockReturnValue([
            {} as DOMRect,
        ] as unknown as DOMRectList);
        expect(container.getClientRects().length).toBeGreaterThan(0);
        menu.close();
        expect(menu.isVisible).toBe(false);
    });

    describe('平台适配（坐标右滑手势注册）', () => {
        it('非安卓平台注册触摸监听器', () => {
            expect((menu as any)._swipeTouchStartDisp).not.toBeNull();
            expect((menu as any)._swipeTouchEndDisp).not.toBeNull();
        });

        it('安卓平台不注册坐标右滑手势（交由系统返回键）', () => {
            vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
                'Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile'
            );
            const androidMenu = new SlideMenu({
                container,
                onItemClick: vi.fn(),
                onFolderEnter: vi.fn(),
                onAfterRender: vi.fn(),
                onClose: vi.fn(),
            });
            expect((androidMenu as any)._swipeTouchStartDisp).toBeNull();
            expect((androidMenu as any)._swipeTouchEndDisp).toBeNull();
            androidMenu.dispose();
        });
    });
});
