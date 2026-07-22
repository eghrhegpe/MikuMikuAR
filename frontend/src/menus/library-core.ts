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
    uiState,
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
    libraryRoot,
    BrowseOutcome,
} from '../core/config';
import { SlideMenu } from './menu';
import { safeDispose } from '../core/dispose-helpers';
import { createIconifyIcon } from '../core/icons';
import { slideRow, createResourcePanel, openFullscreen, closeFullscreen } from '../core/ui-helpers';
import { notifyThumbnailUpdate } from '../core/ui-resource-panel';
import type { ResourceItem, SlideRowExtra, ResourcePanelHandle } from '../core/ui-helpers';
import { isUnderRoot, isStageLike, getDirPath } from '../core/utils';
import { libraryModelBaseKey, buildThumbnailKey } from '@/scene/manager/thumbnail-key';
import { t } from '../core/i18n/t';
import { getLang } from '../core/i18n/locale';
import { GetThumbnail, GetThumbnailBatch, GetModelMetaBatch } from '../core/wails-bindings';
import { loadManager } from '../core/load-manager';
import { focusModel } from '../scene/scene';
import { buildModelToolsLevel } from './model-detail';
import {
    onModelRowClick,
    replaceModel,
    replaceMotion,
    prepareModelRestore,
    importFile,
} from './library-actions';

// ======== Resource View Mode ========

export type ResourceViewMode = 'list' | 'grid';

let resourceViewMode: ResourceViewMode = 'list';

export function getResourceViewMode(): ResourceViewMode {
    return resourceViewMode;
}
export function setResourceViewMode(mode: ResourceViewMode): void {
    resourceViewMode = mode;
    import('../core/wails-bindings').then(({ SetUIState }) =>
        SetUIState({ resourceViewMode: mode } as import('../core/wails-bindings').UIState).catch(
            (err) => logWarn('library-core', 'SetUIState failed:', err)
        )
    );
}

// ======== 模型目录检测 ========

export function isModelDirTarget(target: string | undefined): boolean {
    return !!target && target.startsWith('models:');
}

// ======== 恢复状态（library-actions ↔ library-browse 共享）========
// [doc:adr-135] 状态已迁入 LibrarySessionStore 单例，调用方直接使用 store 实例。

const _pendingMetaGuard = new LoadingGuard();
export function getPendingMetaGuard(): LoadingGuard {
    return _pendingMetaGuard;
}

// ======== 路径工具 ========

export function splitSubdirSegments(rootRaw: string, dirRaw: string): string[] | null {
    const root = normPath(rootRaw);
    const dir = normPath(dirRaw);
    if (!isUnderRoot(root, dir)) {
        return null;
    }
    const rel = dir.substring(root.length + 1);
    return rel ? rel.split('/').filter(Boolean) : [];
}

export function getRelativePathUnderDir(mdirRaw: string, baseDirRaw: string): string | null {
    const mdir = normPath(mdirRaw);
    const base = normPath(baseDirRaw);
    if (!isUnderRoot(base, mdir)) {
        return null;
    }
    const rel = mdir.substring(base.length + 1);
    return rel;
}

export function isLeafFlattenDir(
    dir: string,
    modelList: LibraryModel[],
    filter?: (m: LibraryModel) => boolean
): boolean {
    const d = normPath(dir);
    let directModelCount = 0;
    let zipModelCount = 0;
    for (const m of modelList) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        if (mdir === d) {
            directModelCount++;
            if (m.container === 'zip') {
                zipModelCount++;
            }
            continue;
        }
        const rel = getRelativePathUnderDir(mdir, d);
        if (rel) {
            return false;
        } // model in subdirectory → not a leaf
    }
    // No models under this directory → not a leaf
    if (directModelCount === 0) {
        return false;
    }
    // Multiple zip-only models → keep as folder
    if (directModelCount > 1 && zipModelCount === directModelCount) {
        return false;
    }
    return true;
}

