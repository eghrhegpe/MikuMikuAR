// plaza-browser.ts — 模型广场：站点管理 + 浏览/搜索/渲染
// 从 plaza.ts 拆分

import type { PlazaSite } from './plaza-sites';
import type { PlazaCreator } from './plaza-creators';
import {
    allSites, allCreators, currentSiteId, setCurrentSiteId,
    setAllSites, setAllCreators, CUSTOM_SITES_PATH, GLOBAL_MODE_KEY,
    SITE_GROUPS, getCurrentSite, layer, setLayer, getLayer,
    plazaProxyActive, setPlazaProxyActive,
    plazaIframe, setPlazaIframe,
    remoteURLDisplay, setRemoteURLDisplay,
    remoteProgress, setRemoteProgress,
    loadGlobalMode, saveGlobalMode, effectiveMode,
    type OpenMode,
} from './plaza-state';
import { FetchPlazaConfig, GetCachedPlazaConfig, ReadTextFile,
    StartProxy, ClosePlazaWindow, PlazaGoBack, PlazaGoForward,
    PlazaReload, PlazaZoomIn, PlazaZoomOut, PlazaZoomReset,
} from '../core/wails-bindings';
import { NavigatePlazaWindow } from '@bindings/mikumikuar/internal/app/app';
import { isAndroidPlatform, openExternalURL } from '../core/platform';
import { closeAllOverlays, swallowError } from '../core/utils';
import { safeCallAsync } from '../core/safe-call';
import { setStatus } from '../core/status-bar';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { showErrorToast } from '../core/toast';
import { registerShortcuts } from '../core/shortcut-registry';
import { addDisposableListener, type Disposable } from '../core/dom';
import { safeDispose } from '../core/dispose-helpers';
import { PLAZA_SITES } from './plaza-sites';
import { PLAZA_CREATORS } from './plaza-creators';

// ======== 本地化文本 ========

const L: Record<string, string> = {
    title: '模型广场',
    back: '‹ 后退',
    openInBrowser: '浏览器',
    refresh: '刷新',
    close: '关闭',
    goBack: '‹ 后退',
    goForward: '前进 ›',
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '重置',
    closeWindow: '关闭窗口',
    remoteHint: '广场窗口已打开，点击下载链接会自动入库',
    loading: '加载中...',
    downloading: '下载中',
    downloadComplete: '下载完成',
};

// ======== 公共 DOM 辅助函数 ========

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function _plazaBtn(html: string, onClick: () => void, className = 'plaza-btn', title?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.innerHTML = html;
    btn.onclick = onClick;
    if (title) btn.title = title;
    return btn;
}

export function _plazaSectionHeader(titleHtml: string, ...actions: HTMLElement[]): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'plaza-section-header';
    const title = document.createElement('div');
    title.className = 'plaza-section-title';
    title.innerHTML = titleHtml;
    header.appendChild(title);
    if (actions.length > 0) {
        const actionBar = document.createElement('div');
        actionBar.className = 'plaza-section-actions';
        for (const a of actions) actionBar.appendChild(a);
        header.appendChild(actionBar);
    }
    return header;
}

// ======== 站点数据管理 ========

