import { PopupLevel, PopupRow, showHint, hideHint } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addToggleRow, addModeSlider } from '../core/ui-helpers';
import { subscribe } from '../core/reactivity';
import { t } from '../core/i18n/t';
import { logWarn } from '../core/utils';
import { addDisposableListener, type Disposable } from '../core/dom';

/** 菜单过渡时间常量（与 app.css :root --menu-transition-duration 同步） */
const TRANSITION_DURATION = '0.15s';
const TRANSITION_DURATION_FAST = '0.12s';

/** 渲染上下文栈 — 控件创建函数通过 getCurrentRenderingMenu() 获得当前菜单 */
const _renderingStack: SlideMenu[] = [];

/** 获取当前正在渲染的 SlideMenu 实例（供 ui-helpers 中的控件函数自动注册） */
export function getCurrentRenderingMenu(): SlideMenu | null {
    return _renderingStack[_renderingStack.length - 1] ?? null;
}

export class SlideMenu {
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
    /** keydown 监听器引用，供 dispose 清理 */
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    /** 触屏滑动手势起始坐标 */
    private _swipeStartX = 0;
    private _swipeStartY = 0;
    private _swipeTouchStartHandler: ((e: TouchEvent) => void) | null = null;
    private _swipeTouchEndHandler: ((e: TouchEvent) => void) | null = null;
    private _keydownDisp: Disposable | null = null;
    private _swipeTouchStartDisp: Disposable | null = null;
    private _swipeTouchEndDisp: Disposable | null = null;
    /** 自更新控件注册表 — 每个元素有 update() 方法，由 updateControls() 统一调用 */
    private _controls: Array<{ update: () => void }> = [];
    /** 响应式订阅取消函数 — dispose 时调用 */
    private _unsubscribe: (() => void) | null = null;

    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null | Promise<PopupLevel | null>;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    onClose?: () => void;
    extraButtonFactory?: () => HTMLElement[];
    /** 每次 level 变更（push/pop）后回调，供外部持久化当前目录等状态 */
    onLevelEnter?: (level: PopupLevel, menu: SlideMenu) => void;

