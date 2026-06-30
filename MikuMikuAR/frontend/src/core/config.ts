// Shared types, state, DOM refs, and helper functions for MikuMikuAR.

import type { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { ClothConfig } from '../physics/xpbd-cloth';
import { DEFAULT_CLOTH_CONFIG } from '../physics/xpbd-cloth';

// ======== Types ========

export type ModelKind = 'actor' | 'stage';

export type ModelInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    rootMesh: Mesh;
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
    /** Bone line overlay visibility */
    showBoneLines: boolean;
    /** Bone joint sphere overlay visibility */
    showBoneJoints: boolean;
    /** Physics simulation enabled for this model */
    physicsEnabled: boolean;
    /** Uniform scale factor, 1.0 = original size */
    scaling: number;
    /** Y-axis rotation in radians */
    rotationY: number;
    /** Loaded outfit configuration (null = no outfits.json found) */
    outfitFile?: OutfitFile;
    /** Currently active variant name (undefined = original textures) */
    activeVariant?: string;
    /** Original texture snapshot before first variant application */
    _origTextures?: Map<
        number,
        {
            diffuse?: Texture | null;
            toon?: Texture | null;
            spa?: Texture | null;
            normal?: Texture | null;
            emissive?: Texture | null;
        }
    >;
    /** Original material params before first variant application */
    _origParams?: Map<
        number,
        {
            diffuseR: number;
            diffuseG: number;
            diffuseB: number;
            specularR: number;
            specularG: number;
            specularB: number;
            specularPower: number;
            ambientR: number;
            ambientG: number;
            ambientB: number;
        }
    >;
};

/** [doc:architecture] PropInstance — 场景道具实例（独立于模型库，不参与 VMD/物理/排列） */
export type PropInstance = {
    id: string;
    name: string;
    filePath: string;
    port: number;
    modelDir: string;
    meshes: Mesh[];
    rootMesh: Mesh;
    /** Optional parent TransformNode that holds all meshes as children.
     *  When set, transforms (position/rotation/scaling) apply to the container
     *  instead of rootMesh, ensuring multi-mesh props move as a unit. */
    container?: import('@babylonjs/core/Meshes/transformNode').TransformNode;
    /** World-space position [x, y, z] */
    position: [number, number, number];
    /** Y-axis rotation in radians */
    rotationY: number;
    /** Uniform scale factor, 1.0 = original size */
    scaling: number;
    /** Visibility state */
    visible: boolean;
};

// ======== Outfit System Types ========

export type OutfitSlot = {
    diffuse?: string;
    toon?: string;
    spa?: string;
    normal?: string;
    emissive?: string;
    params?: { diffuseMul?: number; specularMul?: number; shininess?: number; ambientMul?: number };
    tint?: [number, number, number];
};

export type OutfitVariant = {
    name: string;
    byCategory?: Record<string, OutfitSlot>;
    byMaterial?: Record<string, OutfitSlot>;
    all?: OutfitSlot;
};

export type OutfitFile = {
    version: number;
    variants: OutfitVariant[];
};

export type LibraryModel = {
    dir: string;
    file_path: string;
    name_jp: string;
    name_en: string;
    comment: string;
    has_thumb: boolean;
    type: string;
    format: string;
    container: string;
    zip_inner: string;
    category: string;
    source: string;
};

export type PopupRow = {
    kind: 'folder' | 'model' | 'action' | 'divider';
    label: string;
    icon: string;
    target: string;
    sublabel?: string;
    model?: LibraryModel;
    catTag?: string;
    editable?: boolean;
    /** If set, render a ★/☆ toggle button. Value is the libraryRef to toggle. */
    favRef?: string;
    /** If true, render a "📄" detail button on the right (for loaded model rows). */
    /** Called when the "+" add-model button is clicked. */
    onAddClick?: () => void;
    /** Called when the "📄" detail button is clicked. If unset, defaults to
     *  navigating into the folder (onFolderEnter). Set this to override —
     *  e.g. to focus the model instead of opening its detail submenu. */
    onDetailClick?: () => void;
};

export type PopupLevel = {
    label: string;
    dir: string;
    items: PopupRow[];
    /** Optional custom render function — overrides items when set.
     *  May be async; SlideMenu will await completion before onAfterRender. */
    renderCustom?: (container: HTMLElement) => void | Promise<void>;
};

