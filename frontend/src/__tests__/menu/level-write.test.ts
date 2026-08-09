// menu/level-write.test.ts — SlideMenu 状态写路径（setLevel / replaceCurrentLevel / updateRow / refreshHeader）
// + 模块级函数（getOpenMenus / getCurrentRenderingMenu）。对照 menu.ts 公开面 audit：这些方法零覆盖。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SlideMenu } from '../../menus/menu';
import { getOpenMenus, getCurrentRenderingMenu } from '../../menus/menu';
import { makeTestLevel, makeTestMenu } from '../fixtures/menu';
import { pushRenderingContext, popRenderingContext } from '../../core/render-context';
import type { PopupLevel, PopupRow } from '../../core/config';

const actionRow = (label: string, target: string): PopupRow => ({
    kind: 'action',
    label,
    icon: 'i',
    target,
});

describe('SlideMenu — 状态写路径', () => {
    let menu: SlideMenu;
    let container: HTMLElement;

    beforeEach(() => {
        const m = makeTestMenu();
        menu = m.menu;
        container = m.container;
        menu.reset(makeTestLevel('根'));
    });

    describe('setLevel', () => {
        it('替换当前层触发 reRender', () => {
            const spy = vi.spyOn(menu, 'reRender');
            const lvl = makeTestLevel('新根');
            menu.setLevel(0, lvl);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(menu.getLevel(0)).toBe(lvl);
        });

        it('替换非当前层不触发 reRender', () => {
            menu.push(makeTestLevel('子级'));
            const spy = vi.spyOn(menu, 'reRender');
            menu.setLevel(0, makeTestLevel('改根'));
            expect(spy).not.toHaveBeenCalled();
        });

        it('越界/负索引无操作', () => {
            const spy = vi.spyOn(menu, 'reRender');
            menu.setLevel(5, makeTestLevel('越界'));
            menu.setLevel(-1, makeTestLevel('负'));
            expect(spy).not.toHaveBeenCalled();
            expect(menu.getLevel(0)?.label).toBe('根');
        });
    });

    describe('replaceCurrentLevel', () => {
        it('替换栈顶并重绘', () => {
            menu.push(makeTestLevel('子级'));
            const spy = vi.spyOn(menu, 'reRender');
            menu.replaceCurrentLevel(makeTestLevel('新子级'));
            expect(spy).toHaveBeenCalledTimes(1);
            expect(menu.currentLevel?.label).toBe('新子级');
        });

        it('空栈静默返回', () => {
            const fresh = makeTestMenu().menu;
            expect(() => fresh.replaceCurrentLevel(makeTestLevel('x'))).not.toThrow();
            expect(fresh.currentLevel).toBeUndefined();
        });
    });

    describe('updateRow', () => {
        it('替换指定行 DOM 且不改其他行', () => {
            const level: PopupLevel = {
                label: '根',
                dir: '',
                items: [actionRow('A', 'a'), actionRow('B', 'b')],
            };
            menu.reset(level);

            menu.updateRow(1, actionRow('B2', 'b2'));

            const labels = Array.from(container.querySelectorAll('.slide-label')).map(
                (el) => el.textContent
            );
            expect(labels).toEqual(['A', 'B2']);
            expect(level.items[1].label).toBe('B2');
        });

        it('越界索引静默返回', () => {
            menu.reset(makeTestLevel('根', '', [actionRow('A', 'a')]));
            expect(() => menu.updateRow(5, actionRow('X', 'x'))).not.toThrow();
            expect(container.querySelectorAll('.slide-label')).toHaveLength(1);
        });

        it('含 divider 时按 items 下标对齐 DOM 行（跳过占位）', () => {
            const level: PopupLevel = {
                label: '根',
                dir: '',
                items: [
                    actionRow('A', 'a'),
                    { kind: 'divider' as const, label: '', icon: '', target: '' },
                    actionRow('B', 'b'),
                ],
            };
            menu.reset(level);

            menu.updateRow(2, actionRow('B2', 'b2'));

            const labels = Array.from(container.querySelectorAll('.slide-label')).map(
                (el) => el.textContent
            );
            expect(labels).toEqual(['A', 'B2']);
            // 替换行仍在 lcard 组内，分组结构不被破坏
            expect(container.querySelector('.lcard')).toBeTruthy();
        });
    });

    describe('refreshHeader', () => {
        it('只刷新标题栏（label 变化反映到 header）', async () => {
            menu.reset(makeTestLevel('根'));
            // 等 buildPanel.then 里的 updateHeader 渲染完成
            await new Promise((r) => setTimeout(r, 10));
            const level = menu.getLevel(0)!;
            level.label = '改名后';

            menu.refreshHeader();

            expect(container.querySelector('.slide-header')?.textContent).toContain('改名后');
        });
    });
});

describe('menu 模块级函数', () => {
    it('getOpenMenus 返回存活实例，dispose 后移除', () => {
        const { menu } = makeTestMenu();
        expect(getOpenMenus()).toContain(menu);
        menu.dispose();
        expect(getOpenMenus()).not.toContain(menu);
    });

    it('getCurrentRenderingMenu 返回当前渲染上下文', () => {
        const { menu } = makeTestMenu();
        pushRenderingContext(menu);
        try {
            expect(getCurrentRenderingMenu()).toBe(menu);
        } finally {
            popRenderingContext();
        }
    });
});
