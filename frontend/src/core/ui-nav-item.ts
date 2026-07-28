// 菜单导航项契约 — leaf module（ADR-153 键盘导航范式）。
//
// 背景：menu.ts 此前靠类名枚举（.slide-item/.cs-row/.toggle-row...）识别方向键
// 导航项，每加一种控件就要回改 menu.ts 三处（selector/聚焦目标/调值让位），
// 靠"记得改"极易遗漏（mode-slider、type-row 先后漏掉）。
//
// 契约制：控件工厂给可导航的行打统一标记，menu.ts 只认标记，职责回归控件自身。
//   - data-nav-item        : 标记"我是方向键导航项"
//   - data-nav-focus       : 内部聚焦目标 selector（缺省=行本身）
//   - data-nav-adjust      : 'horizontal' 时 ←→ 让给控件自身调值（缺省=不让，←→ 走 pop/激活）

/** 导航项标记属性名 */
export const NAV_ITEM_ATTR = 'data-nav-item';
export const NAV_FOCUS_ATTR = 'data-nav-focus';
export const NAV_ADJUST_ATTR = 'data-nav-adjust';

/** 方向键导航项统一选择器（panelItems 用） */
export const NAV_ITEM_SELECTOR = `[${NAV_ITEM_ATTR}]`;

export interface NavItemOptions {
    /** 内部聚焦目标 selector；缺省聚焦行本身 */
    focusSelector?: string;
    /** 为 true 时 ←→ 让给控件自身调值（滑块/模式切换器） */
    horizontalAdjust?: boolean;
}

/**
 * 给一个行元素打上方向键导航项标记。控件工厂在创建行后调用一次即可，
 * 无需再改 menu.ts。
 */
export function markNavItem(row: HTMLElement, opts: NavItemOptions = {}): void {
    row.setAttribute(NAV_ITEM_ATTR, '');
    if (opts.focusSelector) {
        row.setAttribute(NAV_FOCUS_ATTR, opts.focusSelector);
    }
    if (opts.horizontalAdjust) {
        row.setAttribute(NAV_ADJUST_ATTR, 'horizontal');
    }
}

/** 读取行的内部聚焦目标（缺省返回行本身） */
export function navFocusTarget(row: HTMLElement): HTMLElement {
    const sel = row.getAttribute(NAV_FOCUS_ATTR);
    if (sel) {
        const el = row.querySelector<HTMLElement>(sel);
        if (el) {
            return el;
        }
    }
    return row;
}

/** 该行是否声明了 ←→ 水平调值（菜单应让位） */
export function navHasHorizontalAdjust(row: HTMLElement): boolean {
    return row.getAttribute(NAV_ADJUST_ATTR) === 'horizontal';
}
