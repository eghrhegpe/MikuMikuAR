// plaza-browser.ts — 模型广场：站点管理 + 浏览/搜索/渲染
// 从 plaza.ts 拆分

import type { PlazaSite } from './plaza-sites';
import type { PlazaCreator } from './plaza-creators';
import {
    allSites,
    allCreators,
    currentSiteId,
    setCurrentSiteId,
    setAllSites,
    setAllCreators,
    CUSTOM_SITES_PATH,
    GLOBAL_MODE_KEY,
    SITE_GROUPS,
    getCurrentSite,
    getLayer,
    setPlazaProxyActive,
    setPlazaIframe,
    loadGlobalMode,
    saveGlobalMode,
    effectiveMode,
    stopProxy,
    closePlaza,
    type OpenMode,
} from './plaza-state';
import {
    FetchPlazaConfig,
    GetCachedPlazaConfig,
    ReadTextFile,
    WriteTextFile,
    StartProxy,
} from '../core/wails-bindings';
import { NavigatePlazaWindow } from '@bindings/mikumikuar/internal/app/app';
import { getCachedCapabilities } from '../core/backend';
import { openExternalURL } from '../core/platform';
import { browser } from '../core/runtime-bridge';
import { swallowError, escapeHtml } from '../core/utils';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { showErrorToast } from '../core/toast';
import { addDisposableListener, type Disposable } from '../core/dom';
import { safeDispose } from '../core/dispose-helpers';
import { _plazaBtn, _plazaSectionHeader } from './plaza-thumbnail';
import {
    installDownloadListener,
    installEventListeners,
    installShortcuts,
    ensureObserver,
} from './plaza-download';
import { PLAZA_SITES } from './plaza-sites';
import { PLAZA_CREATORS } from './plaza-creators';

// ======== 站点数据管理 ========

/** JSON 解析后的原始站点数据（未校验） */
interface RawSiteInput {
    id?: string;
    name?: string;
    label?: string;
    url?: string;
    mode?: string;
    icon?: string;
    desc?: string;
    group?: string;
    searchUrl?: string;
    presetSearches?: { label: string; q?: string }[];
    directNavigate?: boolean;
}

/** JSON 解析后的原始创作者数据（未校验） */
interface RawCreatorInput {
    name?: string;
    site?: string;
    type?: string;
    tag?: string;
    role?: string;
    desc?: string;
    tier?: 'gold' | 'silver';
}

