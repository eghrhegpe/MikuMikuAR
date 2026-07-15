// [doc:architecture] Library Core — 模型库核心工具函数 + re-export
// 从 library-core.ts 拆分：浏览逻辑 → library-browse.ts，动作 → library-actions.ts，配置 → library-setup.ts

import {
    setStatus,
    allModels,
    LibraryModel,
    PopupRow,
    PopupLevel,
    normPath,
    setThumbnailCache,
    thumbnailCache,
    modelMetaCache,
    setModelMetaCache,
    displayNamePriority,
    modelRegistry,
    focusedModelId,
    cardContainer,
    librarySortMode,
    stackRegistry,
    getBrowseDir,
    getBaseName,
    logWarn,
    LoadingGuard,
    closeAllOverlays,
    layerBindingTargetId,
    setLayerBindingTargetId,
    motionBindingTargetId,
    setMotionBindingTargetId,
    modelReplaceTargetId,
    setModelReplaceTargetId,
    libraryRoot,
} from '../core/config';
import { SlideMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    createResourcePanel,
    openFullscreen,
    closeFullscreen,
    setCurrentState,
} from '../core/ui-helpers';
import type { ResourceItem, SlideRowExtra } from '../core/ui-helpers';
import { isUnderRoot } from '../core/utils';
import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { GetThumbnailBatch, GetModelMetaBatch } from '../core/wails-bindings';
import { loadManager } from '../core/load-manager';
import { focusModel } from '../scene/scene';
import { buildModelToolsLevel } from './model-detail';
import { onModelRowClick, replaceModel, prepareModelRestore, importFile } from './library-actions';

// ======== Resource View Mode ========

export type ResourceViewMode = 'list' | 'grid';

let resourceViewMode: ResourceViewMode = 'list';

export function getResourceViewMode(): ResourceViewMode { return resourceViewMode; }
export function setResourceViewMode(mode: ResourceViewMode): void { resourceViewMode = mode; }

// ======== 模型目录检测 ========

export function isModelDirTarget(target: string | undefined): boolean {
    return !!target && target.startsWith('models:');
}

// ======== 恢复状态（library-actions ↔ library-browse 共享）========

let pendingAutoExpand: string[] | null = null;
let pendingFocusModel: { dir: string; rowKey: string } | null = null;
export function getPendingAutoExpand(): string[] | null { return pendingAutoExpand; }
export function setPendingAutoExpand(v: string[] | null): void { pendingAutoExpand = v; }
export function getPendingFocusModel(): { dir: string; rowKey: string } | null { return pendingFocusModel; }
export function setPendingFocusModel(v: { dir: string; rowKey: string } | null): void { pendingFocusModel = v; }

const _pendingMetaGuard = new LoadingGuard();
export function getPendingMetaGuard(): LoadingGuard { return _pendingMetaGuard; }

// ======== 路径工具 ========

export function splitSubdirSegments(rootRaw: string, dirRaw: string): string[] | null {
    const root = normPath(rootRaw);
    const dir = normPath(dirRaw);
    if (!isUnderRoot(root, dir)) return null;
    const rel = dir.substring(root.length + 1);
    return rel ? rel.split('/').filter(Boolean) : null;
}

export function getRelativePathUnderDir(mdirRaw: string, baseDirRaw: string): string | null {
    const mdir = normPath(mdirRaw);
    const base = normPath(baseDirRaw);
    if (!isUnderRoot(base, mdir)) return null;
    const rel = mdir.substring(base.length + 1);
    return rel || null;
}

export function isLeafFlattenDir(
    dir: string,
    modelList: LibraryModel[],
    filter?: (m: LibraryModel) => boolean
): boolean {
    const d = normPath(dir);
    for (const m of modelList) {
        if (filter && !filter(m)) continue;
        const mdir = normPath(m.dir);
        if (mdir === d) continue;
        const rel = getRelativePathUnderDir(mdir, d);
        if (rel !== null && rel.includes('/')) return false;
    }
    return true;
}