/**
 * [修复] 解析模型在资源库中的"显示目录"——即用户点击该模型时实际看到的层级。
 *
 * 单 pmx 叶子目录会被展平（isLeafFlattenDir）显示在其上层目录中，
 * 因此该模型物理位于 /X（根的子目录），但 UI 在根目录层级直接展示它。
 * 若将"记忆地址"记为 /X，下次打开会因 onLevelEnter 早退而无法回到用户所见位置；
 * 故向上回退到第一个非叶子展平目录（通常为根目录），使其与用户视线一致。
 */
export function resolveDisplayBrowseDir(
    m: LibraryModel,
    category: 'pmx' | 'stage' | 'prop'
): string {
    const root = normPath(getBrowseDir(category));
    let cur = normPath(m.dir);
    if (!root || cur === root) {
        return cur;
    }
    const list = allModels || [];
    while (isLeafFlattenDir(cur, list, undefined)) {
        const parent = getDirPath(cur);
        if (!parent || parent === cur) {
            break;
        }
        if (parent === root) {
            cur = root;
            break;
        }
        cur = parent;
    }
    return cur;
}

export function computeRestoreSegments(
    rootRaw: string,
    targetRaw: string,
    modelList: LibraryModel[],
    filter?: (m: LibraryModel) => boolean
): string[] | null {
    const root = normPath(rootRaw);
    const target = normPath(targetRaw);
    if (root === target) {
        return [];
    }
    const segs = splitSubdirSegments(root, target);
    if (!segs) {
        return null;
    }
    // 逐段检查：leaf flatten dir 可折叠（单模型目录），多模型目录保留全路径
    let current = root;
    for (let i = 0; i < segs.length; i++) {
        current = current + '/' + segs[i];
        if (isLeafFlattenDir(current, modelList, filter)) {
            const modelCount = modelList.filter(
                (m) => (!filter || filter(m)) && normPath(m.dir) === current
            ).length;
            if (modelCount <= 1) {
                return segs.slice(0, i);
            }
        }
    }
    return segs;
}

// ======== 缩略图 & 元数据 ========

export function thumbnailKeyForModel(m: LibraryModel, resolution?: number): string {
    // 统一经 thumbnail-key 模块构造，与写侧（model-loader / props）同源，杜绝双源拼接反弹。
    // 格式：`<baseKey>::<resolution>::<aspect>`，ZIP 内模型 baseKey 为 `file_path::zip_inner`。
    const baseKey = libraryModelBaseKey(m);
    const res = resolution ?? uiState.thumbnailResolution ?? 512;
    return buildThumbnailKey({ baseKey, isStage: isStageLike(m.type), resolution: res });
}

async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
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
        logWarn('library-core', 'ensureModelMeta:', err);
    } finally {
        for (const p of uncached) {
            guard.leave(p);
        }
    }
}

/**
 * 流式加载缩略图：并发控制，每加载一张立即更新缓存并通知面板刷新，
 * 替代一次性 GetThumbnailBatch 的"全等"模式，实现缩略图逐张出现。
 * 同 key 已在缓存中时跳过（不改动现有缓存）。
 */
const THUMB_STREAM_CONCURRENCY = 4;

// [adr-136] 缩略图流式加载「当前批次」控制器：每次新调用都会 abort 上一批次，
// 避免快速切换文件夹时旧的 GetThumbnail 请求堆积。
// 注：GetThumbnail 是 Wails binding，Go 侧无法真正中止；此处为「协作式取消」——
// abort 后不再派发新 worker、丢弃已拉取但未写入的过期结果，避免向已不可见的面板写缓存/通知。
let _thumbAbortController: AbortController | null = null;

/**
 * 流式加载缩略图：并发控制，每加载一张立即更新缓存并通知面板刷新，
 * 替代一次性 GetThumbnailBatch 的"全等"模式，实现缩略图逐张出现。
 * 同 key 已在缓存中时跳过（不改动现有缓存）。
 *
 * @param signal 外部取消信号。传入后，abort 时协作式停止：不再处理剩余 key、
 *               且丢弃已拉取但未写入的过期结果。与内部「当前批次」控制器合并，两者任一 abort 即生效。
 */
