// Shared types, state, DOM refs, and helper functions for MikuMikuAR.

import type { MmdWasmModel } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmModel";
import { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

// ======== Types ========

export type ModelKind = "actor" | "stage";

export type ModelInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    mmdModel?: MmdWasmModel;
    vmdData: ArrayBuffer | null;
    vmdName: string;
    vmdPath: string | null;
    animationDuration: number;
    kind: ModelKind;
    /** Visibility state: true = visible, false = hidden */
    visible: boolean;
    /** Opacity 0..1, 1.0 = fully opaque */
    opacity: number;
    /** Wireframe rendering mode */
    wireframe: boolean;
    /** Uniform scale factor, 1.0 = original size */
    scaling: number;
    /** Y-axis rotation in radians */
    rotationY: number;
};

export type LibraryModel = {
    dir: string; file_path: string; name_jp: string; name_en: string;
    comment: string; has_thumb: boolean;
    type: string; format: string; container: string;
    zip_inner: string; category: string;
    source: string;
};

export type PopupRow = {
    kind: "folder" | "model" | "action" | "divider";
    label: string;
    icon: string;
    target: string;
    sublabel?: string;
    model?: LibraryModel;
    catTag?: string;
    editable?: boolean;
};

export type PopupLevel = {
    label: string;
    dir: string;
    items: PopupRow[];
    /** Optional custom render function — overrides items when set. */
    renderCustom?: (container: HTMLElement) => void;
};

// ======== Shared Mutable State ========

export let mmdRuntime: MmdWasmRuntime | null = null;
export function setMmdRuntime(r: MmdWasmRuntime | null): void { mmdRuntime = r; }

export let modelRegistry = new Map<string, ModelInstance>();
export function setModelRegistry(m: Map<string, ModelInstance>): void { modelRegistry = m; }

export let focusedModelId: string | null = null;
export function setFocusedModelId(id: string | null): void { focusedModelId = id; }

export let currentPort = 0;
export function setCurrentPort(p: number): void { currentPort = p; }

export let isPlaying = false;
export function setIsPlaying(v: boolean): void { isPlaying = v; }

export let autoLoop = true;
export function setAutoLoop(v: boolean): void { autoLoop = v; }

export let isLoadingModel = false;
export function setIsLoadingModel(v: boolean): void { isLoadingModel = v; }

export let isLoadingVmd = false;
export function setIsLoadingVmd(v: boolean): void { isLoadingVmd = v; }

export type PendingVmd = { data: ArrayBuffer; name: string };
export let pendingVmd: PendingVmd | null = null;
export function setPendingVmd(v: PendingVmd | null): void { pendingVmd = v; }

export let seekDragging = false;
export function setSeekDragging(v: boolean): void { seekDragging = v; }

export let libraryRoot = "";
export function setLibraryRoot(r: string): void { libraryRoot = r; }

export let allModels: LibraryModel[] = [];
export function setAllModels(m: LibraryModel[]): void { allModels = m; }

export let externalPaths: { path: string; name: string }[] = [];
export function setExternalPaths(e: { path: string; name: string }[]): void { externalPaths = e; }

export let popupOpen = false;
export function setPopupOpen(v: boolean): void { popupOpen = v; }

export let searchMode = false;
export function setSearchMode(v: boolean): void { searchMode = v; }

// ======== Thumbnail Cache ========

/** In-memory cache of base64-encoded thumbnails keyed by model path. */
export let thumbnailCache = new Map<string, string>();
export function setThumbnailCache(m: Map<string, string>): void { thumbnailCache = m; }

// ======== Display Name Priority ========

export type DisplayNamePriority = "name_jp" | "name_en" | "filename";

export type CameraMode = "orbit" | "freefly" | "oneshot" | "concert";

export let cameraMode: CameraMode = "orbit";
export function setCameraMode(m: CameraMode): void { cameraMode = m; }

export let displayNamePriority: DisplayNamePriority = "filename";
export function setDisplayNamePriority(p: DisplayNamePriority): void { displayNamePriority = p; }

// ======== Model Metadata Cache (on-demand PMX header parsing) ========

/** Cached PMX header metadata keyed by file_path. Populated on demand. */
export let modelMetaCache = new Map<string, { name_jp: string; name_en: string; comment: string }>();
export function setModelMetaCache(m: Map<string, { name_jp: string; name_en: string; comment: string }>): void { modelMetaCache = m; }

// ======== Tree Expand State ========

/** Set of directory paths that are currently expanded in the tree view. */
export let expandedFolders = new Set<string>();
export function setExpandedFolders(s: Set<string>): void { expandedFolders = s; }
export function toggleExpandedFolder(path: string): void {
    if (expandedFolders.has(path)) expandedFolders.delete(path);
    else expandedFolders.add(path);
}

// ======== DOM Element Refs ========