export function normalizeSite(raw: any): PlazaSite | null {
    if (!raw || !raw.id) return null;
    const name = raw.name || raw.label || raw.id;
    const url = raw.url || '';
    if (!name || !url) return null;
    const mode: 'embed' | 'external' = raw.mode === 'embed' ? 'embed' : 'external';
    let icon = raw.icon;
    if (icon && /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(icon)) {
        icon = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><text y=%2220%22 font-size=%2220%22>${icon}</text></svg>`;
    }
    return { id: raw.id, name, url, mode, icon: icon || 'lucide:globe', desc: raw.desc || '', group: raw.group || 'search', searchUrl: raw.searchUrl, presetSearches: raw.presetSearches || [] };
}

export function normalizeCreator(raw: any): PlazaCreator | null {
    if (!raw || !raw.name) return null;
    const site = raw.site || raw.type || '';
    if (!site) return null;
    let tag = raw.tag || raw.role || 'creator';
    if (tag === 'repo') tag = 'creator';
    if (!['official', 'creator', 'vup', 'oc'].includes(tag)) tag = 'creator';
    const primarySite = (site as string).split(';')[0];
    return { name: raw.name, desc: raw.desc || '', tag: tag as PlazaCreator['tag'], tier: raw.tier || undefined, site: primarySite };
}

export async function loadCustomSites(): Promise<PlazaSite[]> {
    try {
        const raw = await ReadTextFile(CUSTOM_SITES_PATH);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as any[];
        return parsed.map(normalizeSite).filter(Boolean) as PlazaSite[];
    } catch { return []; }
}

export function mergeSites(base: PlazaSite[], extras: PlazaSite[]): PlazaSite[] {
    const map = new Map(base.map((s) => [s.id, s]));
    for (const s of extras) {
        if (s) map.set(s.id, s);
    }
    // 按原始顺序排列
    const seen = new Set<string>();
    const result: PlazaSite[] = [];
    for (const s of [...base, ...extras]) {
        if (s && !seen.has(s.id)) {
            seen.add(s.id);
            const merged = map.get(s.id)!;
            result.push(merged);
        }
    }
    return result;
}

export async function loadCachedConfig(): Promise<void> {
    try {
        const cached = await GetCachedPlazaConfig();
        if (cached && cached[0]) {
            const parsed = JSON.parse(cached[0]) as { sites?: any[]; creators?: any[] };
            if (parsed.sites?.length) setAllSites(parsed.sites.map(normalizeSite).filter(Boolean) as PlazaSite[]);
            if (parsed.creators?.length) setAllCreators(parsed.creators.map(normalizeCreator).filter(Boolean) as PlazaCreator[]);
        }
    } catch { /* ignore */ }
}

export async function ensureSitesLoaded(): Promise<void> {
    if (allSites.length > 0) return;
    await loadCachedConfig();
    if (allSites.length > 0) return;
    const custom = await loadCustomSites();
    setAllSites(mergeSites(PLAZA_SITES, custom));
    setAllCreators([...PLAZA_CREATORS]);
}

// ======== 站点浏览 ========

export function openSiteByMode(site: PlazaSite, url?: string): void {
    const mode = effectiveMode(site);
    switch (mode) {
        case 'embed':
            renderEmbed(site);
            break;
        case 'external':
            openExternal(site, url);
            break;
        case 'window':
            openInWindow(site, url);
            break;
    }
}

export function openExternal(site: PlazaSite, url?: string): void {
    openExternalURL(url ?? site.url);
}

export function openInWindow(site: PlazaSite, url?: string): void {
    setPlazaProxyActive(true);
    renderRemote(site);
    safeCallAsync('plaza', '', () => NavigatePlazaWindow(url ?? site.url)).catch(() => {
        setPlazaProxyActive(false);
    });
}

export function getCustomPresets(siteId: string): { label: string; q: string }[] {
    try {
        return JSON.parse(localStorage.getItem(`miku.plaza.presets.${siteId}`) || '[]');
    } catch { return []; }
}

export function saveCustomPresets(siteId: string, presets: { label: string; q: string }[]): void {
    try { localStorage.setItem(`miku.plaza.presets.${siteId}`, JSON.stringify(presets)); } catch { /* ignore */ }
}

export function buildSiteTabs(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-site-tabs';
    for (const grp of SITE_GROUPS) {
        const grpSites = allSites.filter((s) => grp.ids.includes(s.id));
        if (grpSites.length === 0) continue;
        const grpWrap = document.createElement('div');
        grpWrap.className = 'plaza-tab-group';
        const grpLabel = document.createElement('span');
        grpLabel.className = 'plaza-tab-group-label';
        grpLabel.innerHTML = `<iconify-icon icon="${grp.icon}" width="11" height="11"></iconify-icon><span>${grp.label}</span>`;
        grpWrap.appendChild(grpLabel);
        const tabsRow = document.createElement('div');
        tabsRow.className = 'plaza-tab-group-tabs';
        for (const site of grpSites) {
            const btn = document.createElement('button');
            btn.className = 'plaza-site-tab' + (currentSiteId === site.id ? ' active' : '');
            btn.innerHTML = `<iconify-icon icon="${site.icon ?? 'lucide:globe'}"></iconify-icon><span>${site.name}</span>`;
            btn.onclick = () => {
                if (currentSiteId === site.id) return;
                setCurrentSiteId(site.id);
                renderHome();
            };
            tabsRow.appendChild(btn);
        }
        grpWrap.appendChild(tabsRow);
        wrap.appendChild(grpWrap);
    }
    const grouped = new Set(SITE_GROUPS.flatMap((g) => g.ids));
    const others = allSites.filter((s) => !grouped.has(s.id));
    if (others.length > 0) {
        const tabsRow = document.createElement('div');
        tabsRow.className = 'plaza-tab-group-tabs';
        for (const site of others) {
            const btn = document.createElement('button');
            btn.className = 'plaza-site-tab' + (currentSiteId === site.id ? ' active' : '');
            btn.innerHTML = `<iconify-icon icon="${site.icon ?? 'lucide:globe'}"></iconify-icon><span>${site.name}</span>`;
            btn.onclick = () => {
                if (currentSiteId === site.id) return;
                setCurrentSiteId(site.id);
                renderHome();
            };
            tabsRow.appendChild(btn);
        }
        wrap.appendChild(tabsRow);
    }
    return wrap;
}

export function renderSiteContent(site: PlazaSite): HTMLElement {
    const container = document.createElement('div');
    container.className = 'plaza-site-content';
    const presets = site.presetSearches || [];
    const searchSection = document.createElement('div');
    searchSection.className = 'plaza-section';
    const searchHeader = document.createElement('div');
    searchHeader.className = 'plaza-section-header';
    const searchTitle = document.createElement('div');
    searchTitle.className = 'plaza-section-title';
    function updateSearchCount(): void {
        const custom = getCustomPresets(site.id);
        const total = custom.length + presets.length;
        searchTitle.innerHTML = `<iconify-icon icon="lucide:search"></iconify-icon><span>网页搜索词</span><span class="plaza-section-sub">(${total})</span>`;
    }
    updateSearchCount();
    searchHeader.appendChild(searchTitle);
    const searchActions = document.createElement('div');
    searchActions.className = 'plaza-section-actions';
    const addBtn = _plazaBtn('<iconify-icon icon="lucide:plus"></iconify-icon>', () => {}, 'plaza-btn', '添加搜索词');
    addBtn.onclick = (e) => {
        e.stopPropagation();
        addBtn.style.display = 'none';
        const inputRow = document.createElement('div');
        inputRow.className = 'plaza-preset-add-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plaza-preset-input';
        input.placeholder = '输入搜索词…';
        const confirmBtn = _plazaBtn('<iconify-icon icon="lucide:check"></iconify-icon>', () => {}, 'plaza-btn plaza-btn-primary');
        const cancelBtn = _plazaBtn('<iconify-icon icon="lucide:x"></iconify-icon>', () => {}, 'plaza-btn');
        inputRow.append(input, confirmBtn, cancelBtn);
        searchSection.insertBefore(inputRow, presetArea);
        function commit(): void {
            const val = input.value.trim();
            if (val) {
                const custom = getCustomPresets(site.id);
                if (!custom.some((p) => p.label === val)) {
                    custom.unshift({ label: val, q: val });
                    saveCustomPresets(site.id, custom);
                    rebuildPresetArea();
                }
            }
            inputRow.remove();
            addBtn.style.display = '';
        }
        confirmBtn.onclick = commit;
        cancelBtn.onclick = () => { inputRow.remove(); addBtn.style.display = ''; };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') { inputRow.remove(); addBtn.style.display = ''; }
        });
        input.focus();
    };
    searchActions.appendChild(addBtn);
    const moreBtn = _plazaBtn('<iconify-icon icon="lucide:more-horizontal"></iconify-icon>', () => {}, 'plaza-btn');
    moreBtn.onclick = (e) => { e.stopPropagation(); showActionsMenu(site, moreBtn); };
    searchActions.appendChild(moreBtn);
    searchHeader.appendChild(searchActions);
    searchSection.appendChild(searchHeader);
    const presetArea = document.createElement('div');
    presetArea.className = 'plaza-preset-area';
    function rebuildPresetArea(): void {
        presetArea.innerHTML = '';
        const custom = getCustomPresets(site.id);
        const hasContent = custom.length > 0 || presets.length > 0;
        if (!hasContent) {
            const empty = document.createElement('div');
            empty.className = 'plaza-empty';
            empty.innerHTML = '<iconify-icon icon="lucide:search-x"></iconify-icon><span>暂无搜索词，点 ➕ 添加</span>';
            presetArea.appendChild(empty);
            updateSearchCount();
            return;
        }
        for (const cp of custom) {
            const btn = document.createElement('button');
            btn.className = 'plaza-preset-btn plaza-preset-custom';
            btn.innerHTML = `<span>${cp.label}</span><iconify-icon icon="lucide:x" class="plaza-preset-del"></iconify-icon>`;
            btn.onclick = (ev) => {
                if ((ev.target as HTMLElement).closest('.plaza-preset-del')) {
                    const updated = custom.filter((p) => p.label !== cp.label);
                    saveCustomPresets(site.id, updated);
                    rebuildPresetArea();
                    return;
                }
                const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(cp.q || cp.label));
                if (url) openSiteByMode(site, url);
            };
            presetArea.appendChild(btn);
        }
        for (const ps of presets) {
            const btn = document.createElement('button');
            btn.className = 'plaza-preset-btn';
            btn.textContent = ps.label;
            btn.onclick = () => {
                const keyword = ps.q || ps.label;
                const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(keyword));
                if (url) openSiteByMode(site, url);
            };
            presetArea.appendChild(btn);
        }
        updateSearchCount();
    }
    rebuildPresetArea();
    searchSection.appendChild(presetArea);
    container.appendChild(searchSection);
    // ── 创作者频道 ──
    const siteCreators = allCreators.filter((c) => c.site === site.id);
    const creatorSection = document.createElement('div');
    creatorSection.className = 'plaza-section';
    const creatorHeader = document.createElement('div');
    creatorHeader.className = 'plaza-section-header';
    const creatorTitle = document.createElement('div');
    creatorTitle.className = 'plaza-section-title';
    creatorTitle.innerHTML = `<iconify-icon icon="lucide:users"></iconify-icon><span>活跃创作者</span><span class="plaza-section-sub">(${siteCreators.length})</span>`;
    creatorHeader.appendChild(creatorTitle);
    const creatorActions = document.createElement('div');
    creatorActions.className = 'plaza-section-actions';
    const updateBtn = document.createElement('button');
    updateBtn.className = 'plaza-btn plaza-update-btn';
    updateBtn.innerHTML = '<iconify-icon icon="lucide:refresh-cw"></iconify-icon><span>更新配置</span>';
    updateBtn.onclick = async () => {
        updateBtn.disabled = true;
        updateBtn.innerHTML = '<iconify-icon icon="lucide:loader-2" class="plaza-spin"></iconify-icon><span>更新中...</span>';
        try {
            const [crJson, stJson] = await FetchPlazaConfig();
            if (stJson) {
                const raw = JSON.parse(stJson) as any[];
                const remote = raw.map(normalizeSite).filter(Boolean) as PlazaSite[];
                setAllSites(mergeSites(PLAZA_SITES, remote));
            }
            if (crJson) {
                const raw = JSON.parse(crJson) as any[];
                setAllCreators(raw.map(normalizeCreator).filter(Boolean) as PlazaCreator[]);
            }
            if (!allSites.some((s) => s.id === currentSiteId)) {
                setCurrentSiteId(allSites[0]?.id || '');
            }
            renderHome();
        } catch (e) {
            showErrorToast(`更新失败: ${translateGoError(e)}`);
        } finally {
            updateBtn.disabled = false;
            updateBtn.innerHTML = '<iconify-icon icon="lucide:refresh-cw"></iconify-icon><span>更新配置</span>';
        }
    };
    creatorActions.appendChild(updateBtn);
    creatorHeader.appendChild(creatorActions);
    creatorSection.appendChild(creatorHeader);
    if (siteCreators.length > 0) {
        const searchRow = document.createElement('div');
        searchRow.className = 'plaza-creator-search-row';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'plaza-creator-search';
        searchInput.placeholder = '搜创作者名...';
        searchRow.appendChild(searchInput);
        creatorSection.appendChild(searchRow);
        const tags = [
            { key: '', label: '全部', icon: 'lucide:target' },
            { key: 'official', label: '官方IP', icon: 'lucide:building-2' },
            { key: 'creator', label: '创作者', icon: 'lucide:paintbrush' },
            { key: 'vup', label: 'VUP', icon: 'lucide:mic' },
            { key: 'oc', label: 'OC', icon: 'lucide:sparkles' },
        ];
        const tagRow = document.createElement('div');
        tagRow.className = 'plaza-tag-filter-row';
        let activeTag = '';
        let searchKw = '';
        const creatorGrid = document.createElement('div');
        creatorGrid.className = 'plaza-creator-grid';
        function isFaved(name: string): boolean {
            try { return JSON.parse(localStorage.getItem('miku.plaza.favCreators') || '[]').includes(name); } catch { return false; }
        }
        function toggleFav(name: string): boolean {
            try {
                const favs = JSON.parse(localStorage.getItem('miku.plaza.favCreators') || '[]');
                const idx = favs.indexOf(name);
                if (idx >= 0) favs.splice(idx, 1); else favs.unshift(name);
                localStorage.setItem('miku.plaza.favCreators', JSON.stringify(favs));
                return idx < 0;
            } catch { return false; }
        }
        function getFilteredCreators(): PlazaCreator[] {
            const kw = searchKw.trim().toLowerCase();
            let list = activeTag ? siteCreators.filter((c) => c.tag === activeTag) : [...siteCreators];
            const favMap = new Map(list.map((c) => [c.name, isFaved(c.name) ? 1 : 0]));
            list.sort((a, b) => {
                const af = favMap.get(a.name) ?? 0, bf = favMap.get(b.name) ?? 0;
                if (af !== bf) return bf - af;
                const at = a.tier === 'gold' ? 0 : a.tier === 'silver' ? 1 : 2;
                const bt = b.tier === 'gold' ? 0 : b.tier === 'silver' ? 1 : 2;
                return at - bt;
            });
            if (kw) list = list.filter((c) => c.name.toLowerCase().includes(kw) || c.desc.toLowerCase().includes(kw));
            return list;
        }
        function renderCreators(): void {
            creatorGrid.innerHTML = '';
            const filtered = getFilteredCreators();
            for (const cr of filtered) {
                const card = document.createElement('div');
                card.className = 'plaza-cr-card';
                if (cr.tier) card.dataset.tier = cr.tier;
                card.dataset.tag = cr.tag;
                card.dataset.name = cr.name;
                const tierBar = cr.tier ? '<div class="plaza-cr-tier-bar"></div>' : '';
                const fav = isFaved(cr.name) ? '★' : '☆';
                const tagIcon = tags.find((t) => t.key === cr.tag)?.icon ?? 'lucide:user';
                card.innerHTML = tierBar + `<div class="plaza-cr-header"><div class="plaza-cr-avatar-container"><div class="plaza-cr-avatar-ring${cr.tier ? ` plaza-cr-ring-${cr.tier}` : ''}"></div><div class="plaza-cr-avatar plaza-cr-avatar-fb">${cr.name.charAt(0).toUpperCase()}</div></div><div class="plaza-cr-name-row"><span class="plaza-cr-name">${escapeHtml(cr.name)}</span><span class="plaza-cr-star" data-star="${escapeHtml(cr.name)}">${fav}</span></div></div><div class="plaza-cr-desc">${escapeHtml(cr.desc)}</div><div class="plaza-cr-footer"><span class="plaza-cr-tag plaza-cr-tag-${cr.tag}"><iconify-icon icon="${tagIcon}" width="10" height="10"></iconify-icon><span>${cr.tag}</span></span></div>`;
                card.addEventListener('click', (e) => {
                    if ((e.target as HTMLElement).closest('.plaza-cr-star')) return;
                    const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(cr.name));
                    if (url) openSiteByMode(site, url);
                });
                const starBtn = card.querySelector('.plaza-cr-star');
                starBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const now = toggleFav(cr.name);
                    (starBtn as HTMLElement).textContent = now ? '★' : '☆';
                    card.classList.add('plaza-cr-fav-flash');
                    setTimeout(() => card.classList.remove('plaza-cr-fav-flash'), 300);
                });
                creatorGrid.appendChild(card);
            }
            const countEl = creatorSection.querySelector('.plaza-section-sub');
            if (countEl) countEl.textContent = `(${filtered.length}/${siteCreators.length})`;
        }
        searchInput.addEventListener('input', () => { searchKw = searchInput.value; renderCreators(); });
        for (const t of tags) {
            const btn = document.createElement('button');
            btn.className = 'plaza-tag-btn' + (t.key === '' ? ' active' : '');
            btn.innerHTML = `<iconify-icon icon="${t.icon}" width="12" height="12"></iconify-icon><span>${t.label}</span>`;
            btn.onclick = () => {
                activeTag = t.key;
                tagRow.querySelectorAll('.plaza-tag-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                renderCreators();
            };
            tagRow.appendChild(btn);
        }
        creatorSection.appendChild(tagRow);
        renderCreators();
        creatorSection.appendChild(creatorGrid);
    } else {
        const empty = document.createElement('div');
        empty.className = 'plaza-empty';
        empty.innerHTML = '<iconify-icon icon="lucide:user-x"></iconify-icon><span>暂无收录创作者，点击「更新配置」拉取</span>';
        creatorSection.appendChild(empty);
    }
    container.appendChild(creatorSection);
    return container;
}

export function buildToolbar(opts: { title: string; onBack?: () => void; onOpen?: () => void; onRefresh?: () => void; onClose: () => void; globalModeSwitch?: HTMLElement }): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'plaza-toolbar';
    const left = document.createElement('div');
    left.className = 'plaza-toolbar-left';
    if (opts.onBack) left.appendChild(_plazaBtn('‹ ' + L.back, opts.onBack));
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
    if (opts.onOpen) right.appendChild(_plazaBtn(L.openInBrowser, opts.onOpen, 'plaza-btn plaza-btn-accent'));
    if (opts.onRefresh) right.appendChild(_plazaBtn(L.refresh, opts.onRefresh));
    const close = _plazaBtn(L.close, opts.onClose);
    close.title = L.close;
    right.appendChild(close);
    bar.appendChild(right);
    return bar;
}

export function showActionsMenu(site: PlazaSite, anchor: HTMLElement): void {
    const existing = document.querySelector('.plaza-actions-menu');
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.className = 'plaza-actions-menu';
    const modeTitle = document.createElement('div');
    modeTitle.className = 'plaza-actions-menu-title';
    modeTitle.textContent = '打开方式';
    menu.appendChild(modeTitle);
    const modes = document.createElement('div');
    modes.className = 'plaza-actions-menu-modes';
    const opts: { key: OpenMode | 'auto'; label: string }[] = [
        { key: 'auto', label: '自动' },
        ...(isAndroidPlatform()
            ? [{ key: 'external' as const, label: 'chrome' }]
            : [{ key: 'embed' as const, label: 'iframe' }, { key: 'external' as const, label: 'chrome' }, { key: 'window' as const, label: 'wails' }]),
    ];
    const current = loadGlobalMode() ?? 'auto';
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-actions-menu-item' + (current === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            if (o.key === 'auto') { try { localStorage.removeItem(GLOBAL_MODE_KEY); } catch { /* ignore */ } }
            else { saveGlobalMode(o.key); }
            menu.remove();
        };
        modes.appendChild(b);
    }
    menu.appendChild(modes);
    const divider = document.createElement('div');
    divider.className = 'plaza-actions-menu-divider';
    menu.appendChild(divider);
    const openBtn = _plazaBtn('<iconify-icon icon="lucide:external-link"></iconify-icon><span>打开网站</span>', () => { openSiteByMode(site); menu.remove(); }, 'plaza-actions-menu-item plaza-actions-menu-item-accent');
    menu.appendChild(openBtn);
    const closeBtn = _plazaBtn('<iconify-icon icon="lucide:x"></iconify-icon><span>关闭</span>', () => { closePlaza(); menu.remove(); }, 'plaza-actions-menu-item');
    menu.appendChild(closeBtn);
    document.body.appendChild(menu);
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 8)}px`;
    menu.style.top = `${Math.min(anchorRect.bottom + 4, window.innerHeight - menuRect.height - 8)}px`;
    let onDownDisp: Disposable | null = null;
    const onDown = (e: MouseEvent): void => {
        if (!menu.contains(e.target as Node)) { menu.remove(); onDownDisp = safeDispose(onDownDisp); }
    };
    setTimeout(() => { onDownDisp = addDisposableListener(document, 'mousedown', onDown); }, 0);
}

export async function renderHome(): Promise<void> {
    stopProxy();
    await ensureSitesLoaded();
    if (!currentSiteId && allSites.length > 0) setCurrentSiteId(allSites[0].id);
    const el = getLayer();
    if (!el) return;
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';
    root.appendChild(buildToolbar({ title: L.title, onClose: closePlaza }));
    root.appendChild(buildSiteTabs());
    const site = getCurrentSite();
    if (site) root.appendChild(renderSiteContent(site));
    el.appendChild(root);
}

export function renderEmbed(site: PlazaSite): void {
    stopProxy();
    const el = getLayer();
    if (!el) return;
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';
    const body = document.createElement('div');
    body.className = 'plaza-body';
    const spinner = document.createElement('div');
    spinner.className = 'plaza-spinner';
    spinner.innerHTML = '<div class="plaza-spinner-ring"></div>';
    body.appendChild(spinner);
    const iframe = document.createElement('iframe');
    iframe.className = 'plaza-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
    iframe.onload = () => spinner.classList.add('is-hidden');
    iframe.addEventListener('dragover', (e) => e.preventDefault());
    iframe.addEventListener('drop', (e) => e.preventDefault());
    setPlazaIframe(iframe);
    body.appendChild(iframe);
    root.appendChild(buildToolbar({ title: site.name, onBack: renderHome, onOpen: () => openExternal(site), onRefresh: () => { if (iframe.src) { spinner.classList.remove('is-hidden'); iframe.src = iframe.src; } }, onClose: closePlaza }));
    root.appendChild(body);
    el.appendChild(root);
    setPlazaProxyActive(true);
    StartProxy(site.url, 'embed').then((proxyUrl) => { iframe.src = proxyUrl; }).catch((e) => {
        setPlazaProxyActive(false);
        spinner.classList.add('is-hidden');
        const err = document.createElement('div');
        err.className = 'plaza-error';
        err.textContent = t('plaza.proxyError', { err: translateGoError(e) });
        body.appendChild(err);
    });
}

export function renderRemote(site: PlazaSite): void {
    const el = getLayer();
    if (!el) return;
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root plaza-remote';
    root.appendChild(buildToolbar({ title: site.name, onBack: async () => { setPlazaProxyActive(false); await safeCallAsync('plaza', '', () => ClosePlazaWindow()); renderHome(); }, onClose: async () => { setPlazaProxyActive(false); await safeCallAsync('plaza', '', () => ClosePlazaWindow()); closePlaza(); } }));
    const body = document.createElement('div');
    body.className = 'plaza-remote-body';
    const hint = document.createElement('div');
    hint.className = 'plaza-remote-hint';
    hint.textContent = L.remoteHint;
    body.appendChild(hint);
    const urlDisplay = document.createElement('div');
    urlDisplay.className = 'plaza-remote-url';
    urlDisplay.textContent = L.loading;
    setRemoteURLDisplay(urlDisplay);
    body.appendChild(urlDisplay);
    const progress = document.createElement('div');
    progress.className = 'plaza-remote-progress';
    setRemoteProgress(progress);
    body.appendChild(progress);
    const controls = document.createElement('div');
    controls.className = 'plaza-remote-controls';
    const addBtn = (label: string, fn: () => Promise<unknown>): void => {
        const b = document.createElement('button');
        b.className = 'plaza-btn plaza-remote-btn';
        b.textContent = label;
        b.onclick = () => { swallowError(fn()); };
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

// 从 plaza.ts 引用的函数
import { stopProxy, closePlaza } from './plaza-state';