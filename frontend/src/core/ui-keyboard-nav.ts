/**
 * ADR-153 Phase 3: 键盘导航公共工具
 *
 * 统一 Arrow 键 + Enter/Space + Escape 列表导航。
 * 被 `menu.ts`（CSS-highlight 模型）和 `settings-diagnostic.ts`（tablist）等使用。
 *
 * ADR-153 增强（全大统一）：新增三项能力边界，使 `menu.ts` 的 `focusIndex`
 * 状态机可接入而不破坏返回手感（ArrowRight→激活、ArrowLeft→pop）：
 *   1. perKeySkip —— 按键相关的差异化跳过（↑↓ 与 →← 跳过规则可不同）
 *   2. getActiveIndex/setActiveIndex —— 焦点真相源抽象，允许外部用
 *      `.slide-focused` CSS 类而非原生 `:focus` 定位当前项
 *   3. arrowRightActivate —— ArrowRight 语义切换为激活而非平级移动
 */
import { addDisposableListener, type Disposable } from './dom';

/** 导航按键分类：垂直移动 / 水平移动，供 perKeySkip 差异化判断 */
export type NavKeyKind = 'vertical' | 'horizontal';

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
    /**
     * 按键相关的差异化跳过（优先级高于 skipSelector）。
     * 返回 true 时该按键的导航被忽略、事件透传。
     * 用于 `menu.ts`：↑↓ 仅跳 slider/tablist，→←/Enter 还要跳原生 button。
     */
    perKeySkip?: (target: HTMLElement | null, kind: NavKeyKind) => boolean;
    /** 过渡锁：为 true 时所有键盘操作被忽略 */
    transitioningGuard?: () => boolean;
    /** 是否循环 wrap（默认 true） */
    wrap?: boolean;
    /** roving tabindex：箭头移动后设置新元素 tabIndex=0、旧元素 tabIndex=-1 */
    rovingTabIndex?: boolean;
    /**
     * 焦点真相源读取：返回当前激活项索引。提供后取代默认的 `:focus` 反查，
     * 让外部（如 menu.ts）用 `.slide-focused` CSS 类维护焦点。
     */
    getActiveIndex?: (items: HTMLElement[]) => number;
    /**
     * 焦点真相源写入：移动到目标索引。提供后取代默认的 `el.focus()`，
     * 由外部负责打 `.slide-focused` 类 + scrollIntoView + focus。
     */
    setActiveIndex?: (items: HTMLElement[], nextIdx: number) => void;
    /**
     * ArrowRight 语义为「激活当前项」而非「平级向后移动」（menu.ts 层级进入）。
     * 为 true 时 ArrowRight 走 onEnter 路径；ArrowDown 仍为平级移动。
     */
    arrowRightActivate?: boolean;
    /**
     * 自定义导航项来源：提供后取代默认的 `container.querySelectorAll(selector)`。
     * 用于 menu.ts —— 其 panelItems 含纯 CSS 无法表达的过滤（如“仅含 .cs-bar 的 .cs-row”），
     * 保证焦点真相源（getActiveIndex 的索引）与 list.length 完全一致，避免 wrap 边界错位。
     */
    getItems?: () => HTMLElement[];
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

        const items = options.getItems
            ? options.getItems()
            : Array.from(container.querySelectorAll<HTMLElement>(selector));
        if (items.length === 0) return;
        const list = items;

        // 焦点真相源：优先外部 getActiveIndex（如 menu.ts 的 focusIndex），
        // 否则回退原生 `:focus` 反查（tablist / fullscreen-overlay 路径不变）。
        const idx = options.getActiveIndex
            ? options.getActiveIndex(list)
            : (() => {
                  const f = container.querySelector<HTMLElement>(`${selector}:focus`);
                  return f ? list.indexOf(f) : -1;
              })();
        const activeEl = idx >= 0 && idx < list.length ? list[idx] : null;

        switch (e.key) {
            case 'ArrowDown': {
                if (options.perKeySkip?.(target, 'vertical')) return;
                e.preventDefault();
                const next = wrap ? (idx + 1) % list.length : Math.min(idx + 1, list.length - 1);
                _moveFocus(list, idx, next, options);
                break;
            }
            case 'ArrowRight': {
                if (options.perKeySkip?.(target, 'horizontal')) return;
                // menu.ts 语义：ArrowRight = 激活当前项（层级进入），非平级移动
                if (options.arrowRightActivate) {
                    if (activeEl) {
                        e.preventDefault();
                        options.onEnter ? options.onEnter(activeEl) : activeEl.click();
                    }
                    break;
                }
                e.preventDefault();
                const next = wrap ? (idx + 1) % list.length : Math.min(idx + 1, list.length - 1);
                _moveFocus(list, idx, next, options);
                break;
            }
            case 'ArrowUp': {
                if (options.perKeySkip?.(target, 'vertical')) return;
                e.preventDefault();
                const prev = wrap ? (idx - 1 + list.length) % list.length : Math.max(idx - 1, 0);
                _moveFocus(list, idx, prev, options);
                break;
            }
            case 'ArrowLeft': {
                if (options.perKeySkip?.(target, 'horizontal')) return;
                if (options.onArrowBack) {
                    e.preventDefault();
                    options.onArrowBack();
                    break;
                }
                e.preventDefault();
                const prev = wrap ? (idx - 1 + list.length) % list.length : Math.max(idx - 1, 0);
                _moveFocus(list, idx, prev, options);
                break;
            }
            case 'Enter':
            case ' ': {
                if (options.perKeySkip?.(target, 'horizontal')) return;
                if (activeEl) {
                    e.preventDefault();
                    options.onEnter ? options.onEnter(activeEl) : activeEl.click();
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
    items: HTMLElement[],
    prevIdx: number,
    nextIdx: number,
    options: KeyboardNavOptions
): void {
    // 焦点真相源写入：外部提供 setActiveIndex 时由其接管（menu.ts 打 .slide-focused），
    // 否则走默认 roving tabindex + 原生 focus。
    if (options.setActiveIndex) {
        options.setActiveIndex(items, nextIdx);
        options.onArrowActivate?.(items[nextIdx]);
        return;
    }
    if (options.rovingTabIndex && prevIdx >= 0 && prevIdx < items.length) {
        items[prevIdx].tabIndex = -1;
    }
    items[nextIdx].focus();
    if (options.rovingTabIndex) {
        items[nextIdx].tabIndex = 0;
    }
    options.onArrowActivate?.(items[nextIdx]);
}