export function normalizeSite(raw: RawSiteInput): PlazaSite | null {
    if (!raw || !raw.id) {
        return null;
    }
    const name = raw.name || raw.label || raw.id;
    const url = raw.url || '';
    if (!name || !url) {
        return null;
    }
    const mode: 'embed' | 'external' = raw.mode === 'embed' ? 'embed' : 'external';
    let icon = raw.icon;
    if (icon && /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(icon)) {
        icon = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><text y=%2220%22 font-size=%2220%22>${icon}</text></svg>`;
    }
    return {
        id: raw.id,
        name,
        url,
        mode,
        icon: icon || 'lucide:globe',
        desc: raw.desc || '',
        group: raw.group || 'search',
        searchUrl: raw.searchUrl,
        presetSearches: raw.presetSearches || [],
        directNavigate: raw.directNavigate ?? true,
    };
}

export function normalizeCreator(raw: RawCreatorInput): PlazaCreator | null {
    if (!raw || !raw.name) {
        return null;
    }
    const site = raw.site || raw.type || '';
    if (!site) {
        return null;
    }
    let tag = raw.tag || raw.role || 'creator';
    if (tag === 'repo') {
        tag = 'creator';
    }
    if (!['official', 'creator', 'vup', 'oc'].includes(tag)) {
        tag = 'creator';
    }
    const primarySite = (site as string).split(';')[0];
    return {
        name: raw.name,
        desc: raw.desc || '',
        tag: tag as PlazaCreator['tag'],
        tier: raw.tier || undefined,
        site: primarySite,
    };
}

export async function loadCustomSites(): Promise<PlazaSite[]> {
    try {
        const raw = await ReadTextFile(CUSTOM_SITES_PATH);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw) as RawSiteInput[];
        return parsed.map(normalizeSite).filter(Boolean) as PlazaSite[];
    } catch {
        return [];
    }
}

// ── 本地缓存（plaza_cache.json）：拉取后持久化，启动时优先读取 ──

const PLAZA_CACHE_PATH = 'plaza_cache.json';

interface PlazaCache {
    sites: RawSiteInput[];
    creators: RawCreatorInput[];
}

/** 从本地缓存文件读取站点 + 创作者。缓存不存在时返回 null。 */
export async function loadPlazaCache(): Promise<{ sites: PlazaSite[]; creators: PlazaCreator[] } | null> {
    try {
        const raw = await ReadTextFile(PLAZA_CACHE_PATH);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PlazaCache;
        if (!parsed.sites?.length && !parsed.creators?.length) return null;
        return {
            sites: parsed.sites?.map(normalizeSite).filter(Boolean) as PlazaSite[] ?? [],
            creators: parsed.creators?.map(normalizeCreator).filter(Boolean) as PlazaCreator[] ?? [],
        };
    } catch {
        return null;
    }
}

/** 将当前站点 + 创作者写入本地缓存文件。 */
export async function savePlazaCache(): Promise<void> {
    try {
        const data: PlazaCache = {
            sites: allSites.map((s) => ({
                id: s.id,
                name: s.name,
                url: s.url,
                mode: s.mode,
                icon: s.icon,
                desc: s.desc,
                group: s.group,
                searchUrl: s.searchUrl,
                presetSearches: s.presetSearches,
                directNavigate: s.directNavigate,
            })),
            creators: allCreators.map((c) => ({
                name: c.name,
                site: c.site,
                tag: c.tag,
                desc: c.desc,
                tier: c.tier,
            })),
        };
        await WriteTextFile(PLAZA_CACHE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        logWarn('plaza-browser', 'savePlazaCache failed', e);
    }
}

export function mergeSites(base: PlazaSite[], extras: PlazaSite[]): PlazaSite[] {
    const map = new Map(base.map((s) => [s.id, s]));
    for (const s of extras) {
        if (s) {
            map.set(s.id, s);
        }
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

// [doc:plaza-spa] 内置站点的路由标记（directNavigate）属代码级决策，缓存/远程配置不得覆盖或丢弃。
// 缓存路径（plaza_cache.json / Go 缓存）会丢失该字段并以缓存为准提前返回，导致内置站点
// 静默退回代理 origin → API CORS 白屏。此函数保证内置站点的路由标记始终以源码 PLAZA_SITES 为准，
// 缓存只覆盖用户可编辑字段（mode/url 等）。
const BUILTIN_ROUTING = new Map(PLAZA_SITES.map((s) => [s.id, s]));
export function preserveBuiltinRouting(sites: PlazaSite[]): PlazaSite[] {
    return sites.map((s) => {
        const builtin = BUILTIN_ROUTING.get(s.id);
        return builtin ? { ...s, directNavigate: builtin.directNavigate ?? s.directNavigate } : s;
    });
}

export async function loadCachedConfig(): Promise<void> {
    try {
        const cached = await GetCachedPlazaConfig();
        if (cached && cached[0]) {
            const parsed = JSON.parse(cached[0]) as {
                sites?: RawSiteInput[];
                creators?: RawCreatorInput[];
            };
            if (parsed.sites?.length) {
                setAllSites(preserveBuiltinRouting(parsed.sites.map(normalizeSite).filter(Boolean) as PlazaSite[]));
            }
            if (parsed.creators?.length) {
                setAllCreators(
                    parsed.creators.map(normalizeCreator).filter(Boolean) as PlazaCreator[]
                );
            }
        }
    } catch (e) {
        logWarn('plaza-browser', 'loadCachedConfig failed', e);
    }
}

export async function ensureSitesLoaded(): Promise<void> {
    if (allSites.length > 0) {
        return;
    }
    // 1) 优先读本地缓存（plaza_cache.json，由更新配置写出）
    const cached = await loadPlazaCache();
    if (cached && cached.sites.length > 0) {
        setAllSites(preserveBuiltinRouting(cached.sites));
        if (cached.creators.length > 0) {
            setAllCreators(cached.creators);
        }
        return;
    }
    // 2) 读 Go 缓存（plaza-cache/，由 FetchPlazaConfig 远程拉取后缓存）
    await loadCachedConfig();
    if (allSites.length > 0) {
        // Go 缓存命中 → 顺便写一份本地缓存供下次冷启动使用
        savePlazaCache();
        return;
    }
    // 3) 冷启动兜底：硬编码站点 + 自定义 + 空创作者
    const custom = await loadCustomSites();
    setAllSites(preserveBuiltinRouting(mergeSites(PLAZA_SITES, custom)));
    setAllCreators([...PLAZA_CREATORS]);
}

// ======== 站点浏览 ========

export function openSiteByMode(site: PlazaSite, url?: string): void {
    // 网页端无 Wails 后端；安卓端触屏操作优先走系统浏览器（Edog 等）
    const mode = getCachedCapabilities().inAppBrowser ? effectiveMode(site) : 'external';
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
        case 'browser':
            openInSystemBrowser(site, url);
            break;
    }
}

export function openExternal(site: PlazaSite, url?: string): void {
    const target = url ?? site.url;
    if (!openExternalURL(target)) {
        // 网页端（非 Android）：openExternalURL 返回 false 时自己用 window.open
        const win = window.open(target, '_blank', 'noopener,noreferrer');
        if (!win) {
            logWarn('plaza-browser', 'openExternal: popup blocked for', target);
        }
    }
}

/** 调用操作系统的默认浏览器打开站点（Browser.OpenURL 或 window.open）。 */
export function openInSystemBrowser(site: PlazaSite, url?: string): void {
    const target = url ?? site.url;
    swallowError(browser.openURL(target));
}

export function openInWindow(site: PlazaSite, url?: string): void {
    // [doc:plaza-spa] directNavigate 站点（独立 API 域 SPA）直连真实域名，
    // 否则代理 origin (127.0.0.1:PORT) 触发 api CORS 白屏。
    const direct = site.directNavigate ?? false;
    if (!direct) {
        setPlazaProxyActive(true);
    }
    safeCallAsync('plaza', '', () => NavigatePlazaWindow(url ?? site.url, direct)).catch(() => {
        setPlazaProxyActive(false);
    });
}

export function getCustomPresets(siteId: string): { label: string; q: string }[] {
    try {
        return JSON.parse(localStorage.getItem(`miku.plaza.presets.${siteId}`) || '[]');
    } catch {
        return [];
    }
}

export function saveCustomPresets(siteId: string, presets: { label: string; q: string }[]): void {
    try {
        localStorage.setItem(`miku.plaza.presets.${siteId}`, JSON.stringify(presets));
    } catch (e) {
        logWarn('plaza-browser', 'saveCustomPresets failed', e);
    }
}

export function buildSiteTabs(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'plaza-site-tabs';
    for (const grp of SITE_GROUPS) {
        const grpSites = allSites.filter((s) => grp.ids.includes(s.id));
        if (grpSites.length === 0) {
            continue;
        }
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
                if (currentSiteId === site.id) {
                    return;
                }
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
                if (currentSiteId === site.id) {
                    return;
                }
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
    const addBtn = _plazaBtn(
        '<iconify-icon icon="lucide:plus"></iconify-icon>',
        () => {},
        'plaza-btn',
        '添加搜索词'
    );
    addBtn.onclick = (e) => {
        e.stopPropagation();
        addBtn.style.display = 'none';
        const inputRow = document.createElement('div');
        inputRow.className = 'plaza-preset-add-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'plaza-preset-input';
        input.placeholder = '输入搜索词…';
        const confirmBtn = _plazaBtn(
            '<iconify-icon icon="lucide:check"></iconify-icon>',
            () => {},
            'plaza-btn plaza-btn-primary'
        );
        const cancelBtn = _plazaBtn(
            '<iconify-icon icon="lucide:x"></iconify-icon>',
            () => {},
            'plaza-btn'
        );
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
        cancelBtn.onclick = () => {
            inputRow.remove();
            addBtn.style.display = '';
        };
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                commit();
            }
            if (ev.key === 'Escape') {
                inputRow.remove();
                addBtn.style.display = '';
            }
        });
        input.focus();
    };
    searchActions.appendChild(addBtn);
    const moreBtn = _plazaBtn(
        '<iconify-icon icon="lucide:more-horizontal"></iconify-icon>',
        () => {},
        'plaza-btn'
    );
    moreBtn.onclick = (e) => {
        e.stopPropagation();
        showActionsMenu(site, moreBtn);
    };
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
            empty.innerHTML =
                '<iconify-icon icon="lucide:search-x"></iconify-icon><span>暂无搜索词，点 ➕ 添加</span>';
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
                if (url) {
                    openSiteByMode(site, url);
                }
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
                if (url) {
                    openSiteByMode(site, url);
                }
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
    updateBtn.innerHTML =
        '<iconify-icon icon="lucide:refresh-cw"></iconify-icon><span>更新配置</span>';
    updateBtn.onclick = async () => {
        updateBtn.disabled = true;
        updateBtn.innerHTML =
            '<iconify-icon icon="lucide:loader-2" class="plaza-spin"></iconify-icon><span>更新中...</span>';
        try {
            const [crJson, stJson] = await FetchPlazaConfig();
            if (stJson) {
                const raw = JSON.parse(stJson) as RawSiteInput[];
                const remote = raw.map(normalizeSite).filter(Boolean) as PlazaSite[];
                setAllSites(mergeSites(PLAZA_SITES, remote));
            }
            if (crJson) {
                const raw = JSON.parse(crJson) as RawCreatorInput[];
                setAllCreators(raw.map(normalizeCreator).filter(Boolean) as PlazaCreator[]);
            }
            if (!allSites.some((s) => s.id === currentSiteId)) {
                setCurrentSiteId(allSites[0]?.id || '');
            }
            // 持久化到本地缓存，下次启动直接读
            await savePlazaCache();
            renderHome();
        } catch (e) {
            showErrorToast(`更新失败: ${translateGoError(e)}`);
        } finally {
            updateBtn.disabled = false;
            updateBtn.innerHTML =
                '<iconify-icon icon="lucide:refresh-cw"></iconify-icon><span>更新配置</span>';
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
            try {
                return JSON.parse(localStorage.getItem('miku.plaza.favCreators') || '[]').includes(
                    name
                );
            } catch {
                return false;
            }
        }
        function toggleFav(name: string): boolean {
            try {
                const favs = JSON.parse(localStorage.getItem('miku.plaza.favCreators') || '[]');
                const idx = favs.indexOf(name);
                if (idx >= 0) {
                    favs.splice(idx, 1);
                } else {
                    favs.unshift(name);
                }
                localStorage.setItem('miku.plaza.favCreators', JSON.stringify(favs));
                return idx < 0;
            } catch {
                return false;
            }
        }
        function getFilteredCreators(): PlazaCreator[] {
            const kw = searchKw.trim().toLowerCase();
            let list = activeTag
                ? siteCreators.filter((c) => c.tag === activeTag)
                : [...siteCreators];
            const favMap = new Map(list.map((c) => [c.name, isFaved(c.name) ? 1 : 0]));
            list.sort((a, b) => {
                const af = favMap.get(a.name) ?? 0,
                    bf = favMap.get(b.name) ?? 0;
                if (af !== bf) {
                    return bf - af;
                }
                const at = a.tier === 'gold' ? 0 : a.tier === 'silver' ? 1 : 2;
                const bt = b.tier === 'gold' ? 0 : b.tier === 'silver' ? 1 : 2;
                return at - bt;
            });
            if (kw) {
                list = list.filter(
                    (c) => c.name.toLowerCase().includes(kw) || c.desc.toLowerCase().includes(kw)
                );
            }
            return list;
        }
        function renderCreators(): void {
            creatorGrid.innerHTML = '';
            const filtered = getFilteredCreators();
            for (const cr of filtered) {
                const card = document.createElement('div');
                card.className = 'plaza-cr-card';
                if (cr.tier) {
                    card.dataset.tier = cr.tier;
                }
                card.dataset.tag = cr.tag;
                card.dataset.name = cr.name;
                const tierBar = cr.tier ? '<div class="plaza-cr-tier-bar"></div>' : '';
                const fav = isFaved(cr.name) ? '★' : '☆';
                const tagIcon = tags.find((t) => t.key === cr.tag)?.icon ?? 'lucide:user';
                card.innerHTML =
                    tierBar +
                    `<div class="plaza-cr-header"><div class="plaza-cr-avatar-container"><div class="plaza-cr-avatar-ring${cr.tier ? ` plaza-cr-ring-${cr.tier}` : ''}"></div><div class="plaza-cr-avatar plaza-cr-avatar-fb">${cr.name.charAt(0).toUpperCase()}</div></div><div class="plaza-cr-name-row"><span class="plaza-cr-name">${escapeHtml(cr.name)}</span><span class="plaza-cr-star" data-star="${escapeHtml(cr.name)}">${fav}</span></div></div><div class="plaza-cr-desc">${escapeHtml(cr.desc)}</div><div class="plaza-cr-footer"><span class="plaza-cr-tag plaza-cr-tag-${cr.tag}"><iconify-icon icon="${tagIcon}" width="10" height="10"></iconify-icon><span>${cr.tag}</span></span></div>`;
                card.addEventListener('click', (e) => {
                    if ((e.target as HTMLElement).closest('.plaza-cr-star')) {
                        return;
                    }
                    const url = site.searchUrl?.replace('{{q}}', encodeURIComponent(cr.name));
                    if (url) {
                        openSiteByMode(site, url);
                    }
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
            if (countEl) {
                countEl.textContent = `(${filtered.length}/${siteCreators.length})`;
            }
        }
        searchInput.addEventListener('input', () => {
            searchKw = searchInput.value;
            renderCreators();
        });
        for (const t of tags) {
            const btn = document.createElement('button');
            btn.className = 'plaza-tag-btn' + (t.key === '' ? ' active' : '');
            btn.innerHTML = `<iconify-icon icon="${t.icon}" width="12" height="12"></iconify-icon><span>${t.label}</span>`;
            btn.onclick = () => {
                activeTag = t.key;
                tagRow
                    .querySelectorAll('.plaza-tag-btn')
                    .forEach((b) => b.classList.remove('active'));
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
        empty.innerHTML =
            '<iconify-icon icon="lucide:user-x"></iconify-icon><span>暂无收录创作者，点击「更新配置」拉取</span>';
        creatorSection.appendChild(empty);
    }
    container.appendChild(creatorSection);
    return container;
}

export function buildToolbar(opts: {
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
        left.appendChild(_plazaBtn(t('plaza.back'), opts.onBack));
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
        right.appendChild(
            _plazaBtn(t('plaza.openInBrowser'), opts.onOpen, 'plaza-btn plaza-btn-accent')
        );
    }
    if (opts.onRefresh) {
        right.appendChild(_plazaBtn(t('plaza.refresh'), opts.onRefresh));
    }
    const close = _plazaBtn(t('plaza.close'), opts.onClose);
    close.title = t('plaza.close');
    right.appendChild(close);
    bar.appendChild(right);
    return bar;
}

export function showActionsMenu(site: PlazaSite, anchor: HTMLElement): void {
    const existing = document.querySelector('.plaza-actions-menu');
    if (existing) {
        existing.remove();
    }
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
        ...(getCachedCapabilities().inAppBrowser
            ? [
                  { key: 'embed' as const, label: '内嵌页' },
                  // [doc:adr-177] A5 能力门控：plazaWindow===false 时隐藏「独立窗口」选项
                  ...(getCachedCapabilities().plazaWindow
                      ? [{ key: 'window' as const, label: '独立窗口' }]
                      : []),
                  { key: 'external' as const, label: '第二窗口浏览器' },
                  { key: 'browser' as const, label: '直接打开浏览器' },
              ]
            : [{ key: 'external' as const, label: '系统浏览器' }]),
    ];
    const current = loadGlobalMode() ?? 'auto';
    for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'plaza-actions-menu-item' + (current === o.key ? ' active' : '');
        b.textContent = o.label;
        b.onclick = () => {
            if (o.key === 'auto') {
                try {
                    localStorage.removeItem(GLOBAL_MODE_KEY);
                } catch (e) {
                    logWarn('plaza-browser', 'removeItem GLOBAL_MODE_KEY failed', e);
                }
            } else {
                saveGlobalMode(o.key);
                // 清除站点级模式，让全局模式优先（否则 effectiveMode 先命中站点级会忽略全局）
                try {
                    localStorage.removeItem(`miku.plaza.mode.${site.name}`);
                } catch (e) {
                    logWarn('plaza-browser', 'removeItem site mode failed', e);
                }
            }
            menu.remove();
        };
        modes.appendChild(b);
    }
    menu.appendChild(modes);
    const divider = document.createElement('div');
    divider.className = 'plaza-actions-menu-divider';
    menu.appendChild(divider);
    const openBtn = _plazaBtn(
        '<iconify-icon icon="lucide:external-link"></iconify-icon><span>打开网站</span>',
        () => {
            openSiteByMode(site);
            menu.remove();
        },
        'plaza-actions-menu-item plaza-actions-menu-item-accent'
    );
    menu.appendChild(openBtn);
    const closeBtn = _plazaBtn(
        '<iconify-icon icon="lucide:x"></iconify-icon><span>关闭</span>',
        () => {
            closePlaza();
            menu.remove();
        },
        'plaza-actions-menu-item'
    );
    menu.appendChild(closeBtn);
    document.body.appendChild(menu);
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 8)}px`;
    menu.style.top = `${Math.min(anchorRect.bottom + 4, window.innerHeight - menuRect.height - 8)}px`;
    let onDownDisp: Disposable | null = null;
    const onDown = (e: MouseEvent): void => {
        if (!menu.contains(e.target as Node)) {
            menu.remove();
            onDownDisp = safeDispose(onDownDisp);
        }
    };
    setTimeout(() => {
        onDownDisp = addDisposableListener(document, 'mousedown', onDown);
    }, 0);
}

export async function renderHome(): Promise<void> {
    stopProxy();
    await ensureSitesLoaded();
    if (!currentSiteId && allSites.length > 0) {
        setCurrentSiteId(allSites[0].id);
    }
    const el = getLayer();
    if (!el) {
        return;
    }
    el.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'plaza-root';
    root.appendChild(buildToolbar({ title: t('plaza.title'), onClose: closePlaza }));
    root.appendChild(buildSiteTabs());
    const site = getCurrentSite();
    if (site) {
        root.appendChild(renderSiteContent(site));
    }
    el.appendChild(root);
}

export function renderEmbed(site: PlazaSite): void {
    stopProxy();
    const el = getLayer();
    if (!el) {
        return;
    }
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
    // [ADR-077] allow-same-origin 必需：sandbox 缺此标记时 iframe origin 被强制为 null
    // (opaque origin)，登录站 SPA 的 fetch/XHR 跨域到 http://127.0.0.1:PORT 会被
    // 浏览器 CORS 拦截，登录态中继失效。父窗口与 iframe origin 本就不同源
    // (wails:// vs 127.0.0.1)，补此标记不会让 iframe 反向访问父窗口。
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin');
    iframe.onload = () => spinner.classList.add('is-hidden');
    iframe.addEventListener('dragover', (e) => e.preventDefault());
    iframe.addEventListener('drop', (e) => e.preventDefault());
    setPlazaIframe(iframe);
    body.appendChild(iframe);
    root.appendChild(
        buildToolbar({
            title: site.name,
            onBack: renderHome,
            onOpen: () => openExternal(site),
            onRefresh: () => {
                if (iframe.src) {
                    spinner.classList.remove('is-hidden');
                    const currentSrc = iframe.src;
                    iframe.src = currentSrc;
                }
            },
            onClose: closePlaza,
        })
    );
    root.appendChild(body);
    el.appendChild(root);

    // [doc:plaza-spa] 直连是默认路径：iframe 直接加载真实域名，跳过代理。
    // 独立 API 域 SPA（如 aplaybox）以真实 origin 发 API 请求，CORS 才放行；
    // 代理 origin (127.0.0.1:PORT) 会被 api CORS 拦死，只剩壳子转圈。
    // 代价：无代理注入，应用内下载接管（/__plaza_dl__）失效，下载退化为系统浏览器 + fsnotify 兜底（ADR-003）。
    // 仅 frame-hostile 站点（发 X-Frame-Options/CSP frame-ancestors 拒绝被框）应置 directNavigate:false 走代理剥离头，
    // 否则 embed 会白屏；window 模式不受此限，始终直连真实域名。
    if (site.directNavigate) {
        setPlazaProxyActive(false);
        iframe.src = site.url;
        return;
    }

    setPlazaProxyActive(true);
    StartProxy(site.url, 'embed')
        .then((proxyUrl) => {
            iframe.src = proxyUrl;
        })
        .catch((e) => {
            setPlazaProxyActive(false);
            spinner.classList.add('is-hidden');
            const err = document.createElement('div');
            err.className = 'plaza-error';
            err.textContent = t('plaza.proxyError', { err: translateGoError(e) });
            body.appendChild(err);
        });
}


// ======== 入口函数 ========

export async function showPlaza(): Promise<void> {
    installDownloadListener();
    installEventListeners();
    installShortcuts();
    ensureObserver();
    await renderHome();
}
