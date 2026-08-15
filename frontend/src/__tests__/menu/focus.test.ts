import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import type { PopupLevel, PopupRow } from '../../core/config';
import { bundles } from '../../core/i18n/t';
import { zhCN } from '../../core/i18n/locales/zh-CN';
import { makeTestMenu } from '../fixtures/menu';

// ─── SlideMenu 测试：焦点全面（setupFocus/clearFocus/applyFocus/activateFocused） ───

describe('SlideMenu — 焦点全面 (setupFocus/clearFocus/applyFocus/activateFocused)', () => {
    let container: HTMLElement;
    let menu: SlideMenu;

    beforeAll(() => {
        // [doc:perf] 语言包运行时加载；测试环境直接预填基准包，避免 t() 缺失 key 告警
        bundles['zh-CN'] = zhCN;
    });

    beforeEach(() => {
        const m = makeTestMenu();
        container = m.container;
        menu = m.menu;
    });

    afterEach(() => {
        menu.dispose();
        container.remove();
    });

    async function initWithItems(items: PopupRow[]): Promise<void> {
        const p = new Promise<void>((resolve) => {
            const orig = (menu as any).onAfterRender;
            (menu as any).onAfterRender = () => {
                (menu as any).onAfterRender = orig;
                orig?.();
                resolve();
            };
        });
        menu.reset({ label: 'F', dir: '', items });
        await p;
    }

    it('setupFocus 初始化焦点为 0 并应用样式', async () => {
        await initWithItems([{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }]);
        expect((menu as any).focusIndex).toBe(0);
        expect(container.querySelector('.slide-focused')).toBeTruthy();
    });

    it('setupFocus 空列表时 focusIndex 为 -1', async () => {
        await initWithItems([]);
        expect((menu as any).focusIndex).toBe(-1);
        expect(container.querySelector('.slide-focused')).toBeFalsy();
    });

    it('clearFocus 移除焦点样式', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
        ]);
        (menu as any).clearFocus();
        expect(container.querySelector('.slide-focused')).toBeFalsy();
    });

    it('panelItems 纳入滑块行(.cs-row 含 .cs-bar)与开关行(.toggle-row)', async () => {
        // 用 renderCustom 注入真实控件行 DOM，验证方向键导航范围已扩展
        const level: PopupLevel = {
            label: 'F',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const sliderRow = document.createElement('div');
                sliderRow.className = 'cs-row';
                const bar = document.createElement('div');
                bar.className = 'cs-bar';
                bar.tabIndex = 0;
                sliderRow.appendChild(bar);
                c.appendChild(sliderRow);
                const toggleRow = document.createElement('div');
                toggleRow.className = 'toggle-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                toggleRow.appendChild(input);
                c.appendChild(toggleRow);
                // 无控件的提示行（.cs-row 但无 .cs-bar）—— 不应被纳入
                const hintRow = document.createElement('div');
                hintRow.className = 'cs-row';
                c.appendChild(hintRow);
            },
        };
        const p = new Promise<void>((resolve) => {
            (menu as any).onAfterRender = () => resolve();
        });
        menu.reset(level);
        await p;

        const items = (menu as any).panelItems as HTMLElement[];
        expect(
            items.some((el) => el.classList.contains('cs-row') && el.querySelector('.cs-bar'))
        ).toBe(true);
        expect(items.some((el) => el.classList.contains('toggle-row'))).toBe(true);
        // 无 .cs-bar 的提示行被排除
        expect(items.filter((el) => el.classList.contains('cs-row')).length).toBe(1);
    });

    it('panelItems 纳入模式切换器(.cs-row+.cs-top[role=slider])与 type-row', async () => {
        // 回归防护：mode-slider / type-row 曾因无 .cs-bar 而被遗漏，契约制应纳入
        const level: PopupLevel = {
            label: 'F',
            dir: '',
            items: [],
            renderCustom: (c) => {
                // 模式切换器（slider，无 .cs-bar；[audit:round6] ARIA 合规 role=listbox→slider）
                const modeRow = document.createElement('div');
                modeRow.className = 'cs-row';
                const top = document.createElement('div');
                top.className = 'cs-top';
                top.tabIndex = 0;
                top.setAttribute('role', 'slider');
                modeRow.appendChild(top);
                c.appendChild(modeRow);
                // type-row
                const typeRow = document.createElement('div');
                typeRow.className = 'type-row';
                c.appendChild(typeRow);
            },
        };
        const p = new Promise<void>((resolve) => {
            (menu as any).onAfterRender = () => resolve();
        });
        menu.reset(level);
        await p;

        const items = (menu as any).panelItems as HTMLElement[];
        expect(items.some((el) => el.classList.contains('cs-row'))).toBe(true);
        expect(items.some((el) => el.classList.contains('type-row'))).toBe(true);
        // 模式切换器声明了 ←→ 调值让位
        const modeItem = items.find((el) => el.classList.contains('cs-row'))!;
        expect(modeItem.getAttribute('data-nav-adjust')).toBe('horizontal');
        expect(modeItem.getAttribute('data-nav-focus')).toBe('.cs-top[role="slider"]');
    });

    it('preset-group chips 组标记为二维导航站（data-nav-group）', async () => {
        const level: PopupLevel = {
            label: 'F',
            dir: '',
            items: [],
            renderCustom: (c) => {
                const group = document.createElement('div');
                group.className = 'preset-group';
                for (let i = 0; i < 3; i++) {
                    const chip = document.createElement('button');
                    chip.className = 'preset-chip' + (i === 1 ? ' active' : '');
                    chip.textContent = `chip-${i}`;
                    group.appendChild(chip);
                }
                c.appendChild(group);
            },
        };
        const p = new Promise<void>((resolve) => {
            (menu as any).onAfterRender = () => resolve();
        });
        menu.reset(level);
        await p;

        const items = (menu as any).panelItems as HTMLElement[];
        const groupRow = items.find((el) => el.classList.contains('preset-group'))!;
        expect(groupRow).toBeTruthy();
        expect(groupRow.getAttribute('data-nav-group')).toBe('.preset-chip:not(.badge)');
        // 组行隐含 ←→ 让位
        expect(groupRow.getAttribute('data-nav-adjust')).toBe('horizontal');
    });

    it('applyFocus 给当前焦点索引添加样式', async () => {
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
            { kind: 'action' as const, label: 'C', icon: 'i', target: 'c' },
        ]);
        (menu as any).focusIndex = 1;
        (menu as any).applyFocus();
        const focused = container.querySelector('.slide-focused');
        expect(focused).toBeTruthy();
        expect(focused?.textContent).toContain('B');
    });

    it('applyFocus 越界索引不操作', async () => {
        await initWithItems([{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }]);
        (menu as any).focusIndex = 99;
        // 不应抛异常，也不应误加焦点样式
        expect(() => (menu as any).applyFocus()).not.toThrow();
        expect(container.querySelector('.slide-focused')).toBeFalsy();
    });

    it('activateFocused 点击聚焦项', async () => {
        const onClick = vi.fn();
        (menu as any).onItemClick = onClick;
        await initWithItems([
            { kind: 'action' as const, label: 'A', icon: 'i', target: 'a' },
            { kind: 'action' as const, label: 'B', icon: 'i', target: 'b' },
        ]);
        (menu as any).focusIndex = 1;
        (menu as any).activateFocused();
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ label: 'B' }), menu);
    });

    it('activateFocused 越界不操作', async () => {
        const onClick = vi.fn();
        (menu as any).onItemClick = onClick;
        await initWithItems([{ kind: 'action' as const, label: 'A', icon: 'i', target: 'a' }]);
        (menu as any).focusIndex = 99;
        (menu as any).activateFocused();
        expect(onClick).not.toHaveBeenCalled();
    });

    it('focusNext 空列表无操作', async () => {
        await initWithItems([]);
        (menu as any).focusIndex = -1;
        expect(() => (menu as any).focusNext()).not.toThrow();
        expect((menu as any).focusIndex).toBe(-1);
    });

    it('focusPrev 空列表无操作', async () => {
        await initWithItems([]);
        (menu as any).focusIndex = -1;
        expect(() => (menu as any).focusPrev()).not.toThrow();
        expect((menu as any).focusIndex).toBe(-1);
    });
});