    constructor(opts: {
        container: HTMLElement;
        onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
        onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null | Promise<PopupLevel | null>;
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

        // 键盘导航
        this.container.tabIndex = -1;
        this._keydownHandler = (e) => {
            if (this.transitioning) {
                return;
            }
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.focusNext();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.focusPrev();
                    break;
                case 'ArrowRight':
                case 'Enter':
                    e.preventDefault();
                    this.activateFocused();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.pop();
                    break;
            }
        };
        this._keydownDisp = addDisposableListener(this.container, 'keydown', this._keydownHandler);

        // 触屏手势：右滑返回上一层级
        this._swipeStartX = 0;
        this._swipeStartY = 0;
        this._swipeTouchStartHandler = (e: TouchEvent) => {
            if (e.touches.length === 1) {
                this._swipeStartX = e.touches[0].clientX;
                this._swipeStartY = e.touches[0].clientY;
            }
        };
        this._swipeTouchEndHandler = (e: TouchEvent) => {
            if (this.transitioning || this.levels.length <= 1) {
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

        // 响应式订阅：状态变更 → 自动 updateControls
        this._unsubscribe = subscribe(() => this.updateControls());
    }

    // ======== 公共 API ========

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    get levelCount(): number {
        return this.levels.length;
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
        this.buildPanel(level).then(() => {
            this.updateHeader(level);
            this.setupFocus();
            this.onAfterRender?.(level, this);
            this.onLevelEnter?.(level, this);
        });
    }

    push(level: PopupLevel): void {
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
            fadeOutDisp?.dispose();
            fadeOutDisp = null;
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
                fadeInDisp?.dispose();
                fadeInDisp = null;
                this._cancelTimeout();
                this.transitioning = false;
                this.setupFocus();
                this.onAfterRender?.(level, this);
            this.onLevelEnter?.(level, this);
            };
            fadeInDisp = addDisposableListener(this.panel, 'transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateX(0)';
                        this.transitioning = false;
                        this.setupFocus();
                        this.onAfterRender?.(level, this);
                        this.onLevelEnter?.(level, this);
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

        this.panel.style.transition = `opacity ${TRANSITION_DURATION_FAST} ease, transform ${TRANSITION_DURATION_FAST} ease`;
        this.panel.style.opacity = '0';
        this.panel.style.transform = 'translateX(8px)';

        let fadeOutDisp: Disposable | null = null;
        const onFadeOut = async () => {
            fadeOutDisp?.dispose();
            fadeOutDisp = null;
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
                fadeInDisp?.dispose();
                fadeInDisp = null;
                this._cancelTimeout();
                this.transitioning = false;
                this.setupFocus();
                this.onAfterRender?.(prevLevel, this);
                this.onLevelEnter?.(prevLevel, this);
            };
            fadeInDisp = addDisposableListener(this.panel, 'transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateX(0)';
                        this.transitioning = false;
                        this.setupFocus();
                        this.onAfterRender?.(prevLevel, this);
                        this.onLevelEnter?.(prevLevel, this);
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
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
        this.buildPanel(level).then(() => {
            this.updateHeader(level);
            this.setupFocus();
            this.onAfterRender?.(level, this);
            this.onLevelEnter?.(level, this);
        });
    }

    reRender(opts?: { preserveFocus?: boolean }): void {
        if (this.transitioning) {
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

    /** 注册一个自更新控件，由 updateControls() 统一驱动刷新 */
    registerControl(update: () => void): void {
        this._controls.push({ update });
    }

    /** 增量刷新所有已注册的自更新控件（不重建 DOM） */
    updateControls(): void {
        const _start = performance.now();
        for (const c of this._controls) {
            c.update();
        }
        // [doc:adr-065] 纯 items 层级语言热刷新：当前层持有 itemBuilder 时，
        // 重建 items 并增量 patch（仅当面板已渲染——避免对未打开/已 dispose 的菜单误触发全量 buildPanel）。
        const level = this.currentLevel;
        if (level?.itemBuilder && this.panel.querySelector('.slide-list')) {
            level.items = level.itemBuilder();
            this.patchPanel(level.items);
        }
        const _elapsed = performance.now() - _start;
        if (_elapsed > 4) {
            logWarn('perf:menu', `updateControls took ${_elapsed.toFixed(1)}ms (${this._controls.length} controls, itemBuilder=${!!level?.itemBuilder})`);
        }
    }

    private _doReRender(opts?: { preserveFocus?: boolean }): void {
        const level = this.currentLevel;
        if (!level) {
            return;
        }
        this._cachedExtraBtns = null;

        const finalize = () => {
            this.updateHeader(level);
            // reRenderCustom 路径是增量更新，不抢焦点
            const preserve = opts?.preserveFocus ?? level.reRenderCustom !== undefined;
            if (!preserve) {
                this.setupFocus();
            }
            this.onAfterRender?.(level, this);
        };

        if (level.reRenderCustom) {
            // === 增量路径：patch items（非空时）+ reRenderCustom ===
            const list = this.panel.querySelector('.slide-list');
            if (list) {
                if (level.items.length > 0) {
                    this.patchPanel(level.items);
                }
                level.reRenderCustom(list as HTMLElement);
                finalize();
                return;
            }
            // 没有旧 DOM → 退化为全量重建
            this.buildPanel(level).then(finalize);
        } else if (level.renderCustom || level.items.length === 0) {
            // === 自定义渲染 / 空列表 → 全量重建 ===
            this.buildPanel(level).then(finalize);
        } else {
            // === 纯 items → 全量重建（card-per-divider 结构不支持增量 patch） ===
            this.buildPanel(level).then(finalize);
            finalize();
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
        const oldChild = list.children[index] as HTMLElement | undefined;
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
        this._cancelTimeout();
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateX(0)';
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

    private get panelItems(): NodeListOf<HTMLElement> {
        return this.panel.querySelectorAll<HTMLElement>('.slide-item');
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
        items[this.focusIndex].classList.add('slide-focused');
        items[this.focusIndex].scrollIntoView({ block: 'nearest' });
    }

    private setupFocus(): void {
        this.focusIndex = -1;
        this.clearFocus();
        if (this.panelItems.length > 0) {
            this.focusIndex = 0;
            this.applyFocus();
        }
        this.container.focus({ preventScroll: true });
    }

    private focusPrev(): void {
        const len = this.panelItems.length;
        if (len === 0) {
            return;
        }
        this.focusIndex = this.focusIndex <= 0 ? len - 1 : this.focusIndex - 1;
        this.applyFocus();
    }

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
        return `${row.kind}:${row.target}`;
    }

    /** 增量 patch 当前 panel：只创建/替换/删除有变化的行 */
    private patchPanel(items: PopupRow[]): void {
        if (items.length === 0) {
            return;
        }
        const list = this.panel.querySelector('.slide-list');
        if (!list) {
            this.buildPanel(this.currentLevel!);
            return;
        }

        // [doc:adr-NNN] 多 lcard（card-per-divider）场景：按 divider 分割 items，
        // 分别 patch 到对应的 lcard，避免全量重建
        const cards = list.querySelectorAll(':scope > .lcard') as NodeListOf<HTMLElement>;
        if (cards.length > 1) {
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
     * 仅更新 folder/action/model 行的 label / data-hint，不重建 DOM、不丢焦点与监听器。
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
        const labelEl = el.querySelector('.slide-label') as HTMLElement | null;
        if (labelEl) {
            labelEl.textContent = row.label ?? '';
        }
        const hint = row.sublabel || (row.model ? t('menu.noDesc') : t('menu.noHint'));
        el.setAttribute('data-hint', hint);
    }

    private async buildPanel(level: PopupLevel): Promise<void> {
        const seq = ++this._buildSeq;
        this.panel.innerHTML = '';
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
            _renderingStack.push(this);
            try {
                await level.renderCustom(list);
            } catch (err) {
                console.error('[SlideMenu] renderCustom failed:', err);
                list.innerHTML = `<div class="slide-empty" style="color:var(--danger);">加载失败: ${err instanceof Error ? err.message : '未知错误'}</div>`;
            } finally {
                _renderingStack.pop();
            }
        }
        // 只有最新的 build 才 appendChild，防止并发导致重复
        if (seq === this._buildSeq) {
            this.panel.appendChild(list);
        }
    }

    /** 释放所有资源（清除动画定时器、键盘/触摸监听、状态），调用后实例不可再用。 */
    dispose(): void {
        this._cancelAnim();
        if (this._unsubscribe) {
            this._unsubscribe();
            this._unsubscribe = null;
        }
        this._keydownDisp?.dispose();
        this._keydownDisp = null;
        this._keydownHandler = null;
        this._swipeTouchStartDisp?.dispose();
        this._swipeTouchStartDisp = null;
        this._swipeTouchStartHandler = null;
        this._swipeTouchEndDisp?.dispose();
        this._swipeTouchEndDisp = null;
        this._swipeTouchEndHandler = null;
        this.levels = [];
        this._cachedExtraBtns = null;
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
            backBtn.addEventListener('click', () => this.onClose());
        }
        this.headerEl.appendChild(backBtn);

        const title = document.createElement('span');
        title.className = 'slide-title';
        title.textContent = level.label || '';
        this.headerEl.appendChild(title);

        // === headerToggle 开关（弹窗标题旁）===
        const ht = level.headerToggle;
        if (ht) {
            const toggle = document.createElement('label');
            toggle.className = 'toggle header-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = ht.value;
            const slider = document.createElement('span');
            slider.className = 'slider';
            toggle.appendChild(input);
            toggle.appendChild(slider);
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                input.checked = !input.checked;
                ht.onChange(input.checked);
            });
            this.headerEl.appendChild(toggle);

            // 自更新支持
            if (ht.bind) {
                let cached = ht.value;
                const update = () => {
                    const v = !!ht.bind!();
                    if (v !== cached) {
                        cached = v;
                        input.checked = v;
                    }
                };
                this.registerControl(update);
            }
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
                    const btn = document.createElement('button');
                    btn.textContent = chip.label;
                    btn.className = 'preset-chip' + (chip.active ? ' active' : '');
                    btn.addEventListener('click', chip.onClick);
                    wrapper.appendChild(btn);
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
        el.className = 'slide-item';
        el.dataset.rowKey = this.rowKey(row);
        const hint = row.sublabel || (row.model ? t('menu.noDesc') : t('menu.noHint'));
        el.setAttribute('data-hint', hint);

        const iconSpan = document.createElement('span');
        iconSpan.className = 'slide-icon';
        const iconEl = createIconifyIcon(row.icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        } else {
            iconSpan.textContent = row.icon;
        }
        el.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'slide-label' + (row.wrapLabel ? ' wrap-2' : '');
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        if (row.kind === 'folder') {
            const arrow = document.createElement('span');
            arrow.className = 'slide-arrow';
            arrow.textContent = '>';
            el.appendChild(arrow);
        }

        if (row.onAddClick) {
            const addBtn = document.createElement('span');
            addBtn.className = 'slide-add-btn';
            addBtn.textContent = '+';
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                row.onAddClick!();
            });
            el.appendChild(addBtn);
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
