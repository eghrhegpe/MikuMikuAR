// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, status bar, library refs, menu wrappers.

import { createIconifyIcon } from './icons';
import { dom } from './dom';
import {
    externalPaths,
    libraryRoot,
    overridePaths,
    setPopupOpen,
    setLayerBindingTargetId,
    setMotionBindingTargetId,
} from './state';
import { normPath } from './fileservice';
import type { SlideMenu } from '../menus/menu';
import { getCurrentRenderingMenu } from '../menus/menu';

// Re-export normPath from fileservice; kept here for import compatibility.
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

// ======== Status Bar ========

let hintActive = false;
let savedStatusText = '';
let savedStatusColor = '';
let _statusTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 设置状态栏文本。
 * @param ok true=成功(绿色), false=信息/错误(白灰色)
 * @param hold true=持续显示不自动消失(默认 false, 2s/5s 后淡出)
 */
export function setStatus(text: string, ok: boolean, hold = false): void {
    if (!dom.statusText) {
        return;
    }

    // 清除旧定时器
    if (_statusTimer) {
        clearTimeout(_statusTimer);
        _statusTimer = null;
    }

    // hint 激活时仍然更新保存的值，hint 结束后显示最新状态
    if (hintActive) {
        savedStatusText = text;
        savedStatusColor = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
        return;
    }

    dom.statusText.textContent = text;
    dom.statusText.style.color = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
    dom.statusText.style.opacity = '1';

    // 自动淡出
    if (!hold) {
        const delay = ok ? 2000 : 5000;
        _statusTimer = setTimeout(() => {
            dom.statusText.style.transition = 'opacity 0.5s ease';
            dom.statusText.style.opacity = '0';
            _statusTimer = setTimeout(() => {
                dom.statusText.textContent = '';
                dom.statusText.style.transition = '';
                dom.statusText.style.opacity = '1';
            }, 500);
        }, delay);
    }
}

export function showHint(text: string): void {
    if (!dom.statusText) {
        return;
    }
    if (!hintActive) {
        savedStatusText = dom.statusText.textContent || '';
        savedStatusColor = dom.statusText.style.color || '';
    }
    hintActive = true;
    dom.statusText.textContent = text;
    dom.statusText.style.color = 'rgba(255,255,255,0.4)';
    dom.statusText.style.opacity = '1';
}

export function hideHint(): void {
    hintActive = false;
    if (!dom.statusText) {
        return;
    }
    // 恢复到最新保存的状态（可能已被 setStatus 更新过）
    dom.statusText.textContent = savedStatusText;
    dom.statusText.style.color = savedStatusColor;
    dom.statusText.style.opacity = '1';
}

export function initHints(): void {
    document.querySelectorAll('[data-hint]').forEach((el) => {
        el.addEventListener('mouseenter', () => {
            showHint(el.getAttribute('data-hint') || '暂无提示');
        });
        el.addEventListener('mouseleave', () => hideHint());
    });
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
    _onCloseAllOverlays?.();
    // 清除图层/动作绑定目标，防止残留下次误触发
    setLayerBindingTargetId(null);
    setMotionBindingTargetId(null);
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
        setStatus(`${context}: ${msg}`, false);
        console.warn(`[${context}]`, err);
        onError?.(err);
        return undefined;
    }
}

// ======== Error Toast（轻量小弹窗，含复制按钮） ========

export interface ToastAction {
    label: string;
    onClick: () => void;
}

// ======== Toast Queue ========

const MAX_VISIBLE_TOASTS = 5;
const TOAST_GAP = 8; // px gap between stacked toasts
let _toastIdCounter = 0;
const _activeToasts: Array<{
    id: number;
    el: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    fadeTimer: ReturnType<typeof setTimeout> | null;
}> = [];

function getToastContainer(): HTMLElement {
    let container = document.getElementById('mmk-toast-container');
    if (container) {
        return container;
    }
    container = document.createElement('div');
    container.id = 'mmk-toast-container';
    container.style.cssText = [
        'position:fixed;top:64px;left:50%;transform:translateX(-50%)',
        'display:flex;flex-direction:column;align-items:center;gap:8px;z-index:9999',
        'pointer-events:none', // container doesn't block clicks, children do
        'max-width:calc(min(80vw,420px));width:max-content',
    ].join(';');
    document.body.appendChild(container);
    return container;
}

function removeToast(id: number): void {
    const idx = _activeToasts.findIndex((t) => t.id === id);
    if (idx === -1) {
        return;
    }
    const entry = _activeToasts[idx];
    if (entry.fadeTimer) {
        clearTimeout(entry.fadeTimer);
    }
    clearTimeout(entry.timer);
    if (entry.el.parentNode) {
        entry.el.remove();
    }
    _activeToasts.splice(idx, 1);
}