export function computeRestoreSegments(
    rootRaw: string,
    targetRaw: string,
    modelList: LibraryModel[],
    filter?: (m: LibraryModel) => boolean
): string[] | null {
    const root = normPath(rootRaw);
    const target = normPath(targetRaw);
    const segs = splitSubdirSegments(root, target);
    if (!segs) return null;
    // 从根开始逐段验证：每段对应目录下至少有一个符合条件的模型
    let current = root;
    for (let i = 0; i < segs.length; i++) {
        current = current + '/' + segs[i];
        let hasModel = false;
        for (const m of modelList) {
            if (filter && !filter(m)) continue;
            if (isUnderRoot(current, normPath(m.dir))) { hasModel = true; break; }
        }
        if (!hasModel) return segs.slice(0, i);
    }
    return segs;
}

// ======== 缩略图 & 元数据 ========

export function thumbnailKeyForModel(m: LibraryModel): string {
    return m.file_path || m.file_path || '';
}

async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
    const guard = getPendingMetaGuard();
    const uncached = pmxPaths.filter((p) => !modelMetaCache.has(p) && !guard.isLoading(p));
    if (uncached.length === 0) return;
    for (const p of uncached) guard.tryEnter(p);
    try {
        const batch = await GetModelMetaBatch(uncached);
        if (batch) {
            const merged = new Map(modelMetaCache);
            for (const [path, meta] of Object.entries(batch)) merged.set(path, meta);
            setModelMetaCache(merged);
        }
    } catch (err) {
        logWarn('library-core', 'ensureModelMeta:', err);
    } finally {
        for (const p of uncached) guard.leave(p);
    }
}

// ======== 模型显示名/图标 公共解析 ========

function resolveModelIcon(m: LibraryModel): string {
    if (m.format === 'vmd') return 'music';
    if (m.format === 'audio') return 'volume-2';
    if (m.format === 'vpd') return 'user';
    if (m.container === 'zip' && m.format === 'pmx') return 'archive';
    return 'box';
}

function resolveModelLabel(m: LibraryModel, filenameFallback: string): string {
    const fp = m.file_path || '';
    const filename = m.container === 'zip' && m.zip_inner
        ? getBaseName(m.zip_inner) || filenameFallback
        : getBaseName(fp) || filenameFallback;
    const cached = modelMetaCache.get(fp);
    switch (displayNamePriority) {
        case 'filename': return filename;
        case 'name_en': return cached?.name_en || m.name_en || cached?.name_jp || m.name_jp || filename;
        case 'name_jp':
        default: return cached?.name_jp || m.name_jp || cached?.name_en || m.name_en || filename;
    }
}

export function modelToRow(m: LibraryModel): PopupRow {
    return {
        kind: 'model', label: resolveModelLabel(m, t('library.unknown')), icon: resolveModelIcon(m),
        target: m.file_path, sublabel: undefined, model: m, editable: m.format === 'pmx', wrapLabel: true,
        onAddClick: () => { closeAllOverlays(); onModelRowClick(m); },
    };
}

export function modelToResourceItem(m: LibraryModel): ResourceItem {
    const fp = m.file_path || '';
    const cached = modelMetaCache.get(fp);
    return {
        id: fp, label: resolveModelLabel(m, ''), filePath: fp, thumbKey: thumbnailKeyForModel(m),
        icon: resolveModelIcon(m), isFolder: false,
        sublabel: cached?.comment || m.comment || undefined, data: m,
    };
}

// ======== 构建列表 ========

export function buildResourceItemsForDir(
    dir: string, filter?: (m: LibraryModel) => boolean, browseDir?: string
): ResourceItem[] {
    const items: ResourceItem[] = [];
    const subdirs = new Set<string>();
    const modelList = allModels || [];
    for (const m of modelList) {
        if (filter && !filter(m)) continue;
        const mdir = normPath(m.dir);
        const targetDir = browseDir ? normPath(browseDir) : '';
        if (browseDir && !isUnderRoot(targetDir, mdir)) continue;
        const rel = getRelativePathUnderDir(mdir, dir);
        if (rel === null) continue;
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) {
            items.push(modelToResourceItem(m));
        } else {
            subdirs.add(parts[0]);
        }
    }
    for (const d of Array.from(subdirs).sort()) {
        items.unshift({ id: dir + '/' + d, label: d, filePath: dir + '/' + d, icon: 'folder', isFolder: true });
    }
    return items;
}

// ======== 视图切换按钮 ========