export async function loadThumbnailsStreaming(keys: string[], signal?: AbortSignal): Promise<void> {
    if (keys.length === 0) {
        return;
    }
    // [adr-136] 取消上一批次（快速切换文件夹时避免请求堆积）
    if (_thumbAbortController) {
        _thumbAbortController.abort();
    }
    const internalCtrl = new AbortController();
    _thumbAbortController = internalCtrl;
    // 合并外部 signal 与内部控制器：任一 abort 即生效。
    // 用 AbortSignal.any 而非 ?? 回退，否则会忽略内部批次取消（与 model-loader 同款考量，ADR-096/105）。
    const effectiveSignal = signal
        ? AbortSignal.any([signal, internalCtrl.signal])
        : internalCtrl.signal;
    let index = 0;
    const workers = Array.from(
        { length: Math.min(THUMB_STREAM_CONCURRENCY, keys.length) },
        async () => {
            while (index < keys.length) {
                if (effectiveSignal.aborted) {
                    break; // 协作式停止派发
                }
                const key = keys[index++];
                if (thumbnailCache.has(key)) {
                    continue;
                }
                try {
                    const data = await GetThumbnail(key);
                    // 拉取完成后再判一次 abort：丢弃已不可见的过期结果
                    if (effectiveSignal.aborted) {
                        continue;
                    }
                    if (data) {
                        thumbnailCache.set(key, data);
                        // 通知所有活跃面板，使当前可见的缩略图立即显示
                        notifyThumbnailUpdate();
                    }
                } catch (err) {
                    logWarn('library-core', `GetThumbnail failed for ${key}:`, err);
                }
            }
        }
    );
    try {
        await Promise.all(workers);
    } finally {
        // 批次自然结束时清引用；若已被外部/新批次取代则不动（防误清新批次）
        if (_thumbAbortController === internalCtrl) {
            _thumbAbortController = null;
        }
    }
}

/** [adr-136] 取消当前正在进行的缩略图流式加载批次（如弹窗关闭/重开时调用）。 */
export function abortThumbnailStreaming(): void {
    if (_thumbAbortController) {
        _thumbAbortController.abort();
        _thumbAbortController = null;
    }
}

// ======== 模型显示名/图标 公共解析 ========

function resolveModelIcon(m: LibraryModel): string {
    if (m.format === 'vmd') {
        return 'music';
    }
    if (m.format === 'audio') {
        return 'volume-2';
    }
    if (m.format === 'vpd') {
        return 'user';
    }
    if (m.container === 'zip' && m.format === 'pmx') {
        return 'archive';
    }
    return 'box';
}

function resolveModelLabel(m: LibraryModel, filenameFallback: string): string {
    const fp = m.file_path || '';
    const filename =
        m.container === 'zip' && m.zip_inner
            ? getBaseName(m.zip_inner) || filenameFallback
            : getBaseName(fp) || filenameFallback;
    const cached = modelMetaCache.get(fp);
    switch (displayNamePriority) {
        case 'filename':
            return filename;
        case 'name_en':
            return cached?.name_en || m.name_en || cached?.name_jp || m.name_jp || filename;
        case 'name_jp':
        default:
            return cached?.name_jp || m.name_jp || cached?.name_en || m.name_en || filename;
    }
}

export function modelToRow(m: LibraryModel): PopupRow {
    return {
        kind: 'model',
        label: resolveModelLabel(m, t('library.unknown')),
        icon: resolveModelIcon(m),
        target: m.file_path,
        sublabel: undefined,
        model: m,
        editable: m.format === 'pmx',
        wrapLabel: true,
        onAddClick: () => {
            closeAllOverlays();
            onModelRowClick(m);
        },
    };
}

export function modelToResourceItem(m: LibraryModel): ResourceItem {
    const fp = m.file_path || '';
    const cached = modelMetaCache.get(fp);
    const isStage = isStageLike(m.type);
    return {
        id: fp,
        label: resolveModelLabel(m, ''),
        filePath: fp,
        thumbKey: thumbnailKeyForModel(m),
        thumbAspect: isStage ? '16/9' : '2/3',
        icon: resolveModelIcon(m),
        isFolder: false,
        sublabel: cached?.comment || m.comment || undefined,
        data: m,
    };
}

// ======== 构建列表 ========

