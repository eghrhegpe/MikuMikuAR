// plaza.ts — 模型广场：独立全屏「视图层」（非弹窗菜单）
// 见 ADR-075。免登录展示站走全屏内嵌 iframe（Go 反向代理剥离 X-Frame / CSP
// frame-ancestors），登录站走系统浏览器保留登录态，下载由 ADR-003 方案 C
// 的 fsnotify 监听落库。两条路在「落库」处会师，不重复造轮子。
//
// 呈现容器是独立的 #webviewLayer（index.html 中与 #sceneOverlay 平级的兄弟节点），
// 不再寄生在 SlideMenu 弹窗里——浏览器是单一全屏表面，没有层级/返回栈，
// SlideMenu 的导航机件对它纯属死重。

import { Browser, Events } from '@wailsio/runtime';
import {
    StartProxy,
    StopProxy,
    NavigatePlazaWindow,
    ClosePlazaWindow,
    PlazaGoBack,
    PlazaGoForward,
    PlazaReload,
    PlazaZoomIn,
    PlazaZoomOut,
    PlazaZoomReset,
} from '../core/wails-bindings';
import { openExternalURL } from '../core/platform';
import { closeAllOverlays, swallowError, logWarn } from '../core/utils';
import { PLAZA_SITES, type PlazaSite } from './plaza-sites';
import { setStatus } from '../core/status-bar';
import { t } from '../core/i18n/t';
import { showErrorToast } from '../core/toast';
import { refreshLibrary } from './library';
import { registerShortcuts } from '../core/shortcut-registry';
import { addDisposableListener, type Disposable } from '../core/dom';

const CUSTOM_SITES_PATH = 'plaza_sites.json';

const L = {
    title: '模型广场',
    openInBrowser: '在浏览器打开',
    close: '关闭',
    back: '返回',
    refresh: '刷新',
    proxyError: '代理启动失败：',
    // [ADR-087 P0] 遥控面板
    goBack: '‹ 后退',
    goForward: '前进 ›',
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '重置',
    closeWindow: '关闭窗口',
    remoteHint: '广场窗口已打开，点击下载链接会自动入库',
    // [ADR-087 P1] URL 追踪 + 下载进度
    loading: '加载中...',
    downloading: '下载中',
    downloadComplete: '下载完成',
    // Tab 标签
    tabSites: '模型站',
    tabCreators: '创作者',
    tabLibrary: '资源库',
};

// 打开方式：embed=内嵌 iframe；window=Wails 新窗口；external=系统浏览器。
// [ADR-087 P1→P3-优化] 存储优先级链：
//   miku.plaza.mode.{siteName}  (per-site 覆写) → 最高
//   miku.plaza.globalMode       (全局默认)       → 中
//   site.mode                   (代码默认)       → 最低
// 全局模式由工具栏分段选择器统一切换，卡片仅显示徽章；双击卡片可覆写单站。
type OpenMode = 'embed' | 'external' | 'window';

const GLOBAL_MODE_KEY = 'miku.plaza.globalMode';

function loadGlobalMode(): OpenMode | null {
    try {
        const v = localStorage.getItem(GLOBAL_MODE_KEY);
        if (v === 'embed' || v === 'external' || v === 'window') {
            return v;
        }
    } catch {
        /* localStorage 不可用时忽略 */
    }
    return null;
}

function saveGlobalMode(mode: OpenMode): void {
    try {
        localStorage.setItem(GLOBAL_MODE_KEY, mode);
    } catch {
        /* 忽略 */
    }
}

function effectiveMode(site: PlazaSite): OpenMode {
    try {
        const key = `miku.plaza.mode.${site.name}`;
        const saved = localStorage.getItem(key);
        if (saved === 'embed' || saved === 'external' || saved === 'window') {
            return saved;
        }
    } catch {
        /* localStorage 不可用时忽略 */
    }
    const global = loadGlobalMode();
    if (global) {
        return global;
    }
    return site.mode ?? 'embed';
}

function saveSiteMode(site: PlazaSite, mode: OpenMode): void {
    try {
        const key = `miku.plaza.mode.${site.name}`;
        localStorage.setItem(key, mode);
    } catch {
        /* 忽略 */
    }
}

/** 清除单站覆写，回退到全局/代码默认。用于双击菜单的「跟随全局」选项 */
function clearSiteMode(site: PlazaSite): void {
    try {
        localStorage.removeItem(`miku.plaza.mode.${site.name}`);
    } catch {
        /* 忽略 */
    }
}

