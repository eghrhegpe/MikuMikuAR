// Universal navigation stack — each level is a separate floating layer.
// Inspired by DanceXR's multi-panel drill-down: push creates a new card
// (slightly offset, fade in), pop removes it and reveals the previous one.

import { PopupLevel, PopupRow, showHint, hideHint, favorites } from "./config";
import { createIconifyIcon } from "./icons";

export class MenuStack {
    private levels: PopupLevel[] = [];
    private layers: HTMLElement[] = [];
    private parentEl: HTMLElement;
    private layerClass: string; // CSS class for each layer

    /** Called when a non-folder row is clicked (model, action). */
    onItemClick?: (row: PopupRow, stack: MenuStack) => void;
    /** Called when a folder row is clicked. Return the next level or null to stay. */
    onFolderEnter?: (row: PopupRow, stack: MenuStack) => PopupLevel | null;
    /** Called when mouse enters/leaves any row (for help text in status bar). */
    onHover?: (row: PopupRow, entering: boolean) => void;
    /** Factory for extra header buttons (called per layer to get fresh DOM). */
    extraButtonFactory?: () => HTMLElement[];
    /** Called after each render (for thumbnail loading etc.). */
    onAfterRender?: (level: PopupLevel, stack: MenuStack) => void;
    /** Called when the back/close button is clicked at root level. */
    onClose?: () => void;
    /** Called when the ★/☆ fav button is clicked on a row. */
    onFavToggle?: (row: PopupRow) => void;

    /** How many pixels each successive layer is offset (for card-stack effect). */
    offsetX = 4;
    offsetY = 4;

    constructor(opts: {
        parentEl: HTMLElement;
        layerClass?: string;
        onItemClick?: (row: PopupRow, stack: MenuStack) => void;
        onFolderEnter?: (row: PopupRow, stack: MenuStack) => PopupLevel | null;
        onHover?: (row: PopupRow, entering: boolean) => void;
        extraButtonFactory?: () => HTMLElement[];
        onAfterRender?: (level: PopupLevel, stack: MenuStack) => void;
        onClose?: () => void;
        onFavToggle?: (row: PopupRow) => void;
    }) {
        this.parentEl = opts.parentEl;
        this.layerClass = opts.layerClass || "popup-layer";
        this.onItemClick = opts.onItemClick;
        this.onFolderEnter = opts.onFolderEnter;
        this.onHover = opts.onHover;
        this.extraButtonFactory = opts.extraButtonFactory;
        this.onAfterRender = opts.onAfterRender;
        this.onClose = opts.onClose;
        this.onFavToggle = opts.onFavToggle;
    }

    get currentLevel(): PopupLevel | undefined {
        return this.levels[this.levels.length - 1];
    }

    /** Reset — clear all layers, show root level. */
    reset(level: PopupLevel): void {
        this.levels = [level];
        this.clearLayers();
        this.createLayer(level, 0, false);
        this.onAfterRender?.(level, this);
    }

    /** Push — create a new floating layer, fade in. */
    push(level: PopupLevel): void {
        this.levels.push(level);
        this.createLayer(level, this.layers.length, true);
        this.onAfterRender?.(level, this);
    }

    /** Pop — remove top layer, reveal previous. */
    pop(): void {
        if (this.layers.length <= 1) return;
        this.levels.pop();
        const removed = this.layers.pop()!;
        removed.classList.remove("popup-layer-enter");
        removed.classList.add("popup-layer-leave");
        setTimeout(() => { try { removed.remove(); } catch {} }, 250);
        // Show previous layer
        const prev = this.layers[this.layers.length - 1];
        if (prev) {
            prev.style.display = "";
            prev.style.opacity = "1";
            prev.style.pointerEvents = "auto";
        }
    }

    /** Pop to a specific stack index with leave animation. */
    popTo(index: number): void {
        if (index < 0 || index >= this.levels.length) return;
        const removeCount = this.layers.length - (index + 1);
        for (let i = 0; i < removeCount; i++) {
            const layer = this.layers.pop()!;
            layer.classList.add("popup-layer-leave");
            setTimeout(() => { try { layer.remove(); } catch {} }, 250);
        }
        this.levels = this.levels.slice(0, index + 1);
        const target = this.layers[this.layers.length - 1];
        if (target) {
            target.style.display = "";
            target.style.opacity = "1";
            target.style.pointerEvents = "auto";
        }
    }

    /** Re-render all levels from scratch (e.g. after priority change). */
    reRender(): void {
        this.clearLayers();
        for (let i = 0; i < this.levels.length; i++) {
            this.createLayer(this.levels[i], i, false);
        }
        // Restore display state for correct stack: show only top layer
        for (let i = 0; i < this.layers.length; i++) {
            this.layers[i].style.display = i < this.layers.length - 1 ? "none" : "flex";
        }
    }
    // ======== Layer management ========

    private clearLayers(): void {
        for (const el of this.layers) el.remove();
        this.layers = [];
    }