export function buildResourceItemsForDir(
    dir: string,
    filter?: (m: LibraryModel) => boolean,
    browseDir?: string
): ResourceItem[] {
    const items: ResourceItem[] = [];
    const subdirs = new Set<string>();
    const modelList = allModels || [];
    for (const m of modelList) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        const targetDir = browseDir ? normPath(browseDir) : '';
        if (browseDir && !isUnderRoot(targetDir, mdir)) {
            continue;
        }
        const rel = getRelativePathUnderDir(mdir, dir);
        if (rel === null) {
            continue;
        }
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) {
            items.push(modelToResourceItem(m));
        } else {
            subdirs.add(parts[0]);
        }
    }
    // Flatten leaf subdirs: single-model dirs show their model directly instead of as a folder
    for (const d of Array.from(subdirs).sort()) {
        const subdirPath = dir + '/' + d;
        if (isLeafFlattenDir(subdirPath, modelList, filter)) {
            // Flatten: add models from this leaf subdir directly
            for (const m of modelList) {
                if (filter && !filter(m)) {
                    continue;
                }
                if (normPath(m.dir) === subdirPath) {
                    items.push(modelToResourceItem(m));
                }
            }
        } else {
            items.unshift({
                id: subdirPath,
                label: d,
                filePath: subdirPath,
                icon: 'folder',
                isFolder: true,
            });
        }
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
            if (cl) {
                stack!.replaceCurrentLevel(buildLevel(cl.dir, cl.label, cl.filter, targetStack));
            }
        });
        toolbar.appendChild(btn);
    };
    modeBtn('grid', '⊞', 'library.gridView');
    modeBtn('list', '≡', 'library.listView');
}

// ======== 列表模式渲染 ========

function addListViewToolbar(
    card: HTMLElement,
    _dir: string,
    items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined,
    allResourceItems: ResourceItem[]
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
        openResourceFullscreen(items[0]?.label || '资源库', allResourceItems, filter, (m) =>
            onModelRowClick(m)
        );
    });
    toolbar.appendChild(expandBtn);
    card.appendChild(toolbar);
}

function renderItemsWithRAF(
    card: HTMLElement,
    items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined
): void {
    const RAF_BATCH_THRESHOLD = 100;
    const RAF_BATCH_SIZE = 50;
    const activateItem = (item: PopupRow): void => {
        const stack = targetStack || stackRegistry.modelStack;
        const outcome = stack?.currentLevel?.outcome ?? { mode: 'close' as const };
        if (item.kind === 'folder') {
            const next = buildLevel(
                item.target,
                item.label,
                filter,
                targetStack,
                undefined,
                outcome
            );
            stack?.push(next);
        } else if (item.model) {
            // [doc:adr-131] 连续预览：加载后保持浏览器打开，不收起 overlay
            if (item.model.format === 'vmd' && outcome.mode === 'stay') {
                if (outcome.onVmdPick) {
                    const name = item.model.name_jp || item.model.name_en || '';
                    outcome.onVmdPick(item.model.file_path, name);
                    return;
                }
                loadManager.load({
                    kind: 'vmd',
                    path: item.model.file_path,
                    modelId: outcome.modelId,
                    skipSceneIntent: true,
                });
                return;
            }
            // [doc:adr-131] 替换模式：显式传 jumpToDir modelId，取代 modelReplaceTargetId 全局反推
            if (outcome.mode === 'jumpToDir' && outcome.modelId) {
                onModelRowClick(item.model, outcome.modelId);
                return;
            }
            // [doc:adr-131] 默认 close：走标准加载路径（关闭浏览器）
            onModelRowClick(item.model);
        }
    };
    const onRowClick = (item: PopupRow): void => {
        if (item.kind === 'folder') {
            activateItem(item);
            return;
        }
        if (item.model && item.model.format !== 'vmd') {
            replaceModel(item.model);
            return;
        }
        if (item.model && item.model.format === 'vmd') {
            const stack = targetStack || stackRegistry.modelStack;
            const outcome = stack?.currentLevel?.outcome ?? { mode: 'close' as const };
            if (outcome.mode === 'stay' && outcome.onVmdReplace) {
                const name = item.model.name_jp || item.model.name_en || '';
                outcome.onVmdReplace(item.model.file_path, name);
                return;
            }
        }
        activateItem(item);
    };
    const buildRowExtra = (item: PopupRow): SlideRowExtra | undefined => {
        const e: SlideRowExtra = {};
        if (item.wrapLabel) {
            e.wrapLabel = true;
        }
        if (item.kind !== 'folder') {
            e.trailing = {
                icon: 'lucide:plus',
                title: t('library.loadModel'),
                onClick: () => {
                    activateItem(item);
                },
            };
        }
        return e.wrapLabel || e.trailing ? e : undefined;
    };
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'slide-empty';
        empty.style.cssText =
            'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
        empty.textContent = t('library.noModels');
        card.appendChild(empty);
        return;
    }
    if (items.length <= RAF_BATCH_THRESHOLD) {
        for (const item of items) {
            if (item.kind === 'divider') {
                continue;
            }
            slideRow(
                card,
                item.icon,
                item.label,
                item.kind === 'folder',
                () => onRowClick(item),
                item.sublabel,
                undefined,
                undefined,
                undefined,
                buildRowExtra(item)
            );
        }
        return;
    }
    let index = 0;
    function renderBatch(): void {
        const end = Math.min(index + RAF_BATCH_SIZE, items.length);
        for (; index < end; index++) {
            const item = items[index];
            if (item.kind === 'divider') {
                continue;
            }
            slideRow(
                card,
                item.icon,
                item.label,
                item.kind === 'folder',
                () => onRowClick(item),
                item.sublabel,
                undefined,
                undefined,
                undefined,
                buildRowExtra(item)
            );
        }
        if (index < items.length) {
            requestAnimationFrame(renderBatch);
        }
    }
    renderBatch();
}

