// [doc:architecture] Library Actions — 模型加载/替换/标签/缩略图
// 从 library-core.ts 拆分

import {
    setStatus,
    allModels,
    LibraryModel,
    PopupLevel,
    normPath,
    modelMetaCache,
    setModelMetaCache,
    closeAllOverlays,
    modelRegistry,
    focusedModelId,
    recentModels,
    setRecentModels,
    computeLibraryRef,
    cardContainer,
    formatError,
    stackRegistry,
} from '../core/config';
import { loadManager } from '../core/load-manager';
import {
    removeModel,
    loadVPDPose,
    triggerAutoSave,
    pushUndoSnapshot,
    offerSceneUndoAndRefresh,
} from '../scene/scene';
import { captureInheritedState, applyInheritedState } from '../scene/manager/model-ops'; // [doc:adr-150]
import { getMotionMenu } from './motion-popup';
import { slideRow } from '../core/ui-helpers';
import { addDisposableListener, type Disposable } from '../core/dom';
import {
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
    withLoadingStatus,
    getBrowseDir,
    isUnderRoot,
    getBaseName,
    logWarn,
    isStageLike,
} from '../core/utils';
import { safeCallAsync } from '@/core/safe-call';
import { t } from '../core/i18n/t';
import { createIconifyIcon } from '../core/icons';
import {
    buildLevel,
    modelToRow,
    thumbnailKeyForModel,
    splitSubdirSegments,
    computeRestoreSegments,
    getPendingMetaGuard,
    resolveDisplayBrowseDir,
    loadThumbnailsStreaming,
} from './library-core';
import { librarySessionStore } from './library-session-store';

// ======== 模块级状态 ========
// [doc:adr-135] 加载守卫状态已迁入 LibrarySessionStore 单例。
// - extraction：原 _isExtracting，解压进行中标记（per-model 升级归 P1.2）
// - replaceLoading：原 _isReplaceLoading，链式替换加载中标记

// mmku:modelLoaded 事件：模型加载完成后刷新模型库弹窗根级列表
// 用命名函数 + 模块级引用，支持 HMR 幂等清理
let _mmkuDisp: Disposable | null = null;
function _onModelLoaded(): void {
    if (librarySessionStore.isReplaceLoading()) {
        return;
    }
    // 懒加载避免循环依赖
    import('../core/config').then(({ dom, stackRegistry }) => {
        if (
            dom.sceneOverlay.classList.contains('visible') &&
            dom.sceneOverlay.dataset.popupType === 'model'
        ) {
            const stack = stackRegistry.modelStack;
            if (stack) {
                import('./library-core').then(({ buildModelRootItems }) => {
                    stack.setLevel(0, {
                        label: t('library.model'),
                        dir: '',
                        items: buildModelRootItems(),
                        itemBuilder: buildModelRootItems,
                    });
                    stack.reRender();
                });
            }
        }
    });
}
// 先移除旧监听器再注册，确保 HMR 重载不重复绑定
_mmkuDisp?.dispose();
_mmkuDisp = addDisposableListener(document, 'mmku:modelLoaded', _onModelLoaded);

// ======== 缩略图 ========

export async function loadThumbnailsForLevel(
    level: PopupLevel,
    signal?: AbortSignal
): Promise<void> {
    const items = level.items.filter((r) => r.kind === 'model' && r.model);
    const keys = items.map((r) => thumbnailKeyForModel(r.model!));
    if (keys.length === 0) {
        return;
    }
    // 流式加载：逐张出现，不阻塞 UI。[adr-136] 透传外部取消信号
    await safeCallAsync('library-actions', 'loadThumbnailsForLevel:', () =>
        loadThumbnailsStreaming(keys, signal)
    );
}

