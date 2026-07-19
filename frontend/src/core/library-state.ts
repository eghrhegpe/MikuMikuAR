/**
 * [doc:architecture] Library / resource store — ADR-141 split from core/state.ts.
 * 状态访问规约见 scene-state.ts 头部注释（单一写入点 + 禁止直接赋值 export let）。
 */

import type {
    OverridePaths,
    LibraryModel,
    RecentMotion,
    DisplayNamePriority,
    LibrarySortMode,
} from './types';

// ======== Library Paths ========

export let libraryRoot = '';
export function setLibraryRoot(r: string): void {
    libraryRoot = r;
}

export let resourceRoot = '';
export function setResourceRoot(r: string): void {
    resourceRoot = r;
    libraryRoot = r;
}

export let overridePaths: OverridePaths = {};
export function setOverridePaths(p: OverridePaths): void {
    overridePaths = p;
}

// ======== Model Cache / List ========

export let allModels: LibraryModel[] = [];
export function setAllModels(m: LibraryModel[]): void {
    allModels = m;
}

// ======== Thumbnail Cache ========

export const thumbnailCache = new Map<string, string>();

/** 缩略图更新回调（由 ui-resource-panel.ts 注册，避免模块间动态 import 耦合）。 */
let _thumbnailUpdateCb: (() => void) | null = null;
export function setThumbnailUpdateCallback(cb: () => void): void {
    _thumbnailUpdateCb = cb;
}

export function setThumbnailCache(m: Map<string, string>): void {
    // [fix:thumbnail] 原地 mutate 而非替换 Map 对象，保证所有持有 live 引用的
    // 面板（createResourcePanel / IntersectionObserver）能感知缓存更新。
    thumbnailCache.clear();
    for (const [k, v] of m) {
        thumbnailCache.set(k, v);
    }
    // 通知所有活跃面板刷新缩略图 DOM（解决冷缓存首次加载不显示缩略图的问题）
    _thumbnailUpdateCb?.();
}

// ======== Recent Models ========

export let recentModels: string[] = [];
export function setRecentModels(r: string[]): void {
    recentModels = r;
}

// ======== Display Name Priority ========

export let displayNamePriority: DisplayNamePriority = 'filename';
export function setDisplayNamePriority(p: DisplayNamePriority): void {
    displayNamePriority = p;
}

// ======== Library Sort Mode ========

export let librarySortMode: LibrarySortMode = 'default';
export function setLibrarySortMode(m: LibrarySortMode): void {
    librarySortMode = m;
}

// ======== Recent Motions (memory only, not persisted) ========

const MAX_RECENT_MOTIONS = 10;
let _recentMotions: RecentMotion[] = [];

export function addRecentMotion(path: string, name: string): void {
    _recentMotions = _recentMotions.filter((r) => r.path !== path);
    _recentMotions.unshift({ path, name, timestamp: Date.now() });
    if (_recentMotions.length > MAX_RECENT_MOTIONS) {
        _recentMotions.length = MAX_RECENT_MOTIONS;
    }
}

export function getRecentMotions(): RecentMotion[] {
    return _recentMotions;
}

// ======== Model Metadata Cache ========

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

export const expandedFolders = new Set<string>();

export function toggleExpandedFolder(path: string): void {
    if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
    } else {
        expandedFolders.add(path);
    }
}