export interface UIState {
    scale?: number;
    popupWidth?: number;
    accent?: string;
    fontFamily?: string;
    animations?: boolean;
    blurBg?: boolean;
    performanceMode?: 'auto' | 'quality' | 'balanced' | 'performance';
}

export interface EnvState {
    skyMode: 'color' | 'texture' | 'procedural';
    skyColorTop: [number, number, number];
    skyColorMid: [number, number, number];
    skyColorBot: [number, number, number];
    skyTexture: string;
    skyRotationY: number;
    skyRotationSpeed: number; // 天空旋转动画速度 0~5 度/秒
    skyBrightness: number;
    starsEnabled: boolean; // 夜晚星空
    envIntensity: number;

    groundVisible: boolean;
    groundMode: 'solid' | 'grid' | 'checker';
    groundColor: [number, number, number];
    groundAlpha: number;

    windEnabled: boolean;
    windDirection: [number, number, number];
    windSpeed: number;

    particleEnabled: boolean;
    particleType: 'none' | 'sakura' | 'rain' | 'snow' | 'fireworks' | 'fireflies' | 'leaves';
    particleEmitRate: number;
    particleSize: number;
    particleSpeed: number;

    // 场景地面高度（世界 Y 坐标），用于粒子系统等的高度参考
    groundLevel: number;

    waterEnabled: boolean;
    waterLevel: number;
    waterColor: [number, number, number];
    waterTransparency: number;
    waterWaveHeight: number;
    waterSize: number;
    waterAnimSpeed: number; // 水体动画速度倍率 0.1~5

    // ======== 水面泡沫 ========
    foamThreshold: number;
    foamIntensity: number;

    // ======== 水下效果 ========
    underwaterFogColor: [number, number, number];
    underwaterFogDensity: number;
    underwaterChromaticAmount: number;

    cloudsEnabled: boolean;
    /** Enable debug visualization (red ring + yellow/green markers) */
    debugClouds?: boolean;
    cloudCover: number;
    cloudScale: number;
    cloudHeight: number;
    cloudThickness: number;
    cloudVisibility: number;
    /** Cloud gap contrast: 0 = default spacing, 1 = larger gaps (stretches noise distribution) */
    cloudGap: number;
    // Fog
    fogEnabled: boolean;
    fogColor: [number, number, number];
    fogDensity: number;

    // ======== XPBD 布料模拟 ========
    clothEnabled: boolean;
    clothConfig: ClothConfig;

    // ======== 太阳参数（序列化用）========
    sunAngle: number; // 太阳高度角, -15~90
    azimuth: number; // 太阳方位角（度）, 默认 -45
}

// ======== Shared Mutable State ========

export let mmdRuntime: MmdWasmRuntime | null = null;
export function setMmdRuntime(r: MmdWasmRuntime | null): void {
    mmdRuntime = r;
}

export let modelRegistry = new Map<string, ModelInstance>();
// [doc:architecture] modelRegistry — 已加载模型的运行时注册表（key=实例ID）
// ⚠️ 修改时同步: loadPMXFile(新增) / removeModel(删除) / arrangeModels(替换整个Map)
export function setModelRegistry(m: Map<string, ModelInstance>): void {
    modelRegistry = m;
}

export let propRegistry = new Map<string, PropInstance>();
// [doc:architecture] propRegistry — 场景道具注册表（独立于模型，不参与 VMD/物理/排列）
// ⚠️ 修改时同步: loadProp(新增) / removeProp(删除) / deserializeScene(清空后重建)
export function setPropRegistry(m: Map<string, PropInstance>): void {
    propRegistry = m;
}

export let focusedModelId: string | null = null;
// [doc:architecture] focusedModelId — 当前聚焦模型ID（用于键盘/相机/VMD绑定/详情面板）
// ⚠️ 修改时同步: focusModel(切换) / loadPMXFile(新增后自动) / removeModel(删除后迁移)
export function setFocusedModelId(id: string | null): void {
    focusedModelId = id;
}

export let currentPort = 0;
export function setCurrentPort(p: number): void {
    currentPort = p;
}

export let isPlaying = false;
export function setIsPlaying(v: boolean): void {
    isPlaying = v;
}

export let autoLoop = true;
export function setAutoLoop(v: boolean): void {
    autoLoop = v;
}

export let isLoadingModel = false;
export function setIsLoadingModel(v: boolean): void {
    isLoadingModel = v;
}

export let isLoadingVmd = false;
export function setIsLoadingVmd(v: boolean): void {
    isLoadingVmd = v;
}