/** 某站点是否有 per-site 覆写（用于双击菜单显示「跟随全局」选项） */
function hasSiteOverride(site: PlazaSite): boolean {
    try {
        return localStorage.getItem(`miku.plaza.mode.${site.name}`) !== null;
    } catch {
        return false;
    }
}

async function loadCustomSites(): Promise<PlazaSite[]> {
    try {
        const { ReadTextFile } = await import('../core/wails-bindings');
        const content = await ReadTextFile(CUSTOM_SITES_PATH);
        const json = JSON.parse(content) as PlazaSite[];
        return json.filter((s) => s.id && s.name && s.url && s.mode);
    } catch {
        return [];
    }
}

let allSites: PlazaSite[] = [];

async function ensureSitesLoaded(): Promise<void> {
    if (allSites.length > 0) {
        return;
    }
    const custom = await loadCustomSites();
    const builtinIds = new Set(PLAZA_SITES.map((s) => s.id));
    allSites = [...PLAZA_SITES, ...custom.filter((s) => !builtinIds.has(s.id))];
}

function buildSearchBar(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-search-bar';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'plaza-search-input';
    input.placeholder = '搜索站点...';
    input.addEventListener('input', () => {
        renderHome(input.value);
    });
    wrap.appendChild(input);
    return wrap;
}

function buildPresetTags(site: PlazaSite): HTMLElement | null {
    if (!site.presetSearches || site.presetSearches.length === 0) {
        return null;
    }
    const wrap = document.createElement('div');
    wrap.className = 'plaza-card-presets';
    for (const p of site.presetSearches) {
        const tag = document.createElement('button');
        tag.className = 'plaza-preset-tag';
        tag.textContent = p.label;
        tag.onclick = (e) => {
            e.stopPropagation();
            const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(p.q));
            if (url) {
                const mode = effectiveMode(site);
                if (mode === 'external') {
                    openExternal({ ...site, url });
                } else if (mode === 'window') {
                    openInWindow({ ...site, url });
                } else {
                    renderEmbed({ ...site, url });
                }
            }
        };
        wrap.appendChild(tag);
    }
    return wrap;
}

let currentSiteId: string = '';

function buildSiteTabs(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-site-tabs';

    for (const site of allSites) {
        const btn = document.createElement('button');
        btn.className = 'plaza-site-tab' + (currentSiteId === site.id ? ' active' : '');
        btn.innerHTML = `<iconify-icon icon="${site.icon ?? 'lucide:globe'}"></iconify-icon><span>${site.name}</span>`;
        btn.onclick = () => {
            if (currentSiteId === site.id) return;
            currentSiteId = site.id;
            renderHome();
        };
        wrap.appendChild(btn);
    }

    return wrap;
}

function getCurrentSite(): PlazaSite | undefined {
    return allSites.find((s) => s.id === currentSiteId);
}

function openSiteByMode(site: PlazaSite, url?: string): void {
    const mode = effectiveMode(site);
    const target = url ? { ...site, url } : site;
    if (mode === 'external') {
        openExternal(target);
    } else if (mode === 'window') {
        openInWindow(target);
    } else {
        renderEmbed(target);
    }
}

function renderSiteContent(site: PlazaSite): HTMLElement {
    const container = document.createElement('div');
    container.className = 'plaza-site-content';

    if (site.presetSearches && site.presetSearches.length > 0) {
        const section = document.createElement('div');
        section.className = 'plaza-section';

        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'plaza-section-header';

        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'plaza-section-title';
        sectionTitle.innerHTML = `<iconify-icon icon="lucide:search"></iconify-icon><span>网页搜索词</span><span class="plaza-section-sub">(${site.presetSearches.length})</span>`;
        sectionHeader.appendChild(sectionTitle);

        const sectionActions = document.createElement('div');
        sectionActions.className = 'plaza-section-actions';

        const modeSwitch = buildGlobalModeSwitch();
        sectionActions.appendChild(modeSwitch);

        const openBtn = document.createElement('button');
        openBtn.className = 'plaza-btn plaza-btn-accent plaza-open-btn';
        openBtn.innerHTML = `<iconify-icon icon="lucide:external-link"></iconify-icon><span>打开网站</span>`;
        openBtn.onclick = () => openSiteByMode(site);
        sectionActions.appendChild(openBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'plaza-btn';
        closeBtn.innerHTML = `<iconify-icon icon="lucide:x"></iconify-icon><span>关闭</span>`;
        closeBtn.onclick = closePlaza;
        sectionActions.appendChild(closeBtn);

        sectionHeader.appendChild(sectionActions);
        section.appendChild(sectionHeader);

        const presetArea = document.createElement('div');
        presetArea.className = 'plaza-preset-area';

        for (const ps of site.presetSearches) {
            const btn = document.createElement('button');
            btn.className = 'plaza-preset-btn';
            btn.textContent = ps.label;
            btn.onclick = () => {
                const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(ps.q ?? ''));
                if (url) {
                    openSiteByMode(site, url);
                }
            };
            presetArea.appendChild(btn);
        }

        section.appendChild(presetArea);
        container.appendChild(section);
    }

    return container;
}

