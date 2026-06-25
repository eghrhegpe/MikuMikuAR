// Library popup, search, and motion popup.

import { GetConfig, SetLibraryRoot, SelectDir, ScanModelDir, GetLibraryIndex,
         ExtractZip, CleanOrphanCache, ClearExtractCache,
         GetThumbnailBatch, GetModelMetaBatch } from "../wailsjs/go/main/App";
import {
    dom, setStatus, setLibraryRoot, libraryRoot, setAllModels, allModels,
    setExternalPaths, externalPaths, setPopupOpen, popupOpen,
    setSearchMode, searchMode,
    LibraryModel, PopupRow, PopupLevel,
    escapeHtml, normPath, thumbnailCache, setThumbnailCache,
    displayNamePriority, setDisplayNamePriority, DisplayNamePriority,
    modelMetaCache, setModelMetaCache,
    closeAllOverlays, modelRegistry, focusedModelId, setFocusedModelId,
} from "./config";
import {
    loadPMXFile, loadVMDFromPath, loadVMDMotion, focusModel, removeModel,
} from "./scene";
import { MenuStack } from "./menu";

// ======== MenuStack instances ========

const makeModelStack = (): MenuStack => {
    return new MenuStack({
        parentEl: dom.modelPopup,
        extraButtonFactory: () => {
            const closeBtn = dom.btnClosePopup.cloneNode(true) as HTMLButtonElement;
            closeBtn.addEventListener("click", hidePopup);
            return [closeBtn];
        },
        onFolderEnter: (row) => {
            if (row.target === "models:browse") {
                if (!libraryRoot) {
                    return {
                        label: "模型库",
                        dir: "",
                        items: [],
                        renderCustom: (container) => {
                            container.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
                            container.innerHTML = '<div style="font-size:28px;margin-bottom:6px;">📁</div><div>尚未设置模型库目录</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">请前往 ⚙ 设置 → 系统 中设置</div>';
                        },
                    };
                }
                // Enter file browser at library root
                const level = buildLevel(libraryRoot, "模型库", m => m.format === "pmx");
                for (const ep of externalPaths) {
                    level.items.unshift({
                        kind: "folder",
                        label: ep.name,
                        icon: "plug",
                        target: ep.path,
                    });
                }
                return level;
            }
            // Reserved items — no-op
            // Fallback: file browser folder navigation
            if (row.target && !row.target.startsWith("reserved:") && !row.target.startsWith("models:")) {
                return buildLevel(row.target, row.label, m => m.format === "pmx");
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
            if (row.model) {
                hidePopup();
                onModelRowClick(row.model);
                return;
            }
            if (row.target === "models:rescan") {
                refreshLibrary();
                return;
            }
            // Scene: focus on clicked model
            if (row.target && row.target.startsWith("scene:")) {
                const id = row.target.replace("scene:", "");
                setFocusedModelId(id);
                focusModel(id);
                hidePopup();
                return;
            }
        },
        onHover: (row, entering) => {
            if (!entering) { setStatus("", false); return; }
            const hints: Record<string, string> = {
                "models:browse": "📁 浏览模型库 · 加载 PMX 模型",
            };
            const hint = hints[row.target || ""];
            if (hint) setStatus(hint, false);
        },
    });
};

const makeMotionStack = (): MenuStack => {
    return new MenuStack({
        parentEl: dom.motionPopup,
        extraButtonFactory: () => {
            const closeBtn = document.createElement("button");
            closeBtn.className = "close-btn";
            closeBtn.textContent = "✕";
            closeBtn.addEventListener("click", hideMotionPopup);
            return [closeBtn];
        },
        onFolderEnter: (row) => {
            if (row.target === "motion:browse") {
                return buildLevel(libraryRoot, "动作库", m => m.format === "vmd");
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
            if (row.model) {
                hideMotionPopup();
                loadVMDFromPath(row.model.file_path);
            }
        },
    });
};

let modelStack: MenuStack | null = null;
let motionStack: MenuStack | null = null;

// ======== Popup Show / Hide ========
export function togglePopup(): void {
    if (popupOpen) { hidePopup(); return; }
    showPopup();
}

export function showPopup(): void {
    closeAllOverlays();
    setPopupOpen(true);
    dom.popupSearchInput.value = "";
    setSearchMode(false);
    dom.modelPopup.classList.add("visible");

    if (!modelStack) {
        modelStack = makeModelStack();
    }

    // Build root menu: scene models first, then divider, then features
    const rootItems: PopupRow[] = [];

    // Add currently loaded models as quick-access buttons
    for (const [id, inst] of modelRegistry) {
        rootItems.push({
            kind: "action", label: inst.name, icon: "🎭",
            target: `scene:${id}`,
            sublabel: inst.vmdName || undefined,
            editable: id === focusedModelId,
        });
    }
    if (rootItems.length > 0) {
        rootItems.push({ kind: "divider", label: "", icon: "", target: "" });
    }

    // Static menu items
    rootItems.push(
        { kind: "folder", label: "加载模型", icon: "folder", target: "models:browse" },
        { kind: "folder", label: "动作倍率", icon: "timer", target: "reserved:speed", sublabel: "即将推出" },
        { kind: "folder", label: "角色定制", icon: "sparkles", target: "reserved:customize", sublabel: "即将推出" },
        { kind: "action", label: "重新扫描", icon: "refresh-cw", target: "models:rescan" },
    );

    modelStack.reset({ label: "模型", dir: "", items: rootItems });
}

export function hidePopup(): void {
    closeAllOverlays();
}

// ======== Motion Popup ========

export function showMotionPopup(): void {
    closeAllOverlays();
    dom.motionPopup.classList.add("visible");

    if (!motionStack) {
        motionStack = makeMotionStack();
    }

    const rootItems: PopupRow[] = [
        { kind: "folder", label: "加载动作", icon: "folder", target: "motion:browse" },
        { kind: "folder", label: "动作倍率", icon: "timer", target: "reserved:motionSpeed", sublabel: "即将推出" },
    ];
    motionStack.reset({ label: "动作", dir: "", items: rootItems });
}

export function hideMotionPopup(): void {
    dom.motionPopup.classList.remove("visible");
}

// ======== Thumbnail batch loading ========

/** Load thumbnails for all model rows in a level and cache them in memory. */
async function loadThumbnailsForLevel(level: PopupLevel): Promise<void> {
    const pmxPaths = level.items
        .filter(r => r.kind === "model" && r.model)
        .map(r => r.model!.file_path);
    if (pmxPaths.length === 0) return;
    try {
        const batch = await GetThumbnailBatch(pmxPaths);
        setThumbnailCache(new Map(Object.entries(batch)));
    } catch (err) {
        console.warn("loadThumbnailsForLevel:", err);
    }
}

/** Ensure PMX header metadata (name_jp/name_en/comment) is loaded for the given model paths.
 *  Skips paths already in cache; fetches missing ones via Go binding. */
async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
    const uncached = pmxPaths.filter(p => !modelMetaCache.has(p));
    if (uncached.length === 0) return;
    try {
        const batch = await GetModelMetaBatch(uncached);
        if (batch) {
            const merged = new Map(modelMetaCache);
            for (const [path, meta] of Object.entries(batch)) {
                merged.set(path, meta);
            }
            setModelMetaCache(merged);
        }
    } catch (err) {
        console.warn("ensureModelMeta:", err);
    }
}

// ======== Build list from scan data ========
function buildLevel(dir: string, label: string, filter?: (m: LibraryModel) => boolean): PopupLevel {
    dir = normPath(dir);
    const isRoot = filter ? false : normPath(libraryRoot) === dir;
    const items: PopupRow[] = [];
    const subdirs = new Set<string>();
    const subdirIsLeaf = new Set<string>();

    for (const m of allModels) {
        if (filter && !filter(m)) continue;
        const mdir = normPath(m.dir);
        const rel = mdir.startsWith(dir)
            ? mdir.substring(dir.length).replace(/^\//, "")
            : null;
        if (rel === null) continue;
        const parts = rel.split("/").filter(Boolean);

        if (parts.length === 0) {
            items.push(modelToRow(m));
        } else {
            const topDir = parts[0];
            subdirs.add(topDir);
            if (parts.length === 1) {
                subdirIsLeaf.add(topDir);
            }
        }
    }

    for (const d of Array.from(subdirs).sort()) {
        const fullPath = dir + "/" + d;
        if (subdirIsLeaf.has(d) && !isRoot) {
            const entries = allModels.filter(m => {
                if (filter && !filter(m)) return false;
                return normPath(m.dir) === fullPath;
            });
            const allZip = entries.length > 0 && entries.every(m => m.container === "zip");
            if (!allZip) {
                for (const m of entries) {
                    items.push(modelToRow(m));
                }
                continue;
            }
        }
        items.unshift({ kind: "folder", label: d, icon: "folder", target: fullPath });
    }

    return { label, dir, items };
}

function modelToRow(m: LibraryModel): PopupRow {
    let icon = "box";
    if (m.format === "vmd") icon = "music";
    else if (m.container === "zip" && m.format === "pmx") icon = "archive";
    // Compute display label based on user's priority setting
    // For zip containers, file_path is the zip file path — use zip_inner to get the real model name
    const filename = (m.container === "zip" && m.zip_inner)
        ? m.zip_inner.split("/").pop() || "未知"
        : m.file_path.split("/").pop() || "未知";
    const cached = modelMetaCache.get(m.file_path);
    let label: string;
    switch (displayNamePriority) {
        case "filename":
            label = filename;
            break;
        case "name_en":
            label = (cached?.name_en || m.name_en || cached?.name_jp || m.name_jp || filename);
            break;
        case "name_jp":
        default:
            label = (cached?.name_jp || m.name_jp || cached?.name_en || m.name_en || filename);
            break;
    }
    const comment = cached?.comment || m.comment || "";
    return {
        kind: "model",
        label,
        icon,
        target: m.file_path,
        sublabel: comment ? comment.substring(0, 28) : undefined,
        model: m,
        catTag: m.category || undefined,
        editable: m.format === "pmx",
    };
}

function onModelRowClick(m: LibraryModel): void {
    const isStage = m.type === "stage" || m.type === "scene";
    if (m.container === "zip") {
        hidePopup();
        setStatus("正在解压 zip...", false);
        ExtractZip(m.file_path, m.zip_inner).then(result => {
            setStatus(result.cached ? "✓ 命中缓存" : "✓ 解压完成", true);
            if (m.format === "vmd") loadVMDFromPath(result.file_path);
            else loadPMXFile(result.file_path, isStage);
        }).catch(err => {
            setStatus("✗ 解压失败: " + (err as Error).message, false);
        });
        return;
    }
    hidePopup();
    if (m.format === "pmx") loadPMXFile(m.file_path, isStage);
    else if (m.format === "vmd") loadVMDFromPath(m.file_path);
}

function isSearchLayer(): boolean {
    return modelStack?.currentLevel?.label === "🔍 搜索结果";
}

function handlePopupSearch(): void {
    const q = dom.popupSearchInput.value.trim().toLowerCase();
    if (!q) {
        setSearchMode(false);
        if (isSearchLayer()) {
            modelStack?.pop();
        }
        return;
    }
    setSearchMode(true);
    if (isSearchLayer()) {
        // Update existing search results by re-pushing (pop first, then push)
        modelStack?.pop();
    }
    const results = allModels.filter(m => {
        const cached = modelMetaCache.get(m.file_path);
        const nameJp = cached?.name_jp || m.name_jp || "";
        const nameEn = cached?.name_en || m.name_en || "";
        const comment = cached?.comment || m.comment || "";
        return nameJp.toLowerCase().includes(q) ||
            nameEn.toLowerCase().includes(q) ||
            comment.toLowerCase().includes(q) ||
            m.file_path.toLowerCase().includes(q);
    });

    // Trigger on-demand PMX header parsing for search results (background)
    ensureModelMeta(results.filter(m => m.format === "pmx").map(m => m.file_path));

    const resultLevel: PopupLevel = {
        label: "🔍 搜索结果",
        dir: "",
        items: [],
        renderCustom: (container) => {
            if (results.length === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "padding:24px;text-align:center;color:var(--text-muted);font-size:13px;";
                empty.innerHTML = '<div style="font-size:28px;margin-bottom:6px;">🔍</div><div>没有找到匹配的模型</div>';
                container.appendChild(empty);
                return;
            }
            for (const m of results) {
                const row = modelToRow(m);
                const el = document.createElement("div");
                el.className = "menu-item";
                let html = `<span class="menu-icon">${row.icon}</span><span class="menu-label">${escapeHtml(row.label)}</span>`;
                if (row.catTag) {
                    html += `<span class="menu-tag">${escapeHtml(row.catTag)}</span>`;
                }
                const thumbB64 = thumbnailCache.get(m.file_path);
                if (thumbB64) {
                    html = `<img class="row-thumb" src="data:image/png;base64,${thumbB64}">` + html;
                }
                el.innerHTML = html;
                el.addEventListener("click", () => { onModelRowClick(m); });
                container.appendChild(el);
            }
            // Load thumbnails
            const resultLevel: PopupLevel = { label: "搜索结果", dir: "", items: results.map(m => modelToRow(m)) };
            loadThumbnailsForLevel(resultLevel);
        },
    };

    // Push search results onto the model stack
    modelStack?.push(resultLevel);
}

// ======== Library loading ========
export async function initLibrary(): Promise<void> {
    try {
        const cfg = await GetConfig();
        if (!cfg || !cfg.library_root) {
            setStatus("📦 首次使用：点击这里打开模型库 → 加载模型，模型目录请在 ⚙ 设置中配置", false);
            return;
        }
        setLibraryRoot(cfg.library_root);
        setExternalPaths(cfg.external_paths || []);
        // Load saved display name priority
        if (cfg.display_name_priority) {
            setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
        }
        try {
            const cached = await GetLibraryIndex();
            const validCached = cached ? cached.filter((m: any) => m.file_path) : [];
            if (validCached.length > 0) setAllModels(validCached);
        } catch { /* no cache */ }
        try {
            await rescanAndSync();
        } catch (err) {
            console.warn("ScanModelDir refresh:", err);
        }
        CleanOrphanCache().catch(err => console.warn("CleanOrphanCache:", err));
        setStatus("📦 点击这里浏览模型 · 💃 点击这里加载动作 · 拖拽旋转 · 滚轮缩放", false);
    } catch (err) {
        console.warn("initLibrary:", err);
        setStatus("✗ 模型库加载失败", false);
    }
}

async function selectAndSetLibraryRoot(): Promise<void> {
    try {
        const dir = await SelectDir();
        if (!dir) return;
        setLibraryRoot(dir);
        setStatus("扫描模型库...", false);
        const models = await rescanAndSync();
        setStatus(`✓ ${models.length} 个条目`, true);
        showPopup();
    } catch (err) {
        console.error("Error setting library root:", err);
        setStatus("✗ 目录选择失败", false);
    }
}

// ======== Library loading ========

/** Re-scan the model directory and sync all local state. */
export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
    const root = dir ?? libraryRoot;
    const models = await ScanModelDir(root, externalPaths);
    setAllModels(models);
    await SetLibraryRoot(root);
    return models;
}

/** Reload config from disk and update local library state. */
export async function reloadConfig(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg) {
        setLibraryRoot(cfg.library_root || "");
        setExternalPaths(cfg.external_paths || []);
    }
}

export async function refreshLibrary(): Promise<void> {
    setStatus("扫描中...", false);
    try {
        await ClearExtractCache();
        const models = await rescanAndSync();
        setStatus(`✓ ${models.length} 个条目`, true);
        CleanOrphanCache().catch(err => console.warn("CleanOrphanCache (background):", err));
        if (popupOpen) showPopup();
    } catch (err) {
        setStatus("✗ 扫描失败", false);
    }
}

// ======== Popup search input handler ========
export function handlePopupSearchInput(): void {
    handlePopupSearch();
}

// Wire up event listeners that belong to library module
dom.btnClosePopup.addEventListener("click", hidePopup);
dom.btnRescan.addEventListener("click", refreshLibrary);
dom.popupSearchInput.addEventListener("input", handlePopupSearchInput);
dom.btnMainAction.addEventListener("click", togglePopup);
dom.canvas.addEventListener("click", () => { if (popupOpen) hidePopup(); });

// ======== Motion Popup Events ========
dom.btnMotionPopup.addEventListener("click", showMotionPopup);
dom.btnCloseMotionPopup.addEventListener("click", hideMotionPopup);