export let isLoadingProp = false;
export function setIsLoadingProp(v: boolean): void {
    isLoadingProp = v;
}

export type PendingVmd = { data: ArrayBuffer; name: string };
export let pendingVmd: PendingVmd | null = null;
export function setPendingVmd(v: PendingVmd | null): void {
    pendingVmd = v;
}

// [doc:architecture] libraryRef — 可移植库标识符，用于场景序列化

export let seekDragging = false;
export function setSeekDragging(v: boolean): void {
    seekDragging = v;
}

export let libraryRoot = '';
export function setLibraryRoot(r: string): void {
    libraryRoot = r;
}

export let allModels: LibraryModel[] = [];
export function setAllModels(m: LibraryModel[]): void {
    allModels = m;
}

export let externalPaths: { path: string; name: string }[] = [];
export function setExternalPaths(e: { path: string; name: string }[]): void {
    externalPaths = e;
}

export let popupOpen = false;
export function setPopupOpen(v: boolean): void {
    popupOpen = v;
}

// ======== Thumbnail Cache ========

/** In-memory cache of base64-encoded thumbnails keyed by model path. */
export let thumbnailCache = new Map<string, string>();
export function setThumbnailCache(m: Map<string, string>): void {
    thumbnailCache = m;
}

// ======== Recent Models ========

/** Recently opened model libraryRefs (newest first). */
export let recentModels: string[] = [];
export function setRecentModels(r: string[]): void {
    recentModels = r;
}

// ======== Display Name Priority ========

export type DisplayNamePriority = 'name_jp' | 'name_en' | 'filename';

export type PhysicsCategory = 'skirt' | 'chest' | 'hair' | 'accessory';

export type CameraMode = 'orbit' | 'freefly' | 'oneshot' | 'concert';

export let cameraMode: CameraMode = 'orbit';
export function setCameraMode(m: CameraMode): void {
    cameraMode = m;
}

export let displayNamePriority: DisplayNamePriority = 'filename';
export function setDisplayNamePriority(p: DisplayNamePriority): void {
    displayNamePriority = p;
}

// Cross-popup motion binding target — set when browsing VMD from model detail
export let motionBindingTargetId: string | null = null;
export function setMotionBindingTargetId(v: string | null): void {
    motionBindingTargetId = v;
}

// ======== Model Metadata Cache (on-demand PMX header parsing) ========

/** Cached PMX header metadata keyed by file_path. Populated on demand. */
export let modelMetaCache = new Map<
    string,
    { name_jp: string; name_en: string; comment: string }
>();
export function setModelMetaCache(
    m: Map<string, { name_jp: string; name_en: string; comment: string }>
): void {
    modelMetaCache = m;
}

// ======== Tree Expand State ========

/** Set of directory paths that are currently expanded in the tree view. */
export let expandedFolders = new Set<string>();
export function setExpandedFolders(s: Set<string>): void {
    expandedFolders = s;
}
export function toggleExpandedFolder(path: string): void {
    if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
    } else {
        expandedFolders.add(path);
    }
}

// ======== Environment State (Phase 8) ========

export const envState: EnvState = {
    skyMode: 'color',
    skyColorTop: [0.3, 0.5, 0.8],
    skyColorMid: [0.8, 0.8, 0.9],
    skyColorBot: [0.2, 0.2, 0.25],
    skyTexture: '',
    skyRotationY: 0,
    skyRotationSpeed: 0, // 0=关, 1=慢速, 5=快速
    skyBrightness: 1,
    starsEnabled: false,
    envIntensity: 1,

    groundVisible: true,
    groundMode: 'solid',
    groundColor: [0.15, 0.15, 0.18],
    groundAlpha: 0.6,

    windEnabled: true,
    windDirection: [0, 0, 1],
    windSpeed: 5,

    particleEnabled: false,
    particleType: 'none',
    particleEmitRate: 1,
    particleSize: 1,
    particleSpeed: 1,

    groundLevel: 0,

    waterEnabled: false,
    waterLevel: 0,
    waterColor: [0.2, 0.4, 0.6],
    waterTransparency: 0.8,
    waterWaveHeight: 0.5,
    waterSize: 50,
    waterAnimSpeed: 1,

    // ======== 水面泡沫 ========
    foamThreshold: 0.1,
    foamIntensity: 0.5,

    // ======== 水下效果 ========
    underwaterFogColor: [0.08, 0.2, 0.45],
    underwaterFogDensity: 0.015,
    underwaterChromaticAmount: 20,

    cloudsEnabled: false,
    debugClouds: false,
    cloudCover: 0.5,
    cloudScale: 0.55,
    cloudHeight: 325,
    cloudThickness: 15,
    cloudVisibility: 3000,
    cloudGap: 0.5,

    fogEnabled: false,
    fogColor: [0.5, 0.5, 0.6],
    fogDensity: 0.01,

    // ======== XPBD 布料模拟 ========
    clothEnabled: false,
    clothConfig: { ...DEFAULT_CLOTH_CONFIG },

    // ======== 太阳参数（序列化用）====
    sunAngle: 45,
    azimuth: -45,
};

