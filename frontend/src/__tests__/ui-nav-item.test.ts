// [doc:adr-153] 导航项契约辅助单测
import { describe, it, expect } from 'vitest';
import {
    markNavItem,
    navFocusTarget,
    navHasHorizontalAdjust,
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
});
