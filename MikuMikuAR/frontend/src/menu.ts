import { PopupLevel, PopupRow, showHint, hideHint } from "./config";
import { createIconifyIcon } from "./icons";

export class SlideMenu {
    private levels: PopupLevel[] = [];
    private panels: [HTMLElement, HTMLElement];
    private activeIdx: 0 | 1 = 0;
    private transitioning = false;
    private container: HTMLElement;
    private viewport: HTMLElement;
    private inner: HTMLElement;
    private headerEl: HTMLElement;
    private focusIndex = -1;

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

        this.inner = document.createElement("div");
        this.inner.className = "slide-inner";

        const p0 = document.createElement("div");
        p0.className = "slide-panel";
        const p1 = document.createElement("div");
        p1.className = "slide-panel";

        this.inner.appendChild(p0);
        this.inner.appendChild(p1);
        this.viewport.appendChild(this.inner);
        this.container.appendChild(this.viewport);

        this.headerEl = document.createElement("div");
        this.headerEl.className = "slide-header";
        this.container.appendChild(this.headerEl);

        this.panels = [p0, p1];

        this.container.tabIndex = -1;
        this.container.addEventListener("keydown", (e) => {
            if (this.transitioning) return;
            switch (e.key) {
                case "ArrowDown": e.preventDefault(); this.focusNext(); break;
                case "ArrowUp": e.preventDefault(); this.focusPrev(); break;
                case "ArrowRight":
                case "Enter": e.preventDefault(); this.activateFocused(); break;
                case "ArrowLeft": e.preventDefault(); this.pop(); break;
            }
        });
    }

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    get levelCount(): number { return this.levels.length; }

    reset(level: PopupLevel): void {
        this.levels = [level];
        this.activeIdx = 0;
        this.transitioning = false;
        this.panels[0].style.display = "";
        this.panels[0].style.opacity = "1";
        this.panels[0].style.transform = "";
        this.buildPanel(this.panels[0], level);
        this.panels[1].style.display = "none";
        this.panels[1].style.opacity = "";
        this.panels[1].style.transform = "";
        this.updateHeader(level);
        this.setupFocus();
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
        this.levels = this.levels.slice(0, index + 1);
        this.transitioning = true;
        this.animateSlide(false, this.levels[this.levels.length - 1]);
    }

    reRender(): void {
        const level = this.currentLevel;
        if (!level) return;
        this.buildPanel(this.panels[this.activeIdx], level);
        this.updateHeader(level);
        this.setupFocus();
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
        const dur = getComputedStyle(document.documentElement).getPropertyValue("--ui-animations").trim() !== "0" ? "0.15s" : "0s";
        const activePanel = this.panels[this.activeIdx];
        const nextIdx = this.activeIdx === 0 ? 1 : 0;
        this.activeIdx = nextIdx as 0 | 1;
        this.updateHeader(nextLevel);

        const nextPanel = this.panels[nextIdx];
        nextPanel.style.display = "";
        nextPanel.style.opacity = "0";
        nextPanel.style.transform = forward ? "translateX(40px)" : "translateX(-40px)";
        this.buildPanel(nextPanel, nextLevel);

        void nextPanel.offsetWidth;

        activePanel.style.transition = `opacity ${dur} ease, transform ${dur} ease`;
        nextPanel.style.transition = `opacity ${dur} ease, transform ${dur} ease`;

        activePanel.style.opacity = "0";
        activePanel.style.transform = forward ? "translateX(-40px)" : "translateX(40px)";
        nextPanel.style.opacity = "1";
        nextPanel.style.transform = "translateX(0)";

        setTimeout(() => {
            activePanel.style.display = "none";
            activePanel.style.transition = "";
            activePanel.style.transform = "";
            nextPanel.style.transition = "";
            nextPanel.style.transform = "";
            this.transitioning = false;
            this.setupFocus();
            this.onAfterRender?.(nextLevel, this);
        }, dur === "0s" ? 10 : 180);
    }

    private get panelItems(): NodeListOf<HTMLElement> {
        return this.panels[this.activeIdx].querySelectorAll<HTMLElement>(".slide-item");
    }

    private clearFocus(): void {
        this.panels[this.activeIdx].querySelectorAll(".slide-focused").forEach(el => el.classList.remove("slide-focused"));
    }

    private applyFocus(): void {
        this.clearFocus();
        const items = this.panelItems;
        if (this.focusIndex < 0 || this.focusIndex >= items.length) return;
        items[this.focusIndex].classList.add("slide-focused");
        items[this.focusIndex].scrollIntoView({ block: "nearest" });
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
        if (len === 0) return;
        this.focusIndex = this.focusIndex <= 0 ? len - 1 : this.focusIndex - 1;
        this.applyFocus();
    }

    private focusNext(): void {
        const len = this.panelItems.length;
        if (len === 0) return;
        this.focusIndex = this.focusIndex >= len - 1 ? 0 : this.focusIndex + 1;
        this.applyFocus();
    }

    private activateFocused(): void {
        const items = this.panelItems;
        if (this.focusIndex < 0 || this.focusIndex >= items.length) return;
        items[this.focusIndex].click();
    }

    private buildPanel(panel: HTMLElement, level: PopupLevel): void {
        panel.innerHTML = "";

        const list = document.createElement("div");
        list.className = "slide-list";

        if (level.items.length === 0 && !level.renderCustom) {
            list.innerHTML = '<div class="slide-empty">暂无内容</div>';
        } else if (level.renderCustom) {
            list.classList.add("render-card");
            level.renderCustom(list);
        } else {
            for (const row of level.items) {
                const el = this.createRow(row);
                if (el) list.appendChild(el);
            }
        }

        panel.appendChild(list);
    }

    private updateHeader(level: PopupLevel): void {
        this.headerEl.innerHTML = "";
        const backBtn = document.createElement("span");
        backBtn.className = "slide-back";
        const backIcon = createIconifyIcon(this.levels.length > 1 ? "lucide:chevron-left" : "lucide:x");
        if (backIcon) backBtn.appendChild(backIcon);
        if (this.levels.length > 1) {
            backBtn.addEventListener("click", () => this.pop());
        } else {
            backBtn.addEventListener("click", () => this.onClose?.());
        }
        this.headerEl.appendChild(backBtn);
        const title = document.createElement("span");
        title.className = "slide-title";
        title.textContent = level.label || "";
        this.headerEl.appendChild(title);
        for (const btn of this.extraButtonFactory?.() ?? []) {
            this.headerEl.appendChild(btn);
        }
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
                if ((e.target as HTMLElement).closest(".slide-add-btn")) return;
                const next = this.onFolderEnter?.(row, this);
                if (next) this.push(next);
            });
        } else {
            el.addEventListener("click", () => this.onItemClick?.(row, this));
        }

        el.addEventListener("mouseenter", () => {
            // Mouse takes priority: clear keyboard focus
            if (this.focusIndex >= 0) {
                this.clearFocus();
                this.focusIndex = -1;
            }
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
