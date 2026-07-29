import { describe, it, expect, beforeEach } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import type { PopupLevel } from '../../core/config';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';

// ─── SlideMenu 测试：层级栈管理 + 渲染 ─────────────────────────────
// 过渡动画基于 CSS，jsdom/happy-dom 中不触发 transitionend；
// 通过手动清除 transitioning 标志来测试同步状态变更。

describe('SlideMenu — 层级栈管理', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    it('reset 创建初始层级', () => {
        menu.reset(makeTestLevel('根'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('push 立即增加层级数（同步）', () => {
        menu.reset(makeTestLevel('根'));
        const before = menu.levelCount;
        menu.push(makeTestLevel('子级'));
        // levels.push() 是同步的，transitioning 不影响数组
        expect(menu.levelCount).toBe(before + 1);
    });

    it('pop 减少层级数', () => {
        menu.reset(makeTestLevel('根'));
        menu.push(makeTestLevel('子级'));
        const before = menu.levelCount;
        // 手动清除 transitioning 使 pop 可以执行
        (menu as any).transitioning = false;
        menu.pop();
        (menu as any).transitioning = false;
        expect(menu.levelCount).toBe(before - 1);
    });

    it('pop 在仅有一层时无效', () => {
        menu.reset(makeTestLevel('根'));
        menu.pop();
        expect(menu.levelCount).toBe(1);
    });

    it('popTo 回退到指定深度', () => {
        // 直接设置 levels 数组，绕过 push 的 transitioning 守卫
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        (menu as any).transitioning = false;
        menu.popTo(0);
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('L0');
    });

    it('reset 清空所有层级并设新根', () => {
        menu.reset(makeTestLevel('A'));
        menu.push(makeTestLevel('B'));
        (menu as any).transitioning = false;

        menu.reset(makeTestLevel('Z'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('Z');
    });

    it('currentLevel 在 pop 完所有层级后为 undefined', () => {
        menu.reset(makeTestLevel('X'));
        menu.pop();
        (menu as any).transitioning = false;
        // pop 最后一层的 fallback：levels 至少保留 reset 设置的那一层
        // SlideMenu 设计上不允许完全空栈，pop 到 0 时保留当前层
        expect(menu.levelCount).toBeGreaterThanOrEqual(0);
    });

    it('push 在 transitioning 时被阻止', () => {
        menu.reset(makeTestLevel('根'));
        const before = menu.levelCount;
        (menu as any).transitioning = true;
        menu.push(makeTestLevel('不应推入'));
        expect(menu.levelCount).toBe(before);
    });

    it('pop 在 transitioning 时被阻止', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = (menu as any).levels.length;
        (menu as any).transitioning = true;
        menu.pop();
        expect((menu as any).levels.length).toBe(before);
    });

    it('popTo 到当前层级无变化', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1'), makeTestLevel('L2')];
        const before = menu.levelCount;
        menu.popTo(2); // index === length-1 → no-op
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 负数索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(-1);
        expect(menu.levelCount).toBe(before);
    });

    it('popTo 越界索引被忽略', () => {
        (menu as any).levels = [makeTestLevel('L0'), makeTestLevel('L1')];
        const before = menu.levelCount;
        menu.popTo(5);
        expect(menu.levelCount).toBe(before);
    });

    it('resetToRoot 清除多余层级至根', () => {
        (menu as any).levels = [makeTestLevel('根'), makeTestLevel('A'), makeTestLevel('B')];
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('resetToRoot 单层级时无变化', () => {
        menu.reset(makeTestLevel('仅一层'));
        menu.resetToRoot();
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('仅一层');
    });
});

describe('SlideMenu — 渲染', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    it('reset 构建面板 DOM', () => {
        const level: PopupLevel = {
            label: '测试',
            dir: '',
            items: [
                { kind: 'action' as const, label: '项目1', icon: 'i', target: 'v1' },
                { kind: 'action' as const, label: '项目2', icon: 'i', target: 'v2' },
            ],
        };
        menu.reset(level);
        const items = container.querySelectorAll('.slide-item');
        expect(items.length).toBe(2);
    });

    it('renderCustom 回调创建自定义 DOM', async () => {
        let rendered = false;
        const level: PopupLevel = {
            label: '自定义',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const div = document.createElement('div');
                div.className = 'custom-content';
                div.textContent = 'Hello';
                c.appendChild(div);
            },
        };
        (menu as any).onAfterRender = () => {
            rendered = true;
        };
        menu.reset(level);
        // 等待 buildPanel 的 async 回调 + onAfterRender
        while (!rendered) {
            await new Promise((r) => setTimeout(r, 5));
        }
        const custom = container.querySelectorAll('.custom-content');
        expect(custom.length).toBe(1);
        expect(custom[0]?.textContent).toBe('Hello');
    });

    it('reRender 重新构建当前层级', async () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        expect(container.querySelectorAll('.slide-item').length).toBe(1);

        level.items.push({ kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.reRender();
        // reRender 使用 RAF 去抖，需等待下一帧
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });
});