let layer: HTMLElement | null = null;
let plazaProxyActive = false;
let observer: MutationObserver | null = null;
let downloadListenerInstalled = false;
let eventListenersInstalled = false;
let shortcutsRegistered = false;
// [ADR-078] 持有当前内嵌 iframe 引用，供下载请求来源校验
let plazaIframe: HTMLIFrameElement | null = null;
// [ADR-087 P1] 遥控面板显示状态
let remoteURLDisplay: HTMLElement | null = null;
let remoteProgress: HTMLElement | null = null;

// [ADR-078] 监听 iframe 内注入脚本发来的下载请求
function installDownloadListener(): void {
    if (downloadListenerInstalled) {
        return;
    }
    downloadListenerInstalled = true;
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type !== 'plaza-download-request') {
            return;
        }
        // [ADR-078] 来源校验：仅接受当前内嵌 iframe 发来的下载请求，阻断任意页伪造
        if (!plazaIframe || e.source !== plazaIframe.contentWindow) {
            return;
        }
        const { url, filename } = e.data as { url: string; filename: string };
        if (!url) {
            return;
        }
        handlePlazaDownload(url, filename || 'download');
    });
}

// [ADR-087 P2] 注册广场窗口快捷键。只在广场层可见时生效。
function installShortcuts(): void {
    if (shortcutsRegistered) {
        return;
    }
    shortcutsRegistered = true;
    registerShortcuts([
        {
            id: 'plaza:reload',
            label: 'shortcuts.label.plaza',
            defaultKey: 'F5',
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaReload());
                }
            },
            group: 'shortcuts.group.plaza',
        },
        {
            id: 'plaza:reload-ctrl',
            label: 'shortcuts.label.plaza',
            defaultKey: 'KeyR',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaReload());
                }
            },
            group: 'shortcuts.group.plaza',
        },
        {
            id: 'plaza:goBack',
            label: 'shortcuts.label.plaza',
            defaultKey: 'ArrowLeft',
            defaultAlt: true,
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaGoBack());
                }
            },
            group: 'shortcuts.group.plaza',
        },
        {
            id: 'plaza:goForward',
            label: 'shortcuts.label.plaza',
            defaultKey: 'ArrowRight',
            defaultAlt: true,
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaGoForward());
                }
            },
            group: 'shortcuts.group.plaza',
        },
        {
            id: 'plaza:zoomIn',
            label: 'shortcuts.label.plaza',
            defaultKey: 'Equal',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaZoomIn());
                }
            },
            group: 'shortcuts.group.plaza',
        },
        {
            id: 'plaza:zoomOut',
            label: 'shortcuts.label.plaza',
            defaultKey: 'Minus',
            defaultCtrl: true,
            prevent: true,
            handler: () => {
                if (getLayer().classList.contains('visible')) {
                    swallowError(PlazaZoomOut());
                }
            },
            group: 'shortcuts.group.plaza',
        },
    ]);
}

