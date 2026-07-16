// [doc:architecture] Library Actions — 模型加载/替换/标签/缩略图
// 从 library-core.ts 拆分

import {
    setStatus,
    allModels,
    LibraryModel,
    PopupLevel,
    PopupRow,
    normPath,
    thumbnailCache,
    setThumbnailCache,
    modelMetaCache,
    setModelMetaCache,
    closeAllOverlays,
    modelRegistry,
    focusedModelId,
    recentModels,
    setRecentModels,
    computeLibraryRef,
    modelReplaceTargetId,
    setModelReplaceTargetId,
    cardContainer,
    formatError,
    setPendingVmd,
    stackRegistry,
} from '../core/config';
import { loadManager } from '../core/load-manager';
import { removeModel } from '../scene/scene';
import { loadVPDPose } from '../scene/scene';
import { slideRow } from '../core/ui-helpers';
import {
    GetThumbnailBatch,
    GetModelMetaBatch,
    AddRecentModel,
    ExtractZip,
    GetAllTags,
    GetModelsByTag,
    SelectImportFile,
    ImportZip,
    GetLastBrowseDir,
    SetLastBrowseDir,
} from '../core/wails-bindings';
import {
    tryCatchStatus,
    getBrowseDir,
    isUnderRoot,
    getBaseName,
    logWarn,
    isStageLike,
    LoadingGuard,
} from '../core/utils';
import { showConfirm } from '../core/dialog';
import { t } from '../core/i18n/t';
import { createIconifyIcon } from '../core/icons';
import { buildLevel, modelToRow, modelToResourceItem, thumbnailKeyForModel, buildResourceItemsForDir, buildModelRootItems, splitSubdirSegments, computeRestoreSegments, getPendingAutoExpand, setPendingAutoExpand, getPendingFocusModel, setPendingFocusModel, getPendingMetaGuard, resolveDisplayBrowseDir } from './library-core';

// ======== 模块级状态 ========

let _isExtracting = false;
/** 链式替换加载中标记：阻止mmku:modelLoaded事件自动重置菜单 */
let _isReplaceLoading = false;

// mmku:modelLoaded 事件：模型加载完成后刷新模型库弹窗根级列表
// 用命名函数 + 模块级引用，支持 HMR 幂等清理
let _mmkuHandler: (() => void) | null = null;
function _onModelLoaded(): void {
    if (_isReplaceLoading) return;
    // 懒加载避免循环依赖
    import('../core/config').then(({ dom, stackRegistry }) => {
        if (dom.sceneOverlay.classList.contains('visible') && dom.sceneOverlay.dataset.popupType === 'model') {
            const stack = stackRegistry.modelStack;
            if (stack) {
                import('./library-core').then(({ buildModelRootItems }) => {
                    stack.setLevel(0, { label: t('library.model'), dir: '', items: buildModelRootItems(), itemBuilder: buildModelRootItems });
                    stack.reRender();
                });
            }
        }
    });
}
// 先移除旧监听器再注册，确保 HMR 重载不重复绑定
if (_mmkuHandler) {
    document.removeEventListener('mmku:modelLoaded', _mmkuHandler);
}
_mmkuHandler = _onModelLoaded;
document.addEventListener('mmku:modelLoaded', _mmkuHandler);

// ======== 缩略图 ========

export async function loadThumbnailsForLevel(level: PopupLevel): Promise<void> {
    const items = level.items.filter((r) => r.kind === 'model' && r.model);
    const keys = items.map((r) => thumbnailKeyForModel(r.model!));
    if (keys.length === 0) return;
    try {
        const batch = await GetThumbnailBatch(keys);
        const merged = new Map(thumbnailCache);
        for (const [k, v] of Object.entries(batch)) merged.set(k, v);
        setThumbnailCache(merged);
    } catch (err) {
        logWarn('library-actions', 'loadThumbnailsForLevel:', err);
    }
}

export async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
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
        logWarn('library-actions', 'ensureModelMeta:', err);
    } finally {
        for (const p of uncached) guard.leave(p);
    }
}

// ======== 模型恢复（上次浏览目录高亮）========

function highlightRow(root: HTMLElement, rowKey: string): void {
    const list = (root.querySelector('.slide-list') ?? root) as HTMLElement;
    const rows = Array.from(list.querySelectorAll('.slide-item')) as HTMLElement[];
    rows.forEach((r) => r.classList.remove('slide-focused'));
    const el = rows.find((r) => r.dataset.rowKey === rowKey);
    if (el) {
        el.classList.add('slide-focused');
        el.scrollIntoView({ block: 'nearest' });
    } else if (import.meta.env.DEV) {
        logWarn('restore', 'focus row not found:', rowKey);
    }
}

