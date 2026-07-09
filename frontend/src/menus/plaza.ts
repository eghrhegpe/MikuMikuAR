// plaza.ts — 模型广场：全屏浏览（反向代理）+ 外链（系统浏览器）
// 见 ADR-075。免登录展示站走全屏内嵌 iframe（Go 反向代理剥离 X-Frame / CSP
// frame-ancestors），登录站走系统浏览器保留登录态，下载由 ADR-003 方案 C
// 的 fsnotify 监听落库。两条路在「落库」处会师，不重复造轮子。

import type { SlideMenu } from './menu';
import { registerPopupMenu } from './menu-factory';
import { PopupRow, PopupLevel, cardContainer } from '../core/config';
import { StartProxy, StopProxy } from '../core/wails-bindings';
import { openExternalURL } from '../core/platform';
import { Browser } from '@wailsio/runtime';
import { PLAZA_SITES, type PlazaSite } from './plaza-sites';

/** 当前菜单实例引用（onShow 时注入），供自定义关闭按钮触发完整关闭路径 */
let plazaMenuRef: SlideMenu | null = null;

const L = {
    title: '模型广场',
    openInBrowser: '在浏览器打开',
    close: '关闭',
    proxyError: '代理启动失败：',
};

function openExternal(site: PlazaSite): void {
    if (!openExternalURL(site.url)) {
        Browser.OpenURL(site.url);
    }
}

function buildPlazaRootItems(): PopupRow[] {
    return PLAZA_SITES.map((site, i) => ({
        kind: 'folder' as const,
        label: site.name,
        icon: site.icon ?? 'lucide:globe',
        target: `site:${i}`,
    }));
}

function buildPlazaRoot(): PopupLevel {
    return { label: L.title, dir: '', items: buildPlazaRootItems() };
}

function buildEmbedLevel(site: PlazaSite): PopupLevel {
    return {
        label: site.name,
        dir: '',
        items: [],
        renderCustom: (container: HTMLElement) => {
            cardContainer(container, (c) => {
                // 全屏方框 frame：毛玻璃 + 青色描边，融合 UI 透明度风格
                const frame = document.createElement('div');
                frame.style.cssText =
                    'flex:1;display:flex;flex-direction:column;min-height:0;' +
                    'margin:14px;border-radius:16px;overflow:hidden;' +
                    'border:1px solid rgba(57,197,187,.35);' +
                    'background:rgba(10,16,20,.55);' +
                    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
                    'box-shadow:0 12px 48px rgba(0,0,0,.45);';

                // 毛玻璃顶栏
                const header = document.createElement('div');
                header.style.cssText =
                    'flex-shrink:0;display:flex;align-items:center;justify-content:space-between;' +
                    'gap:10px;padding:10px 14px;' +
                    'background:rgba(57,197,187,.10);' +
                    'border-bottom:1px solid rgba(57,197,187,.22);';
                const title = document.createElement('div');
                title.textContent = site.name;
                title.style.cssText =
                    'font-size:13px;font-weight:600;color:var(--text,#e8f6f4);' +
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

                const openBtn = document.createElement('button');
                openBtn.textContent = L.openInBrowser;
                openBtn.style.cssText =
                    'font-size:12px;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;' +
                    'background:var(--accent,#39C5BB);color:#06231f;font-weight:600;';
                openBtn.onclick = () => openExternal(site);

                const closeBtn = document.createElement('button');
                closeBtn.textContent = L.close;
                closeBtn.title = L.close;
                closeBtn.style.cssText =
                    'font-size:12px;padding:6px 12px;border:none;border-radius:6px;cursor:pointer;' +
                    'background:rgba(255,255,255,.06);color:var(--text,#e8f6f4);';
                closeBtn.onclick = () => {
                    // 走 menu-factory 完整关闭路径：StopProxy + dispose + closeAllOverlays
                    plazaMenuRef?.onClose?.();
                };

                actions.appendChild(openBtn);
                actions.appendChild(closeBtn);
                header.appendChild(title);
                header.appendChild(actions);
                frame.appendChild(header);

                // iframe 主体，撑满方框剩余空间
                const body = document.createElement('div');
                body.style.cssText = 'flex:1;min-height:0;display:flex;';
                const iframe = document.createElement('iframe');
                iframe.style.cssText =
                    'flex:1;width:100%;height:100%;border:none;background:#fff;';
                iframe.setAttribute(
                    'sandbox',
                    'allow-scripts allow-same-origin allow-forms allow-popups'
                );
                body.appendChild(iframe);
                frame.appendChild(body);
                c.appendChild(frame);

                StartProxy(site.url)
                    .then((proxyUrl) => {
                        iframe.src = proxyUrl;
                    })
                    .catch((e) => {
                        const err = document.createElement('div');
                        err.style.cssText = 'padding:12px;color:#e24b4a;font-size:12px;';
                        err.textContent =
                            L.proxyError + (e instanceof Error ? e.message : String(e));
                        frame.appendChild(err);
                    });
            });
        },
    };
}

function plazaOnFolderEnter(row: PopupRow): PopupLevel | null {
    if (!row.target || !row.target.startsWith('site:')) return null;
    const idx = parseInt(row.target.slice('site:'.length), 10);
    const site = PLAZA_SITES[idx];
    if (!site) return null;
    if (site.mode === 'external') {
        openExternal(site);
        return null;
    }
    return buildEmbedLevel(site);
}

const {
    getMenu: getPlazaMenu,
    refreshRoot: refreshPlazaRoot,
    show: showPlaza,
} = registerPopupMenu({
    wrapperKey: 'plaza-menu',
    popupType: 'plaza',
    overlayClass: 'sceneOverlay-plaza',
    buildRoot: () => buildPlazaRoot(),
    buildRootItems: () => buildPlazaRootItems(),
    onShow: (m) => {
        plazaMenuRef = m;
    },
    onClose: () => {
        StopProxy().catch(() => {});
    },
    handlers: {
        onFolderEnter: plazaOnFolderEnter,
    },
});

export { getPlazaMenu, refreshPlazaRoot, showPlaza };
