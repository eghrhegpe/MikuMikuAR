// plaza.ts — 模型广场：全屏视图层入口（barrel + 入口函数）
// 已拆分：plaza-state.ts（状态）、plaza-browser.ts（浏览/渲染）、plaza-download.ts（下载/事件/快捷键）
// 本文件保留入口函数 + barrel re-export

// ======== Barrel Re-Exports ========
export { closePlaza } from './plaza-state';
export { renderHome, renderEmbed, renderRemote, buildSiteTabs, buildToolbar, renderSiteContent, showActionsMenu, openSiteByMode, openExternal, openInWindow, escapeHtml, _plazaBtn, _plazaSectionHeader, normalizeSite, normalizeCreator, loadCustomSites, mergeSites, loadCachedConfig, ensureSitesLoaded, getCustomPresets, saveCustomPresets } from './plaza-browser';
export { installDownloadListener, installShortcuts, installEventListeners, ensureObserver, handlePlazaDownload } from './plaza-download';

// ======== 入口函数 ========
import { installDownloadListener, installEventListeners, installShortcuts, ensureObserver } from './plaza-download';
import { renderHome } from './plaza-browser';

export async function showPlaza(): Promise<void> {
    installDownloadListener();
    installEventListeners();
    installShortcuts();
    ensureObserver();
    await renderHome();
}