function fadeAndRemoveToast(id: number, el: HTMLElement, fadeDuration = 300): void {
    const entry = _activeToasts.find((t) => t.id === id);
    if (!entry) {
        return;
    }
    clearTimeout(entry.timer);
    if (entry.fadeTimer) {
        clearTimeout(entry.fadeTimer);
    }
    entry.fadeTimer = setTimeout(() => {
        if (el.parentNode) {
            el.style.transition = `opacity ${fadeDuration}ms ease,transform ${fadeDuration}ms ease`;
            el.style.opacity = '0';
            el.style.transform = 'translateY(-8px) scale(0.97)';
            setTimeout(() => removeToast(id), fadeDuration);
        }
    }, 50);
}

function buildToastElement(title: string, detail?: string, actions?: ToastAction[]): HTMLElement {
    const toast = document.createElement('div');
    toast.style.cssText = [
        'pointer-events:auto', // toast itself is interactive
        'background:var(--bg-scene)',
        'border:1px solid rgba(255,80,80,0.3);border-radius:8px',
        'padding:8px 14px;display:flex;align-items:flex-start;gap:10px',
        'font-size:var(--font-ui);box-shadow:0 2px 16px rgba(0,0,0,0.4)',
        'width:100%;backdrop-filter:blur(8px)',
        'transition:opacity 0.3s ease,transform 0.3s ease',
    ].join(';');

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight:600;color:var(--text-bright);margin-bottom:2px';
    titleEl.textContent = title;
    body.appendChild(titleEl);

    if (detail) {
        const detailEl = document.createElement('div');
        detailEl.style.cssText =
            'color:var(--text-dim);font-size:var(--font-ui-sm);word-break:break-all;line-height:1.3';
        detailEl.textContent = detail;
        body.appendChild(detailEl);
    }
    toast.appendChild(body);

    // Actions area
    const actionsEl = document.createElement('div');
    actionsEl.style.cssText =
        'display:flex;gap:6px;flex-shrink:0;align-items:flex-start;padding-top:2px';

    // Copy button (only when there's detail to copy)
    if (detail) {
        const copyText = `${title}\n${detail}`;
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '复制';
        copyBtn.style.cssText =
            'padding:3px 10px;border:none;border-radius:4px;font-size:var(--font-ui-sm);cursor:pointer;' +
            'background:var(--white-08);color:var(--text)';
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(copyText);
                copyBtn.textContent = '已复制 ✓';
                setTimeout(() => {
                    copyBtn.textContent = '复制';
                }, 1500);
            } catch {
                // clipboard unavailable — silently ignore
            }
        });
        actionsEl.appendChild(copyBtn);
    }

    // Custom action buttons
    if (actions) {
        for (const act of actions) {
            const btn = document.createElement('button');
            btn.textContent = act.label;
            btn.style.cssText =
                'padding:3px 10px;border:none;border-radius:4px;font-size:var(--font-ui-sm);' +
                'cursor:pointer;background:var(--accent);color:#fff';
            btn.addEventListener('click', () => {
                act.onClick();
                removeToast(_toastIdCounter);
            });
            actionsEl.appendChild(btn);
        }
    }

    // Close button (always present)
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
        'font-size:11px;color:var(--text-dim);cursor:pointer;padding:2px 4px;line-height:1';
    closeBtn.addEventListener('click', () => fadeAndRemoveToast(_toastIdCounter, toast, 150));
    actionsEl.appendChild(closeBtn);

    toast.appendChild(actionsEl);
    return toast;
}

/**
 * Show a small non-intrusive toast at the top of the screen.
 * Supports a queue — multiple toasts stack vertically.
 * Oldest toasts are removed when exceeding MAX_VISIBLE_TOASTS.
 *
 * @param title   Bold title line (always visible).
 * @param detail  Optional detail text below the title.
 * @param actions Optional action buttons (e.g. [{ label: '撤销', onClick }]).
 * @param duration  Auto-hide after ms (default 8000).
 *
 * When a copy button should appear, pass the text to copy as the `detail` and
 * the function adds a copy button automatically.
 */
export function showErrorToast(
    title: string,
    detail?: string,
    actions?: ToastAction[],
    duration = 8000
): void {
    // Enforce max visible — dismiss oldest
    while (_activeToasts.length >= MAX_VISIBLE_TOASTS) {
        const oldest = _activeToasts[0];
        if (oldest) {
            fadeAndRemoveToast(oldest.id, oldest.el, 150);
        } else {
            break;
        }
    }

    const id = ++_toastIdCounter;
    const el = buildToastElement(title, detail, actions);
    const container = getToastContainer();
    container.appendChild(el);

    const timer = setTimeout(() => {
        fadeAndRemoveToast(id, el);
    }, duration);

    _activeToasts.push({ id, el, timer, fadeTimer: null });
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
    return libraryRoot + '/' + category;
}
