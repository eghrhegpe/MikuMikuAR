// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, library refs, menu wrappers.
// Status bar → status-bar.ts
// Toast notifications → toast.ts
// UI builders → ui-helpers.ts

import { dom } from './dom';
import {
    externalPaths,
    libraryRoot,
    overridePaths,
    setPopupOpen,
    setLayerBindingTargetId,
    setMotionBindingTargetId,
    setModelReplaceTargetId,
} from './state';
import { normPath } from './fileservice';
import { setStatus } from './status-bar';
import { t } from './i18n/t';
export { showErrorToast } from './toast';
export type { ToastAction } from './toast';
import type { SlideMenu } from '../menus/menu';

export { normPath };

// ======== Path Helpers ========

/**
 * 跨平台取路径末段文件名。
 * 基于 `normPath`（反斜杠→正斜杠、去尾斜杠、折叠 `.`、content:// 透传），
 * 避免各模块重复手搓 `p.replace(/\\/g, '/').split('/').pop()`。
 */
export function getBaseName(p: string): string {
    const norm = normPath(p);
    const segs = norm.split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1] : norm;
}

/**
 * 跨平台取父目录路径。根目录（无 `/`）返回空字符串。
 * 基于 `normPath`，是 `p.replace(/\\/g, '/').replace(/\/[^/]*$/, '')` 的归一化替代。
 */
export function getDirPath(p: string): string {
    const norm = normPath(p);
    const idx = norm.lastIndexOf('/');
    return idx >= 0 ? norm.substring(0, idx) : '';
}

// ======== Card Container ========

/** Card container helper: removes render-card bg, wraps content in an lcard. */
export function cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void {
    container.classList.remove('render-card');
    const card = document.createElement('div');
    card.className = 'lcard';
    fn(card);
    container.appendChild(card);
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

// ======== Math Helpers ========

export function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
}

export function clampInt(v: number, lo: number, hi: number): number {
    return Math.round(clamp(v, lo, hi));
}

export function clamp01(v: number): number {
    return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function lerpArray(a: number[], b: number[], t: number): number[] {
    return a.map((v, i) => lerp(v, b[i], t));
}

export function formatTimestamp(d: Date = new Date()): string {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
}

export function debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    ms: number
): {
    (...args: A): void;
    cancel(): void;
} {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = (...args: A): void => {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, ms);
    };
    debounced.cancel = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };
    return debounced;
}

export function deepClone<T>(x: T): T {
    return JSON.parse(JSON.stringify(x)) as T;
}

// ======== Error & Async Helpers (ADR-101 P1-a) ========

/**
 * 统一标签格式的警告日志：`[tag] message err`。
 * message 为空时省略中间空格；err 为空时不传第二个参数（避免尾随空字符串）。
 */
export function logWarn(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    if (err !== undefined) {
        console.warn(prefix, err);
    } else {
        console.warn(prefix);
    }
}

/** 统一标签格式的错误日志（与 logWarn 对应，走 console.error）。 */
export function logError(tag: string, message: string, err?: unknown): void {
    const prefix = message ? `[${tag}] ${message}` : `[${tag}]`;
    if (err !== undefined) {
        console.error(prefix, err);
    } else {
        console.error(prefix);
    }
}

/**
 * 吞掉 promise 的异常并记录日志（比空 `.catch(() => {})` 可调试）。
 * 不返回值——用于 fire-and-forget 场景。内部调用 logWarn，确保错误不沉默。
 */
export function swallowError<T>(promise: Promise<T>): void {
    promise.catch((err) => logWarn('swallow', '', err));
}

/** 启动一个异步操作但不等待，异常由 swallowError 兜底。 */
export function fireAndForget(fn: () => Promise<void>): void {
    swallowError(fn());
}

