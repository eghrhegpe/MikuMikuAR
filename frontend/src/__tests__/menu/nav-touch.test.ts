import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import { bundles } from '../../core/i18n/t';
import { zhCN } from '../../core/i18n/locales/zh-CN';

beforeAll(() => {
    // [doc:perf] 语言包运行时加载；测试环境直接预填基准包，避免缺失 key 告警噪声。
    bundles['zh-CN'] = zhCN;
});

// ─── SlideMenu 测试：键盘导航 + 触屏手势守卫与平台适配 ───

describe('SlideMenu — 键盘导航', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
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
        container.remove();
    });

    function dispatchTouch(
        type: 'touchstart' | 'touchend',
        points: Array<{ clientX: number; clientY: number }>
    ): void {
        const event = new TouchEvent(type, { bubbles: true });
        if (type === 'touchstart') {
            Object.defineProperty(event, 'touches', { value: points });
        } else {
            Object.defineProperty(event, 'changedTouches', { value: points });
        }
        container.dispatchEvent(event);
    }

    it('单指 touchstart 置 _swipeActive=true，右滑触发 pop 后复位', () => {
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        (menu as any).transitioning = false;
        const before = menu.levelCount;

        dispatchTouch('touchstart', [{ clientX: 0, clientY: 0 }]);
        expect((menu as any)._swipeActive).toBe(true);

        dispatchTouch('touchend', [{ clientX: 100, clientY: 0 }]);

        expect(menu.levelCount).toBe(before - 1);
        expect((menu as any)._swipeActive).toBe(false);
    });

    it('双指触摸置 _swipeActive=false，不触发 pop', () => {
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        (menu as any).transitioning = false;
        const before = menu.levelCount;

        dispatchTouch('touchstart', [
            { clientX: 0, clientY: 0 },
            { clientX: 10, clientY: 10 },
        ]);
        expect((menu as any)._swipeActive).toBe(false);

        dispatchTouch('touchend', [{ clientX: 200, clientY: 0 }]);

        expect(menu.levelCount).toBe(before);
        expect((menu as any)._swipeActive).toBe(false);
    });

    it('_isOpen 构造后为 true，close/dispose 后变 false', () => {
        expect((menu as any)._isOpen).toBe(true);
        menu.close();
        expect((menu as any)._isOpen).toBe(false);

        const m2Container = document.createElement('div');
        document.body.appendChild(m2Container);
        const m2 = new SlideMenu({
            container: m2Container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
        expect((m2 as any)._isOpen).toBe(true);
        m2.dispose();
        expect((m2 as any)._isOpen).toBe(false);
        m2Container.remove();
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
        function makePlatformMenu(userAgent: string): {
            platformContainer: HTMLElement;
            platformMenu: SlideMenu;
        } {
            vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
            const platformContainer = document.createElement('div');
            document.body.appendChild(platformContainer);
            const platformMenu = new SlideMenu({
                container: platformContainer,
                onItemClick: vi.fn(),
                onFolderEnter: vi.fn(),
                onAfterRender: vi.fn(),
                onClose: vi.fn(),
            });
            return { platformContainer, platformMenu };
        }

        it('非安卓平台注册触摸监听器', () => {
            const { platformContainer, platformMenu } = makePlatformMenu(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
            );
            expect((platformMenu as any)._swipeTouchStartDisp).not.toBeNull();
            expect((platformMenu as any)._swipeTouchEndDisp).not.toBeNull();
            platformMenu.dispose();
            platformContainer.remove();
        });

        it('安卓平台不注册坐标右滑手势（交由系统返回键）', () => {
            const { platformContainer, platformMenu } = makePlatformMenu(
                'Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile'
            );
            expect((platformMenu as any)._swipeTouchStartDisp).toBeNull();
            expect((platformMenu as any)._swipeTouchEndDisp).toBeNull();
            platformMenu.dispose();
            platformContainer.remove();
        });
    });
});
