import { PopupLevel, PopupRow, showHint, hideHint } from "./config";
import { createIconifyIcon } from "./icons";

export class SlideMenu {
    private levels: PopupLevel[] = [];
    private panels: [HTMLElement, HTMLElement];
    private activeIdx: 0 | 1 = 0;
    private transitioning = false;
    private container: HTMLElement;
    private viewport: HTMLElement;

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

        this.container.innerHTML = "";
        this.container.classList.add("slide-menu");

        this.viewport = document.createElement("div");
        this.viewport.className = "slide-viewport";

        const p0 = document.createElement("div");
        p0.className = "slide-panel";
        const p1 = document.createElement("div");
        p1.className = "slide-panel";

        this.viewport.appendChild(p0);
        this.viewport.appendChild(p1);
        this.container.appendChild(this.viewport);
        this.panels = [p0, p1];
    }

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    get levelCount(): number { return this.levels.length; }

    reset(level: PopupLevel): void {
        this.levels = [level];
        this.activeIdx = 0;
        this.buildPanel(this.panels[0], level);
        this.panels[0].style.transform = "translateX(0)";
        this.panels[0].style.display = "";
        this.panels[1].style.display = "none";
        this.onAfterRender?.(level, this);
    }

    push(level: PopupLevel): void {
        if (this.transitioning) return;
        this.transitioning = true;
        this.levels.push(level);
        this.animateSlide(true, level);
    }

    pop(): void {
        if (this.transitioning || this.levels.length <= 1) return;
        this.transitioning = true;
        this.levels.pop();
        this.animateSlide(false, this.levels[this.levels.length - 1]);
    }

    popTo(index: number): void {
        if (index < 0 || index >= this.levels.length || this.transitioning) return;
        const removeCount = this.levels.length - (index + 1);
        this.levels = this.levels.slice(0, index + 1);
        if (removeCount > 0) {
            this.transitioning = true;
            this.animateSlide(false, this.levels[this.levels.length - 1]);
        }
    }

    reRender(): void {
        const level = this.currentLevel;
        if (!level) return;
        this.buildPanel(this.panels[this.activeIdx], level);
        this.onAfterRender?.(level, this);
    }

    getLevel(index: number): PopupLevel | undefined {
        return this.levels[index];
    }

    setLevel(index: number, level: PopupLevel): void {
        if (index >= 0 && index < this.levels.length) {
            this.levels[index] = level;
        }
    }

    private animateSlide(forward: boolean, nextLevel: PopupLevel): void {
        const fromIdx = this.activeIdx;
        const toIdx = fromIdx === 0 ? 1 : 0;
        this.activeIdx = toIdx as 0 | 1;

        const fromPanel = this.panels[fromIdx];
        const toPanel = this.panels[toIdx];

        fromPanel.style.transition = "none";
        toPanel.style.transition = "none";
        this.buildPanel(toPanel, nextLevel);
        toPanel.style.display = "";
        toPanel.style.transform = forward ? "translateX(100%)" : "translateX(-100%)";

        void toPanel.offsetWidth;

        fromPanel.style.transition = "transform 0.22s ease";
        toPanel.style.transition = "transform 0.22s ease";
        fromPanel.style.transform = forward ? "translateX(-100%)" : "translateX(100%)";
        toPanel.style.transform = "translateX(0)";

        setTimeout(() => {
            fromPanel.style.transition = "";
            toPanel.style.transition = "";
            fromPanel.style.display = "none";
            this.transitioning = false;
            this.onAfterRender?.(nextLevel, this);
        }, 250);
    }

    private buildPanel(panel: HTMLElement, level: PopupLevel): void {
        panel.innerHTML = "";

        const header = document.createElement("div");
        header.className = "slide-header";

        const backBtn = document.createElement("span");
        backBtn.className = "slide-back";
        if (this.levels.length > 1) {
            backBtn.textContent = "←";
            backBtn.addEventListener("click", () => this.pop());
        } else {
            backBtn.textContent = "✕";
            backBtn.addEventListener("click", () => this.onClose?.());
        }
        header.appendChild(backBtn);

        const title = document.createElement("span");
        title.className = "slide-title";
        title.textContent = level.label || "";
        header.appendChild(title);

        for (const btn of this.extraButtonFactory?.() ?? []) {
            header.appendChild(btn);
        }

        panel.appendChild(header);

        const list = document.createElement("div");
        list.className = "slide-list";

        if (level.items.length === 0 && !level.renderCustom) {
            list.innerHTML = '<div class="slide-empty">暂无内容</div>';
        } else if (level.renderCustom) {
            level.renderCustom(list);
        } else {
            for (const row of level.items) {
                const el = this.createRow(row);
                if (el) list.appendChild(el);
            }
        }

        panel.appendChild(list);
    }

    private createRow(row: PopupRow): HTMLElement | null {
        if (row.kind === "divider") {
            const el = document.createElement("div");
            el.className = "slide-divider";
            return el;
        }

        const el = document.createElement("div");
        el.className = "slide-item";
        const hint = row.sublabel || (row.model ? "暂无描述" : "暂无提示");
        el.setAttribute("data-hint", hint);

        const iconSpan = document.createElement("span");
        iconSpan.className = "slide-icon";
        const iconEl = createIconifyIcon(row.icon);
        if (iconEl) iconSpan.appendChild(iconEl);
        else iconSpan.textContent = row.icon;
        el.appendChild(iconSpan);

        const labelSpan = document.createElement("span");
        labelSpan.className = "slide-label";
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        if (row.catTag) {
            const tagSpan = document.createElement("span");
            tagSpan.className = "slide-tag";
            tagSpan.textContent = row.catTag;
            el.appendChild(tagSpan);
        }

        if (row.kind === "folder") {
            const arrow = document.createElement("span");
            arrow.className = "slide-arrow";
            arrow.textContent = ">";
            el.appendChild(arrow);
        }

        if (row.showDetailBtn) {
            const detailBtn = document.createElement("span");
            detailBtn.className = "slide-detail-btn";
            detailBtn.textContent = "📄";
            detailBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (row.onDetailClick) row.onDetailClick();
                else {
                    const next = this.onFolderEnter?.(row, this);
                    if (next) this.push(next);
                }
            });
            el.appendChild(detailBtn);
        }

        if (row.onAddClick) {
            const addBtn = document.createElement("span");
            addBtn.className = "slide-add-btn";
            addBtn.textContent = "+";
            addBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                row.onAddClick!();
            });
            el.appendChild(addBtn);
        }

        if (row.kind === "folder") {
            el.addEventListener("click", (e) => {
                if ((e.target as HTMLElement).closest(".slide-detail-btn, .slide-add-btn")) return;
                const next = this.onFolderEnter?.(row, this);
                if (next) this.push(next);
            });
        } else {
            el.addEventListener("click", () => this.onItemClick?.(row, this));
        }

        el.addEventListener("mouseenter", () => {
            showHint(hint);
            this.onHover?.(row, true);
        });
        el.addEventListener("mouseleave", () => {
            hideHint();
            this.onHover?.(row, false);
        });

        return el;
    }
}
