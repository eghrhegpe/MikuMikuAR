// [doc:adr-153] 导航项契约辅助单测
import { describe, it, expect } from 'vitest';
import {
    markNavItem,
    navFocusTarget,
    navHasHorizontalAdjust,
    navGroupSelector,
    navGroupMove,
    NAV_ITEM_ATTR,
    NAV_ITEM_SELECTOR,
} from '../core/ui-nav-item';

describe('ui-nav-item 契约', () => {
    it('markNavItem 打上 data-nav-item 标记', () => {
        const el = document.createElement('div');
        markNavItem(el);
        expect(el.hasAttribute(NAV_ITEM_ATTR)).toBe(true);
        expect(el.matches(NAV_ITEM_SELECTOR)).toBe(true);
    });

    it('缺省 focusSelector 时 navFocusTarget 返回行本身', () => {
        const el = document.createElement('div');
        markNavItem(el);
        expect(navFocusTarget(el)).toBe(el);
    });

    it('focusSelector 命中时返回内部元素', () => {
        const row = document.createElement('div');
        const bar = document.createElement('div');
        bar.className = 'cs-bar';
        row.appendChild(bar);
        markNavItem(row, { focusSelector: '.cs-bar' });
        expect(navFocusTarget(row)).toBe(bar);
    });

    it('focusSelector 未命中时回退行本身', () => {
        const row = document.createElement('div');
        markNavItem(row, { focusSelector: '.not-exist' });
        expect(navFocusTarget(row)).toBe(row);
    });

    it('horizontalAdjust 反映到 navHasHorizontalAdjust', () => {
        const a = document.createElement('div');
        markNavItem(a, { horizontalAdjust: true });
        expect(navHasHorizontalAdjust(a)).toBe(true);

        const b = document.createElement('div');
        markNavItem(b);
        expect(navHasHorizontalAdjust(b)).toBe(false);
    });

    it('groupSelector 隐含 horizontalAdjust 且可给 navGroupSelector 读取', () => {
        const row = document.createElement('div');
        markNavItem(row, { groupSelector: '.preset-chip' });
        expect(navHasHorizontalAdjust(row)).toBe(true);
        expect(navGroupSelector(row)).toBe('.preset-chip');
    });

    it('navFocusTarget 组行优先聚焦 active 子项，无 active 则首项', () => {
        const row = document.createElement('div');
        const c1 = document.createElement('button');
        c1.className = 'preset-chip';
        const c2 = document.createElement('button');
        c2.className = 'preset-chip active';
        row.append(c1, c2);
        markNavItem(row, { groupSelector: '.preset-chip' });
        expect(navFocusTarget(row)).toBe(c2); // active 优先
        c2.classList.remove('active');
        expect(navFocusTarget(row)).toBe(c1); // 无 active → 首项
    });

    it('navGroupMove 在组内循环移动焦点', () => {
        const row = document.createElement('div');
        const c1 = document.createElement('button');
        c1.className = 'preset-chip';
        const c2 = document.createElement('button');
        c2.className = 'preset-chip';
        row.append(c1, c2);
        document.body.appendChild(row);
        markNavItem(row, { groupSelector: '.preset-chip' });
        c1.focus();
        expect(navGroupMove(row, 1)).toBe(true);
        expect(document.activeElement).toBe(c2);
        navGroupMove(row, 1); // wrap 回 c1
        expect(document.activeElement).toBe(c1);
        row.remove();
    });

    it('navGroupMove 非组行返回 false', () => {
        const row = document.createElement('div');
        markNavItem(row);
        expect(navGroupMove(row, 1)).toBe(false);
    });
});
