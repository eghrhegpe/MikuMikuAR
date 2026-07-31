import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── SlideMenu 测试：生命周期 (dispose / 动画) + 高阶功能 ───

describe('SlideMenu — 生命周期 (dispose / 动画)', () => {
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
    });

    describe('dispose', () => {
        it('清理 _keydownDisp 和触摸监听器', () => {
            expect((menu as any)._keydownDisp).not.toBeNull();
            expect((menu as any)._swipeTouchStartHandler).not.toBeNull();
            expect((menu as any)._swipeTouchEndHandler).not.toBeNull();

            menu.dispose();

            expect((menu as any)._keydownDisp).toBeNull();
            expect((menu as any)._swipeTouchStartHandler).toBeNull();
            expect((menu as any)._swipeTouchEndHandler).toBeNull();
        });

        it('清空 levels 和缓存', () => {
            menu.reset(makeTestLevel('根'));
            menu.push(makeTestLevel('子级'));
            (menu as any).transitioning = false;
            expect(menu.levelCount).toBe(2);

            menu.dispose();
            expect((menu as any).levels.length).toBe(0);
            expect((menu as any)._cachedExtraBtns).toBeNull();
        });

        it('重置 transitioning 和面板样式', () => {
            (menu as any).transitioning = true;
            menu.dispose();
            expect((menu as any).transitioning).toBe(false);
        });

        it('取消未决的 setTimeout', () => {
            vi.useFakeTimers();
            menu.reset(makeTestLevel('根'));
            menu.push(makeTestLevel('动画'));
            // push 设置了 setTimeout(150)
            expect((menu as any)._pendingTimeouts.length).toBeGreaterThan(0);

            menu.dispose();
            // dispose 调用 _cancelAnim → _cancelTimeout → 清空 pending
            expect((menu as any)._pendingTimeouts.length).toBe(0);
            vi.useRealTimers();
        });
    });

    describe('push/pop 动画', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it('push 动画通过定时器完成', async () => {
            vi.useFakeTimers();
            const onAfterRender = vi.fn();
            (menu as any).onAfterRender = onAfterRender;

            menu.reset(makeTestLevel('根'));
            expect((menu as any).transitioning).toBe(false);

            menu.push(makeTestLevel('子级'));
            expect((menu as any).transitioning).toBe(true);
            expect(menu.levelCount).toBe(2);

            // 推进到 fadeOut 完成 (150ms)
            await vi.advanceTimersByTimeAsync(160);
            // 推进到 fadeIn 完成 (+200ms)
            await vi.advanceTimersByTimeAsync(210);

            expect((menu as any).transitioning).toBe(false);
            expect(menu.currentLevel?.label).toBe('子级');
            expect(onAfterRender).toHaveBeenCalled();
        });

        it('pop 动画通过定时器完成', async () => {
            vi.useFakeTimers();
            const onAfterRender = vi.fn();
            (menu as any).onAfterRender = onAfterRender;

            menu.reset(makeTestLevel('根'));
            (menu as any).transitioning = false;
            (menu as any).levels.push(makeTestLevel('子级')); // 直接操作数组避免 push 动画

            (menu as any).transitioning = false;
            menu.pop();
            expect((menu as any).transitioning).toBe(true);

            // 推进到 fadeOut (150ms)
            await vi.advanceTimersByTimeAsync(160);
            // 推进到 fadeIn (+200ms)
            await vi.advanceTimersByTimeAsync(210);

            expect((menu as any).transitioning).toBe(false);
            expect(menu.currentLevel?.label).toBe('根');
            expect(onAfterRender).toHaveBeenCalled();
        });

        it('push 在 transitioning 时拒绝新推送', () => {
            vi.useFakeTimers();
            menu.reset(makeTestLevel('根'));
            menu.push(makeTestLevel('A'));
            const levelCount = menu.levelCount;

            // 尝试再推一个（仍处于 transitioning）
            menu.push(makeTestLevel('B'));
            expect(menu.levelCount).toBe(levelCount);
        });
    });
});

describe('SlideMenu — 高阶功能 (extraButtonFactory / onClose / 手势)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('extraButtonFactory 添加按钮到标题栏', async () => {
        const extraBtn = document.createElement('button');
        extraBtn.textContent = '⚙';
        extraBtn.className = 'extra-btn';
        const m = makeTestMenu({ container, handlers: { extraButtonFactory: () => [extraBtn] } });
        menu = m.menu;
        menu.reset(makeTestLevel('设置'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const header = container.querySelector('.slide-header')!;
        expect(header.contains(extraBtn)).toBe(true);
        expect(header.querySelector('.extra-btn')?.textContent).toBe('⚙');
    });

    it('onClose 回调在根层级点击返回时触发', async () => {
        const onClose = vi.fn();
        const m = makeTestMenu({ container, handlers: { onClose } });
        menu = m.menu;
        menu.reset(makeTestLevel('根'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // 根层级返回按钮使用 X 图标，点击触发 onClose
        const backBtn = container.querySelector('.slide-back')!;
        expect(backBtn).toBeTruthy();
        (backBtn as HTMLElement).click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('updateHeader 根层级显示 X 图标, 子层级显示返回箭头', async () => {
        const m = makeTestMenu({ container });
        menu = m.menu;
        menu.reset(makeTestLevel('根'));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        // 根层级：iconify-icon 有 lucide:x
        let backIcon = container.querySelector('.slide-back iconify-icon');
        expect(backIcon?.getAttribute('icon')).toMatch(/x/);

        // 推入子层级
        (menu as any).levels.push(makeTestLevel('子级'));
        (menu as any).updateHeader((menu as any).currentLevel);
        backIcon = container.querySelector('.slide-back iconify-icon');
        expect(backIcon?.getAttribute('icon')).toBeTruthy();
        expect(backIcon?.getAttribute('icon')).toMatch(/chevron/);
    });

    it('触屏右滑手势触发 pop', () => {
        const m = makeTestMenu({ container });
        menu = m.menu;
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before - 1);
    });

    it('触屏右滑距离不足时不触发 pop', () => {
        const m = makeTestMenu({ container });
        menu = m.menu;
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        const before = menu.levelCount;

        // 右滑仅 30px（不足 60）
        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 30, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before); // 未触发 pop
    });

    it('触屏手势在单层级时不触发 pop', () => {
        const m = makeTestMenu({ container });
        menu = m.menu;
        menu.reset(makeTestLevel('仅根'));
        const before = menu.levelCount;

        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 0 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before);
    });

    it('触屏手势垂直偏移过大时不触发 pop', () => {
        const m = makeTestMenu({ container });
        menu = m.menu;
        menu.reset(makeTestLevel('根'));
        (menu as any).levels.push(makeTestLevel('子级'));
        const before = menu.levelCount;

        // 右滑 100px 但垂直偏移 50px（超过 40）
        const touchStart = new TouchEvent('touchstart', { bubbles: true });
        Object.defineProperty(touchStart, 'touches', {
            value: [{ clientX: 0, clientY: 0 }],
        });
        container.dispatchEvent(touchStart);

        const touchEnd = new TouchEvent('touchend', { bubbles: true });
        Object.defineProperty(touchEnd, 'changedTouches', {
            value: [{ clientX: 100, clientY: 50 }],
        });
        container.dispatchEvent(touchEnd);

        expect(menu.levelCount).toBe(before);
    });
});
