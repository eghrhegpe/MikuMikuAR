// [doc:adr-153] 导航项契约辅助单测
import { describe, it, expect, afterEach } from 'vitest';
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
    afterEach(() => {
        document.body.innerHTML = '';
    });

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
        expect(navGroupMove(row, 1)).toBe(true); // wrap 回 c1
        expect(document.activeElement).toBe(c1);
    });

    it('markNavItem 重复调用以最新选项覆盖旧标记', () => {
        const el = document.createElement('div');
        markNavItem(el, { focusSelector: '.cs-bar', groupSelector: '.preset-chip' });
        markNavItem(el);
        expect(el.hasAttribute(NAV_ITEM_ATTR)).toBe(true);
        expect(navGroupSelector(el)).toBeNull();
        expect(navHasHorizontalAdjust(el)).toBe(false);
        expect(navFocusTarget(el)).toBe(el);
    });

    it('focusSelector 非法时 navFocusTarget 回退行本身', () => {
        const row = document.createElement('div');
        markNavItem(row, { focusSelector: '[' });
        expect(navFocusTarget(row)).toBe(row);
    });

    it('groupSelector 无匹配或非法时 navFocusTarget 回退行本身', () => {
        const missing = document.createElement('div');
        markNavItem(missing, { groupSelector: '.missing' });
        expect(navFocusTarget(missing)).toBe(missing);

        const invalid = document.createElement('div');
        markNavItem(invalid, { groupSelector: '[' });
        expect(navFocusTarget(invalid)).toBe(invalid);
    });

    it('navGroupMove 空组或非法 groupSelector 返回 false', () => {
        const empty = document.createElement('div');
        markNavItem(empty, { groupSelector: '.missing' });
        expect(navGroupMove(empty, 1)).toBe(false);

        const invalid = document.createElement('div');
        document.body.appendChild(invalid);
        markNavItem(invalid, { groupSelector: '[' });
        expect(navGroupMove(invalid, 1)).toBe(false);
    });

    it('navGroupMove 单元素组保持焦点并返回 true', () => {
        const row = document.createElement('div');
        const c = document.createElement('button');
        c.className = 'preset-chip';
        row.appendChild(c);
        document.body.appendChild(row);
        markNavItem(row, { groupSelector: '.preset-chip' });
        c.focus();
        expect(navGroupMove(row, 1)).toBe(true);
        expect(document.activeElement).toBe(c);
    });

    it('navGroupMove 已移除行返回 false', () => {
        const row = document.createElement('div');
        const c = document.createElement('button');
        c.className = 'preset-chip';
        row.appendChild(c);
        document.body.appendChild(row);
        markNavItem(row, { groupSelector: '.preset-chip' });
        c.focus();
        row.remove();
        expect(navGroupMove(row, 1)).toBe(false);
    });

    it('navGroupMove 非法 dir 返回 false', () => {
        const row = document.createElement('div');
        document.body.appendChild(row);
        markNavItem(row, { groupSelector: '.preset-chip' });
        expect(navGroupMove(row, 0 as -1 | 1)).toBe(false);
    });

    it('navGroupMove 非组行返回 false', () => {
        const row = document.createElement('div');
        markNavItem(row);
        expect(navGroupMove(row, 1)).toBe(false);
    });
});