// [修复] 全屏资源浏览器统一导航：无论 list / grid 内嵌模式，
// 全屏一律以「grid 面板 + overlay 自有 navigate 栈」渲染，文件夹进入走 overlay.navigate（重渲染当前面板），
// 不再触碰被冻结的 SlideMenu 栈，退出后位置不丢失。
// 每个层级的面板在创建前先 dispose 上一层，避免观察器 / _activePanels 泄漏。
function openResourceFullscreen(
    title: string,
    rootItems: ResourceItem[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    onSelectModel: (m: LibraryModel) => void
): void {
    let currentPanel: ResourcePanelHandle | null = null;
    const renderPanelAt = (
        path: string | null,
        container: HTMLElement,
        navigate: (t: string, r: (c: HTMLElement) => void) => void
    ): void => {
        const itemsForPath = path === null ? rootItems : buildResourceItemsForDir(path, filter);
        currentPanel?.dispose();
        currentPanel = createResourcePanel(container, {
            items: itemsForPath,
            thumbnailCache,
            onSelect: (item) => {
                const m = item.data as LibraryModel | undefined;
                if (!m) {
                    return;
                }
                closeFullscreen();
                onSelectModel(m);
            },
            onEnterFolder: (p) => {
                navigate(getBaseName(p) || p, (c) => renderPanelAt(p, c, navigate));
            },
            layout: 'grid',
        });
    };
    openFullscreen({
        title,
        onBack: () => {
            currentPanel = safeDispose(currentPanel);
        },
        renderContent: (container, navigate) => renderPanelAt(null, container, navigate),
    });
}

// ======== Grid 模式渲染 ========

function renderGridMode(
    container: HTMLElement,
    dir: string,
    items: PopupRow[],
    filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu
): void {
    const allResourceItems = buildResourceItemsForDir(dir, filter);
    const thumbKeys2 = allResourceItems
        .filter((item) => !item.isFolder && item.thumbKey)
        .map((item) => item.thumbKey!);
    if (thumbKeys2.length > 0) {
        // 流式加载：逐张出现，不阻塞面板渲染
        loadThumbnailsStreaming(thumbKeys2).catch((err) =>
            logWarn('library-core', 'loadThumbnailsStreaming failed:', err)
        );
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
            openResourceFullscreen(items[0]?.label || '资源库', allResourceItems, filter, (m) => {
                if (m.format === 'vmd') {
                    replaceMotion(m);
                } else {
                    replaceModel(m);
                }
            });
        });
        toolbar.appendChild(expandBtn);
        card.appendChild(toolbar);
        createResourcePanel(card, {
            items: allResourceItems,
            thumbnailCache,
            onSelect: (item) => {
                const m = item.data as LibraryModel | undefined;
                if (!m) {
                    return;
                }
                // [doc:adr-131] 网格模式也读取 outcome，stay 时不关闭 browser
                if (m.format === 'vmd') {
                    const outcome = (targetStack || stackRegistry.modelStack)?.currentLevel
                        ?.outcome;
                    if (outcome?.mode === 'stay') {
                        loadManager.load({
                            kind: 'vmd',
                            path: m.file_path,
                            modelId: outcome.modelId,
                            skipSceneIntent: true,
                        });
                        return;
                    }
                    replaceMotion(m);
                } else {
                    replaceModel(m);
                }
            },
            onEnterFolder: (path) => {
                const stack = targetStack || stackRegistry.modelStack;
                if (stack) {
                    const folderLabel =
                        allResourceItems.find((fi) => fi.id === path)?.label ||
                        getBaseName(path) ||
                        path;
                    stack.push(buildLevel(path, folderLabel, filter, targetStack));
                }
            },
            layout: 'grid',
        });
    });
}