function _buildViewToggleButtons(toolbar: HTMLElement, targetStack?: SlideMenu): void {
    const modeBtn = (mode: 'grid' | 'list', icon: string, titleKey: string) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm' + (resourceViewMode === mode ? ' btn-active' : '');
        btn.textContent = icon;
        btn.title = t(titleKey);
        btn.addEventListener('click', () => {
            setResourceViewMode(mode);
            const stack = targetStack || stackRegistry.modelStack;
            const cl = stack?.currentLevel;
            if (cl) stack!.replaceCurrentLevel(buildLevel(cl.dir, cl.label, cl.filter, targetStack));
        });
        toolbar.appendChild(btn);
    };
    modeBtn('grid', '⊞', 'library.gridView');
    modeBtn('list', '≡', 'library.listView');
}

// ======== 列表模式渲染 ========

function addListViewToolbar(
    card: HTMLElement, _dir: string, items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined, allResourceItems: ResourceItem[]
): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    _buildViewToggleButtons(toolbar, targetStack);
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn btn-ghost btn-sm';
    expandBtn.textContent = '⛶';
    expandBtn.title = t('library.expandPanel');
    expandBtn.style.marginLeft = 'auto';
    expandBtn.addEventListener('click', () => {
        const currentTitle = items[0]?.label || '资源库';
        openFullscreen({
            title: currentTitle, onBack: () => setCurrentState('EMBEDDED_GRID'),
            renderContent: (container, navigate) => {
                createResourcePanel(container, {
                    items: allResourceItems, thumbnailCache,
                    onSelect: (item) => { if (item.data) { closeFullscreen(); onModelRowClick(item.data as LibraryModel); } },
                    onEnterFolder: (path) => {
                        const folderLabel = allResourceItems.find((i) => i.id === path)?.label || getBaseName(path) || path;
                        navigate(folderLabel, (c) => { renderFullscreenFolder(c, path, filter, navigate); });
                    },
                    layout: 'grid',
                });
            },
        });
    });
    toolbar.appendChild(expandBtn);
    card.appendChild(toolbar);
}

function renderItemsWithRAF(
    card: HTMLElement, items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined
): void {
    const RAF_BATCH_THRESHOLD = 100;
    const RAF_BATCH_SIZE = 50;
    const activateItem = (item: PopupRow): void => {
        if (item.kind === 'folder') {
            const next = buildLevel(item.target, item.label, filter, targetStack);
            const stack = targetStack || stackRegistry.modelStack;
            stack.push(next);
        } else if (item.model) {
            if (item.model.format === 'vmd' && layerBindingTargetId) {
                const id = layerBindingTargetId;
                setLayerBindingTargetId(null);
                closeAllOverlays();
                loadManager.load({ kind: 'vmd', path: item.model.file_path, modelId: id });
            } else if (item.model.format === 'vmd' && motionBindingTargetId) {
                const id = motionBindingTargetId;
                setMotionBindingTargetId(null);
                closeAllOverlays();
                loadManager.load({ kind: 'vmd', path: item.model.file_path, modelId: id });
            } else {
                onModelRowClick(item.model);
            }
        }
    };
    const onRowClick = (item: PopupRow): void => {
        if (item.kind === 'folder') { activateItem(item); return; }
        if (item.model && item.model.format !== 'vmd') { replaceModel(item.model); return; }
        activateItem(item);
    };
    const buildRowExtra = (item: PopupRow): SlideRowExtra | undefined => {
        const e: SlideRowExtra = {};
        if (item.wrapLabel) e.wrapLabel = true;
        if (item.kind !== 'folder') {
            e.trailing = {
                icon: 'lucide:plus', title: t('library.loadModel'),
                onClick: () => { setModelReplaceTargetId(null); activateItem(item); },
            };
        }
        return e.wrapLabel || e.trailing ? e : undefined;
    };
    if (items.length <= RAF_BATCH_THRESHOLD) {
        for (const item of items) {
            if (item.kind === 'divider') continue;
            slideRow(card, item.icon, item.label, item.kind === 'folder', () => onRowClick(item),
                item.sublabel, undefined, undefined, undefined, buildRowExtra(item));
        }
        return;
    }
    let index = 0;
    function renderBatch(): void {
        const end = Math.min(index + RAF_BATCH_SIZE, items.length);
        for (; index < end; index++) {
            const item = items[index];
            if (item.kind === 'divider') continue;
            slideRow(card, item.icon, item.label, item.kind === 'folder', () => onRowClick(item),
                item.sublabel, undefined, undefined, undefined, buildRowExtra(item));
        }
        if (index < items.length) requestAnimationFrame(renderBatch);
    }
    renderBatch();
}

