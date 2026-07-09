// plaza.ts — 模型广场：独立全屏「视图层」（非弹窗菜单）
// 见 ADR-075。免登录展示站走全屏内嵌 iframe（Go 反向代理剥离 X-Frame / CSP
// frame-ancestors），登录站走系统浏览器保留登录态，下载由 ADR-003 方案 C
// 的 fsnotify 监听落库。两条路在「落库」处会师，不重复造轮子。
//
// 呈现容器是独立的 #webviewLayer（index.html 中与 #sceneOverlay 平级的兄弟节点），
// 不再寄生在 SlideMenu 弹窗里——浏览器是单一全屏表面，没有层级/返回栈，
// SlideMenu 的导航机件对它纯属死重。

import { StartProxy, StopProxy } from '../core/wails-bindings';
import { openExternalURL } from '../core/platform';
import { Browser } from '@wailsio/runtime';
import { closeAllOverlays } from '../core/utils';
import { PLAZA_SITES, type PlazaSite } from './plaza-sites';
import { showErrorToast } from '../core/toast';
import { setStatus } from '../core/status-bar';

const L = {
    title: '模型广场',
    openInBrowser: '在浏览器打开',
    close: '关闭',
    back: '返回',
    refresh: '刷新',
    proxyError: '代理启动失败：',
};

// 全局打开方式开关：auto=尊重每站自带 mode；embed=强制内嵌；external=强制系统浏览器。
// 持久化到 localStorage，重启保留。见 ADR-075。
type OpenMode = 'auto' | 'embed' | 'external';
const OPEN_MODE_KEY = 'miku.plaza.openMode';
let openMode: OpenMode = loadOpenMode();

function loadOpenMode(): OpenMode {
    try {
        const v = localStorage.getItem(OPEN_MODE_KEY);
        if (v === 'auto' || v === 'embed' || v === 'external') return v;
    } catch {
        /* localStorage 不可用时忽略，回退 auto */
    }
    return 'auto';
}
function saveOpenMode(): void {
    try {
        localStorage.setItem(OPEN_MODE_KEY, openMode);
    } catch {
        /* 忽略 */
    }
}
/** 某站点在当前全局开关下的实际打开方式 */
function effectiveMode(site: PlazaSite): 'embed' | 'external' {
    return openMode === 'auto' ? site.mode : openMode;
}

let layer: HTMLElement | null = null;
let plazaProxyActive = false;
let observer: MutationObserver | null = null;
let downloadListenerInstalled = false;

// [ADR-078] 监听 iframe 内注入脚本发来的下载请求
function installDownloadListener(): void {
    if (downloadListenerInstalled) return;
    downloadListenerInstalled = true;
    window.addEventListener('message', (e: MessageEvent) => {
        if (e.data?.type !== 'plaza-download-request') return;
        const { url, filename } = e.data as { url: string; filename: string };
        if (!url) return;
        handlePlazaDownload(url, filename || 'download');
    });
}

async function handlePlazaDownload(url: string, filename: string): Promise<void> {
    setStatus(`下载中: ${filename}`, false, true);
    try {
        // 动态导入 DownloadFromPlaza（binding 可能尚未生成，降级到系统浏览器）
        const { DownloadFromPlaza } = await import('../core/wails-bindings');
        if (typeof DownloadFromPlaza !== 'function') {
            throw new Error('binding not available');
        }
        const result = await DownloadFromPlaza(url, filename);
        setStatus(`✓ 已下载: ${result.fileName} (${(result.size / 1024).toFixed(1)} KB)`, true);
    } catch {
        // 降级：用系统浏览器下载
        setStatus('下载中（浏览器）...', false, true);
        if (!openExternalURL(url)) {
            Browser.OpenURL(url);
        }
        setStatus('已在浏览器中下载', true);
    }
}

function getLayer(): HTMLElement {
    if (!layer) layer = document.getElementById('webviewLayer');
    return layer!;
}

function openExternal(site: PlazaSite): void {
    if (!openExternalURL(site.url)) {
        Browser.OpenURL(site.url);
    }
}

/** 回收 Go 反向代理（幂等，已停则无操作） */
function stopProxy(): void {
    if (!plazaProxyActive) return;
    plazaProxyActive = false;
    StopProxy().catch(() => {});
}

// 监听 #webviewLayer 的 visible 类移除：覆盖任何关闭路径（侧栏再点 / 交叉淡入 /
// ESC / 关闭按钮 / closeAllOverlays），确保代理被回收，避免 Go http server 泄漏。
function ensureObserver(): void {
    if (observer) return;
    const el = getLayer();
    if (!el) return;
    observer = new MutationObserver(() => {
        if (!el.classList.contains('visible')) stopProxy();
    });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
}

function buildModeSwitch(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-modeswitch';
    const opts: { key: OpenMode; label: string }[] = [
        { key: 'auto', label: '自动' },
        { key: 'embed', label: '内嵌' },
        { key: 'external', label: '浏览器' },
    ];
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-mode-opt' + (openMode === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            openMode = o.key;
            saveOpenMode();
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
    if (opts.modeSwitch) left.appendChild(opts.modeSwitch);
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
            `<div class="plaza-card-mode">${eff === 'external' ? '系统浏览器' : '内嵌浏览'}</div>`;
        card.onclick = () => {
            if (eff === 'external') {
                openExternal(site);
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

    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: renderHome,
            onOpen: () => openExternal(site),
            onRefresh: () => {
                const f = root.querySelector('iframe');
                if (f) f.src = f.src;
            },
            onClose: closePlaza,
        })
    );

    const body = document.createElement('div');
    body.className = 'plaza-body';
    const iframe = document.createElement('iframe');
    iframe.className = 'plaza-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    body.appendChild(iframe);
    root.appendChild(body);
    el.appendChild(root);

    plazaProxyActive = true;
    StartProxy(site.url)
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
    stopProxy();
    closeAllOverlays();
}