// [ADR-087 P1] 监听 Go 端发射的 plaza 事件：urlChanged（导航完成）、
// downloadProgress（下载进度）、downloadComplete（下载完成）。
function installEventListeners(): void {
    if (eventListenersInstalled) {
        return;
    }
    eventListenersInstalled = true;
    Events.On('plaza:urlChanged', (data) => {
        const d = data as unknown as { url: string; title: string };
        if (remoteURLDisplay) {
            remoteURLDisplay.textContent = d.title || d.url || L.loading;
        }
    });
    Events.On('plaza:downloadProgress', (data) => {
        const d = data as unknown as {
            fileName: string;
            read: number;
            total: number;
            percent: number;
        };
        if (remoteProgress) {
            const percent =
                d.percent > 0 ? `${d.percent.toFixed(0)}%` : `${(d.read / 1024).toFixed(0)} KB`;
            remoteProgress.textContent = `${L.downloading} ${d.fileName}: ${percent}`;
        }
    });
    Events.On('plaza:downloadComplete', (data) => {
        const d = data as unknown as { fileName: string; size: number };
        if (remoteProgress) {
            remoteProgress.textContent = `${L.downloadComplete}: ${d.fileName} (${(d.size / 1024).toFixed(1)} KB)`;
        }
        setTimeout(() => {
            if (remoteProgress) {
                remoteProgress.textContent = '';
            }
        }, 3000);
        showErrorToast(
            t('plaza.downloaded', { name: d.fileName, size: (d.size / 1024).toFixed(1) }),
            undefined,
            [
                {
                    label: t('plaza.viewLibrary'),
                    onClick: () => {
                        refreshLibrary().catch((err) =>
                            logWarn('plaza', 'refresh after plaza download:', err)
                        );
                    },
                },
            ],
            8000
        );
    });
}

async function handlePlazaDownload(url: string, filename: string): Promise<void> {
    setStatus(t('plaza.downloading', { name: filename }), false, true);
    try {
        // 动态绑定导入：binding 可能尚未生成，失败即失败，不自动降级到浏览器。
        const { DownloadFromPlaza } = await import('../core/wails-bindings');
        if (typeof DownloadFromPlaza !== 'function') {
            throw new Error('binding not available');
        }
        const result = await DownloadFromPlaza(url, filename);
        setStatus(
            t('plaza.downloaded', { name: result.fileName, size: (result.size / 1024).toFixed(1) }),
            true
        );
    } catch (e) {
        // 动态 import 失败或 binding 未生成：仅报状态，不串到系统浏览器下载，便于单独定位内嵌下载问题。
        setStatus(
            t('plaza.downloadFail', { err: e instanceof Error ? e.message : String(e) }),
            true
        );
    }
}

function getLayer(): HTMLElement {
    if (!layer) {
        layer = document.getElementById('webviewLayer');
    }
    return layer!;
}

function openExternal(site: PlazaSite): void {
    // 平台分流（非降级）：Android 用 <a> 打开，桌面用 Wails Browser.OpenURL。
    if (!openExternalURL(site.url)) {
        Browser.OpenURL(site.url);
    }
}

function openInWindow(site: PlazaSite): void {
    setStatus(t('plaza.opening', { name: site.name }), false, true);
    NavigatePlazaWindow(site.url)
        .then(() => {
            setStatus('', false);
            // [ADR-087 P0] window 模式打开后，plaza 层切换为遥控面板：
            // 后退/前进/刷新/缩放/关闭。下载拦截由注入脚本 fetch /__plaza_dl__ 完成。
            // [ADR-087 P3-审核] 标记代理活跃，使 Escape 路径能回收 Go 端代理。
            plazaProxyActive = true;
            renderRemote(site);
        })
        .catch((e) => {
            // 不再自动降级到系统浏览器：wails 窗口失败即失败，便于单独测试该模式。
            setStatus(
                t('plaza.openFail', { err: e instanceof Error ? e.message : String(e) }),
                true
            );
        });
}

// [ADR-087 P0/P1] renderRemote 在主窗口 plaza 层渲染遥控面板，控制独立打开的
// 广场 WebView2 窗口。代理由 NavigatePlazaWindow 在 Go 端启动，这里不调
// StartProxy/StopProxy（ClosePlazaWindow 会回收代理）。
// [ADR-087 P1] 显示当前页面标题/URL（由 plaza:urlChanged 事件更新）和下载进度。
function renderRemote(site: PlazaSite): void {
    const el = getLayer();
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root plaza-remote';

    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: async () => {
                plazaProxyActive = false;
                await ClosePlazaWindow().catch((err) => logWarn('plaza', '', err));
                renderHome();
            },
            onClose: async () => {
                plazaProxyActive = false;
                await ClosePlazaWindow().catch((err) => logWarn('plaza', '', err));
                closePlaza();
            },
        })
    );

    const body = document.createElement('div');
    body.className = 'plaza-remote-body';

    const hint = document.createElement('div');
    hint.className = 'plaza-remote-hint';
    hint.textContent = L.remoteHint;
    body.appendChild(hint);

    const urlDisplay = document.createElement('div');
    urlDisplay.className = 'plaza-remote-url';
    urlDisplay.textContent = L.loading;
    remoteURLDisplay = urlDisplay;
    body.appendChild(urlDisplay);

    const progress = document.createElement('div');
    progress.className = 'plaza-remote-progress';
    remoteProgress = progress;
    body.appendChild(progress);

    const controls = document.createElement('div');
    controls.className = 'plaza-remote-controls';

    const addBtn = (label: string, fn: () => Promise<unknown>): void => {
        const b = document.createElement('button');
        b.className = 'plaza-btn plaza-remote-btn';
        b.textContent = label;
        b.onclick = () => {
            swallowError(fn());
        };
        controls.appendChild(b);
    };

    addBtn(L.goBack, () => PlazaGoBack());
    addBtn(L.goForward, () => PlazaGoForward());
    addBtn(L.refresh, () => PlazaReload());
    addBtn(L.zoomIn, () => PlazaZoomIn());
    addBtn(L.zoomOut, () => PlazaZoomOut());
    addBtn(L.zoomReset, () => PlazaZoomReset());

    body.appendChild(controls);
    root.appendChild(body);
    el.appendChild(root);
}

