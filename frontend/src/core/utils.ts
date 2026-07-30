// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, library refs, menu wrappers.
// Status bar → status-bar.ts
// Toast notifications → toast.ts
// UI builders → ui-helpers.ts

import { dom } from './dom';
import { libraryRoot, overridePaths, setPopupOpen } from './state';
import { normPath, computeLibraryRef as _pureComputeLibraryRef, getBaseName, getDirPath, isUnderRoot, isStageLike } from './path';
export { getBaseName, getDirPath, isUnderRoot, isStageLike, normPath };
import { setStatus } from './status-bar';
import { t } from './i18n/t';
import { translateGoError } from './i18n/goerr';
export { showErrorToast } from './toast';
export type { ToastAction } from './toast';
import { feedbackStatus, feedbackError, feedbackInfo } from './feedback';
import type { SlideMenu } from '../menus/menu';

import { logWarn, logError } from './logger';
// Re-export for external consumers (utils still serves as a barrel)
export { logWarn, logError };

// ======== Path Helpers ========

// ======== Card Container ========

/** Card container helper: removes render-card bg, wraps content in an lcard. Returns dispose from callback if provided. */
export function cardContainer(
    container: HTMLElement,
    fn: (c: HTMLElement) => (() => void) | void
): (() => void) | void {
    container.classList.remove('render-card');
    const card = document.createElement('div');
    card.className = 'lcard';
    const dispose = fn(card);
    container.appendChild(card);
    return dispose;
}

// ======== Loading Indicator ========

/**
 * 加载指示器包裹器：显示 loading 遮罩 → 执行 fn → `finally` 隐藏。
 * 收敛各加载器重复的 `loadingEl.display` 显隐 + `loadingText` 样板，
 * 避免"改一处漏一处"（ADR-096 复用收敛）。
 *
 * 注意：仅封装遮罩显隐与 `finally` 清理；**异常处理由 `fn` 内部自行负责**，
 * 以保留各加载器差异化的错误文案（`console.error` tag / `setStatus` key）
 * 与提前 `return` 语义。带进度回调的加载器（model-loader/props）不适用本包裹器。
 *
 * @param textKey loading 文案的 i18n key
 * @param fn 加载主体（自行 try/catch 差异化错误）
 */
export async function withLoadingIndicator<T>(textKey: string, fn: () => Promise<T>): Promise<T> {
    dom.loadingEl.style.display = 'block';
    dom.loadingText.textContent = t(textKey);
    try {
        return await fn();
    } finally {
        dom.loadingEl.style.display = 'none';
    }
}

// ======== Formatting ========

export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function formatError(err: unknown, maxLen = 120): string {
    if (err === null || err === undefined) {
        return 'unknown error';
    }
    // [doc:adr-135] P0.2: 识别 LibraryLoadError 结构化对象，加 [loadId/phase] 前缀。
    // 用 structural type 判断（不 import 类型），避免 utils → load-manager 依赖。
    // 调用方（library-actions 的 6 处 catch）零侵入获得 trace 能力。
    if (typeof err === 'object' && (err as { name?: string }).name === 'LibraryLoadError') {
        const e = err as {
            loadId: string;
            phase: string;
            cause: unknown;
        };
        // 递归 formatError 取内层 cause 文本，给前缀留 30 字符空间
        const causeStr = formatError(e.cause, Math.max(20, maxLen - 30));
        const prefix = `[${e.loadId}/${e.phase}] `;
        const full = prefix + causeStr;
        return full.length > maxLen ? full.slice(0, maxLen - 3) + '...' : full;
    }
    if (err instanceof Error) {
        const msg = err.message;
        return msg.length > maxLen ? msg.slice(0, maxLen - 3) + '...' : msg;
    }
    if (typeof err === 'string') {
        return err.length > maxLen ? err.slice(0, maxLen - 3) + '...' : err;
    }
    try {
        const s = String(err);
        return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
    } catch {
        return 'unknown error';
    }
}

export { canvasToBase64, toBase64, thumbDataUrl } from './image';

export { generateUuid } from './uuid';

export { escapeHtml } from './escape-html';

// ======== Math Helpers ========

// [doc:adr-190-followup] 数学钳制收敛至零依赖叶子 clamp.ts，避免纯模块拖入整桶 @/core/utils
import { clamp, clampInt, clamp01, lerp, lerpArray, clampPct } from './clamp';
import {
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    LoadingGuard,
    DebouncedTimer,
    Abortable,
} from './async';
export { clamp, clampInt, clamp01, lerp, lerpArray, clampPct };
export {
    swallowError,
    fireAndForget,
    delay,
    waitForFrame,
    LoadingGuard,
    DebouncedTimer,
    Abortable,
};

// ======== Object Helpers ========

/** 泛型键值写入工具，避免大量 `obj[key] = value` 重复。 */
// ======== Resource Path Resolution =========
export const stackRegistry: {
    modelStack: SlideMenu | null;
    sceneStackGetter: (() => SlideMenu | null) | null;
    buildLevel:
        | ((
              dir: string,
              label: string,
              filter?: (m: import('./types').LibraryModel) => boolean,
              targetStack?: SlideMenu,
              extraFolders?: { label: string; path: string }[],
              outcome?: import('./types').BrowseOutcome
          ) => import('./types').PopupLevel)
        | null;
} = {
    modelStack: null,
    sceneStackGetter: null,
    buildLevel: null,
};