export async function prepareModelRestore(
    browseDir: string,
    category: 'pmx' | 'stage' | 'prop'
): Promise<void> {
    let restoreTarget: string | null = null;
    let focusModel: LibraryModel | null = null;
    let fromRecentModel = false;
    const categoryFilter = (m: LibraryModel) => m.format === category;
    for (const ref of recentModels) {
        const m = allModels.find(
            (x) => x.format === category && computeLibraryRef(x.file_path) === ref
        );
        if (m && isUnderRoot(browseDir, m.dir)) {
            restoreTarget = normPath(m.dir);
            focusModel = m;
            fromRecentModel = true;
            break;
        }
    }
    if (!restoreTarget) {
        const lastDir = await GetLastBrowseDir(category);
        if (lastDir) restoreTarget = normPath(lastDir);
    }
    if (restoreTarget) {
        const fullSegs = splitSubdirSegments(browseDir, restoreTarget);
        if (fromRecentModel) {
            const result = computeRestoreSegments(browseDir, restoreTarget, allModels, categoryFilter);
            setPendingAutoExpand(result && result.length > 0 ? result : null);
        } else {
            setPendingAutoExpand(fullSegs && fullSegs.length > 0 ? fullSegs : null);
        }
    } else {
        setPendingAutoExpand(null);
    }
    setPendingFocusModel(focusModel
        ? { dir: normPath(focusModel.dir), rowKey: 'model:' + focusModel.file_path }
        : null);
}

// ======== 模型行点击 ========

function onModelRowClick(m: LibraryModel): void {
    if (_isExtracting) {
        setStatus(t('library.extracting'), false);
        return;
    }
    if (_isReplaceLoading) {
        setStatus(t('library.loadingModel'), false);
        return;
    }
    const replaceId = modelReplaceTargetId;
    const isStage = isStageLike(m.type);
    const isActor = m.format === 'pmx' && !isStage;
    if (m.format === 'pmx') {
        const ref = computeLibraryRef(m.file_path);
        if (ref) {
            AddRecentModel(ref).catch((err) =>
                logWarn('library-actions', 'AddRecentModel failed:', err)
            );
            setRecentModels([ref, ...recentModels.filter((r) => r !== ref)].slice(0, 20));
        }
    }

    // [修复] 记忆"显示目录"为上次浏览目录：点击模型即记录其可见层级，
    // 使下次打开资源库能回到用户点击时所处位置（单 pmx 叶子目录被展平时回退到根目录）。
    if (m.format === 'pmx') {
        const memCat: 'pmx' | 'stage' | 'prop' =
            m.type === 'prop' ? 'prop' : (m.type === 'stage' || m.type === 'scene') ? 'stage' : 'pmx';
        void SetLastBrowseDir(memCat, resolveDisplayBrowseDir(m, memCat)).catch((e) =>
            logWarn('library-actions', 'SetLastBrowseDir failed:', e)
        );
    }

    // ===== Replace mode =====
    if (replaceId && isActor) {
        setPendingVmd(null);
        _isReplaceLoading = true;

        const doReplace = (path: string, libraryPath?: string): void => {
            setStatus(t('library.loadingModel'), false);
            let browseCategory: 'pmx' | 'stage' | 'prop' = 'pmx';
            let loadKind: 'actor' | 'stage' | 'prop' = 'actor';
            let filter: (model: LibraryModel) => boolean = (model) => model.format === 'pmx';
            if (m.type === 'prop') {
                browseCategory = 'prop';
                loadKind = 'prop';
                filter = (model) => model.type === 'prop';
            } else if (m.type === 'stage' || m.type === 'scene') {
                browseCategory = 'stage';
                loadKind = 'stage';
                filter = (model) => model.type === 'stage' || model.type === 'scene';
            }

            loadManager
                .load({ kind: loadKind, path, libraryPath })
                .then(async (handle) => {
                    if (!handle?.id) {
                        setModelReplaceTargetId(replaceId);
                        stackRegistry.modelStack?.reRender();
                        setStatus(t('library.modelLoadFailed'), false);
                        return;
                    }
                    removeModel(replaceId);
                    setModelReplaceTargetId(handle.id);
                    try {
                        stackRegistry.modelStack?.resetToRoot();
                        let newName = handle.name;
                        if (loadKind === 'prop') {
                            const { propRegistry } = await import('../core/config');
                            newName = propRegistry.get(handle.id)?.name ?? handle.name;
                        } else {
                            newName = modelRegistry.get(handle.id)?.name ?? handle.name;
                        }
                        await prepareModelRestore(getBrowseDir(browseCategory), browseCategory);
                        stackRegistry.modelStack?.push(
                            buildLevel(
                                getBrowseDir(browseCategory),
                                t('model-detail.replaceModelTo', { name: newName }),
                                filter,
                                stackRegistry.modelStack!,
                                []
                            )
                        );
                        setStatus(t('status.done'), true);
                    } catch (uiErr) {
                        logWarn('library-actions', 'replace UI navigation failed', uiErr);
                        setStatus(t('status.done'), true);
                    }
                })
                .catch((err) => {
                    setModelReplaceTargetId(replaceId);
                    setStatus(t('library.modelLoadFailed') + formatError(err), false);
                    stackRegistry.modelStack?.reRender();
                })
                .finally(() => { _isReplaceLoading = false; });
        };

        if (m.container === 'zip') {
            setStatus(t('library.extractingZip'), false);
            _isExtracting = true;
            ExtractZip(m.file_path, m.zip_inner)
                .then((result) => {
                    setStatus(result.cached ? t('library.cacheHit') : t('library.extracted'), true);
                    doReplace(result.file_path, m.file_path);
                })
                .catch((err) => {
                    _isReplaceLoading = false;
                    setModelReplaceTargetId(replaceId);
                    setStatus(t('library.extractFailed') + formatError(err), false);
                })
                .finally(() => { _isExtracting = false; });
        } else {
            doReplace(m.file_path);
        }
        return;
    }

    // ===== Normal mode =====
    if (m.container === 'zip') {
        closeAllOverlays();
        setStatus(t('library.extractingZip'), false);
        _isExtracting = true;
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? t('library.cacheHit') : t('library.extracted'), true);
                if (m.format === 'vmd') {
                    loadManager.load({ kind: 'vmd', path: result.file_path });
                } else {
                    loadManager.load({
                        kind: isStage ? 'stage' : 'actor',
                        path: result.file_path,
                        libraryPath: m.file_path,
                        innerPath: m.zip_inner,
                    });
                }
            })
            .catch((err) => {
                setStatus(t('library.extractFailed') + formatError(err), false);
            })
            .finally(() => { _isExtracting = false; });
        return;
    }
    closeAllOverlays();
    if (m.format === 'pmx') {
        loadManager.load({ kind: isStage ? 'stage' : 'actor', path: m.file_path });
    } else if (m.format === 'vmd') {
        loadManager.load({ kind: 'vmd', path: m.file_path });
    } else if (m.format === 'audio') {
        loadManager.load({ kind: 'audio', path: m.file_path });
    } else if (m.format === 'vpd') {
        loadVPDPose(m.file_path);
    }
}

