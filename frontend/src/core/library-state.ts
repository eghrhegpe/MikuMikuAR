/**
 * [doc:architecture] Library / resource store — ADR-141 split from core/state.ts.
 * 状态访问规约见 scene-state.ts 头部注释（单一写入点 + 禁止直接赋值 export let）。
 */

import type { OverridePaths, LibraryModel, RecentMotion, LibrarySortMode } from './types';

// ======== Library Paths ========

export let libraryRoot = '';
export function setLibraryRoot(r: string): void {
    libraryRoot = r;
}

export let resourceRoot = '';
/** [audit:P2] 同时同步 libraryRoot（历史兼容：二者语义相同，resourceRoot 为新名称）。 */
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

/**
 * [fix:round14 P3] 清空缩略图缓存。
 * 场景切换或库路径变更时调用，释放旧缩略图内存。
 */
export function clearThumbnailCache(): void {
    thumbnailCache.clear();
    _thumbnailUpdateCb?.();
}

// ======== Recent Models ========

export let recentModels: string[] = [];
export function setRecentModels(r: string[]): void {
    recentModels = r;
}

// ======== Display Name Priority（Deprecated：始终显示文件名）========

/** @deprecated 始终显示文件名，保留以防外部引用 */
export const displayNamePriority = 'filename' as const;
export function setDisplayNamePriority(_p: string): void {
    // no-op: 始终使用文件名
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

export function getRecentMotions(): readonly RecentMotion[] {
    // [audit:P2] 返回深拷贝，防外部绕过 setter 直接 mutate（浅拷贝只挡数组级 push/splice，
    // 元素级改 name/path 仍会污染内部状态）。
    return _recentMotions.map((r) => ({ ...r }));
}

/**
 * [fix:round14 P3] 清空最近动作列表。
 * 测试 teardown 或用户手动清除时调用。
 */
export function clearRecentMotions(): void {
    _recentMotions = [];
}

// ======== Model Metadata Cache ========

export let modelMetaCache = new Map<string, { comment: string }>();
export function setModelMetaCache(m: Map<string, { comment: string }>): void {
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

/**
 * [fix:round14 P3] 清空已展开文件夹集合。
 * 库路径切换或文件夹删除时调用，消除幽灵展开状态。
 */
export function clearExpandedFolders(): void {
    expandedFolders.clear();
}
