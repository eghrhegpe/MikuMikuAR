/**
 * ADR-153 Phase 3: 键盘导航公共工具
 *
 * 统一 Arrow 键 + Enter/Space + Escape 列表导航。
 * 被 `menu.ts`（CSS-highlight 模型）和 `settings-diagnostic.ts`（tablist）等使用。
 */
import { addDisposableListener, type Disposable } from './dom';

export interface KeyboardNavOptions {
    /** 容器内可聚焦元素的选择器，默认 '[tabindex]' */
    selector?: string;
    /** Enter/Space 激活回调，默认触发 click() */
    onEnter?: (el: HTMLElement) => void;
    /** Escape 回调 */
    onEscape?: () => void;
    /** ArrowLeft 返回回调（菜单返回用） */
    onArrowBack?: () => void;
    /** 每次箭头键移动焦点后触发（tablist 用） */
    onArrowActivate?: (el: HTMLElement) => void;
    /** 跳过选择器：焦点在此类元素内时箭头键不触发导航 */
    skipSelector?: string;
    /** 过渡锁：为 true 时所有键盘操作被忽略 */
    transitioningGuard?: () => boolean;
    /** 是否循环 wrap（默认 true） */
    wrap?: boolean;
    /** roving tabindex：箭头移动后设置新元素 tabIndex=0、旧元素 tabIndex=-1 */
    rovingTabIndex?: boolean;
}

export function createKeyboardNav(
    container: HTMLElement,
    options: KeyboardNavOptions = {}
): Disposable {
    const selector = options.selector || '[tabindex]';
    const wrap = options.wrap !== false;

    const handler = (e: KeyboardEvent) => {
        if (options.transitioningGuard?.()) return;

        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target && options.skipSelector && target.closest(options.skipSelector)) return;

        const items = container.querySelectorAll<HTMLElement>(selector);
        if (items.length === 0) return;

        const focused = container.querySelector<HTMLElement>(`${selector}:focus`);
        const idx = focused ? Array.from(items).indexOf(focused) : -1;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight': {
                e.preventDefault();
                const next = wrap ? (idx + 1) % items.length : Math.min(idx + 1, items.length - 1);
                _moveFocus(items, idx, next, options);
                break;
            }
            case 'ArrowUp':
            case 'ArrowLeft': {
                if (e.key === 'ArrowLeft' && options.onArrowBack) {
                    e.preventDefault();
                    options.onArrowBack();
                    break;
                }
                e.preventDefault();
                const prev = wrap ? (idx - 1 + items.length) % items.length : Math.max(idx - 1, 0);
                _moveFocus(items, idx, prev, options);
                break;
            }
            case 'Enter':
            case ' ': {
                if (focused) {
                    e.preventDefault();
                    if (options.onEnter) {
                        options.onEnter(focused);
                    } else {
                        focused.click();
                    }
                }
                break;
            }
            case 'Escape': {
                if (options.onEscape) {
                    e.preventDefault();
                    options.onEscape();
                }
                break;
            }
        }
    };

    return addDisposableListener(container, 'keydown', handler);
}

function _moveFocus(
    items: NodeListOf<HTMLElement>,
    prevIdx: number,
    nextIdx: number,
    options: KeyboardNavOptions
): void {
    if (options.rovingTabIndex && prevIdx >= 0) {
        items[prevIdx].tabIndex = -1;
    }
    items[nextIdx].focus();
    if (options.rovingTabIndex) {
        items[nextIdx].tabIndex = 0;
    }
    options.onArrowActivate?.(items[nextIdx]);
}