/** 回收 Go 反向代理（幂等，已停则无操作） */
function stopProxy(): void {
    if (!plazaProxyActive) {
        return;
    }
    plazaProxyActive = false;
    swallowError(StopProxy());
}

// 监听 #webviewLayer 的 visible 类移除：覆盖任何关闭路径（侧栏再点 / 交叉淡入 /
// ESC / 关闭按钮 / closeAllOverlays），确保代理被回收，避免 Go http server 泄漏。
function ensureObserver(): void {
    if (observer) {
        return;
    }
    const el = getLayer();
    if (!el) {
        return;
    }
    observer = new MutationObserver(() => {
        if (!el.classList.contains('visible')) {
            stopProxy();
        }
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
}

// [ADR-087 P3-优化] 全局模式分段选择器：取代卡片内 18 个按钮，工具栏一处统一切换。
// 「自动」= 不设全局偏好，各站用各自 site.mode 默认；选具体模式则覆写所有无 per-site 覆写的站点。
function buildGlobalModeSwitch(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-modeswitch plaza-global-mode';
    const opts: { key: OpenMode | 'auto'; label: string }[] = [
        { key: 'auto', label: '自动' },
        { key: 'embed', label: 'iframe' },
        { key: 'external', label: 'chrome' },
        { key: 'window', label: 'wails' },
    ];
    const current = loadGlobalMode() ?? 'auto';
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-mode-opt' + (current === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            if (o.key === 'auto') {
                try {
                    localStorage.removeItem(GLOBAL_MODE_KEY);
                } catch {
                    /* 忽略 */
                }
            } else {
                saveGlobalMode(o.key);
            }
            renderHome();
        };
        wrap.appendChild(b);
    }
    return wrap;
}

// [ADR-087 P3-优化] 右键卡片弹出单站覆写菜单（power user 精细控制，藏起来不干扰主流）
function showSiteModePopup(site: PlazaSite, x: number, y: number): void {
    const existing = document.querySelector('.plaza-mode-popup');
    if (existing) {
        existing.remove();
    }
    const popup = document.createElement('div');
    popup.className = 'plaza-mode-popup';
    const current = effectiveMode(site);
    const opts: { key: OpenMode; label: string }[] = [
        { key: 'embed', label: 'iframe' },
        { key: 'external', label: 'chrome' },
        { key: 'window', label: 'wails' },
    ];
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-mode-opt' + (current === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            saveSiteMode(site, o.key);
            popup.remove();
            renderHome();
        };
        popup.appendChild(b);
    }
    if (hasSiteOverride(site)) {
        const clear = document.createElement('button');
        clear.className = 'plaza-mode-popup-clear';
        clear.textContent = '跟随全局';
        clear.onclick = () => {
            clearSiteMode(site);
            popup.remove();
            renderHome();
        };
        popup.appendChild(clear);
    }
    // 定位：避免溢出视口右下边界
    popup.style.left = '0';
    popup.style.top = '0';
    document.body.appendChild(popup);
    const rect = popup.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - rect.width - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    popup.style.left = `${px}px`;
    popup.style.top = `${py}px`;

    let onDownDisp: Disposable | null = null;
    const onDown = (e: MouseEvent): void => {
        if (!popup.contains(e.target as Node)) {
            popup.remove();
            onDownDisp?.dispose();
            onDownDisp = null;
        }
    };
    setTimeout(() => {
        onDownDisp = addDisposableListener(document, 'mousedown', onDown);
    }, 0);
}