// ======== 构建层级 ========

// [修复] 从 allModels 实时构建某目录的 PopupRow 列表（对齐网格模式的自愈行为）。
// 抽出为独立函数，使 buildLevel 的 renderCustom 可在每次重渲染时重算，
// 不再依赖 buildLevel 调用时刻的闭包快照（旧实现在 allModels 未就绪时得到空快照且 reRender 后永不刷新）。
function buildPopupRows(
    dirIn: string,
    filter: ((m: LibraryModel) => boolean) | undefined,
    extraFolders?: { label: string; path: string }[]
): PopupRow[] {
    const dir = normPath(dirIn);
    const isRoot = filter ? false : normPath(libraryRoot) === dir;
    const items: PopupRow[] = [];
    const subdirs = new Set<string>();
    const subdirIsLeaf = new Set<string>();
    const modelList = allModels || [];
    const pmxPaths = modelList
        .filter((m) => !filter || filter(m))
        .map((m) => m.file_path)
        .filter(Boolean) as string[];
    if (pmxPaths.length > 0) {
        ensureModelMeta(pmxPaths);
    }
    for (const m of modelList) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        const rel = getRelativePathUnderDir(mdir, dir);
        if (rel === null) {
            continue;
        }
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) {
            items.push(modelToRow(m));
        } else {
            subdirs.add(parts[0]);
            if (parts.length === 1) {
                subdirIsLeaf.add(parts[0]);
            }
        }
    }
    for (const d of Array.from(subdirs).sort()) {
        const fullPath = dir + '/' + d;
        if (subdirIsLeaf.has(d) && !isRoot && isLeafFlattenDir(fullPath, modelList, filter)) {
            for (const m of modelList) {
                if (filter && !filter(m)) {
                    continue;
                }
                if (normPath(m.dir) === fullPath) {
                    items.push(modelToRow(m));
                }
            }
            continue;
        }
        items.unshift({
            kind: 'folder',
            label: d,
            icon: 'folder',
            target: fullPath,
            wrapLabel: true,
        });
    }
    if (extraFolders) {
        for (const ef of extraFolders) {
            items.unshift({ kind: 'folder', label: ef.label, icon: 'plug', target: ef.path });
        }
    }
    if (librarySortMode === 'name') {
        items.sort((a, b) => a.label.localeCompare(b.label, getLang()));
    }
    return items;
}