function replaceModel(m: LibraryModel): void {
    const isActor = m.format === 'pmx' && m.type !== 'stage' && m.type !== 'scene' && m.type !== 'prop';
    if (!modelReplaceTargetId && focusedModelId && isActor) {
        setModelReplaceTargetId(focusedModelId);
    }
    onModelRowClick(m);
}

// 网格模式点击动作（VMD）时触发：替换聚焦模型的当前基础动作。
// 与 replaceModel 对称——模型点击替换模型，动作点击替换动作。
function replaceMotion(m: LibraryModel): void {
    if (m.format !== 'vmd') {
        replaceModel(m);
        return;
    }
    if (!focusedModelId) {
        // 无聚焦模型：退化为普通加载（缓存待应用）
        onModelRowClick(m);
        return;
    }
    if (_isReplaceLoading) {
        setStatus(t('library.loadingModel'), false);
        return;
    }
    closeAllOverlays();
    const targetId = focusedModelId;
    const doLoad = (path: string): void => {
        loadManager
            .load({ kind: 'vmd', path, modelId: targetId })
            .then(() => setStatus(t('status.done'), true))
            .catch((err) => setStatus(t('library.vmdLoadFailed') + formatError(err), false));
    };
    if (m.container === 'zip') {
        setStatus(t('library.extractingZip'), false);
        _isExtracting = true;
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? t('library.cacheHit') : t('library.extracted'), true);
                doLoad(result.file_path);
            })
            .catch((err) => setStatus(t('library.extractFailed') + formatError(err), false))
            .finally(() => { _isExtracting = false; });
        return;
    }
    doLoad(m.file_path);
}

// ======== 标签 ========