export async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
    const guard = getPendingMetaGuard();
    const uncached = pmxPaths.filter((p) => !modelMetaCache.has(p) && !guard.isLoading(p));
    if (uncached.length === 0) {
        return;
    }
    for (const p of uncached) {
        guard.tryEnter(p);
    }
    try {
        const batch = await GetModelMetaBatch(uncached);
        if (batch) {
            const merged = new Map(modelMetaCache);
            for (const [path, meta] of Object.entries(batch)) {
                merged.set(path, meta);
            }
            setModelMetaCache(merged);
        }
    } catch (err) {
        logWarn('library-actions', 'ensureModelMeta:', err);
    } finally {
        for (const p of uncached) {
            guard.leave(p);
        }
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
    // [fix] allModels 为空时跳过恢复：扫描未完成或扫描失败，restore 必然失败
    if (!allModels || allModels.length === 0) {
        librarySessionStore.setPendingAutoExpand(null);
        librarySessionStore.setPendingFocusModel(null);
        return;
    }
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
        if (lastDir) {
            restoreTarget = normPath(lastDir);
        }
    }
    if (restoreTarget) {
        const fullSegs = splitSubdirSegments(browseDir, restoreTarget);
        if (fromRecentModel) {
            const result = computeRestoreSegments(
                browseDir,
                restoreTarget,
                allModels,
                categoryFilter
            );
            librarySessionStore.setPendingAutoExpand(result && result.length > 0 ? result : null);
        } else {
            librarySessionStore.setPendingAutoExpand(
                fullSegs && fullSegs.length > 0 ? fullSegs : null
            );
        }
    } else {
        librarySessionStore.setPendingAutoExpand(null);
    }
    librarySessionStore.setPendingFocusModel(
        focusModel
            ? { dir: normPath(focusModel.dir), rowKey: 'model:' + focusModel.file_path }
            : null
    );
}

// ======== 模型行点击 ========

/** 记录最近使用的模型（用于历史列表）。 */
function recordRecentModel(m: LibraryModel): void {
    const ref = computeLibraryRef(m.file_path);
    if (ref) {
        safeCallAsync('library-actions', 'AddRecentModel failed:', () => AddRecentModel(ref));
        setRecentModels([ref, ...recentModels.filter((r) => r !== ref)].slice(0, 20));
    }
}

/** 记忆浏览目录：使用户下次打开资源库能回到当前位置。 */
function recordBrowseDir(m: LibraryModel): void {
    const memCat: 'pmx' | 'stage' | 'prop' =
        m.type === 'prop' ? 'prop' : m.type === 'stage' || m.type === 'scene' ? 'stage' : 'pmx';
    void safeCallAsync('library-actions', 'SetLastBrowseDir failed:', () =>
        SetLastBrowseDir(memCat, resolveDisplayBrowseDir(m, memCat))
    );
}

/** 替换模式入口：加载新模型 → 移除旧模型 → 导航到浏览层。 */
function startReplaceModel(m: LibraryModel, replaceId: string): void {
    // 取消上一次 loadManager 请求，避免快速连点竞态（与 loadModelNormal 共享同一模块级 AbortController）
    if (_loadManagerAbortCtrl) {
        _loadManagerAbortCtrl.abort();
    }
    const ctrl = new AbortController();
    _loadManagerAbortCtrl = ctrl;
    const signal = ctrl.signal;

    librarySessionStore.setReplaceLoading(true);

    const doReplace = (path: string, libraryPath?: string, innerPath?: string): void => {
        // [doc:adr-150] 替换前捕获旧模型可继承状态 + 场景撤销快照
        const oldInst = modelRegistry.get(replaceId);
        const snapshot = oldInst ? captureInheritedState(oldInst) : null;
        const undoSnap = pushUndoSnapshot();
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
            .load({ kind: loadKind, path, libraryPath, innerPath }, signal)
            .then(async (handle) => {
                if (!handle?.id) {
                    stackRegistry.modelStack?.reRender();
                    setStatus(t('library.modelLoadFailed'), false);
                    return;
                }
                // [doc:adr-150] 在 removeModel 旧模型之前应用继承状态（此时新模型已注册，
                // 焦点已由 model-loader 切换；旧模型 inst 仍可查询）
                if (snapshot) {
                    applyInheritedState(handle.id, snapshot);
                }
                removeModel(replaceId);
                // [doc:adr-127] 破坏性操作场景级撤销保护
                offerSceneUndoAndRefresh(
                    t('model-detail.replaced'),
                    undoSnap,
                    () => stackRegistry.modelStack?.reRender()
                );
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
                    // [doc:adr-131] 替换模式自动跳转收敛为契约实例：声明 jumpToDir outcome，
                    // 后续在该浏览层选中模型时由 activateItem/onItemClick 按 outcome 派发。
                    stackRegistry.modelStack?.push(
                        buildLevel(
                            getBrowseDir(browseCategory),
                            t('model-detail.replaceModelTo', { name: newName }),
                            filter,
                            stackRegistry.modelStack!,
                            [],
                            { mode: 'jumpToDir', modelId: handle.id }
                        )
                    );
                    setStatus(t('status.done'), true);
                } catch (uiErr) {
                    logWarn('library-actions', 'replace UI navigation failed', uiErr);
                    setStatus(t('status.done'), true);
                }
            })
            .catch((err) => {
                setStatus(t('library.modelLoadFailed') + formatError(err), false);
                stackRegistry.modelStack?.reRender();
            })
            .finally(() => {
                librarySessionStore.setReplaceLoading(false);
                if (_loadManagerAbortCtrl === ctrl) {
                    _loadManagerAbortCtrl = null;
                }
            });
    };

    if (m.container === 'zip') {
        setStatus(t('library.extractingZip'), false);
        librarySessionStore.setExtracting(m.file_path);
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? t('library.cacheHit') : t('library.extracted'), true);
                doReplace(result.file_path, m.file_path, m.zip_inner);
            })
            .catch((err) => {
                librarySessionStore.setReplaceLoading(false);
                setStatus(t('library.extractFailed') + formatError(err), false);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
            });
    } else {
        doReplace(m.file_path);
    }
}

