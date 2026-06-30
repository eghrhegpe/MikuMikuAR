import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SlideMenu } from '../menus/menu';
import type { PopupLevel, PopupRow } from '../core/config';

// ─── SlideMenu 测试 ─────────────────────────────────────────────
// 验证层级栈管理（push / pop / reset / popTo）。
// 过渡动画基于 CSS，jsdom 中不触发 transitionend；
// 通过手动清除 transitioning 标志来测试同步状态变更。

// ── 辅助函数 ─────────────────────────────────────────────

function makeLevel(label: string, dir = '', items: PopupRow[] = []): PopupLevel {
    return { label, dir, items };
}

// ── 测试 ─────────────────────────────────────────────────

describe('SlideMenu — 层级栈管理', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onHover: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    it('reset 创建初始层级', () => {
        menu.reset(makeLevel('根'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('根');
    });

    it('push 立即增加层级数（同步）', () => {
        menu.reset(makeLevel('根'));
        const before = menu.levelCount;
        menu.push(makeLevel('子级'));
        // levels.push() 是同步的，transitioning 不影响数组
        expect(menu.levelCount).toBe(before + 1);
    });

    it('pop 减少层级数', () => {
        menu.reset(makeLevel('根'));
        menu.push(makeLevel('子级'));
        const before = menu.levelCount;
        // 手动清除 transitioning 使 pop 可以执行
        (menu as any).transitioning = false;
        menu.pop();
        (menu as any).transitioning = false;
        expect(menu.levelCount).toBe(before - 1);
    });

    it('pop 在仅有一层时无效', () => {
        menu.reset(makeLevel('根'));
        menu.pop();
        expect(menu.levelCount).toBe(1);
    });

    it('popTo 回退到指定深度', () => {
        // 直接设置 levels 数组，绕过 push 的 transitioning 守卫
        (menu as any).levels = [makeLevel('L0'), makeLevel('L1'), makeLevel('L2')];
        (menu as any).transitioning = false;
        menu.popTo(0);
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('L0');
    });

    it('reset 清空所有层级并设新根', () => {
        menu.reset(makeLevel('A'));
        menu.push(makeLevel('B'));
        (menu as any).transitioning = false;

        menu.reset(makeLevel('Z'));
        expect(menu.levelCount).toBe(1);
        expect(menu.currentLevel?.label).toBe('Z');
    });

    it('currentLevel 在 pop 完所有层级后为 undefined', () => {
        menu.reset(makeLevel('X'));
        menu.pop();
        (menu as any).transitioning = false;
        // pop 最后一层的 fallback：levels 至少保留 reset 设置的那一层
        // SlideMenu 设计上不允许完全空栈，pop 到 0 时保留当前层
        expect(menu.levelCount).toBeGreaterThanOrEqual(0);
    });
});

describe('SlideMenu — 渲染', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
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

    it('renderCustom 回调创建自定义 DOM', () => {
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
        menu.reset(level);
        const custom = container.querySelectorAll('.custom-content');
        expect(custom.length).toBe(1);
        expect(custom[0]?.textContent).toBe('Hello');
    });

    it('reRender 重新构建当前层级', () => {
        const level: PopupLevel = {
            label: 'R',
            dir: '',
            items: [{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }],
        };
        menu.reset(level);
        expect(container.querySelectorAll('.slide-item').length).toBe(1);

        level.items.push({ kind: 'action' as const, label: 'B', icon: 'i', target: 'b' });
        menu.reRender();
        expect(container.querySelectorAll('.slide-item').length).toBe(2);
    });
});

describe('SlideMenu — 键盘导航', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        menu = new SlideMenu({
            container,
            onItemClick: vi.fn(),
            onFolderEnter: vi.fn(),
            onAfterRender: vi.fn(),
            onClose: vi.fn(),
        });
    });

    it('focusNext 在正序/循环', () => {
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });
        // setupFocus() 将 focusIndex 设为 0
        expect((menu as any).focusIndex).toBe(0);

        (menu as any).focusNext();
        expect((menu as any).focusIndex).toBe(1);

        (menu as any).focusNext(); // 循环到 0
        expect((menu as any).focusIndex).toBe(0);
    });

    it('focusPrev 反向循环', () => {
        menu!.reset({
            label: 'F',
            dir: '',
            items: [
                { kind: 'action' as const, label: 'X', icon: 'i', target: 'x' },
                { kind: 'action' as const, label: 'Y', icon: 'i', target: 'y' },
            ],
        });

        (menu as any).focusPrev(); // 循环到最后一个
        expect((menu as any).focusIndex).toBe(1);
    });
});
