// plaza.ts — 模型广场：独立全屏「视图层」（非弹窗菜单）
// 见 ADR-075。免登录展示站走全屏内嵌 iframe（Go 反向代理剥离 X-Frame / CSP
// frame-ancestors），登录站走系统浏览器保留登录态，下载由 ADR-003 方案 C
// 的 fsnotify 监听落库。两条路在「落库」处会师，不重复造轮子。
//
// 呈现容器是独立的 #webviewLayer（index.html 中与 #sceneOverlay 平级的兄弟节点），
// 不再寄生在 SlideMenu 弹窗里——浏览器是单一全屏表面，没有层级/返回栈，
// SlideMenu 的导航机件对它纯属死重。

import { Browser, EventsOn } from '@wailsio/runtime';
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
import { closeAllOverlays } from '../core/utils';
import { PLAZA_SITES, type PlazaSite } from './plaza-sites';
import { setStatus } from '../core/status-bar';
import { t } from '../core/i18n/t';

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
};

// 打开方式：embed=内嵌 iframe；window=Wails 新窗口；external=系统浏览器。
// [ADR-087 P1] 从全局模式改为 Per-site 模式记忆：每个站点独立保存偏好，
// 回退到站点默认推荐模式（site.mode）。持久化到 localStorage，重启保留。
type OpenMode = 'embed' | 'external' | 'window';

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

let layer: HTMLElement | null = null;
let plazaProxyActive = false;
let observer: MutationObserver | null = null;
let downloadListenerInstalled = false;
let eventListenersInstalled = false;
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

// [ADR-087 P1] 监听 Go 端发射的 plaza 事件：urlChanged（导航完成）、
// downloadProgress（下载进度）、downloadComplete（下载完成）。
function installEventListeners(): void {
    if (eventListenersInstalled) {
        return;
    }
    eventListenersInstalled = true;
    EventsOn('plaza:urlChanged', (data) => {
        const d = data as { url: string; title: string };
        if (remoteURLDisplay) {
            remoteURLDisplay.textContent = d.title || d.url || L.loading;
        }
    });
    EventsOn('plaza:downloadProgress', (data) => {
        const d = data as { fileName: string; read: number; total: number; percent: number };
        if (remoteProgress) {
            const percent = d.percent > 0 ? `${d.percent.toFixed(0)}%` : `${(d.read / 1024).toFixed(0)} KB`;
            remoteProgress.textContent = `${L.downloading} ${d.fileName}: ${percent}`;
        }
    });
    EventsOn('plaza:downloadComplete', (data) => {
        const d = data as { fileName: string; size: number };
        if (remoteProgress) {
            remoteProgress.textContent = `${L.downloadComplete}: ${d.fileName} (${(d.size / 1024).toFixed(1)} KB)`;
        }
        setTimeout(() => {
            if (remoteProgress) {
                remoteProgress.textContent = '';
            }
        }, 3000);
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

// [ADR-087 P0] renderRemote 在主窗口 plaza 层渲染遥控面板，控制独立打开的
// 广场 WebView2 窗口。代理由 NavigatePlazaWindow 在 Go 端启动，这里不调
// StartProxy/StopProxy（ClosePlazaWindow 会回收代理）。
function renderRemote(site: PlazaSite): void {
    const el = getLayer();
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root plaza-remote';

    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: async () => {
                await ClosePlazaWindow().catch(() => {});
                renderHome();
            },
            onClose: async () => {
                await ClosePlazaWindow().catch(() => {});
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

    const controls = document.createElement('div');
    controls.className = 'plaza-remote-controls';

    const addBtn = (label: string, fn: () => Promise<unknown>): void => {
        const b = document.createElement('button');
        b.className = 'plaza-btn plaza-remote-btn';
        b.textContent = label;
        b.onclick = () => {
            fn().catch(() => {});
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
    StopProxy().catch(() => {});
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

function buildModeSwitch(site: PlazaSite): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-modeswitch';
    const opts: { key: OpenMode; label: string }[] = [
        { key: 'embed', label: 'iframe' },
        { key: 'window', label: 'wails' },
        { key: 'external', label: 'chrome' },
    ];
    const current = effectiveMode(site);
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-mode-opt' + (current === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            saveSiteMode(site, o.key);
            renderHome();
        };
        wrap.appendChild(b);
    }
    return wrap;
}

function buildToolbar(opts: {
    title: string;
    onBack?: () => void;
    onOpen?: () => void;
    onRefresh?: () => void;
    onClose: () => void;
    modeSwitch?: HTMLElement;
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
    if (opts.modeSwitch) {
        left.appendChild(opts.modeSwitch);
    }
    bar.appendChild(left);

    const right = document.createElement('div');
    right.className = 'plaza-toolbar-right';
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

function renderHome(): void {
    stopProxy();
    const el = getLayer();
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';

    root.appendChild(
        buildToolbar({
            title: L.title,
            modeSwitch: buildModeSwitch(),
            onClose: closePlaza,
        })
    );

    const grid = document.createElement('div');
    grid.className = 'plaza-grid';
    for (const site of PLAZA_SITES) {
        const eff = effectiveMode(site);
        const card = document.createElement('button');
        card.className = 'plaza-card';
        card.innerHTML =
            `<iconify-icon icon="${site.icon ?? 'lucide:globe'}"></iconify-icon>` +
            `<div class="plaza-card-name">${site.name}</div>` +
            `<div class="plaza-card-mode">${
                eff === 'external' ? 'chrome' : eff === 'window' ? 'wails' : 'iframe'
            }</div>` +
            `<div class="plaza-card-modeswitch">${buildModeSwitch(site).innerHTML}</div>`;
        card.onclick = () => {
            if (eff === 'external') {
                openExternal(site);
            } else if (eff === 'window') {
                openInWindow(site);
            } else {
                renderEmbed(site);
            }
        };
        grid.appendChild(card);
    }
    root.appendChild(grid);
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
    const iframe = document.createElement('iframe');
    iframe.className = 'plaza-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    plazaIframe = iframe;
    body.appendChild(iframe);

    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: renderHome,
            onOpen: () => openExternal(site),
            onRefresh: () => {
                if (iframe.src) {
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
            const err = document.createElement('div');
            err.className = 'plaza-error';
            err.textContent = L.proxyError + (e instanceof Error ? e.message : String(e));
            body.appendChild(err);
        });
}

export function showPlaza(): void {
    installDownloadListener();
    ensureObserver();
    renderHome();
}

export function closePlaza(): void {
    plazaIframe = null;
    stopProxy();
    closeAllOverlays();
}