function renderFullscreenFolder(
    container: HTMLElement, path: string,
    filter: ((m: LibraryModel) => boolean) | undefined,
    navigate: (title: string, render: (c: HTMLElement) => void) => void
): void {
    container.classList.remove('render-card');
    const items = buildResourceItemsForDir(path, filter);
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'plaza-preset-input';
    searchInput.placeholder = t('library.filterPlaceholder');
    searchInput.style.margin = '0 0 8px';
    container.appendChild(searchInput);
    const listContainer = document.createElement('div');
    container.appendChild(listContainer);
    function renderFiltered(query: string): void {
        listContainer.innerHTML = '';
        const filtered = query ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())) : items;
        const card = document.createElement('div');
        card.className = 'lcard';
        for (const item of filtered) {
            if (item.isFolder) {
                slideRow(card, 'folder', item.label, true, () => {
                    navigate(item.label, (c) => renderFullscreenFolder(c, item.filePath, filter, navigate));
                });
            } else {
                slideRow(card, item.icon, item.label, false, () => {
                    if (item.data) onModelRowClick(item.data as LibraryModel);
                });
            }
        }
        listContainer.appendChild(card);
    }
    searchInput.addEventListener('input', () => renderFiltered(searchInput.value));
    renderFiltered('');
}

// ======== Grid 模式渲染 ========

function renderGridMode(
    container: HTMLElement, dir: string, items: PopupRow[],
    filter?: (m: LibraryModel) => boolean, targetStack?: SlideMenu
): void {
    setCurrentState('EMBEDDED_GRID');
    const allResourceItems = buildResourceItemsForDir(dir, filter);
    const thumbKeys2 = allResourceItems.filter((item) => !item.isFolder && item.thumbKey).map((item) => item.thumbKey!);
    if (thumbKeys2.length > 0) {
        GetThumbnailBatch(thumbKeys2)
            .then((batch) => {
                const merged = new Map(thumbnailCache);
                for (const [path, data] of Object.entries(batch)) merged.set(path, data);
                setThumbnailCache(merged);
            })
            .catch((err) => logWarn('library-core', 'GetThumbnailBatch failed:', err));
    }
    cardContainer(container, (card) => {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        _buildViewToggleButtons(toolbar, targetStack);
        const expandBtn = document.createElement('button');
        expandBtn.className = 'btn btn-ghost btn-sm';
        expandBtn.textContent = '⛶';
        expandBtn.title = t('library.expandPanel');
        expandBtn.style.marginLeft = 'auto';
        expandBtn.addEventListener('click', () => {
            const currentTitle = items[0]?.label || '资源库';
            openFullscreen({
                title: currentTitle, onBack: () => setCurrentState('EMBEDDED_GRID'),
                renderContent: (container, navigate) => {
                    createResourcePanel(container, {
                        items: allResourceItems, thumbnailCache,
                        onSelect: (item) => { if (item.data) { closeFullscreen(); onModelRowClick(item.data as LibraryModel); } },
                        onEnterFolder: (path) => {
                            const stack = targetStack || stackRegistry.modelStack;
                            if (stack) {
                                const folderLabel = allResourceItems.find((fi) => fi.id === path)?.label || getBaseName(path) || path;
                                stack.push(buildLevel(path, folderLabel, filter, targetStack));
                            }
                        },
                        layout: 'grid',
                    });
                },
            });
        });
        toolbar.appendChild(expandBtn);
        card.appendChild(toolbar);
        createResourcePanel(card, {
            items: allResourceItems, thumbnailCache,
            onSelect: (item) => { if (item.data) onModelRowClick(item.data as LibraryModel); },
            onEnterFolder: (path) => {
                const stack = targetStack || stackRegistry.modelStack;
                if (stack) {
                    const folderLabel = allResourceItems.find((fi) => fi.id === path)?.label || getBaseName(path) || path;
                    stack.push(buildLevel(path, folderLabel, filter, targetStack));
                }
            },
            layout: 'grid',
        });
    });
}

// ======== 构建层级 ========