    private createLayer(level: PopupLevel, index: number, animate: boolean): void {
        const el = document.createElement("div");
        el.className = this.layerClass + (animate ? " popup-layer-enter" : "");

        // Hide previous layers so only the current one sizes the container
        for (const prev of this.layers) {
            prev.style.display = "none";
        }

        // Breadcrumb — show back/close button + current level name
        const breadcrumb = document.createElement("div");
        breadcrumb.className = "popup-header";
        const back = document.createElement("span");
        back.className = "crumb back";
        if (this.levels.length > 1) {
            back.textContent = "←";
            const stack = this;
            back.addEventListener("click", () => stack.pop());
        } else {
            back.textContent = "✕";
            const onClose = this.onClose;
            back.addEventListener("click", () => onClose?.());
        }
        breadcrumb.appendChild(back);
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = " ";
        breadcrumb.appendChild(sep);
        const current = document.createElement("span");
        current.className = "crumb current";
        current.textContent = this.currentLevel?.label || "";
        breadcrumb.appendChild(current);
        for (const btn of this.extraButtonFactory?.() ?? []) {
            breadcrumb.appendChild(btn);
        }
        // List first, then breadcrumb (header at bottom for touch accessibility)
        const list = document.createElement("div");
        this.buildListContent(list, level);
        el.appendChild(list);
        el.appendChild(breadcrumb);
        this.parentEl.appendChild(el);
        this.layers.push(el);

        // Dim previous layer
        if (this.layers.length > 1) {
            const prev = this.layers[this.layers.length - 2];
            prev.style.display = "none";
        }

        // Remove enter animation class after it completes
        if (animate) {
            setTimeout(() => { el.classList.remove("popup-layer-enter"); }, 250);
        }
    }

    private buildListContent(list: HTMLElement, level: PopupLevel): void {
        list.className = "popup-layer-list";
        if (level.items.length === 0 && !level.renderCustom) {
            const empty = document.createElement("div");
            empty.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
            empty.innerHTML = '<div style="font-size:28px;margin-bottom:6px;">📭</div><div>这个目录是空的</div>';
            list.appendChild(empty);
        } else if (level.renderCustom) {
            level.renderCustom(list);
        } else {
            for (const row of level.items) {
                const rowEl = this.createRowElement(row);
                list.appendChild(rowEl);
            }
        }
    }

    private createRowElement(row: PopupRow): HTMLElement {
        // Divider — render as a horizontal line
        if (row.kind === "divider") {
            const el = document.createElement("div");
            el.className = "menu-divider";
            return el;
        }

        const el = document.createElement("div");
        el.className = "menu-item";
        const hint = row.sublabel || (row.model ? "暂无描述" : "暂无提示");
        el.setAttribute("data-hint", hint);
        el.addEventListener("mouseenter", () => showHint(hint));
        el.addEventListener("mouseleave", () => hideHint());

        const iconSpan = document.createElement("span");
        iconSpan.className = "menu-icon";
        const iconEl = createIconifyIcon(row.icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        } else {
            iconSpan.textContent = row.icon; // fallback
        }
        el.appendChild(iconSpan);

        const labelSpan = document.createElement("span");
        labelSpan.className = "menu-label";
        labelSpan.textContent = row.label;
        el.appendChild(labelSpan);

        if (row.catTag) {
            const tagSpan = document.createElement("span");
            tagSpan.className = "menu-tag";
            tagSpan.textContent = row.catTag;
            el.appendChild(tagSpan);
        }

        if (row.kind === "folder") {
            const arrow = document.createElement("span");
            arrow.className = "menu-arrow";
            arrow.textContent = ">";
            el.appendChild(arrow);
        }

        if (row.kind === "folder") {
            el.addEventListener("click", () => {
                const next = this.onFolderEnter?.(row, this);
                if (next) this.push(next);
            });
        } else {
            el.addEventListener("click", () => this.onItemClick?.(row, this));
        }

        // Hover help text
        el.addEventListener("mouseenter", () => this.onHover?.(row, true));
        el.addEventListener("mouseleave", () => this.onHover?.(row, false));

        // ★/☆ Favorites toggle button
        if (row.favRef) {
            const favBtn = document.createElement("span");
            favBtn.className = "menu-fav";
            favBtn.style.cssText = "cursor:pointer;margin-left:8px;display:inline-flex;align-items:center;user-select:none;";
            const isFav = favorites.has(row.favRef);
            const iconEl = document.createElement("iconify-icon");
            iconEl.setAttribute("icon", isFav ? "tabler:star-filled" : "tabler:star");
            iconEl.style.cssText = "width:16px;height:16px;color:" + (isFav ? "var(--accent,#ffc107)" : "var(--text-dim,#888)") + ";transition:color 0.15s;";
            favBtn.appendChild(iconEl);
            favBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.onFavToggle?.(row);
            });
            el.appendChild(favBtn);
        }

        return el;
    }
}
