// [doc:architecture] Utility functions for MikuMikuAR.
// Extracted from config.ts — pure helpers, status bar, library refs, menu wrappers.

import { createIconifyIcon } from './icons';
import { dom } from './dom';
import {
    externalPaths,
    libraryRoot,
    setPopupOpen,
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

export function setStatus(text: string, ok: boolean): void {
    if (hintActive || !dom.statusText) return;
    dom.statusText.textContent = text;
    dom.statusText.style.color = ok ? 'rgba(111,207,151,0.7)' : 'rgba(255,255,255,0.4)';
}

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

export function hideHint(): void {
    hintActive = false;
    if (!dom.statusText) return;
    dom.statusText.textContent = savedStatusText;
    dom.statusText.style.color = savedStatusColor;
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
    if (err === null || err === undefined) return 'unknown error';
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
        ((dir: string, label: string, filter?: (m: import('./types').LibraryModel) => boolean) => import('./types').PopupLevel) | null;
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
    if (!libraryRef) return null;
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
 * @returns The function result, or undefined on error
 */
export async function tryCatchStatus<T>(
    fn: () => T | Promise<T>,
    context: string
): Promise<T | undefined> {
    try {
        return await fn();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
        setStatus(`${context}: ${msg}`, false);
        console.warn(`[${context}]`, err);
        return undefined;
    }
}
