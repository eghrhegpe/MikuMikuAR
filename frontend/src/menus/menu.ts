import { PopupLevel, PopupRow, showHint, hideHint } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { addSliderRow, addToggleRow } from '../core/ui-rows';
import { addModeSlider } from '../core/ui-advanced-rows';
import { addPresetChip } from '../core/ui-collapsible';
import { createHeaderToggle } from '../core/ui-header-toggle';
import { slideRow, createTrailingBtn, createLeadingBtn } from '../core/ui-slide-row';
// [doc:adr-229] DOM 契约单源：键盘导航聚焦选择器由 dom-contract 提供，禁止手写字符串
import { ROLE, SLIDER_BAR_CLASS } from '../core/dom-contract';
import { subscribe } from '../core/reactivity';
import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { safeDispose } from '../core/dispose-helpers';
import { addDisposableListener, type Disposable } from '../core/dom';
import { createKeyboardNav } from '../core/ui-keyboard-nav';
import {
    getCurrentRenderingContext,
    pushRenderingContext,
    popRenderingContext,
    type RenderContext,
} from '../core/render-context';
import {
    markNavItem,
    navFocusTarget,
    navHasHorizontalAdjust,
    navGroupSelector,
    navGroupMove,
    NAV_ITEM_ATTR,
    NAV_ITEM_SELECTOR,
    type NavItemOptions,
} from '../core/ui-nav-item';

/** 菜单过渡时间常量（与 app.css :root --menu-transition-duration 同步） */
const TRANSITION_DURATION = '0.15s';
const TRANSITION_DURATION_FAST = '0.12s';

/** 获取当前正在渲染的 SlideMenu 实例（供 menus 层控件的自更新注册）。 */
export function getCurrentRenderingMenu(): SlideMenu | null {
    return (getCurrentRenderingContext() as SlideMenu | null) ?? null;
}

/** 存活（未 dispose）的 SlideMenu 实例集合 — 供全局返回逻辑（android:back）查询当前打开的菜单 */
const _liveMenus = new Set<SlideMenu>();

/** 获取所有当前存活的 SlideMenu 实例（已 dispose 的会自动移除，调用方仍需自行判断可见性） */
export function getOpenMenus(): SlideMenu[] {
    return Array.from(_liveMenus);
}

export class SlideMenu implements RenderContext {
    private levels: PopupLevel[] = [];
    private container: HTMLElement;
    private viewport: HTMLElement;
    private panel: HTMLElement;
    private headerEl: HTMLElement;
    private focusIndex = -1;
    private transitioning = false;
    /** 跟踪未决的 setTimeout，确保 cancelAnims 能全部清除 */
    private _pendingTimeouts: ReturnType<typeof setTimeout>[] = [];
    /** 缓存的额外按钮，避免每次 updateHeader 重建、旧监听器泄漏 */
    private _cachedExtraBtns: HTMLElement[] | null = null;
    /** 记录未决的 RAF reRender，用于去抖 */
    private _reRenderPending = false;
    /** [fix:P0] transitioning 期间缓存的 reRender 请求（merged opts），过渡结束后补执行 */
    private _pendingReRender: { opts?: { preserveFocus?: boolean } } | null = null;
    /** [fix:P3] 缓存 slide-list 引用，buildPanel/重建时重置，避免每帧 querySelector */
    private _slideListRef: HTMLElement | null = null;
    /** 触屏滑动手势起始坐标 */
    private _swipeStartX = 0;
    private _swipeStartY = 0;
    /** 本次滑动手势是否有效（仅单指有效；多指手势置 false 取消判定，避免双指误触发 pop） */
    private _swipeActive = false;
    /** 菜单逻辑打开状态：构造时置 true，close/dispose 置 false；isVisible 的可靠来源，不依赖脆弱的 CSS 布局探测 */
    private _isOpen = false;
    private _swipeTouchStartHandler: ((e: TouchEvent) => void) | null = null;
    private _swipeTouchEndHandler: ((e: TouchEvent) => void) | null = null;
    private _keydownDisp: Disposable | null = null;
    /** 组内导航（chips/mode-btn 一排按钮）的 ←→ 处理器 */
    private _groupNavDisp: Disposable | null = null;
    private _swipeTouchStartDisp: Disposable | null = null;
    private _swipeTouchEndDisp: Disposable | null = null;
    /**
     * 自更新控件注册表 — 每个元素有 update() 方法 + 可选的 pathHint 键路径提示。
     * [doc:PACU] pathHint 为 reactivity 收集的顶层 key（叶名），例如
     * ctrl.bind='env.skyMode' 时传 'skyMode'；不为 undefined 时仅当该 key
     * 在本帧发生过 set 变更才调用 update。
     * pathHint === undefined 保持旧行为（每帧都更新，保守兼容）。
     */
    private _controls: Array<{ update: () => void; pathHint?: string }> = [];
    /** renderCustom 返回的清理函数，在 buildPanel 重建或 dispose 时调用 */
    private _customDispose: (() => void) | null = null;
    /** 响应式订阅取消函数 — dispose 时调用 */
    private _unsubscribe: (() => void) | null = null;
    /** 记录上一次语言码，供 updateControls 检测 i18n 热切换（ADR-065） */
    private _lastLang: string = getLang();

    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (
        row: PopupRow,
        menu: SlideMenu
    ) => PopupLevel | null | Promise<PopupLevel | null>;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    onClose?: () => void;
    extraButtonFactory?: () => HTMLElement[];
    /** 每次 level 变更（push/pop）后回调，供外部持久化当前目录等状态 */
    onLevelEnter?: (level: PopupLevel, menu: SlideMenu) => void;