/** 向后兼容包装：从 config 读取 libraryRoot 再委托给 path 模块的纯函数。 */
export function computeLibraryRef(filePath: string): string | null {
    return _pureComputeLibraryRef(filePath, libraryRoot);
}

export function resolveLibraryRef(libraryRef: string): string | null {
    if (!libraryRef) {
        return null;
    }
    if (libraryRef.startsWith('/') || libraryRef.includes('..')) {
        logWarn('resolveLibraryRef', `suspicious libraryRef rejected: "${libraryRef}"`);
        return null;
    }
    const colonIdx = libraryRef.indexOf(':');
    if (colonIdx > 0) {
        // External library refs (e.g. "MyLib:PMX/model.pmx") are no longer supported;
        // reject any ref containing a colon that isn't a drive letter.
        logWarn('resolveLibraryRef', `external library ref no longer supported: "${libraryRef}"`);
        return null;
    }
    if (libraryRoot) {
        const resolved = normPath(libraryRoot) + '/' + libraryRef;
        if (!isUnderRoot(libraryRoot, resolved)) {
            logWarn('resolveLibraryRef', `path traversal blocked: "${resolved}"`);
            return null;
        }
        return resolved;
    }
    return null;
}

export {
    closeAllOverlays,
    setOnCloseAllOverlays,
    getMenuWrapper,
    disposeMenuWrapper,
    clearAllMenuWrappers,
} from '../menus/menu-overlay';

// ======== Auto-save Trigger ========
// 注：防抖下沉到 scene-serialize.ts 的 _autoSaveDebounced（500ms）统一处理，
// 此处只做函数指针注册，不再叠加 setTimeout，避免 1500ms + 500ms = 2000ms 双层延迟。

let _triggerAutoSaveImpl: (() => void) | null = null;

export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

export function triggerAutoSave(): void {
    _triggerAutoSaveImpl?.();
}

export { tryCatchStatus, withLoadingStatus, withLoadingStatusTargeted } from './status-helpers';

// ======== Pure Functions (ADR-101 P3) ========

/** 2D 欧几里得距离。 */
export function dist2d(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** 3D 欧几里得距离。 */
export function dist3d(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 角度 → 弧度。 */
export function degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/** 弧度 → 角度。 */
export function radToDeg(rad: number): number {
    return (rad * 180) / Math.PI;
}

/** 确保值为数组；非数组则包裹为单元素数组。 */
export function ensureArray<T>(x: T | T[]): T[] {
    return Array.isArray(x) ? x : [x];
}

/** 按谓词过滤对象键，返回仅含满足条件键值对的新对象。 */
export function filterKeys<T extends object>(obj: T, pred: (key: keyof T) => boolean): Partial<T> {
    const result: Partial<T> = {};
    for (const key of Object.keys(obj) as (keyof T)[]) {
        if (pred(key)) {
            result[key] = obj[key];
        }
    }
    return result;
}

/** 轻量泛型缓存——Map 封装，统一 get/set/has/delete/clear 接口。 */
export class Cache<K, V> {
    private _map = new Map<K, V>();

    get(key: K): V | undefined {
        return this._map.get(key);
    }
    set(key: K, value: V): void {
        this._map.set(key, value);
    }
    has(key: K): boolean {
        return this._map.has(key);
    }
    delete(key: K): boolean {
        return this._map.delete(key);
    }
    clear(): void {
        this._map.clear();
    }
    get size(): number {
        return this._map.size;
    }
}

/**
 * 等待全部 promise 结束，仅返回 fulfilled 结果（rejected 被静默丢弃）。
 * 适用于"批量加载、尽力而为"场景。
 */
export async function allSettledFilter<T>(
    promises: Promise<T>[]
): Promise<PromiseFulfilledResult<Awaited<T>>[]> {
    const results = await Promise.allSettled(promises);
    return results.filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled');
}

export { jsonStringify, jsonParse } from './json-stringify';

// ======== Resource Path Resolution ========

/** 资源类别到 OverridePaths 键名的映射 */
const CATEGORY_KEY: Record<string, string> = {
    pmx: 'pmx',
    vmd: 'vmd',
    audio: 'audio',
    stage: 'stage',
    prop: 'prop',
    environment: 'environment',
    md_dress: 'md_dress',
    setting: 'setting',
};

// Go 端 GetPath 使用的实际目录名（大小写敏感）
export const CATEGORY_DIR: Record<string, string> = {
    pmx: 'PMX',
    vmd: 'VMD',
    audio: 'audio',
    stage: 'stage',
    prop: 'prop',
    environment: 'environment',
    md_dress: 'MD-dress',
    setting: 'setting',
};

/**
 * 统一的资源浏览目录解析。
 * 优先级：overridePaths[category] > libraryRoot/subdir
 * @returns 解析后的目录路径，如果 libraryRoot 未设置则返回空字符串
 */
export function getBrowseDir(category: string): string {
    const key = CATEGORY_KEY[category] ?? category;
    const override = (overridePaths as Record<string, string>)[key];
    if (override) {
        return override;
    }
    if (!libraryRoot) {
        return '';
    }
    // 使用与实际目录名一致的子目录名（与 Go 端 GetPath 保持大小写一致）
    // 网页端扫描已将文件映射到虚拟子目录（web://selected-dir/PMX 等），无需特殊处理。
    const subdir = CATEGORY_DIR[category] ?? category;
    return libraryRoot + '/' + subdir;
}