function buildTagsOverviewLevel(): PopupLevel {
    return {
        label: t('library.tags'),
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            try {
                const favRefs = await GetModelsByTag('收藏');
                const tags = await GetAllTags();
                const regularTags = tags ? tags.filter((t) => t !== '收藏') : [];

                cardContainer(container, (c) => {
                    const favRow = document.createElement('div');
                    favRow.className = 'slide-item';
                    const fi = document.createElement('span');
                    fi.className = 'slide-icon';
                    const fe = createIconifyIcon('lucide:star');
                    if (fe) { fe.style.color = 'var(--accent)'; fi.appendChild(fe); }
                    favRow.appendChild(fi);
                    const fl = document.createElement('span');
                    fl.className = 'slide-label';
                    fl.textContent = t('library.favorites');
                    favRow.appendChild(fl);
                    const fs = document.createElement('span');
                    fs.className = 'slide-sublabel';
                    fs.textContent = t('library.favCount', { n: favRefs ? favRefs.length : 0 });
                    favRow.appendChild(fs);
                    const fa = document.createElement('span');
                    fa.className = 'slide-arrow';
                    fa.textContent = '>';
                    favRow.appendChild(fa);
                    favRow.addEventListener('click', () =>
                        stackRegistry.modelStack.push(buildTagDetailLevel('收藏'))
                    );
                    c.appendChild(favRow);

                    for (const tag of regularTags) {
                        slideRow(c, 'lucide:tag', tag, true, () =>
                            stackRegistry.modelStack.push(buildTagDetailLevel(tag))
                        );
                    }
                    if (regularTags.length === 0) {
                        const em = document.createElement('div');
                        em.className = 'slide-empty';
                        em.textContent = t('library.noOtherTags');
                        c.appendChild(em);
                    }
                });
                cardContainer(container, (c) => {
                    slideRow(c, 'lucide:plus', t('library.newTag'), false, () => {
                        setStatus(t('library.addTagHint'), false);
                        stackRegistry.modelStack.pop();
                    });
                });
            } catch (err) {
                logWarn('library-actions', 'buildTagsOverviewLevel:', err);
                container.textContent = t('library.loadTagsFailed');
            }
        },
    };
}

function buildTagDetailLevel(tagName: string): PopupLevel {
    return {
        label: t('library.tagDetail', { name: tagName }),
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            try {
                const modelRefs = await GetModelsByTag(tagName);
                if (!modelRefs || modelRefs.length === 0) {
                    container.innerHTML = `<div class="slide-empty" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">${t('library.tagNoModels')}</div>`;
                    return;
                }
                const matched = (allModels || []).filter((m) => {
                    const ref = computeLibraryRef(m.file_path);
                    return ref && modelRefs.includes(ref);
                });
                if (matched.length === 0) {
                    container.innerHTML = `<div class="slide-empty" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">${t('library.tagNoMatch')}</div>`;
                    return;
                }
                cardContainer(container, (c) => {
                    for (const m of matched) {
                        const row = modelToRow(m);
                        slideRow(c, row.icon, row.label, false, () => onModelRowClick(m),
                            undefined, undefined, undefined, undefined, { wrapLabel: true });
                    }
                });
            } catch (err) {
                logWarn('library-actions', 'buildTagDetailLevel:', err);
                container.textContent = t('library.loadFailed');
            }
        },
    };
}

// ======== 导入文件 ========

export async function importFile(): Promise<void> {
    let path: string;
    try {
        path = await SelectImportFile();
    } catch (err) {
        const msg = err instanceof Error ? err.message
            : err && typeof err === 'object' && 'message' in err
                ? String((err as { message: unknown }).message) : String(err);
        if (/cancelled by user/i.test(msg)) return;
        setStatus(t('library.selectFileFailed') + formatError(err), false);
        return;
    }
    if (!path) return;
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        setStatus(t('library.importingZip'), false);
        try {
            await ImportZip(path);
            setStatus(t('library.zipImported'), true);
            const { refreshLibrary } = await import('./library-setup');
            await refreshLibrary().catch((err) => logWarn('library-actions', 'refresh after zip import:', err));
        } catch (err) {
            setStatus(t('library.importFailed') + formatError(err), false);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus(t('library.loadingModel'), false);
        try { await loadManager.load({ kind: 'actor', path }); }
        catch (err) { setStatus(t('library.modelLoadFailed') + formatError(err), false); }
    } else if (lower.endsWith('.vmd')) {
        setStatus(t('library.loadingMotion'), false);
        try { await loadManager.load({ kind: 'vmd', path }); }
        catch (err) { setStatus(t('library.vmdLoadFailed') + formatError(err), false); }
    } else {
        setStatus(t('library.unsupportedFormat'), false);
    }
}

// ======== 供 library-browse 使用的内部函数 ========

export { onModelRowClick, replaceModel, replaceMotion, buildTagsOverviewLevel, buildTagDetailLevel, highlightRow };