/** [adr-143] 模块级 AbortController：用户快速连点新模型时，取消上一个 loadManager.load()。
 * 与 model-loader 内部的 _loadAbortController 互补：此处取消队列级请求，后者取消底层解析。 */
let _loadManagerAbortCtrl: AbortController | null = null;

/** 正常加载模式：zip 提取后加载，或按格式直接加载。 */
function loadModelNormal(m: LibraryModel, isStage: boolean): void {
    // 取消上一次 loadManager 请求，避免快速连点竞态
    if (_loadManagerAbortCtrl) {
        _loadManagerAbortCtrl.abort();
    }
    const ctrl = new AbortController();
    _loadManagerAbortCtrl = ctrl;
    const signal = ctrl.signal;

    if (m.container === 'zip') {
        closeAllOverlays();
        setStatus(t('library.extractingZip'), false);
        librarySessionStore.setExtracting(m.file_path);
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? t('library.cacheHit') : t('library.extracted'), true);
                if (m.format === 'vmd') {
                    loadManager
                        .load({ kind: 'vmd', path: result.file_path }, signal)
                        .catch((err) =>
                            setStatus(t('library.modelLoadFailed') + formatError(err), false)
                        );
                } else {
                    loadManager
                        .load(
                            {
                                kind: isStage ? 'stage' : 'actor',
                                path: result.file_path,
                                libraryPath: m.file_path,
                                innerPath: m.zip_inner,
                            },
                            signal
                        )
                        .then((handle) => {
                            if (!handle) {
                                setStatus(t('library.modelLoadFailed'), false);
                            }
                        })
                        .catch((err) => {
                            setStatus(t('library.modelLoadFailed') + formatError(err), false);
                        });
                }
            })
            .catch((err) => {
                setStatus(t('library.extractFailed') + formatError(err), false);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
                // 清理模块级 ctrl（当前请求已走完，允许下次新建）
                if (_loadManagerAbortCtrl === ctrl) {
                    _loadManagerAbortCtrl = null;
                }
            });
        return;
    }
    closeAllOverlays();
    if (m.format === 'pmx') {
        loadManager
            .load({ kind: isStage ? 'stage' : 'actor', path: m.file_path }, signal)
            .then((handle) => {
                if (!handle) {
                    setStatus(t('library.modelLoadFailed'), false);
                }
            })
            .catch((err) => setStatus(t('library.modelLoadFailed') + formatError(err), false));
    } else if (m.format === 'vmd') {
        loadManager
            .load({ kind: 'vmd', path: m.file_path }, signal)
            .then((handle) => {
                if (!handle) {
                    setStatus(t('library.modelLoadFailed'), false);
                }
            })
            .catch((err) => setStatus(t('library.modelLoadFailed') + formatError(err), false));
    } else if (m.format === 'audio') {
        loadManager
            .load({ kind: 'audio', path: m.file_path }, signal)
            .then((handle) => {
                if (!handle) {
                    setStatus(t('library.modelLoadFailed'), false);
                }
            })
            .catch((err) => setStatus(t('library.modelLoadFailed') + formatError(err), false));
    } else if (m.format === 'vpd') {
        loadVPDPose(m.file_path);
    }
}

