// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, library refs, menu wrappers.
// Status bar → status-bar.ts
// Toast notifications → toast.ts
// UI builders → ui-helpers.ts

import { createIconifyIcon } from './icons';
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
export { showErrorToast } from './toast';
export type { ToastAction } from './toast';
import type { SlideMenu } from '../menus/menu';

export { normPath };

// ======== Card Container ========

/** Card container helper: removes render-card bg, wraps content in an lcard. */
export function cardContainer(container: HTMLElement, fn: (c: HTMLElement) => void): void {
    container.classList.remove('render-card');
    const card = document.createElement('div');
    card.className = 'lcard';
    fn(card);
    container.appendChild(card);
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

function normalizePath(input: string): string {
    let p = input.replace(/\\/g, '/');
    p = p.replace(/\/+/g, '/');
    const parts = p.split('/').filter((s) => s !== '' && s !== '.');
    const result: string[] = [];
    for (const part of parts) {
        if (part === '..') {
            if (result.length > 0 && result[result.length - 1] !== '..') {
                result.pop();
            }
        } else {
            result.push(part);
        }
    }
    return (p.startsWith('/') ? '/' : '') + result.join('/');
}

function isPathWithinRoot(resolved: string, rootPath: string): boolean {
    const norm = normalizePath(resolved);
    const root = normalizePath(rootPath);
    return norm === root || norm.startsWith(root + '/');
}

/**
 * [doc:adr-090][doc:adr-095] 路径归属判定（单点版，基于 normPath）。
 * 判定 child 是否位于 base 之下：精确相等（忽略大小写），或前缀相等且紧随字符为 '/'。
 * 禁止裸字符串前缀（如 ".../PMX" 误命中 ".../PMXSub" → 伪文件夹）。
 * 与下方 `isPathWithinRoot`（基于 normalizePath，处理 `..`/`.`）并存属已知债，
 * 待 ADR-095 批次 5 归一化合并后收敛为唯一实现。
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
        console.warn(`[resolveLibraryRef] suspicious libraryRef rejected: "${libraryRef}"`);
        return null;
    }
    const colonIdx = libraryRef.indexOf(':');
    if (colonIdx > 0) {
        const source = libraryRef.substring(0, colonIdx);
        const relPath = libraryRef.substring(colonIdx + 1);
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

export function setTriggerAutoSave(fn: () => void): void {
    _triggerAutoSaveImpl = fn;
}

export function triggerAutoSave(): void {
    if (_triggerAutoSaveImpl) {
        _triggerAutoSaveImpl();
    }
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
        console.warn(`[${context}]`, err);
        onError?.(err);
        return undefined;
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