    constructor(opts: {
        container: HTMLElement;
        onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
        onFolderEnter?: (
            row: PopupRow,
            menu: SlideMenu
        ) => PopupLevel | null | Promise<PopupLevel | null>;
        onHover?: (row: PopupRow, entering: boolean) => void;
        onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
        onClose?: () => void;
        extraButtonFactory?: () => HTMLElement[];
        onLevelEnter?: (level: PopupLevel, menu: SlideMenu) => void;
    }) {
        this.container = opts.container;
        this.onItemClick = opts.onItemClick;
        this.onFolderEnter = opts.onFolderEnter;
        this.onHover = opts.onHover;
        this.onAfterRender = opts.onAfterRender;
        this.onClose = opts.onClose;
        this.extraButtonFactory = opts.extraButtonFactory;
        this.onLevelEnter = opts.onLevelEnter;

        this.container.innerHTML = '';
        this.container.classList.add('slide-menu');

        this.viewport = document.createElement('div');
        this.viewport.className = 'slide-viewport';

        this.panel = document.createElement('div');
        this.panel.className = 'slide-panel';
        // 内联样式由 CSS 控制，只设置必要的过渡
        this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
        this.panel.style.display = 'flex';

        this.viewport.appendChild(this.panel);
        this.container.appendChild(this.viewport);

        this.headerEl = document.createElement('div');
        this.headerEl.className = 'slide-header';
        this.container.appendChild(this.headerEl);

        // 键盘导航（ADR-153 全大统一：接入 createKeyboardNav 公共工具，
        // 用 focusIndex 作为焦点真相源，保留 →/Enter 激活、← pop 返回手感）
        this.container.tabIndex = -1;
        this._keydownDisp = createKeyboardNav(this.container, {
            selector: '.slide-item, .collapsible-header',
            // 自定义项源：与 panelItems 完全对齐（含滑块/开关行过滤），保证 wrap 边界正确
            getItems: () => this.panelItems,
            transitioningGuard: () => this.transitioning,
            // ↑↓(vertical)：仅跳 tablist（控件行也要能上下遍历）；
            // →←/Enter(horizontal)：行声明 data-nav-adjust=horizontal 时让给控件自身调值。
            perKeySkip: (target, kind) => {
                if (!target) {
                    return false;
                }
                if (target.closest('[role="tablist"]')) {
                    return true;
                }
                if (kind === 'horizontal') {
                    const row = target.closest<HTMLElement>(NAV_ITEM_SELECTOR);
                    if (row && navHasHorizontalAdjust(row)) {
                        return true;
                    }
                    // 契约之外的原生可输入控件（开关 checkbox 除外——需 →/Enter 切换）
                    const native = target.closest(
                        'button, input, textarea, select, [contenteditable]'
                    );
                    if (
                        native &&
                        !(native instanceof HTMLInputElement && native.type === 'checkbox')
                    ) {
                        return true;
                    }
                }
                return false;
            },
            // 焦点真相源桥接到 focusIndex + .slide-focused（非原生 :focus）
            getActiveIndex: () => this.focusIndex,
            setActiveIndex: (_items, nextIdx) => {
                this.focusIndex = nextIdx;
                this.applyFocus();
            },
            arrowRightActivate: true, // → = 激活（层级进入）
            onEnter: () => this.activateFocused(),
            onArrowBack: () => this.pop(), // ← = 返回上一层级
            wrap: true,
        });

        // 组内导航：停在组行（data-nav-group，如 chips/type-row）时，←→ 在组内子项间移动。
        // createKeyboardNav 对组行的 ←→ 经 perKeySkip 让位（不 preventDefault），事件传到此处理。
        const groupNavHandler = (e: KeyboardEvent) => {
            if (this.transitioning) {
                return;
            }
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                return;
            }
            const target = e.target instanceof HTMLElement ? e.target : null;
            const row = target?.closest<HTMLElement>(NAV_ITEM_SELECTOR);
            if (!row || !navGroupSelector(row)) {
                return;
            }
            const dir = e.key === 'ArrowRight' ? 1 : -1;
            if (navGroupMove(row, dir)) {
                e.preventDefault();
            }
        };
        this._groupNavDisp = addDisposableListener(this.container, 'keydown', groupNavHandler);

