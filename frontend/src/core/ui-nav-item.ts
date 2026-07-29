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
//   - data-nav-group       : 组内子项 selector（如 chips/mode-btn 一排按钮）。
//                            标了它的行为「二维导航站」：↑↓ 进出该行，←→ 在组内子项间移动、Enter 触发。

/** 导航项标记属性名 */
export const NAV_ITEM_ATTR = 'data-nav-item';
export const NAV_FOCUS_ATTR = 'data-nav-focus';
export const NAV_ADJUST_ATTR = 'data-nav-adjust';
export const NAV_GROUP_ATTR = 'data-nav-group';

/** 方向键导航项统一选择器（panelItems 用） */
export const NAV_ITEM_SELECTOR = `[${NAV_ITEM_ATTR}]`;

export interface NavItemOptions {
    /** 内部聚焦目标 selector；缺省聚焦行本身 */
    focusSelector?: string;
    /** 为 true 时 ←→ 让给控件自身调值（滑块/模式切换器） */
    horizontalAdjust?: boolean;
    /**
     * 组内子项 selector（一行多按钮，如 '.preset-chip' / '.mode-btn'）。
     * 设置后该行成为二维导航站：↑↓ 进出行、←→ 在子项间 roving、Enter 触发聚焦子项。
     * 隐含 horizontalAdjust（菜单让出 ←→ 给组内移动）。
     */
    groupSelector?: string;
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
    if (opts.groupSelector) {
        row.setAttribute(NAV_GROUP_ATTR, opts.groupSelector);
        // 组行 ←→ 用于组内移动，菜单必须让出
        row.setAttribute(NAV_ADJUST_ATTR, 'horizontal');
    } else if (opts.horizontalAdjust) {
        row.setAttribute(NAV_ADJUST_ATTR, 'horizontal');
    }
}

/** 读取行的内部聚焦目标（缺省返回行本身） */
export function navFocusTarget(row: HTMLElement): HTMLElement {
    // 组行：聚焦当前 active 子项，否则首个子项
    const group = row.getAttribute(NAV_GROUP_ATTR);
    if (group) {
        const items = row.querySelectorAll<HTMLElement>(group);
        if (items.length > 0) {
            const active = Array.from(items).find((el) => el.classList.contains('active'));
            return active ?? items[0];
        }
    }
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

/** 读取组行的组内子项 selector（非组行返回 null） */
export function navGroupSelector(row: HTMLElement): string | null {
    return row.getAttribute(NAV_GROUP_ATTR);
}

/**
 * 组内 ←→ 移动焦点：在 row 的组内子项间循环移动，返回是否处理了该键。
 * dir: -1 = 左/上一项，+1 = 右/下一项。
 */
export function navGroupMove(row: HTMLElement, dir: -1 | 1): boolean {
    const group = row.getAttribute(NAV_GROUP_ATTR);
    if (!group) {
        return false;
    }
    const items = Array.from(row.querySelectorAll<HTMLElement>(group));
    if (items.length === 0) {
        return false;
    }
    const cur = items.findIndex((el) => el === document.activeElement);
    const from = cur < 0 ? 0 : cur;
    const next = (from + dir + items.length) % items.length;
    items[next].focus({ preventScroll: true });
    return true;
}