/** Promise 包装的延迟。 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Promise 包装的等待下一帧。 */
export function waitForFrame(): Promise<void> {
    // 用箭头函数显式忽略 rAF 的 time 参数，避免 resolve (void) 与 FrameRequestCallback (number) 类型冲突
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 动态导入并取出指定导成名。
 * 不内含 catch——调用方显式配合 swallowError 或 try/catch。
 * `mod[name] as T` 是类型断言，调用方需确保 name 对应的导出类型与 T 一致。
 */
export async function lazyImport<T>(path: string, name: string): Promise<T> {
    const mod = await import(path);
    return mod[name] as T;
}

// ======== Lifecycle Guards (ADR-101 P2) ========

/**
 * 并发加载守卫——防止同一 key 的异步操作重复触发。
 * 覆盖两种模式：
 * - Set 模式：`tryEnter('modelId')` / `leave('modelId')`，多 key 并发去重
 * - Boolean 模式：`tryEnter()` / `leave()` 无参，单实例锁定
 */
export class LoadingGuard {
    private _loading = new Set<string>();

    /** 尝试进入加载状态。返回 true 表示获准进入，false 表示已有同 key 操作进行中。 */
    tryEnter(key: string = '__default__'): boolean {
        if (this._loading.has(key)) {
            return false;
        }
        this._loading.add(key);
        return true;
    }

    /** 退出加载状态，释放 key 占用。 */
    leave(key: string = '__default__'): void {
        this._loading.delete(key);
    }

    /** 查询指定 key 是否正在加载中。 */
    isLoading(key: string = '__default__'): boolean {
        return this._loading.has(key);
    }

    /** 清除所有加载状态（异常恢复用）。 */
    clear(): void {
        this._loading.clear();
    }
}

/**
 * 防抖定时器——封装 setTimeout 的 schedule/cancel 样板。
 * 重复调用 schedule 会取消前一个定时器，仅最后一个生效。
 */
export class DebouncedTimer {
    private _timer: ReturnType<typeof setTimeout> | null = null;

    /** 调度延迟执行。若已有待执行定时器，先取消再重设。 */
    schedule(fn: () => void, ms: number): void {
        this.cancel();
        this._timer = setTimeout(() => {
            this._timer = null;
            fn();
        }, ms);
    }

    /** 取消待执行的定时器。 */
    cancel(): void {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    /** 是否有待执行的定时器。 */
    get isPending(): boolean {
        return this._timer !== null;
    }

    /** 释放资源（等同 cancel）。 */
    dispose(): void {
        this.cancel();
    }
}

/**
 * 可复用的 AbortController 封装——abort 后自动重置，使对象可重复使用。
 * 避免每次 abort 后都要手动 `new AbortController()` 的样板。
 */
export class Abortable {
    private _controller: AbortController = new AbortController();

    /** 获取当前 controller（一般用 signal 即可）。 */
    get controller(): AbortController {
        return this._controller;
    }

    /** 获取当前 signal，传给 fetch / API 调用。 */
    get signal(): AbortSignal {
        return this._controller.signal;
    }

    /** 中止当前 signal，然后自动重置为新 controller，使对象可复用。 */
    abort(): void {
        this._controller.abort();
        this._controller = new AbortController();
    }

    /** 释放资源（abort 后不重置，因为对象不再使用）。 */
    dispose(): void {
        this._controller.abort();
    }
}

// ======== Object Helpers ========

/** 泛型键值写入工具，避免大量 `obj[key] = value` 重复。 */
export function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
    obj[key] = value;
}

// ======== Library Reference Utilities ========

export const stackRegistry: {
    modelStack: SlideMenu | null;
    sceneStackGetter: (() => SlideMenu | null) | null;
    buildLevel:
        | ((
              dir: string,
              label: string,
              filter?: (m: import('./types').LibraryModel) => boolean,
              targetStack?: SlideMenu,
              extraFolders?: { label: string; path: string }[]
          ) => import('./types').PopupLevel)
        | null;
} = {
    modelStack: null,
    sceneStackGetter: null,
    buildLevel: null,
};

export function computeLibraryRef(filePath: string): string | null {
    const normalized = normPath(filePath);
    for (const ext of externalPaths) {
        const extPath = normPath(ext.path);
        if (normalized.startsWith(extPath + '/')) {
            return `${ext.name}:${normalized.substring(extPath.length + 1)}`;
        }
    }
    if (libraryRoot) {
        const root = normPath(libraryRoot);
        if (normalized.startsWith(root + '/')) {
            return normalized.substring(root.length + 1);
        }
    }
    return null;
}

/**
 * [doc:adr-090][doc:adr-095] 路径归属判定（唯一实现，基于 normPath）。
 * 判定 child 是否位于 base 之下：精确相等（忽略大小写），或前缀相等且紧随字符为 '/'。
 * 禁止裸字符串前缀（如 ".../PMX" 误命中 ".../PMXSub" → 伪文件夹）。
 * 含 `..` 的路径直接拒绝（目录边界判定场景，越界到 base 之外属非法输入；
 * 与 resolveLibraryRef 的 `..` 字符串层拦截形成对称防护）。
 */
export function isUnderRoot(base: string, child: string): boolean {
    const b = normPath(base).toLowerCase();
    const c = normPath(child).toLowerCase();
    // 拒绝 '..' 逃逸段：含 '..' 的路径不是已解析绝对路径，跨目录误判且会渲染成 '..' 文件夹。
    // 修复 P2 场景1（如 C:/text-model/PMX/../VMD 不应判为在 PMX 之下）
    if (c === '..' || c.startsWith('../') || c.endsWith('/..') || c.includes('/../')) {
        return false;
    }
    return c === b || c.startsWith(b + '/');
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
        const source = libraryRef.substring(0, colonIdx);
        const relPath = libraryRef.substring(colonIdx + 1);
        if (relPath.startsWith('/') || relPath.includes('..')) {
            logWarn('resolveLibraryRef', `suspicious external relPath rejected: "${relPath}"`);
            return null;
        }
        const ext = externalPaths.find((e) => e.name === source);
        if (ext) {
            const resolved = normPath(ext.path) + '/' + relPath;
            if (!isUnderRoot(ext.path, resolved)) {
                logWarn('resolveLibraryRef', `path traversal blocked: "${resolved}"`);
                return null;
            }
            return resolved;
        }
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

// ======== Overlay Management ========

let _onCloseAllOverlays: (() => void) | null = null;

export function setOnCloseAllOverlays(fn: (() => void) | null): void {
    _onCloseAllOverlays = fn;
}

export function closeAllOverlays(): void {
    document.querySelectorAll<HTMLElement>('[data-overlay].visible').forEach((el) => {
        el.classList.remove('visible', 'overlay-fade-out');
    });
    setPopupOpen(false);
    document.querySelectorAll<HTMLElement>('[aria-controls]').forEach((btn) => {
        btn.setAttribute('aria-expanded', 'false');
    });
    // 关闭可能残留的弹窗对话框（menu 关闭时 dialog 未自动隐藏）
    const dialogOverlay = document.getElementById('mmd-dialog-overlay');
    if (dialogOverlay) {
        dialogOverlay.classList.remove('mmd-dialog-visible');
        dialogOverlay.style.pointerEvents = '';
    }
    _onCloseAllOverlays?.();
    // 清除图层/动作/模型替换绑定目标，防止残留下次误触发
    setLayerBindingTargetId(null);
    setMotionBindingTargetId(null);
    setModelReplaceTargetId(null);
}

// ======== Menu Wrapper Management ========

const _menuWrapperRegistry = new Map<string, HTMLElement>();

export function getMenuWrapper(menuId: string): HTMLElement {
    let wrapper = _menuWrapperRegistry.get(menuId);
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'menu-wrapper';
        wrapper.dataset.menuId = menuId;
        dom.sceneOverlay.appendChild(wrapper);
        _menuWrapperRegistry.set(menuId, wrapper);
    }
    for (const [id, w] of _menuWrapperRegistry) {
        (w as HTMLElement).style.display = id === menuId ? '' : 'none';
    }
    return wrapper;
}

export function disposeMenuWrapper(menuId: string): void {
    const wrapper = _menuWrapperRegistry.get(menuId);
    if (wrapper) {
        wrapper.remove();
        _menuWrapperRegistry.delete(menuId);
    }
}

export function clearAllMenuWrappers(): void {
    for (const [id] of _menuWrapperRegistry) {
        disposeMenuWrapper(id);
    }
}

// ======== Auto-save Trigger ========

let _triggerAutoSaveImpl: (() => void) | null = null;
let _autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DEBOUNCE_MS = 1500;

export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

export function triggerAutoSave(): void {
    if (!_triggerAutoSaveImpl) {
        return;
    }
    if (_autoSaveTimeout) {
        clearTimeout(_autoSaveTimeout);
    }
    _autoSaveTimeout = setTimeout(() => {
        _autoSaveTimeout = null;
        _triggerAutoSaveImpl!();
    }, AUTO_SAVE_DEBOUNCE_MS);
}

// ======== Generic try/catch + status helper ========

/**
 * Execute a function with automatic error handling that shows errors in the status bar.
 * Returns the result of the function, or undefined if an error occurred.
 *
 * @param fn - The function to execute (can be async or sync)
 * @param context - Description of what was being attempted (e.g. "加载模型")
 * @param onError - Optional callback invoked when an error occurs (for recovery logic)
 * @returns The function result, or undefined on error
 */
export async function tryCatchStatus<T>(
    fn: () => T | Promise<T>,
    context: string,
    onError?: (err: unknown) => void
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
        // 用户取消文件选择 — Wails 抛 "cancelled by user"，静默忽略
        if (/cancelled by user/i.test(msg)) {
            return undefined;
        }
        setStatus(`${context}: ${msg}`, false);
        logWarn(context, '', err);
        onError?.(err);
        return undefined;
    }
}

// ======== Pure Functions (ADR-101 P3) ========

/** 百分比钳制到 [0, 100]。 */
export function clampPct(v: number): number {
    return Math.max(0, Math.min(100, v));
}

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

/** 格式化 JSON 字符串（2 空格缩进）。 */
export function jsonStringify(x: unknown): string {
    return JSON.stringify(x, null, 2);
}

/** 安全 JSON 解析；解析失败返回 null。 */
export function jsonParse<T>(s: string): T | null {
    try {
        return JSON.parse(s) as T;
    } catch {
        return null;
    }
}

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
    const subdir = CATEGORY_DIR[category] ?? category;
    return libraryRoot + '/' + subdir;
}
