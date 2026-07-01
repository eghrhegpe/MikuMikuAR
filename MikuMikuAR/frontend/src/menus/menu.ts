import { PopupLevel, PopupRow, showHint, hideHint } from '../core/config';
import { createIconifyIcon } from '../core/icons';

/** 菜单过渡时间常量（与 app.css :root --menu-transition-duration 同步） */
const TRANSITION_DURATION = '0.15s';
const TRANSITION_DURATION_FAST = '0.12s';

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
    /** keydown 监听器引用，供 dispose 清理 */
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
    onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null;
    onHover?: (row: PopupRow, entering: boolean) => void;
    onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
    onClose?: () => void;
    extraButtonFactory?: () => HTMLElement[];

    constructor(opts: {
        container: HTMLElement;
        onItemClick?: (row: PopupRow, menu: SlideMenu) => void;
        onFolderEnter?: (row: PopupRow, menu: SlideMenu) => PopupLevel | null;
        onHover?: (row: PopupRow, entering: boolean) => void;
        onAfterRender?: (level: PopupLevel, menu: SlideMenu) => void;
        onClose?: () => void;
        extraButtonFactory?: () => HTMLElement[];
    }) {
        this.container = opts.container;
        this.onItemClick = opts.onItemClick;
        this.onFolderEnter = opts.onFolderEnter;
        this.onHover = opts.onHover;
        this.onAfterRender = opts.onAfterRender;
        this.onClose = opts.onClose;
        this.extraButtonFactory = opts.extraButtonFactory;

        this.container.innerHTML = '';
        this.container.classList.add('slide-menu');

        this.viewport = document.createElement('div');
        this.viewport.className = 'slide-viewport';

        this.panel = document.createElement('div');
        this.panel.className = 'slide-panel';
        // 内联样式由 CSS 控制，只设置必要的过渡
        this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateY(0)';
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
        this.container.addEventListener('keydown', this._keydownHandler);
    }

    // ======== 公共 API ========

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    get levelCount(): number {
        return this.levels.length;
    }

    reset(level: PopupLevel): void {
        this._cancelAnim();
        this.levels = [level];
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateY(0)';
        this.buildPanel(level).then(() => {
            this.updateHeader(level);
            this.setupFocus();
            this.onAfterRender?.(level, this);
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
        this.panel.style.transform = 'translateY(-8px)';

        const onFadeOut = async () => {
            this.panel.removeEventListener('transitionend', onFadeOut);
            await this.buildPanel(level);
            this.updateHeader(level);
            // 新内容从下方淡入
            this.panel.style.transition = 'none';
            this.panel.style.opacity = '0';
            this.panel.style.transform = 'translateY(8px)';
            void this.panel.offsetHeight;
            this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
            this.panel.style.opacity = '1';
            this.panel.style.transform = 'translateY(0)';

            const onFadeIn = () => {
                this.panel.removeEventListener('transitionend', onFadeIn);
                this._cancelTimeout();
                this.transitioning = false;
                this.setupFocus();
                this.onAfterRender?.(level, this);
            };
            this.panel.addEventListener('transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateY(0)';
                        this.transitioning = false;
                        this.setupFocus();
                        this.onAfterRender?.(level, this);
                    }
                }, 200)
            );
        };

        this.panel.addEventListener('transitionend', onFadeOut);
        this._pushTimeout(
            setTimeout(() => {
                if (this.transitioning) {
                    this.panel.style.opacity = '0';
                    this.panel.style.transform = 'translateY(-8px)';
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
        this.panel.style.transform = 'translateY(8px)';

        const onFadeOut = async () => {
            this.panel.removeEventListener('transitionend', onFadeOut);
            await this.buildPanel(prevLevel);
            this.updateHeader(prevLevel);
            this.panel.style.transition = 'none';
            this.panel.style.opacity = '0';
            this.panel.style.transform = 'translateY(-8px)';
            void this.panel.offsetHeight;
            this.panel.style.transition = `opacity ${TRANSITION_DURATION} ease, transform ${TRANSITION_DURATION} ease`;
            this.panel.style.opacity = '1';
            this.panel.style.transform = 'translateY(0)';

            const onFadeIn = () => {
                this.panel.removeEventListener('transitionend', onFadeIn);
                this._cancelTimeout();
                this.transitioning = false;
                this.setupFocus();
                this.onAfterRender?.(prevLevel, this);
            };
            this.panel.addEventListener('transitionend', onFadeIn);
            this._pushTimeout(
                setTimeout(() => {
                    if (this.transitioning) {
                        this.panel.style.opacity = '1';
                        this.panel.style.transform = 'translateY(0)';
                        this.transitioning = false;
                        this.setupFocus();
                        this.onAfterRender?.(prevLevel, this);
                    }
                }, 200)
            );
        };

        this.panel.addEventListener('transitionend', onFadeOut);
        this._pushTimeout(
            setTimeout(() => {
                if (this.transitioning) {
                    this.panel.style.opacity = '0';
                    this.panel.style.transform = 'translateY(8px)';
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
        this.panel.style.transform = 'translateY(0)';
        this.buildPanel(level).then(() => {
            this.updateHeader(level);
            this.setupFocus();
            this.onAfterRender?.(level, this);
        });
    }

    reRender(): void {
        if (this.transitioning) {
            return;
        }
        const level = this.currentLevel;
        if (!level) {
            return;
        }
        this._cachedExtraBtns = null;
        this.buildPanel(level).then(() => {
            this.updateHeader(level);
            this.setupFocus();
            this.onAfterRender?.(level, this);
        });
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

    /** 强制结束当前动画，清除所有未决定时器，重置过渡状态 */
    private _cancelAnim(): void {
        this.transitioning = false;
        this._cancelTimeout();
        this.panel.style.transition = 'none';
        this.panel.style.opacity = '1';
        this.panel.style.transform = 'translateY(0)';
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

    private async buildPanel(level: PopupLevel): Promise<void> {
        this.panel.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'slide-list';

        if (level.items.length === 0 && !level.renderCustom) {
            list.innerHTML = '<div class="slide-empty">暂无内容</div>';
        } else {
            // 始终渲染 items 导航行
            for (const row of level.items) {
                const el = this.createRow(row);
                if (el) {
                    list.appendChild(el);
                }
            }
            // 如有 renderCustom，追加自定义内容
            if (level.renderCustom) {
                await level.renderCustom(list);
            }
        }
        this.panel.appendChild(list);
    }

    /** 释放所有资源（清除动画定时器、键盘监听、状态），调用后实例不可再用。 */
    dispose(): void {
        this._cancelAnim();
        if (this._keydownHandler) {
            this.container.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
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

        const el = document.createElement('div');
        el.className = 'slide-item';
        const hint = row.sublabel || (row.model ? '暂无描述' : '暂无提示');
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
        labelSpan.className = 'slide-label';
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        if (row.catTag) {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'slide-tag';
            tagSpan.textContent = row.catTag;
            el.appendChild(tagSpan);
        }

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
            el.addEventListener('click', (e) => {
                if ((e.target as HTMLElement).closest('.slide-add-btn')) {
                    return;
                }
                const next = this.onFolderEnter(row, this);
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
            this.onHover(row, true);
        });
        el.addEventListener('mouseleave', () => {
            hideHint();
            this.onHover(row, false);
        });

        return el;
    }
}