function onModelRowClick(m: LibraryModel, jumpToDirModelId?: string): void {
    // [doc:adr-135] P1.2: per-model 守卫。zip A 解压时 pmx B 直接放行，不再被一刀切阻塞。
    if (librarySessionStore.isExtracting(m.file_path)) {
        setStatus(t('library.extracting'), false);
        return;
    }
    if (librarySessionStore.isReplaceLoading()) {
        setStatus(t('library.loadingModel'), false);
        return;
    }
    // [doc:adr-131] 由 replaceModel 传参取代 mutation of currentLevel.outcome
    const replaceId = jumpToDirModelId;
    const isStage = isStageLike(m.type);
    const isActor = m.format === 'pmx' && !isStage;
    if (m.format === 'pmx') {
        recordRecentModel(m);
    }

    // [修复] 记忆"显示目录"为上次浏览目录
    if (m.format === 'pmx') {
        recordBrowseDir(m);
    }

    // ===== Replace mode =====
    if (replaceId && isActor) {
        startReplaceModel(m, replaceId);
        return;
    }

    // ===== Normal mode =====
    loadModelNormal(m, isStage);
}

function replaceModel(m: LibraryModel): void {
    const _isActor =
        m.format === 'pmx' && m.type !== 'stage' && m.type !== 'scene' && m.type !== 'prop';
    // [doc:adr-131] 传参取代 mutation of currentLevel.outcome
    onModelRowClick(m, focusedModelId ?? undefined);
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
    if (librarySessionStore.isReplaceLoading()) {
        setStatus(t('library.loadingModel'), false);
        return;
    }
    closeAllOverlays();
    const targetId = focusedModelId;
    const motionName = m.name_jp || m.name_en || getBaseName(m.file_path).replace(/\.vmd$/i, '');
    const doLoad = async (path: string): Promise<void> => {
        // [adr-169] 原位替换默认动作是破坏性操作（旧默认被移除）：操作前快照，成功后提供撤销
        const snap = pushUndoSnapshot();
        await withLoadingStatus('library.loadingMotion', 'status.done', () =>
            loadManager.load({ kind: 'vmd', path, modelId: targetId })
        );
        triggerAutoSave();
        offerSceneUndoAndRefresh(t('motion.motionReplaced', { name: motionName }), snap, () =>
            getMotionMenu()?.reRender()
        );
    };
    if (m.container === 'zip') {
        librarySessionStore.setExtracting(m.file_path);
        withLoadingStatus('library.extractingZip', 'library.extracted', () =>
            ExtractZip(m.file_path, m.zip_inner)
        )
            .then(async (result) => {
                if (!result) {
                    return;
                }
                await doLoad(result.file_path);
            })
            .catch((err) => {
                setStatus(t('library.extractFailed') + formatError(err), false);
            })
            .finally(() => {
                librarySessionStore.clearExtracting(m.file_path);
            });
        return;
    }
    void doLoad(m.file_path);
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
                    if (fe) {
                        fe.style.color = 'var(--accent)';
                        fi.appendChild(fe);
                    }
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
                        slideRow(
                            c,
                            row.icon,
                            row.label,
                            false,
                            () => onModelRowClick(m),
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            { wrapLabel: true }
                        );
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
        const msg =
            err instanceof Error
                ? err.message
                : err && typeof err === 'object' && 'message' in err
                  ? String((err as { message: unknown }).message)
                  : String(err);
        if (/cancelled by user/i.test(msg)) {
            return;
        }
        setStatus(t('library.selectFileFailed') + formatError(err), false);
        return;
    }
    if (!path) {
        return;
    }
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        const imported = await withLoadingStatus(
            'library.importingZip',
            'library.zipImported',
            () => ImportZip(path)
        );
        if (!imported) {
            return;
        }
        const { refreshLibrary } = await import('./library-setup');
        await safeCallAsync('library-actions', 'refresh after zip import:', () => refreshLibrary());
    } else if (lower.endsWith('.pmx')) {
        await withLoadingStatus('library.loadingModel', 'status.done', () =>
            loadManager.load({ kind: 'actor', path })
        );
    } else if (lower.endsWith('.vmd')) {
        await withLoadingStatus('library.loadingMotion', 'status.done', () =>
            loadManager.load({ kind: 'vmd', path })
        );
    } else {
        setStatus(t('library.unsupportedFormat'), false);
    }
}

// ======== 供 library-browse 使用的内部函数 ========

export {
    onModelRowClick,
    replaceModel,
    replaceMotion,
    buildTagsOverviewLevel,
    buildTagDetailLevel,
    highlightRow,
};