// ======== DOM Element Refs ========

export const dom = {
    canvas: document.getElementById('renderCanvas') as HTMLCanvasElement,
    statusBar: document.getElementById('statusBar') as HTMLElement,
    statusText: document.getElementById('statusText') as HTMLElement,
    fpsClock: document.getElementById('fpsClock') as HTMLElement,
    loadingEl: document.getElementById('loading') as HTMLElement,
    btnMainAction: document.getElementById('btnMainAction') as HTMLButtonElement,
    btnMotionPopup: document.getElementById('btnMotionPopup') as HTMLButtonElement,
    playbackBar: document.getElementById('playbackBar') as HTMLElement,
    btnPlayPause: document.getElementById('btnPlayPause') as HTMLButtonElement,
    btnLoopToggle: document.getElementById('btnLoopToggle') as HTMLButtonElement,
    timeDisplay: document.getElementById('timeDisplay') as HTMLElement,
    seekBar: document.getElementById('seekBar') as HTMLElement,
    seekProgress: document.getElementById('seekProgress') as HTMLElement,
    loadingText: document.getElementById('loadingText') as HTMLElement,
    btnSettings: document.getElementById('btnSettings') as HTMLButtonElement,
    btnScene: document.getElementById('btnScene') as HTMLButtonElement,
    btnEnv: document.getElementById('btnEnv') as HTMLButtonElement,
    sceneOverlay: document.getElementById('sceneOverlay') as HTMLElement,
};

/** Card container helper: removes render-card bg, wraps content in an lcard. */
export function cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void {
    container.classList.remove('render-card');
    const card = document.createElement('div');
    card.className = 'lcard';
    fn(card);
    container.appendChild(card);
}

// ======== Helpers ========

let hintActive = false;
let savedStatusText = '';
let savedStatusColor = '';

export function setStatus(text: string, ok: boolean): void {
    if (hintActive || !dom.statusText) {
        return;
    } // don't overwrite hover hints
    dom.statusText.textContent = text;
    dom.statusText.style.color = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
}

/** Show a hover hint in the status bar, saving the current text for later restore. */
export function showHint(text: string): void {
    if (!dom.statusText) return;
    if (!hintActive) {
        savedStatusText = dom.statusText.textContent || '';
        savedStatusColor = dom.statusText.style.color || '';
    }
    hintActive = true;
    dom.statusText.textContent = text;
    dom.statusText.style.color = 'rgba(255,255,255,0.4)';
}

/** Restore the status bar text that was showing before the hint. */
export function hideHint(): void {
    hintActive = false;
    if (!dom.statusText) return;
    dom.statusText.textContent = savedStatusText;
    dom.statusText.style.color = savedStatusColor;
}

/** Wire up mouseenter/mouseleave for all [data-hint] elements (static HTML). */
export function initHints(): void {
    document.querySelectorAll('[data-hint]').forEach((el) => {
        el.addEventListener('mouseenter', () => {
            showHint(el.getAttribute('data-hint') || '暂无提示');
        });
        el.addEventListener('mouseleave', () => hideHint());
    });
}

export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function toBase64(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ======== Library Reference Utilities (portable scene serialization) ========

// Re-export normPath from fileservice; kept here for import compatibility.
import { normPath } from './fileservice';
export { normPath };

import type { SlideMenu } from '../menus/menu';

export const stackRegistry: {
    modelStack: SlideMenu | null;
    sceneStackGetter: (() => SlideMenu | null) | null;
    buildLevel:
        ((dir: string, label: string, filter?: (m: LibraryModel) => boolean) => PopupLevel) | null;
} = {
    modelStack: null,
    sceneStackGetter: null,
    buildLevel: null,
};

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
        if (normalized.startsWith(extPath + '/')) {
            return `${ext.name}:${normalized.substring(extPath.length + 1)}`;
        }
    }
    // Try main library
    if (libraryRoot) {
        const root = normPath(libraryRoot);
        if (normalized.startsWith(root + '/')) {
            return normalized.substring(root.length + 1);
        }
    }
    return null;
}