export function buildLevel(
    dir: string,
    label: string,
    filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu,
    extraFolders?: { label: string; path: string }[],
    outcome?: BrowseOutcome
): PopupLevel {
    dir = normPath(dir);
    return {
        label,
        dir,
        items: [],
        filter,
        outcome,
        renderCustom: (container) => {
            // [修复] 每次重渲染实时重算 items：列表模式不再依赖 buildLevel 时刻的闭包快照，
            // 解压/扫描未完成时进入空层，待数据就绪后任意一次 reRender（含导航 push/pop、视图切换）即自愈填充。
            const liveItems = buildPopupRows(dir, filter, extraFolders);
            const resourceItems = buildResourceItemsForDir(dir, filter);
            if (resourceViewMode === 'grid') {
                renderGridMode(container, dir, liveItems, filter, targetStack);
            } else {
                cardContainer(container, (card) => {
                    addListViewToolbar(card, dir, liveItems, filter, targetStack, resourceItems);
                    renderItemsWithRAF(card, liveItems, filter, targetStack);
                });
            }
        },
    };
}

const FORMATION_KEYS: Record<string, string> = {
    'line': 'scene.formation.line',
    'v-shape': 'scene.formation.vshape',
    'circle': 'scene.formation.circle',
    'grid': 'scene.formation.grid',
    'diagonal': 'scene.formation.diagonal',
    'arc': 'scene.formation.arc',
};

// ======== Formation 阵型 ========

export function buildModelFormationLevel(): PopupLevel {
    const formations: string[] = ['line', 'v-shape', 'circle', 'grid', 'diagonal', 'arc'];
    const icons: Record<string, string> = {
        'line': 'lucide:minus',
        'v-shape': 'lucide:chevron-up',
        'circle': 'lucide:circle',
        'grid': 'lucide:grid-3x3',
        'diagonal': 'lucide:trending-up',
        'arc': 'lucide:arrow-up-right',
    };
    return {
        label: t('scene.formation'),
        dir: '',
        items: formations.map((f) => ({
            kind: 'action' as const,
            label: t(FORMATION_KEYS[f]),
            icon: icons[f],
            target: `formation:set:${f}`,
        })),
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
            kind: 'action',
            label: inst.name,
            icon: radioIcon,
            target: `scene:${id}`,
            wrapLabel: true,
            focused: isFocused,
            rowKey: 'actor:' + id + (isFocused ? ':on' : ':off'),
            leading: {
                icon: radioIcon,
                title: t('library.focusModel'),
                onClick: () => {
                    focusModel(id);
                    refreshModelRoot();
                },
            },
            trailing: {
                icon: 'lucide:settings-2',
                title: t('library.modelTools'),
                onClick: () => {
                    stackRegistry.modelStack?.push(buildModelToolsLevel(id));
                },
            },
        });
    }
    if (actors.length > 0) {
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    if (modelRegistry.size > 1) {
        items.push({
            kind: 'folder',
            label: t('scene.formation'),
            icon: 'lucide:layout-grid',
            target: 'models:formation',
        });
    }
    items.push({
        kind: 'folder',
        label: t('library.loadModel'),
        icon: 'lucide:folder',
        target: 'models:browse',
    });
    items.push({
        kind: 'action',
        label: t('library.importFile'),
        icon: 'lucide:file-plus',
        target: 'models:import-file',
    });
    items.push({
        kind: 'action',
        label: t('library.rescan'),
        icon: 'lucide:refresh-cw',
        target: 'models:rescan',
    });
    items.push({
        kind: 'folder',
        label: t('library.recent'),
        icon: 'lucide:clock',
        target: '__recent__',
    });
    items.push({
        kind: 'folder',
        label: t('library.tags'),
        icon: 'lucide:tag',
        target: '__tags__',
    });
    return items;
}

export function refreshModelRoot(): void {
    const stack = stackRegistry.modelStack;
    if (!stack) {
        return;
    }
    stack.setLevel(0, {
        label: t('library.model'),
        dir: '',
        items: buildModelRootItems(),
        itemBuilder: buildModelRootItems,
    });
}

// Register buildLevel for use by motion-popup.ts (avoids circular import)
stackRegistry.buildLevel = buildLevel;

// ======== Re-exports（向后兼容，外部通过 library-core 或 library 导入）========

export { showModelPopup } from './library-browse';
export { importFile, prepareModelRestore } from './library-actions';
export {
    initLibrary,
    selectResourceRoot,
    selectOverridePath,
    switchStorageMode,
    rescanAndSync,
    reloadConfig,
    refreshLibrary,
} from './library-setup';