function buildToolbar(opts: {
    title: string;
    onBack?: () => void;
    onOpen?: () => void;
    onRefresh?: () => void;
    onClose: () => void;
    globalModeSwitch?: HTMLElement;
}): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'plaza-toolbar';

    const left = document.createElement('div');
    left.className = 'plaza-toolbar-left';
    if (opts.onBack) {
        const back = document.createElement('button');
        back.className = 'plaza-btn';
        back.textContent = '‹ ' + L.back;
        back.onclick = opts.onBack;
        left.appendChild(back);
    }
    const title = document.createElement('div');
    title.className = 'plaza-title';
    title.textContent = opts.title;
    left.appendChild(title);
    bar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'plaza-toolbar-right';
    if (opts.globalModeSwitch) {
        right.appendChild(opts.globalModeSwitch);
        const label = document.createElement('span');
        label.className = 'plaza-global-mode-label';
        label.textContent = '全局';
        right.appendChild(label);
    }
    if (opts.onOpen) {
        const open = document.createElement('button');
        open.className = 'plaza-btn plaza-btn-accent';
        open.textContent = L.openInBrowser;
        open.onclick = opts.onOpen;
        right.appendChild(open);
    }
    if (opts.onRefresh) {
        const refresh = document.createElement('button');
        refresh.className = 'plaza-btn';
        refresh.textContent = L.refresh;
        refresh.onclick = opts.onRefresh;
        right.appendChild(refresh);
    }
    const close = document.createElement('button');
    close.className = 'plaza-btn';
    close.textContent = L.close;
    close.title = L.close;
    close.onclick = opts.onClose;
    right.appendChild(close);
    bar.appendChild(right);

    return bar;
}

async function renderHome(): Promise<void> {
    stopProxy();
    await ensureSitesLoaded();
    if (!currentSiteId && allSites.length > 0) {
        currentSiteId = allSites[0].id;
    }
    const el = getLayer();
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';

    root.appendChild(buildSiteTabs());

    const site = getCurrentSite();
    if (site) {
        root.appendChild(renderSiteContent(site));
    }

    el.appendChild(root);
}

function renderEmbed(site: PlazaSite): void {
    stopProxy();
    const el = getLayer();
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';

    const body = document.createElement('div');
    body.className = 'plaza-body';

    // [ADR-087 P1] 加载指示 spinner：iframe 加载完成后隐藏
    const spinner = document.createElement('div');
    spinner.className = 'plaza-spinner';
    spinner.innerHTML = '<div class="plaza-spinner-ring"></div>';
    body.appendChild(spinner);

    const iframe = document.createElement('iframe');
    iframe.className = 'plaza-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    iframe.onload = () => {
        spinner.style.display = 'none';
    };
    // [ADR-087 P2] 拖放导入：iframe 上的 dragover 必须 preventDefault，否则主窗口
    // 的 window.drop 事件不会触发。这是 HTML5 拖放规范要求——目标元素必须显式允许
    // 拖放才能接收 drop 事件。主窗口已在 window 级别实现 handleDropFile，这里只需
    // 让事件能穿透到主窗口。
    iframe.addEventListener('dragover', (e) => e.preventDefault());
    iframe.addEventListener('drop', (e) => e.preventDefault());
    plazaIframe = iframe;
    body.appendChild(iframe);

    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: renderHome,
            onOpen: () => openExternal(site),
            onRefresh: () => {
                if (iframe.src) {
                    spinner.style.display = '';
                    const src = iframe.src;
                    iframe.src = src;
                }
            },
            onClose: closePlaza,
        })
    );

    root.appendChild(body);
    el.appendChild(root);

    plazaProxyActive = true;
    StartProxy(site.url, 'embed')
        .then((proxyUrl) => {
            iframe.src = proxyUrl;
        })
        .catch((e) => {
            plazaProxyActive = false;
            spinner.style.display = 'none';
            const err = document.createElement('div');
            err.className = 'plaza-error';
            err.textContent = L.proxyError + (e instanceof Error ? e.message : String(e));
            body.appendChild(err);
        });
}

export async function showPlaza(): Promise<void> {
    installDownloadListener();
    installEventListeners();
    installShortcuts();
    ensureObserver();
    await renderHome();
}

export function closePlaza(): void {
    plazaIframe = null;
    stopProxy();
    closeAllOverlays();
}