        // 触屏手势：右滑返回上一层级
        this._swipeStartX = 0;
        this._swipeStartY = 0;
        this._swipeTouchStartHandler = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                this._swipeStartX = e.touches[0].clientX;
                this._swipeStartY = e.touches[0].clientY;
                this._swipeActive = true;
            } else {
                // 多指（双指缩放/平移）→ 取消本次滑动判定，避免误触发 pop()
                this._swipeActive = false;
            }
        };
        this._swipeTouchEndHandler = (e: TouchEvent) => {
            if (!this._swipeActive || this.transitioning || this.levels.length <= 1) {
                return;
            }
            const ct = e.changedTouches[0];
            if (!ct) {
                return;
            }
            const dx = ct.clientX - this._swipeStartX;
            const dy = Math.abs(ct.clientY - this._swipeStartY);
            // 右滑 > 60px 且垂直偏移 < 40px → 返回
            if (dx > 60 && dy < 40) {
                this.pop();
            }
        };
        // 菜单逻辑上已打开
        this._isOpen = true;
        // 安卓平台交由系统返回键（android:back）唯一处理菜单返回，
        // 避免「系统返回手势」与「坐标位移右滑」双触发导致一次手势 pop 两级（P2）。
        // iOS / 桌面触屏仍用屏幕坐标右滑手势作为返回手段。
        const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
        if (!isAndroid) {
            this._swipeTouchStartDisp = addDisposableListener(
                this.container,
                'touchstart',
                this._swipeTouchStartHandler,
                { passive: true }
            );
            this._swipeTouchEndDisp = addDisposableListener(
                this.container,
                'touchend',
                this._swipeTouchEndHandler,
                { passive: true }
            );
        }

        // 响应式订阅：状态变更 → 自动 updateControls
        this._unsubscribe = subscribe(() => this.updateControls());

        // 注册到全局存活集合，供 android:back 等全局返回逻辑查询
        _liveMenus.add(this);
    }

    // ======== 公共 API ========

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    get levelCount(): number {
        return this.levels.length;
    }

    /** 菜单容器是否实际可见：以 _isOpen 为可靠来源，并辅以容器布局尺寸探测 */
    get isVisible(): boolean {
        return this._isOpen && this.container.getClientRects().length > 0;
    }

    /** 关闭整个菜单（触发 onClose，通常内部会 closeAllOverlays + dispose 当前 SlideMenu）。
     * 注意：close() ≠ dispose()——close 仅翻转可见状态并通知 onClose，不释放监听器/存活集合条目，
     * 实例仍留在 _liveMenus 中；menu-factory 的 onClose 回调负责随后的显式 dispose（见 menu-factory.ts）。
     * 外部若直接构造 SlideMenu 且 onClose 未接 dispose，需自行 dispose 以释放资源。 */
    close(): void {
        this._isOpen = false;
        this.onClose?.();
    }

    /** 只读暴露动画中状态，供外部诊断「展开期间 push 被静默丢弃」的 race */
    get isTransitioning(): boolean {
        return this.transitioning;
    }

    reset(level: PopupLevel): void {
        this._cancelAnim();
        this.levels = [level];
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
        safeCallAsync('menu', 'buildPanel failed:', () =>
            this.buildPanel(level).then(() => {
                this.updateHeader(level);
                this.setupFocus();
                this.onAfterRender?.(level, this);
                this.onLevelEnter?.(level, this);
            })
        );
    }

    /**
     * 推入新层级（含入场动画）。
     * @param level 层级对象
     * @param buildItems [doc:P2] 可选 items 重建工厂。
     *   提供时自动挂为 level.itemBuilder，使语言切换后也能增量更新标签。
     *   适用于 `buildXxxLevel(id)` + `push` 的模式：
     *   `push(buildXxx(id), () => buildXxx(id).items)`
     */
    push(level: PopupLevel, buildItems?: () => PopupRow[]): void {
        if (buildItems && !level.itemBuilder && !level.renderCustom) {
            level.itemBuilder = buildItems;
        }
        if (this.transitioning) {
            return;
        }
        this.transitioning = true;
        this.levels.push(level);

        // 旧内容淡出
        this.panel.style.transition = `opacity ${TRANSITION_DURATION_FAST} ease, transform ${TRANSITION_DURATION_FAST} ease`;
        this.panel.style.opacity = '0';
        this.panel.style.transform = 'translateX(-8px)';

        let fadeOutDisp: Disposable | null = null;
        const onFadeOut = async () => {
            fadeOutDisp = safeDispose(fadeOutDisp);
            await this.buildPanel(level);
            this.updateHeader(level);
            // 新内容从下方淡入
            this.panel.style.transition = 'none';
            this.panel.style.opacity = '0';
            this.panel.style.transform = 'translateX(8px)';
            void this.panel.offsetHeight;
            this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
            this.panel.style.opacity = '1';
            this.panel.style.transform = 'translateX(0)';

            let fadeInDisp: Disposable | null = null;
            const onFadeIn = () => {
                fadeInDisp = safeDispose(fadeInDisp);
                this._cancelTimeout();
                this._endTransition(level);
            };
            fadeInDisp = addDisposableListener(this.panel, 'transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateX(0)';
                        this._endTransition(level);
                    }
                }, 200)
            );
        };

        fadeOutDisp = addDisposableListener(this.panel, 'transitionend', onFadeOut);
        this._pushTimeout(
            setTimeout(() => {
                if (this.transitioning) {
                    this.panel.style.opacity = '0';
                    this.panel.style.transform = 'translateX(-8px)';
                    onFadeOut();
                }
            }, 150)
        );
    }

    pop(): void {
        if (this.transitioning || this.levels.length <= 1) {
            return;
        }
        this.transitioning = true;
        this.levels.pop();
        const prevLevel = this.levels[this.levels.length - 1];

        // [fix:return-refresh] 统一「返回即刷新」：纯 items 层返回时经 itemBuilder 重建 items，
        // 使子层操作（如程序化动作加载/卸载）返回上级时列表即新。
        // renderCustom 层（模型库文件列表）豁免——其 renderCustom 每次渲染实时重算自愈，
        // 强制重建会丢失滚动位置（半记忆位置效果）。
        if (prevLevel.itemBuilder && !prevLevel.renderCustom) {
            prevLevel.items = prevLevel.itemBuilder();
        }

        this.panel.style.transition = `opacity ${TRANSITION_DURATION_FAST} ease, transform ${TRANSITION_DURATION_FAST} ease`;
        this.panel.style.opacity = '0';
        this.panel.style.transform = 'translateX(8px)';

        let fadeOutDisp: Disposable | null = null;
        const onFadeOut = async () => {
            fadeOutDisp = safeDispose(fadeOutDisp);
            await this.buildPanel(prevLevel);
            this.updateHeader(prevLevel);
            this.panel.style.transition = 'none';
            this.panel.style.opacity = '0';
            this.panel.style.transform = 'translateX(-8px)';
            void this.panel.offsetHeight;
            this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
            this.panel.style.opacity = '1';
            this.panel.style.transform = 'translateX(0)';

            let fadeInDisp: Disposable | null = null;
            const onFadeIn = () => {
                fadeInDisp = safeDispose(fadeInDisp);
                this._cancelTimeout();
                this._endTransition(prevLevel);
            };
            fadeInDisp = addDisposableListener(this.panel, 'transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateX(0)';
                        this._endTransition(prevLevel);
                    }
                }, 200)
            );
        };

        fadeOutDisp = addDisposableListener(this.panel, 'transitionend', onFadeOut);
        this._pushTimeout(
            setTimeout(() => {
                if (this.transitioning) {
                    this.panel.style.opacity = '0';
                    this.panel.style.transform = 'translateX(8px)';
                    onFadeOut();
                }
            }, 150)
        );
    }

    popTo(index: number): void {
        if (index < 0 || index >= this.levels.length || this.transitioning) {
            return;
        }
        if (index === this.levels.length - 1) {
            return;
        }
        this._cancelAnim();
        this.levels = this.levels.slice(0, index + 1);
        const level = this.currentLevel!;
        // [fix:return-refresh] 与 pop() 同语义：纯 items 层跳回时经 itemBuilder 重建，
        // renderCustom 层（模型库文件列表）豁免，保留滚动位置。
        if (level.itemBuilder && !level.renderCustom) {
            level.items = level.itemBuilder();
        }
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
        safeCallAsync('menu', 'buildPanel failed:', () =>
            this.buildPanel(level).then(() => {
                this.updateHeader(level);
                this.setupFocus();
                this.onAfterRender?.(level, this);
                this.onLevelEnter?.(level, this);
            })
        );
    }

    reRender(opts?: { preserveFocus?: boolean }): void {
        if (this.transitioning) {
            // [fix:P0] 过渡动画期间不直接丢弃，缓存为 pending，过渡结束后补执行；
            // 合并规则：preserveFocus 只要任一方为 true 即保持（优先不抢焦点，保守原则）。
            if (this._pendingReRender) {
                this._pendingReRender.opts = {
                    preserveFocus:
                        (this._pendingReRender.opts?.preserveFocus ?? false) ||
                        (opts?.preserveFocus ?? false) ||
                        undefined,
                } as { preserveFocus?: boolean } | undefined;
            } else {
                this._pendingReRender = { opts };
            }
            return;
        }
        // RAF 去抖：同帧内多次 reRender 合并为一次
        if (this._reRenderPending) {
            return;
        }
        this._reRenderPending = true;
        requestAnimationFrame(() => {
            this._reRenderPending = false;
            this._doReRender(opts);
        });
    }

    /**
     * 注册一个自更新控件，由 updateControls() 统一驱动刷新。
     * @param update 更新函数
     * @param pathHint [doc:PACU] 可选的状态 key 提示（顶层 key/叶名）。
     *   提供后，仅当该 key 在本帧发生过 set 变更时才调用 update。
     *   不提供则保持旧行为（每帧 updateControls 都更新）。
     */
    registerControl(update: () => void, pathHint?: string): void {
        this._controls.push({ update, pathHint });
    }

    /**
     * 增量刷新所有已注册的自更新控件（不重建 DOM）。
     * [doc:PACU] 接收 changedKeys 集合，仅更新 pathHint 匹配的控件。
     * @param changedKeys 本帧变更的 state key 集合（顶层 key/叶名），从 reactive layer 传入。
     */
    updateControls(changedKeys?: Set<string>): void {
        const _start = performance.now();
        if (changedKeys && changedKeys.size > 0) {
            // [doc:PACU] 有精确路径信息 → 只用匹配的控件
            for (const c of this._controls) {
                if (c.pathHint === undefined || changedKeys.has(c.pathHint)) {
                    c.update();
                }
            }
        } else {
            // 无路径信息 → 全量遍历（保守兼容）
            for (const c of this._controls) {
                c.update();
            }
        }
        const level = this.currentLevel;
        // [doc:adr-065] i18n 热切换：语言变化时，renderCustom 层级的 schema 标签与自定义 DOM
        // 均在渲染期经 t() 求值，须全量重建当前层才能刷新（纯 items 层由下方 itemBuilder patch 覆盖）。
        // [doc:P6] 层级提供 onLangChange 时优先走增量刷新，避免全量 reRender 丢失折叠/滚动状态。
        const lang = getLang();
        if (lang !== this._lastLang) {
            this._lastLang = lang;
            if (level?.onLangChange) {
                level.onLangChange();
            } else if (level?.renderCustom && this._getSlideList()) {
                this.reRender({ preserveFocus: true });
            }
        }
        // [doc:adr-065] 纯 items 层级语言热刷新：当前层持有 itemBuilder 时，
        // 重建 items 并增量 patch（仅当面板已渲染——避免对未打开/已 dispose 的菜单误触发全量 buildPanel）。
        if (level?.itemBuilder && this._getSlideList()) {
            level.items = level.itemBuilder();
            this.patchPanel(level.items);
        }
        const _elapsed = performance.now() - _start;
        if (_elapsed > 4) {
            logWarn(
                'perf:menu',
                `updateControls took ${_elapsed.toFixed(1)}ms (${this._controls.length} controls, itemBuilder=${!!level?.itemBuilder})`
            );
        }
    }

    private _doReRender(opts?: { preserveFocus?: boolean }): void {
        const level = this.currentLevel;
        if (!level) {
            return;
        }
        this._cachedExtraBtns = null;

        // [doc:pose-debug] 用 itemBuilder 刷新 items，确保 reRender 使用最新数据（如删除动作后根菜单及时更新）
        if (level.itemBuilder) {
            level.items = level.itemBuilder();
        }

        const finalize = () => {
            this.updateHeader(level);
            // reRenderCustom 路径是增量更新，不抢焦点
            const preserve = opts?.preserveFocus ?? level.reRenderCustom !== undefined;
            if (!preserve) {
                this.setupFocus();
            }
            this.onAfterRender?.(level, this);
        };

        const safeFinalize = () =>
            safeCallAsync('menu', 'finalize failed:', () => {
                finalize();
                return Promise.resolve();
            });

        if (level.reRenderCustom) {
            // === 增量路径：patch items（非空时）+ reRenderCustom ===
            const list = this._getSlideList();
            if (list) {
                if (level.items.length > 0) {
                    this.patchPanel(level.items);
                }
                level.reRenderCustom(list as HTMLElement);
                finalize();
                return;
            }
            // 没有旧 DOM → 退化为全量重建
            safeCallAsync('menu', 'buildPanel failed:', () =>
                this.buildPanel(level).then(safeFinalize)
            );
        } else if (level.renderCustom || level.items.length === 0) {
            // === 自定义渲染 / 空列表 → 全量重建 ===
            safeCallAsync('menu', 'buildPanel failed:', () =>
                this.buildPanel(level).then(safeFinalize)
            );
        } else {
            // === 纯 items → 全量重建（card-per-divider 结构不支持增量 patch） ===
            // [fix P2] 仅经 safeCallAsync 异步 finalize（buildPanel 完成后执行一次），
            // 删除下方同步 finalize() 调用，避免 onAfterRender/setupFocus 重复触发。
            safeCallAsync('menu', 'buildPanel failed:', () =>
                this.buildPanel(level).then(safeFinalize)
            );
        }
    }

    /** 重置导航栈到根层级，不触发渲染 */
    resetToRoot(): void {
        if (this.levels.length > 1) {
            this.levels = [this.levels[0]];
        }
    }

    getLevel(index: number): PopupLevel | undefined {
        return this.levels[index];
    }

    setLevel(index: number, level: PopupLevel): void {
        if (index >= 0 && index < this.levels.length) {
            this.levels[index] = level;
            // 如果替换的是当前显示层级，自动重绘
            if (index === this.levels.length - 1) {
                this.reRender();
            }
        }
    }

    /** 用新层级替换当前（栈顶）层级并触发重绘，常用于子菜单状态变化后刷新 */
    replaceCurrentLevel(level: PopupLevel): void {
        if (this.levels.length === 0) {
            return;
        }
        this.setLevel(this.levels.length - 1, level);
    }

    /**
     * 精准替换第 index 行的 DOM，不走 reRender 全量重建。
     * 常用于单行状态变化（开关、选中态等）。
     */
    updateRow(index: number, row: PopupRow): void {
        const level = this.currentLevel;
        if (!level || index < 0 || index >= level.items.length) {
            return;
        }
        level.items[index] = row;
        const list = this.panel.querySelector('.slide-list');
        if (!list) {
            return;
        }
        // [fix P2] 行被包在 .lcard 分组容器里（buildPanel），list.children 是组而非行——
        // 旧实现按 list.children[index] 定位在纯 items 菜单上永远错位（单行时还误把 lcard 换成裸行）。
        // 改为按 items 下标对齐 DOM 行：divider 不生成 DOM，跳过其占位。
        let domIndex = 0;
        for (let i = 0; i < index; i++) {
            if (level.items[i].kind !== 'divider') {
                domIndex++;
            }
        }
        const rowEls = Array.from(list.querySelectorAll('[data-row-key]'));
        const oldChild = rowEls[domIndex] as HTMLElement | undefined;
        if (oldChild) {
            const newEl = this.createRow(row);
            if (newEl) {
                oldChild.replaceWith(newEl);
            }
        }
    }

    /** 只刷新标题栏（返回按钮 + 标题 + 额外按钮），不碰面板 */
    refreshHeader(): void {
        const level = this.currentLevel;
        if (!level) {
            return;
        }
        this._cachedExtraBtns = null;
        this.updateHeader(level);
    }

    /** 强制结束当前动画，清除所有未决定时器，重置过渡状态 */
    private _cancelAnim(): void {
        this.transitioning = false;
        this._reRenderPending = false;
        this._pendingReRender = null;
        this._cancelTimeout();
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
    }

    /**
     * [fix:P0] 统一过渡结束收尾：置 transitioning=false + flush pending reRender。
     * push/pop 的 transitionend 回调与 setTimeout 兜底都调用此方法，
     * 杜绝"过渡期间 reRender 被静默丢弃，永不刷新"的时序漏洞。
     */
    private _endTransition(nextLevel: PopupLevel): void {
        this.transitioning = false;
        this.setupFocus();
        this.onAfterRender?.(nextLevel, this);
        this.onLevelEnter?.(nextLevel, this);
        const pending = this._pendingReRender;
        if (pending) {
            this._pendingReRender = null;
            this.reRender(pending.opts);
        }
    }

    /**
     * [fix:P3] 获取 .slide-list 引用：走 ref 缓存，失效时回退 querySelector 并回填。
     * buildPanel 每次重写 panel.innerHTML 会重建 list，因此在 buildPanel 成功 append 后重置 ref。
     */
    private _getSlideList(): HTMLElement | null {
        if (this._slideListRef && this._slideListRef.parentNode === this.panel) {
            return this._slideListRef;
        }
        const el = this.panel.querySelector('.slide-list') as HTMLElement | null;
        this._slideListRef = el;
        return el;
    }

    /** 记录一个由动画生命周期管理的 setTimeout */
    private _pushTimeout(id: ReturnType<typeof setTimeout>): void {
        this._pendingTimeouts.push(id);
    }

    /** 清除所有未决的动画后备 setTimeout */
    private _cancelTimeout(): void {
        for (const id of this._pendingTimeouts) {
            clearTimeout(id);
        }
        this._pendingTimeouts = [];
    }

    // ======== 内部方法 ========

    private get panelItems(): HTMLElement[] {
        // 契约制：只认 [data-nav-item] 标记。每次读前先补打标记，
        // 确保增量渲染（patchPanel/reRenderCustom 等不走 setupFocus 的路径）新增的行也被纳入。
        // markNavItem 内部 hasAttribute 短路，重复扫描成本极低。
        this._ensureNavMarkers();
        const all = this.panel.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR);
        return Array.from(all).filter((el) => !el.closest('[inert]'));
    }

    /**
     * 渲染后统一给面板内可交互行补打导航标记（data-nav-item + 聚焦目标 + 调值语义）。
     * 集中一处「类名→契约」映射，applyFocus/perKeySkip 只读契约、不关心类名。
     * 新控件若沿用既有行类（.cs-row/.toggle-row 等）自动纳入；全新类型在此加一条映射即可。
     */
    private _ensureNavMarkers(): void {
        const mark = (el: HTMLElement, opts?: NavItemOptions) => {
            if (!el.hasAttribute(NAV_ITEM_ATTR)) {
                markNavItem(el, opts);
            }
        };
        // 可点击行 / 折叠头：聚焦行本身，←→ 走激活/pop
        this.panel
            .querySelectorAll<HTMLElement>('.slide-item, .collapsible-header')
            .forEach((el) => mark(el));
        // 开关行：聚焦内部 checkbox，←→ 不让位（→/Enter 切换）
        this.panel
            .querySelectorAll<HTMLElement>('.toggle-row')
            .forEach((el) => mark(el, { focusSelector: 'input[type="checkbox"]' }));
        // 控件行 .cs-row：滑块聚焦 .cs-bar、模式切换器聚焦 .cs-top[role="slider"]，
        // 二者 ←→ 均让给控件自身调值；无控件的提示行（都不含）跳过不标记。
        this.panel.querySelectorAll<HTMLElement>('.cs-row').forEach((el) => {
            if (el.querySelector(`.${SLIDER_BAR_CLASS}`)) {
                mark(el, { focusSelector: `.${SLIDER_BAR_CLASS}`, horizontalAdjust: true });
            } else if (el.querySelector(`.cs-top[role="${ROLE.slider}"]`)) {
                mark(el, {
                    focusSelector: `.cs-top[role="${ROLE.slider}"]`,
                    horizontalAdjust: true,
                });
            }
        });
        // 模式切换行 .type-row：一排 .mode-btn 按钮 → 二维组导航（←→ 组内移动、Enter 触发）。
        this.panel
            .querySelectorAll<HTMLElement>('.type-row')
            .forEach((el) => mark(el, { groupSelector: '.mode-btn' }));
        // 预设 chips 组 .preset-group：一排 .preset-chip 按钮 → 二维组导航。
        // badge chip（只读）不可点击，若整组均为 badge 则组内无可聚焦子项 → navGroupMove 自然空转。
        this.panel.querySelectorAll<HTMLElement>('.preset-group').forEach((el) => {
            if (el.querySelector('.preset-chip:not(.badge)')) {
                mark(el, { groupSelector: '.preset-chip:not(.badge)' });
            }
        });
        // morph slider rows: 聚焦内部原生 range input，←→ 让给 slider 调值
        this.panel
            .querySelectorAll<HTMLElement>('.morph-row')
            .forEach((el) => mark(el, { focusSelector: '.morph-slider', horizontalAdjust: true }));
    }

    private clearFocus(): void {
        this.panel
            .querySelectorAll('.slide-focused')
            .forEach((el) => el.classList.remove('slide-focused'));
    }

    private applyFocus(): void {
        this.clearFocus();
        const items = this.panelItems;
        if (this.focusIndex < 0 || this.focusIndex >= items.length) {
            return;
        }
        const el = items[this.focusIndex];
        el.classList.add('slide-focused');
        el.scrollIntoView({ block: 'nearest' });
        // 契约制：聚焦目标由行的 data-nav-focus 声明（缺省行本身），
        // 保证 ←→ 调值/Enter 切换能落到内部控件。
        const focusTarget = navFocusTarget(el);
        if (document.activeElement !== focusTarget) {
            focusTarget.focus({ preventScroll: true });
        }
    }

    private setupFocus(): void {
        this.focusIndex = -1;
        this.clearFocus();
        if (this.panelItems.length > 0) {
            this.focusIndex = 0;
            this.applyFocus();
        } else {
            this.container.focus({ preventScroll: true });
        }
    }

    /**
     * 程序化焦点后移（循环）。键盘导航已改由 createKeyboardNav 驱动（走 setActiveIndex），
     * 保留此方法作为程序化 API + 单测契约。
     */
    private focusPrev(): void {
        const len = this.panelItems.length;
        if (len === 0) {
            return;
        }
        this.focusIndex = this.focusIndex <= 0 ? len - 1 : this.focusIndex - 1;
        this.applyFocus();
    }

    /** 程序化焦点前移（循环），同 focusPrev。 */
    private focusNext(): void {
        const len = this.panelItems.length;
        if (len === 0) {
            return;
        }
        this.focusIndex = this.focusIndex >= len - 1 ? 0 : this.focusIndex + 1;
        this.applyFocus();
    }

    private activateFocused(): void {
        const items = this.panelItems;
        if (this.focusIndex < 0 || this.focusIndex >= items.length) {
            return;
        }
        items[this.focusIndex].click();
    }

    private _buildSeq = 0;

    // ======== 增量渲染 ========

    /** 生成行的稳定标识 key：优先用 row.rowKey，否则按 kind:target 自动推导 */
    private rowKey(row: PopupRow): string {
        if (row.rowKey) {
            return row.rowKey;
        }
        if (row.kind === 'divider') {
            return '__divider__';
        }
        // [doc:adr-129] sectionTitle 用 label 区分（target 通常为空），避免多个标题行 key 撞车
        if (row.kind === 'sectionTitle') {
            return `sectionTitle:${row.label}`;
        }
        return `${row.kind}:${row.target}`;
    }

    /** 增量 patch 当前 panel：只创建/替换/删除有变化的行 */
    private patchPanel(items: PopupRow[]): void {
        // [fix] itemBuilder 返回空列表时不能静默保留旧行：回退到 buildPanel，
        // 与 _doReRender 的空 items 路径一致（渲染空态并清空旧 DOM/控件注册表）。
        if (items.length === 0) {
            this.buildPanel(this.currentLevel!);
            return;
        }
        const list = this._getSlideList();
        if (!list) {
            this.buildPanel(this.currentLevel!);
            return;
        }

        // [doc:adr-NNN] 多 lcard（card-per-divider）场景：按 divider 分割 items，
        // 分别 patch 到对应的 lcard，避免全量重建
        const cards = list.querySelectorAll(':scope > .lcard') as NodeListOf<HTMLElement>;
        // 只要 items 含 divider，统一走多 card 分段 patch：单 lcard 的前导/尾随 divider
        // 也能按 buildPanel 语义跳过占位，避免把 divider 误塞进 lcard 或逐行错位。
        if (cards.length > 1 || items.some((row) => row.kind === 'divider')) {
            this._patchMultiCard(cards, items);
            return;
        }

        // 单容器（无 lcard 或仅一个）→ 原有逻辑
        const card = cards.length === 1 ? cards[0] : null;
        const container = card || list;
        const oldChildren = Array.from(container.children) as HTMLElement[];

        // 1. 删除多余的行（从后往前，避免索引偏移）
        for (let i = oldChildren.length - 1; i >= items.length; i--) {
            oldChildren[i].remove();
        }

        // 2. 逐行比较
        for (let i = 0; i < items.length; i++) {
            const newRow = items[i];
            const newKey = this.rowKey(newRow);

            if (i < oldChildren.length) {
                const oldEl = oldChildren[i];
                const oldKey = oldEl.dataset.rowKey || '';
                if (oldKey !== newKey) {
                    // key 不匹配 → 替换整行
                    const newEl = this.createRow(newRow);
                    if (newEl) {
                        oldEl.replaceWith(newEl);
                    }
                } else {
                    // [doc:adr-065] key 匹配但语言可能已切换：原地刷新可见文本（label/hint），
                    // 不重建 DOM、保留已有监听器与键盘焦点。控件行（slider/toggle/…）由 registerControl 管理，跳过。
                    this.refreshRowText(oldEl, newRow);
                }
            } else {
                // 追加新行
                const newEl = this.createRow(newRow);
                if (newEl) {
                    container.appendChild(newEl);
                }
            }
        }
    }

    /** 多 lcard 场景：按 divider 分割 items，逐 card patch */
    private _patchMultiCard(cards: NodeListOf<HTMLElement>, items: PopupRow[]): void {
        // 按 divider 分割 items（与 buildPanel 分组逻辑一致：divider 本身不归属任何组）
        const segments: PopupRow[][] = [];
        let cur: PopupRow[] = [];
        for (const row of items) {
            if (row.kind === 'divider') {
                if (cur.length > 0) {
                    segments.push(cur);
                    cur = [];
                }
                continue;
            }
            cur.push(row);
        }
        if (cur.length > 0) {
            segments.push(cur);
        }

        // lcard 数与分组数不匹配 → items 结构变化，回退全量重建
        if (cards.length !== segments.length) {
            this.buildPanel(this.currentLevel!);
            return;
        }

        // 逐个 lcard 独立 patch
        for (let c = 0; c < cards.length; c++) {
            const container = cards[c];
            const seg = segments[c];
            const oldChildren = Array.from(container.children) as HTMLElement[];

            // 删除多余的行
            for (let i = oldChildren.length - 1; i >= seg.length; i--) {
                oldChildren[i].remove();
            }

            // 逐行比较
            for (let i = 0; i < seg.length; i++) {
                const newRow = seg[i];
                const newKey = this.rowKey(newRow);

                if (i < oldChildren.length) {
                    const oldEl = oldChildren[i];
                    const oldKey = oldEl.dataset.rowKey || '';
                    if (oldKey !== newKey) {
                        const newEl = this.createRow(newRow);
                        if (newEl) {
                            oldEl.replaceWith(newEl);
                        }
                    } else {
                        this.refreshRowText(oldEl, newRow);
                    }
                } else {
                    const newEl = this.createRow(newRow);
                    if (newEl) {
                        container.appendChild(newEl);
                    }
                }
            }
        }
    }

    /**
     * [doc:adr-065] 原地刷新单行可见文本（语言热切换用）。
     * 更新 folder/action/model 行的 label / data-hint / trailing 标题，不重建 DOM、不丢焦点与监听器。
     * 控件行（slider/toggle/modeSlider/chips）由 registerControl 管理，此处跳过。
     */
    private refreshRowText(el: HTMLElement, row: PopupRow): void {
        if (
            row.kind === 'slider' ||
            row.kind === 'toggle' ||
            row.kind === 'modeSlider' ||
            row.kind === 'chips'
        ) {
            return;
        }
        // [doc:adr-129] sectionTitle：直接更新 textContent（无 .slide-label 子元素）
        if (row.kind === 'sectionTitle') {
            el.textContent = row.label ?? '';
            return;
        }
        const labelEl = el.querySelector('.slide-label') as HTMLElement | null;
        if (labelEl) {
            labelEl.textContent = row.label ?? '';
        }
        const hint = row.sublabel || (row.model ? t('menu.noDesc') : t('menu.noHint'));
        el.setAttribute('data-hint', hint);
        // [doc:P8] 刷新 trailing 按钮的 title 文本（图标不换 — lucide icon 名不变）
        if (row.trailing) {
            const trailingBtn = el.querySelector('.slide-trailing-btn') as HTMLElement | null;
            if (trailingBtn) {
                trailingBtn.title = row.trailing.title ?? '';
            }
        }
    }

    private async buildPanel(level: PopupLevel): Promise<void> {
        const seq = ++this._buildSeq;
        this.panel.innerHTML = '';
        // [fix:P3] panel 重置，slide-list ref 必然失效，提前清空避免返回悬挂引用
        this._slideListRef = null;
        // 释放上一次 renderCustom 返回的 dispose
        this._customDispose?.();
        this._customDispose = null;
        // 每次重建面板，清空旧的控件注册表
        this._controls = [];
        const list = document.createElement('div');
        list.className = 'slide-list';

        if (level.items.length === 0 && !level.renderCustom) {
            list.innerHTML = '<div class="slide-empty">' + t('common.empty') + '</div>';
        } else if (level.items.length > 0 && !level.renderCustom) {
            // 纯 items 菜单：按 divider 分组，每组包一个 lcard
            let card: HTMLElement | null = null;
            for (const row of level.items) {
                if (row.kind === 'divider') {
                    card = null; // 关闭当前组，下一个非 divider 行开启新组
                    continue;
                }
                if (!card) {
                    card = document.createElement('div');
                    card.className = 'lcard';
                    list.appendChild(card);
                }
                const el = this.createRow(row);
                if (el) {
                    card.appendChild(el);
                }
            }
        } else {
            // 有 renderCustom：先渲染 items 导航行，再调自定义回调
            for (const row of level.items) {
                const el = this.createRow(row);
                if (el) {
                    list.appendChild(el);
                }
            }
            pushRenderingContext(this);
            try {
                const result = await level.renderCustom(list);
                // [fix P2] seq 守卫：dispose 后挂起的 renderCustom 完成时不得覆盖
                // _customDispose（可能已被新 build 或 dispose 置空/替换），
                // 否则其返回的 dispose 会被永久悬挂（observer/virtualGrid 泄漏）。
                if (typeof result === 'function' && seq === this._buildSeq) {
                    this._customDispose = result;
                } else if (typeof result === 'function') {
                    // 过期 build：立即释放返回的 dispose，避免悬挂
                    result();
                }
            } catch (err) {
                // [audit-p4] 原始 err.message 可能含内部技术信息，仅进日志；UI 展示友好翻译文案
                console.error('[SlideMenu] renderCustom failed:', err);
                const empty = document.createElement('div');
                empty.className = 'slide-empty';
                empty.style.color = 'var(--danger)';
                empty.textContent = t('menu.renderFailed');
                list.appendChild(empty);
            } finally {
                popRenderingContext();
            }
        }
        // 只有最新的 build 才 appendChild，防止并发导致重复
        if (seq === this._buildSeq) {
            this.panel.appendChild(list);
            this._slideListRef = list;
        }
    }

    /** 释放所有资源（清除动画定时器、键盘/触摸监听、状态），调用后实例不可再用。 */
    dispose(): void {
        // [fix P2] 递增构建序号：使挂起的 buildPanel 完成后 seq 检查失败——
        // 不再 appendChild 到已清空的 panel，且 renderCustom 返回值被立即释放（见 buildPanel）。
        this._buildSeq++;
        this._cancelAnim();
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this._keydownDisp?.dispose();
        this._keydownDisp = null;
        this._groupNavDisp?.dispose();
        this._groupNavDisp = null;
        this._swipeTouchStartDisp?.dispose();
        this._swipeTouchStartDisp = null;
        this._swipeTouchStartHandler = null;
        this._swipeTouchEndDisp?.dispose();
        this._swipeTouchEndDisp = null;
        this._swipeTouchEndHandler = null;
        this.levels = [];
        this._cachedExtraBtns = null;
        // 清理 initControl 注册的闭包引用 + panel DOM（ADR-106 补全）
        this._customDispose?.();
        this._customDispose = null;
        this._controls = [];
        _liveMenus.delete(this);
        this._isOpen = false;
        this.panel.innerHTML = '';
    }

    private updateHeader(level: PopupLevel): void {
        this.headerEl.innerHTML = '';
        const backBtn = document.createElement('span');
        backBtn.className = 'slide-back';
        const backIcon = createIconifyIcon(
            this.levels.length > 1 ? 'lucide:chevron-left' : 'lucide:x'
        );
        if (backIcon) {
            backBtn.appendChild(backIcon);
        }
        if (this.levels.length > 1) {
            backBtn.addEventListener('click', () => this.pop());
        } else {
            // [fix P2] optional 链：外部直接构造 SlideMenu 且未传 onClose 时，点 X 不抛 TypeError
            backBtn.addEventListener('click', () => this.onClose?.());
        }
        this.headerEl.appendChild(backBtn);

        const title = document.createElement('span');
        title.className = 'slide-title';
        title.textContent = level.label || '';
        this.headerEl.appendChild(title);

        // === headerToggle 开关（弹窗标题旁）===
        const ht = level.headerToggle;
        if (ht) {
            const toggle = createHeaderToggle({
                value: ht.value,
                onChange: (v) => ht.onChange(v),
                bind: ht.bind,
            });
            this.headerEl.appendChild(toggle);
            // bind 自更新已由 createHeaderToggle 内部注册
        }

        // 复用额外按钮，避免每次重建创建新 DOM + 旧监听器泄漏
        if (!this._cachedExtraBtns) {
            this._cachedExtraBtns = this.extraButtonFactory?.() ?? [];
        }
        for (const btn of this._cachedExtraBtns) {
            this.headerEl.appendChild(btn);
        }
    }

    private createRow(row: PopupRow): HTMLElement | null {
        if (row.kind === 'divider') {
            const el = document.createElement('div');
            el.className = 'slide-divider';
            return el;
        }

        // [doc:adr-129] sectionTitle：lcard 内视觉分组的标题行（非交互，仅渲染 .section-title）
        if (row.kind === 'sectionTitle') {
            const el = document.createElement('div');
            el.className = 'section-title';
            el.textContent = row.label;
            el.dataset.rowKey = this.rowKey(row);
            return el;
        }

        // ======== 新 kind：slider / toggle / modeSlider / chips ========
        // 这些 kind 不是可点击的导航行，而是内嵌控件行。
        // 通过 ui-helpers 渲染，包一层带 rowKey 的 wrapper 以支持增量 patch。
        if (
            row.kind === 'slider' ||
            row.kind === 'toggle' ||
            row.kind === 'modeSlider' ||
            row.kind === 'chips'
        ) {
            const wrapper = document.createElement('div');
            wrapper.dataset.rowKey = this.rowKey(row);
            wrapper.dataset.testid = this.rowKey(row);
            if (row.kind === 'slider') {
                addSliderRow(
                    wrapper,
                    row.label,
                    row.sliderValue ?? 0,
                    row.sliderMin ?? 0,
                    row.sliderMax ?? 1,
                    row.sliderStep ?? 0.1,
                    row.onSliderChange ?? (() => {}),
                    row.icon || undefined,
                    row.onSliderDragEnd
                );
            } else if (row.kind === 'toggle') {
                addToggleRow(
                    wrapper,
                    row.label,
                    row.toggleValue ?? false,
                    row.onToggleChange ?? (() => {}),
                    row.icon || undefined
                );
            } else if (row.kind === 'modeSlider') {
                addModeSlider(
                    wrapper,
                    row.label,
                    row.modeOptions ?? [],
                    row.modeValue as string & (string | number),
                    row.onModeChange ?? (() => {}),
                    row.icon || undefined
                );
            } else if (row.kind === 'chips') {
                wrapper.className = 'preset-group';
                for (const chip of row.chips ?? []) {
                    addPresetChip(wrapper, chip.label, !!chip.active, chip.onClick);
                }
            }
            return wrapper;
        }

        // ======== folder / model / action：原有 slide-item 逻辑 ========

        // folder + headerToggle：委托给 slideRow（与 renderCustom 中的视觉一致）
        if (row.kind === 'folder' && row.headerToggle) {
            const wrapper = document.createElement('div');
            slideRow(
                wrapper,
                row.icon,
                row.label,
                true,
                async () => {
                    const next = await this.onFolderEnter?.(row, this);
                    if (next) {
                        this.push(next);
                    }
                },
                row.sublabel,
                undefined,
                undefined,
                row.headerToggle
            );
            const el = wrapper.firstChild as HTMLElement | null;
            if (el) {
                el.dataset.rowKey = this.rowKey(row);
                el.dataset.testid = this.rowKey(row);
                const hint = row.sublabel || t('menu.noHint');
                el.setAttribute('data-hint', hint);
                el.addEventListener('mouseenter', () => {
                    if (this.focusIndex >= 0) {
                        this.clearFocus();
                        this.focusIndex = -1;
                    }
                    showHint(hint);
                    this.onHover?.(row, true);
                });
                el.addEventListener('mouseleave', () => {
                    hideHint();
                    this.onHover?.(row, false);
                });
            }
            return el;
        }

        const el = document.createElement('div');
        el.className = 'slide-item' + (row.focused ? ' slide-focused' : '');
        el.tabIndex = 0;
        el.role = ROLE.button;
        el.dataset.rowKey = this.rowKey(row);
        el.dataset.testid = this.rowKey(row);
        const hint = row.sublabel || (row.model ? t('menu.noDesc') : t('menu.noHint'));
        el.setAttribute('data-hint', hint);

        // === 统一左侧行为区：leading 优先于纯展示 .slide-icon（互斥）===
        // leading 存在时，左侧图标被渲染为可点击按钮（保持 radio 指示视觉），
        // 点击 stopPropagation 后触发该动作（如切焦点），与整行 onClick 解耦。
        if (row.leading) {
            el.appendChild(createLeadingBtn(row.leading));
        } else {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'slide-icon';
            const iconEl = createIconifyIcon(row.icon);
            if (iconEl) {
                iconSpan.appendChild(iconEl);
            } else {
                iconSpan.textContent = row.icon;
            }
            el.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.className = 'slide-label' + (row.wrapLabel ? ' wrap-2' : '');
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        // === 统一尾部行为区：trailing | +(onAddClick) | 装饰 `>`（三者互斥）===
        // 只要设置了第二点击事件+图标(trailing)，或 +(onAddClick)，装饰性 `>` 即被取代，
        // 从构造上杜绝「文件夹既渲染 > 又渲染第二按钮」的误渲染。
        if (row.trailing) {
            el.appendChild(createTrailingBtn(row.trailing));
        } else if (row.onAddClick) {
            // `+` 用 lucide:plus 图标，与 trailing 齿轮/leading radio 统一 iconify 渲染（21px 顶满）
            el.appendChild(
                createTrailingBtn({
                    icon: 'lucide:plus',
                    title: t('library.loadModel'),
                    onClick: (_e) => row.onAddClick!(),
                })
            );
        } else if (row.kind === 'folder') {
            const arrow = document.createElement('span');
            arrow.className = 'slide-arrow';
            arrow.textContent = '>';
            el.appendChild(arrow);
        }

        if (row.kind === 'folder') {
            el.addEventListener('click', async (e) => {
                if ((e.target as HTMLElement).closest('.slide-add-btn')) {
                    return;
                }
                const next = await this.onFolderEnter?.(row, this);
                if (next) {
                    this.push(next);
                }
            });
        } else {
            el.addEventListener('click', () => this.onItemClick(row, this));
        }

        el.addEventListener('mouseenter', () => {
            if (this.focusIndex >= 0) {
                this.clearFocus();
                this.focusIndex = -1;
            }
            showHint(hint);
            this.onHover?.(row, true);
        });
        el.addEventListener('mouseleave', () => {
            hideHint();
            this.onHover?.(row, false);
        });

        return el;
    }
}