/**
 * Normalize a path string to remove "." and ".." segments (browser-safe, no Node path module).
 * Does NOT resolve symlinks or case differences — only lexical normalization.
 */
function normalizePath(input: string): string {
    // Replace backslashes with forward slashes
    let p = input.replace(/\\/g, '/');
    // Collapse multiple slashes
    p = p.replace(/\/+/g, '/');
    // Split into segments
    const parts = p.split('/').filter((s) => s !== '' && s !== '.');
    const result: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            // Pop the last segment, but never go above root
            if (result.length > 0 && result[result.length - 1] !== '..') {
                result.pop();
            }
        } else {
            result.push(part);
        }
    }
    return (p.startsWith('/') ? '/' : '') + result.join('/');
}

/**
 * Verify that a resolved path is within an allowed root directory.
 * Returns false if path escapes the root via ".." segments.
 */
function isPathWithinRoot(resolved: string, rootPath: string): boolean {
    const norm = normalizePath(resolved);
    const root = normalizePath(rootPath);
    // Must start with root + separator, or be exactly equal to root
    return norm === root || norm.startsWith(root + '/');
}

/**
 * Resolve a library identifier back to an absolute file path.
 * Returns the resolved path if the corresponding library is configured AND
 * the resolved path stays within the allowed library root (no directory traversal).
 * Returns null if the library is not configured or the path would escape bounds.
 */
export function resolveLibraryRef(libraryRef: string): string | null {
    if (!libraryRef) {
        return null;
    }
    // Prevent refs that start with "/" or contain ".." before resolution
    if (libraryRef.startsWith('/') || libraryRef.includes('..')) {
        console.warn(`[resolveLibraryRef] suspicious libraryRef rejected: "${libraryRef}"`);
        return null;
    }
    // External ref: "SourceName:rel/path/file.pmx"
    const colonIdx = libraryRef.indexOf(':');
    if (colonIdx > 0) {
        const source = libraryRef.substring(0, colonIdx);
        const relPath = libraryRef.substring(colonIdx + 1);
        // Extra check: relPath must not start with "/" or contain ".."
        if (relPath.startsWith('/') || relPath.includes('..')) {
            console.warn(`[resolveLibraryRef] suspicious external relPath rejected: "${relPath}"`);
            return null;
        }
        const ext = externalPaths.find((e) => e.name === source);
        if (ext) {
            const resolved = normPath(ext.path) + '/' + relPath;
            if (!isPathWithinRoot(resolved, ext.path)) {
                console.warn(`[resolveLibraryRef] path traversal blocked: "${resolved}"`);
                return null;
            }
            return resolved;
        }
        return null;
    }
    // Main library ref: "rel/path/file.pmx"
    if (libraryRoot) {
        const resolved = normPath(libraryRoot) + '/' + libraryRef;
        if (!isPathWithinRoot(resolved, libraryRoot)) {
            console.warn(`[resolveLibraryRef] path traversal blocked: "${resolved}"`);
            return null;
        }
        return resolved;
    }
    return null;
}

// Close all overlay-style popups. Call this before opening any new overlay.
// Uses .overlay.visible selector — all popup elements share the "overlay" CSS class.
export function closeAllOverlays(): void {
    document.querySelectorAll<HTMLElement>('[data-overlay].visible').forEach((el) => {
        el.classList.remove('visible', 'overlay-fade-out'); // 防御：同时清理动画残留类
    });
    setPopupOpen(false);
    // Sync nav button states — when all overlays are closed, all buttons should be aria-expanded="false"
    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        btn.setAttribute('aria-expanded', 'false');
    });
    // Notify registered callback (used by main.ts to reset _lastOverlayFn)
    _onCloseAllOverlays();
}

// Callback hook: called at the end of closeAllOverlays().
// Allows main.ts to reset overlay toggle state without circular dependency.
let _onCloseAllOverlays: (() => void) | null = null;
export function setOnCloseAllOverlays(fn: (() => void) | null): void {
    _onCloseAllOverlays = fn;
}

// ======== Auto-save trigger (injected by scene.ts) ========
let _triggerAutoSaveImpl: (() => void) | null = null;

export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

export function triggerAutoSave(): void {
    if (_triggerAutoSaveImpl) {
        _triggerAutoSaveImpl();
    }
}
