// plaza-state.ts — 模型广场模块级共享状态
// 从 plaza.ts 拆分，供 plaza-browser/download/thumbnail 共享

import type { PlazaSite } from './plaza-sites';
import type { PlazaCreator } from './plaza-creators';
import { closeAllOverlays } from '../core/utils';
import { swallowError } from '../core/utils';
import { StopProxy } from '../core/wails-bindings';

// ======== 常量 ========

export const CUSTOM_SITES_PATH = 'workshop_sites.json';
export const GLOBAL_MODE_KEY = 'miku.plaza.globalMode';

export const SITE_GROUPS: { label: string; icon: string; ids: string[] }[] = [
    {
        label: '国内',
        icon: 'lucide:map-pin',
        ids: ['mzhouse', 'bilibili', 'afdian', 'github', 'cms-blueprint'],
    },
    {
        label: '海外',
        icon: 'lucide:globe-2',
        ids: ['bowlroll', 'booth', 'nicovideo', 'deviantart', 'vroid'],
    },
];

// ======== 站点列表状态 ========

export let allSites: PlazaSite[] = [];
export let allCreators: PlazaCreator[] = [];

export function setAllSites(sites: PlazaSite[]): void {
    allSites = sites;
}
export function setAllCreators(creators: PlazaCreator[]): void {
    allCreators = creators;
}

// ======== 当前站点 ========

export let currentSiteId: string = '';

export function setCurrentSiteId(id: string): void {
    currentSiteId = id;
}
export function getCurrentSite(): PlazaSite | undefined {
    return allSites.find((s) => s.id === currentSiteId);
}

// ======== 界面层 ========

export let layer: HTMLElement | null = null;
export function setLayer(el: HTMLElement | null): void {
    layer = el;
}
export function getLayer(): HTMLElement | null {
    if (!layer) {
        layer = document.getElementById('webviewLayer');
    }
    return layer;
}

// ======== 代理状态 ========

export let plazaProxyActive = false;
export function setPlazaProxyActive(v: boolean): void {
    plazaProxyActive = v;
}

// ======== Observer ========

export let observer: MutationObserver | null = null;
export function setObserver(o: MutationObserver | null): void {
    observer = o;
}

// ======== 安装守卫 ========

export let downloadListenerInstalled = false;
export let eventListenersInstalled = false;
export let shortcutsRegistered = false;

export function setDownloadListenerInstalled(v: boolean): void {
    downloadListenerInstalled = v;
}
export function setEventListenersInstalled(v: boolean): void {
    eventListenersInstalled = v;
}
export function setShortcutsRegistered(v: boolean): void {
    shortcutsRegistered = v;
}

// ======== Iframe 引用 ========

export let plazaIframe: HTMLIFrameElement | null = null;
export function setPlazaIframe(el: HTMLIFrameElement | null): void {
    plazaIframe = el;
}

// ======== 遥控面板 ========

export let remoteURLDisplay: HTMLElement | null = null;
export let remoteProgress: HTMLElement | null = null;
export function setRemoteURLDisplay(el: HTMLElement | null): void {
    remoteURLDisplay = el;
}
export function setRemoteProgress(el: HTMLElement | null): void {
    remoteProgress = el;
}

// ======== 打开模式 ========

export type OpenMode = 'embed' | 'external' | 'window';

export function loadGlobalMode(): OpenMode | null {
    try {
        const v = localStorage.getItem(GLOBAL_MODE_KEY);
        if (v === 'embed' || v === 'external' || v === 'window') {
            return v;
        }
    } catch {
        /* ignore */
    }
    return null;
}

export function saveGlobalMode(mode: OpenMode): void {
    try {
        localStorage.setItem(GLOBAL_MODE_KEY, mode);
    } catch {
        /* ignore */
    }
}

export function effectiveMode(site: PlazaSite): OpenMode {
    try {
        const key = `miku.plaza.mode.${site.name}`;
        const saved = localStorage.getItem(key);
        if (saved === 'embed' || saved === 'external' || saved === 'window') {
            return saved;
        }
    } catch {
        /* ignore */
    }
    const global = loadGlobalMode();
    if (global) {
        return global;
    }
    return site.mode ?? 'embed';
}

// ======== 代理生命周期 ========

export function stopProxy(): void {
    if (!plazaProxyActive) {
        return;
    }
    setPlazaProxyActive(false);
    swallowError(StopProxy());
}

// ======== 关闭广场 ========

export function closePlaza(): void {
    setPlazaIframe(null);
    stopProxy();
    closeAllOverlays();
}