export const dom = {
    canvas: document.getElementById("renderCanvas") as HTMLCanvasElement,
    statusBar: document.getElementById("statusBar") as HTMLElement,
    loadingEl: document.getElementById("loading") as HTMLElement,
    btnMainAction: document.getElementById("btnMainAction") as HTMLButtonElement,
    modelPopup: document.getElementById("modelPopup") as HTMLElement,
    popupBreadcrumb: document.getElementById("popupBreadcrumb") as HTMLElement,
    popupList: document.getElementById("popupList") as HTMLElement,
    popupEmpty: document.getElementById("popupEmpty") as HTMLElement,
    btnClosePopup: document.getElementById("btnClosePopup") as HTMLButtonElement,
    btnManageExternal: document.getElementById("btnManageExternal") as HTMLButtonElement,
    btnRescan: document.getElementById("btnRescan") as HTMLButtonElement,
    // Motion popup
    motionPopup: document.getElementById("motionPopup") as HTMLElement,
    motionPopupBreadcrumb: document.getElementById("motionPopupBreadcrumb") as HTMLElement,
    motionPopupList: document.getElementById("motionPopupList") as HTMLElement,
    motionPopupEmpty: document.getElementById("motionPopupEmpty") as HTMLElement,
    btnCloseMotionPopup: document.getElementById("btnCloseMotionPopup") as HTMLButtonElement,
    btnMotionPopup: document.getElementById("btnMotionPopup") as HTMLButtonElement,
    motionPopupSearch: document.getElementById("motionPopupSearch") as HTMLElement,
    motionPopupSearchInput: document.getElementById("motionPopupSearchInput") as HTMLInputElement,
    playbackBar: document.getElementById("playbackBar") as HTMLElement,
    btnPlayPause: document.getElementById("btnPlayPause") as HTMLButtonElement,
    timeDisplay: document.getElementById("timeDisplay") as HTMLElement,
    seekBar: document.getElementById("seekBar") as HTMLElement,
    seekProgress: document.getElementById("seekProgress") as HTMLElement,
    loadingText: document.getElementById("loadingText") as HTMLElement,
    externalOverlay: document.getElementById("externalOverlay") as HTMLElement,
    externalList: document.getElementById("externalList") as HTMLElement,
    btnCloseExternal: document.getElementById("btnCloseExternal") as HTMLButtonElement,
    btnAddExternal: document.getElementById("btnAddExternal") as HTMLButtonElement,
    popupSearch: document.getElementById("popupSearch") as HTMLElement,
    popupSearchInput: document.getElementById("popupSearchInput") as HTMLInputElement,
    settingsOverlay: document.getElementById("settingsOverlay") as HTMLElement,
    btnSettings: document.getElementById("btnSettings") as HTMLButtonElement,
    btnCloseSettings: document.getElementById("btnCloseSettings") as HTMLButtonElement,
    btnScene: document.getElementById("btnScene") as HTMLButtonElement,
    sceneOverlay: document.getElementById("sceneOverlay") as HTMLElement,
    btnCloseScene: document.getElementById("btnCloseScene") as HTMLButtonElement,
};

// ======== Helpers ========

let hintActive = false;
let savedStatusText = "";
let savedStatusColor = "";

export function setStatus(text: string, ok: boolean): void {
    if (hintActive) return; // don't overwrite hover hints
    dom.statusBar.textContent = text;
    dom.statusBar.style.color = ok ? "rgba(111,207,151,0.7)" : "rgba(255,255,255,0.4)";
}

/** Show a hover hint in the status bar, saving the current text for later restore. */
export function showHint(text: string): void {
    if (!hintActive) {
        savedStatusText = dom.statusBar.textContent || "";
        savedStatusColor = dom.statusBar.style.color || "";
    }
    hintActive = true;
    dom.statusBar.textContent = text;
    dom.statusBar.style.color = "rgba(255,255,255,0.4)";
}

/** Restore the status bar text that was showing before the hint. */
export function hideHint(): void {
    hintActive = false;
    dom.statusBar.textContent = savedStatusText;
    dom.statusBar.style.color = savedStatusColor;
}

/** Wire up mouseenter/mouseleave for all [data-hint] elements (static HTML). */
export function initHints(): void {
    document.querySelectorAll("[data-hint]").forEach(el => {
        el.addEventListener("mouseenter", () => {
            showHint(el.getAttribute("data-hint") || "暂无提示");
        });
        el.addEventListener("mouseleave", () => hideHint());
    });
}

export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function toBase64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ======== Library Reference Utilities (portable scene serialization) ========

// Re-export normPath from fileservice; kept here for import compatibility.
import { normPath } from "./fileservice";
export { normPath };

/**
 * Compute a portable library identifier for a model/VMD file path.
 * Returns a string like "rel/path/model.pmx" (main lib) or "ExtName:rel/path/model.pmx" (external lib),
 * or null if the path doesn't belong to any known library root.
 * Used by scene serialization to avoid absolute-path dependency.
 */
export function computeLibraryRef(filePath: string): string | null {
    const normalized = normPath(filePath);
    // Try external paths first (more specific match)
    for (const ext of externalPaths) {
        const extPath = normPath(ext.path);
        if (normalized.startsWith(extPath + "/")) {
            return `${ext.name}:${normalized.substring(extPath.length + 1)}`;
        }
    }
    // Try main library
    if (libraryRoot) {
        const root = normPath(libraryRoot);
        if (normalized.startsWith(root + "/")) {
            return normalized.substring(root.length + 1);
        }
    }
    return null;
}

/**
 * Resolve a library identifier back to an absolute file path.
 * Returns the resolved path if the corresponding library is configured, or null if not.
 */
export function resolveLibraryRef(libraryRef: string): string | null {
    if (!libraryRef) return null;
    // External ref: "SourceName:rel/path/file.pmx"
    const colonIdx = libraryRef.indexOf(":");
    if (colonIdx > 0) {
        const source = libraryRef.substring(0, colonIdx);
        const relPath = libraryRef.substring(colonIdx + 1);
        const ext = externalPaths.find(e => e.name === source);
        if (ext) return normPath(ext.path) + "/" + relPath;
        return null;
    }
    // Main library ref: "rel/path/file.pmx"
    if (libraryRoot) return normPath(libraryRoot) + "/" + libraryRef;
    return null;
}

// Close all overlay-style popups. Call this before opening any new overlay.
export function closeAllOverlays(): void {
    document.querySelectorAll(".overlay.visible").forEach(el => el.classList.remove("visible"));
    dom.modelPopup.classList.remove("visible");
    dom.motionPopup.classList.remove("visible");
    setPopupOpen(false);
}
