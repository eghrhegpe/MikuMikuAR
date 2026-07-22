/**
 * ADR-153 Phase 3: 键盘导航公共工具
 *
 * 从 menu.ts / ui-fullscreen-overlay.ts 抽取共享的 Arrow 键 + Enter 列表导航逻辑。
 * 支持 focusable 元素选择器 + 循环 wrap + Enter 激活 + Escape 回调。
 */
import { addDisposableListener, type Disposable } from './dom';

export interface KeyboardNavOptions {
    /** 容器内可聚焦元素的选择器，默认 '[tabindex]' */
    selector?: string;
    /** Enter 激活回调，默认触发 click() */
    onEnter?: (el: HTMLElement) => void;
    /** Escape 回调 */
    onEscape?: () => void;
    /** 是否循环 wrap（默认 true） */
    wrap?: boolean;
}

/**
 * 创建列表键盘导航监听器。
 * @returns Disposable，调用 `.dispose()` 移除监听
 */
export function createKeyboardNav(
    container: HTMLElement,
    options: KeyboardNavOptions = {}
): Disposable {
    const selector = options.selector || '[tabindex]';
    const wrap = options.wrap !== false;

    const handler = (e: KeyboardEvent) => {
        const items = container.querySelectorAll<HTMLElement>(selector);
        if (items.length === 0) return;

        const focused = container.querySelector<HTMLElement>(`${selector}:focus`);
        const idx = focused ? Array.from(items).indexOf(focused) : -1;

        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowRight': {
                e.preventDefault();
                const next = wrap
                    ? (idx + 1) % items.length
                    : Math.min(idx + 1, items.length - 1);
                items[next].focus();
                break;
            }
            case 'ArrowUp':
            case 'ArrowLeft': {
                e.preventDefault();
                const prev = wrap
                    ? (idx - 1 + items.length) % items.length
                    : Math.max(idx - 1, 0);
                items[prev].focus();
                break;
            }
            case 'Enter': {
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