export function buildLevel(
    dir: string, label: string, filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu, extraFolders?: { label: string; path: string }[]
): PopupLevel {
    dir = normPath(dir);
    const isRoot = filter ? false : normPath(libraryRoot) === dir;
    const items: PopupRow[] = [];
    const subdirs = new Set<string>();
    const subdirIsLeaf = new Set<string>();
    const modelList = allModels || [];
    const pmxPaths = modelList.filter((m) => !filter || filter(m)).map((m) => m.file_path).filter(Boolean) as string[];
    if (pmxPaths.length > 0) ensureModelMeta(pmxPaths);
    for (const m of modelList) {
        if (filter && !filter(m)) continue;
        const mdir = normPath(m.dir);
        const rel = getRelativePathUnderDir(mdir, dir);
        if (rel === null) continue;
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) {
            items.push(modelToRow(m));
        } else {
            subdirs.add(parts[0]);
            if (parts.length === 1) subdirIsLeaf.add(parts[0]);
        }
    }
    for (const d of Array.from(subdirs).sort()) {
        const fullPath = dir + '/' + d;
        if (subdirIsLeaf.has(d) && !isRoot && isLeafFlattenDir(fullPath, modelList, filter)) {
            for (const m of modelList) {
                if (filter && !filter(m)) continue;
                if (normPath(m.dir) === fullPath) items.push(modelToRow(m));
            }
            continue;
        }
        items.unshift({ kind: 'folder', label: d, icon: 'folder', target: fullPath, wrapLabel: true });
    }
    if (extraFolders) {
        for (const ef of extraFolders) items.unshift({ kind: 'folder', label: ef.label, icon: 'plug', target: ef.path });
    }
    if (librarySortMode === 'name') {
        items.sort((a, b) => a.label.localeCompare(b.label, getLang()));
    }
    return {
        label, dir, items: [], filter,
        renderCustom: (container) => {
            const resourceItems = buildResourceItemsForDir(dir, filter);
            if (resourceViewMode === 'grid') {
                renderGridMode(container, dir, items, filter, targetStack);
            } else {
                addListViewToolbar(container, dir, items, filter, targetStack, resourceItems);
                renderItemsWithRAF(container, items, filter, targetStack);
            }
        },
    };
}

// ======== 根级菜单项 ========

export function buildModelRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    const actors = Array.from(modelRegistry.entries()).filter(([, inst]) => inst.kind === 'actor');
    for (const [id, inst] of actors) {
        const isFocused = focusedModelId === id;
        const radioIcon = isFocused ? 'lucide:check-circle' : 'lucide:circle';
        items.push({
            kind: 'action', label: inst.name, icon: radioIcon, target: `scene:${id}`, wrapLabel: true,
            focused: isFocused, rowKey: 'actor:' + id + (isFocused ? ':on' : ':off'),
            leading: { icon: radioIcon, title: t('library.focusModel'), onClick: () => { focusModel(id); refreshModelRoot(); } },
            trailing: { icon: 'lucide:settings-2', title: t('library.modelTools'), onClick: () => { stackRegistry.modelStack?.push(buildModelToolsLevel(id)); } },
        });
    }
    if (actors.length > 0) items.push({ kind: 'divider', label: '', icon: '', target: '' });
    items.push({ kind: 'folder', label: t('library.loadModel'), icon: 'lucide:folder', target: 'models:browse' });
    items.push({ kind: 'action', label: t('library.importFile'), icon: 'lucide:file-plus', target: 'models:import-file' });
    items.push({ kind: 'action', label: t('library.rescan'), icon: 'lucide:refresh-cw', target: 'models:rescan' });
    items.push({ kind: 'folder', label: t('library.recent'), icon: 'lucide:clock', target: '__recent__' });
    items.push({ kind: 'folder', label: t('library.tags'), icon: 'lucide:tag', target: '__tags__' });
    return items;
}

export function refreshModelRoot(): void {
    const stack = stackRegistry.modelStack;
    if (!stack) return;
    stack.setLevel(0, { label: t('library.model'), dir: '', items: buildModelRootItems(), itemBuilder: buildModelRootItems });
}

// Register buildLevel for use by motion-popup.ts (avoids circular import)
stackRegistry.buildLevel = buildLevel;

// ======== Re-exports（向后兼容，外部通过 library-core 或 library 导入）========

export { showModelPopup } from './library-browse';
export { importFile, prepareModelRestore } from './library-actions';
export { initLibrary, selectResourceRoot, selectOverridePath, switchStorageMode, rescanAndSync, reloadConfig, refreshLibrary } from './library-setup';