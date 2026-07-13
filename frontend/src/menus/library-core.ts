// [doc:architecture] Library Core — 模型库核心逻辑
// 从 library.ts 提取

import { isAndroidPlatform } from '../core/platform';
import {
    GetConfig,
    SetResourceRoot,
    SetOverridePath,
    SetStorageMode,
    GetStorageMode,
    SelectDir,
    SelectImportFile,
    ImportZip,
    ScanModelDir,
    GetLibraryIndex,
    ExtractZip,
    CleanOrphanCache,
    GetThumbnailBatch,
    GetModelMetaBatch,
    GetRecentModels,
    AddRecentModel,
    GetAllTags,
    GetModelsByTag,
    GetLastBrowseDir,
    SetLastBrowseDir,
} from '../core/wails-bindings';
import {
    dom,
    setStatus,
    uiState,
    setLibraryRoot,
    libraryRoot,
    setResourceRoot,
    setAllModels,
    allModels,
    setExternalPaths,
    setOverridePaths,
    overridePaths,
    externalPaths,
    LibraryModel,
    PopupRow,
    PopupLevel,
    normPath,
    setThumbnailCache,
    thumbnailCache,
    displayNamePriority,
    setDisplayNamePriority,
    DisplayNamePriority,
    modelMetaCache,
    setModelMetaCache,
    closeAllOverlays,
    modelRegistry,
    focusedModelId,
    recentModels,
    setRecentModels,
    computeLibraryRef,
    motionBindingTargetId,
    setMotionBindingTargetId,
    layerBindingTargetId,
    setLayerBindingTargetId,
    modelReplaceTargetId,
    setModelReplaceTargetId,
    cardContainer,
    formatError,
    librarySortMode,
    setPendingVmd,
} from '../core/config';
import { loadManager } from '../core/load-manager';
import { removeModel } from '../scene/scene';
import { addVmdLayerFromPath } from '../scene/motion/vmd-layers';
import { loadVPDPose } from '../scene/scene';
import { SelectAudioFile, SelectVMDMotion, SelectVPDPose } from '../core/wails-bindings';
import { buildModelLevel } from './model-detail';
import { buildStageTransformLevel } from './scene-menu';
import { SlideMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    createResourcePanel,
    openFullscreen,
    closeFullscreen,
    getCurrentState,
    setCurrentState,
} from '../core/ui-helpers';
import type { ResourceItem } from '../core/ui-helpers';
import { tryCatchStatus, getBrowseDir, isUnderRoot, getBaseName } from '../core/utils';
import { showConfirm } from '../core/dialog';
import { t } from '../core/i18n/t'; // [doc:adr-059] i18n 翻译
import { getLang } from '../core/i18n/locale'; // [doc:adr-059] 用于列表 collation 随语言切换
import { stackRegistry, getMenuWrapper } from '../core/config';

// ======== Resource View Mode ========

export type ResourceViewMode = 'list' | 'grid';

let resourceViewMode: ResourceViewMode = 'list';

export function getResourceViewMode(): ResourceViewMode {
    return resourceViewMode;
}

export function setResourceViewMode(mode: ResourceViewMode): void {
    resourceViewMode = mode;
    uiState.resourceViewMode = mode;
    // [doc:adr-066] 持久化到 config（传完整 uiState 快照，避免单字段写入清空其他字段）
    import('../core/wails-bindings').then(({ SetUIState }) => {
        SetUIState({ ...uiState } as unknown as import('../core/wails-bindings').UIState).catch(
            () => {}
        );
    });
}

// ======== Model Stack ========

/** 判断 row.target 是否为文件目录浏览路径（而非内置命令或特殊条目） */
function isModelDirTarget(target: string | undefined): boolean {
    return !!target && !target.startsWith('models:') && !target.startsWith('__');
}

/**
 * 计算 dir 相对 root 的子目录段数组，用于"展开栈"自动恢复上次浏览位置。
 * - 返回 []  ：dir 与 root 相同（无需展开）
 * - 返回 null：dir 不是 root 的严格子目录（不展开，降级为停在 root）
 * - 否则     ：从 root 到 dir 的每一级子目录名（顺序）
 * 必须使用路径边界匹配，禁止裸字符串前缀（与 buildLevel 同款修复：避免 "PMX" 误匹配 "PMXSub"、
 * 或盘符残缺 "C" 切出 ":" 伪文件夹）。
 */
export function splitSubdirSegments(rootRaw: string, dirRaw: string): string[] | null {
    // 拒绝 '..' 逃逸段：记忆/浏览路径不应含 '..'，含则视为不规范输入直接拒绝（修复 P2 场景1）
    if (rootRaw.includes('..') || dirRaw.includes('..')) {
        return null;
    }
    const rootNorm = normPath(rootRaw);
    const dirNorm = normPath(dirRaw);
    // 比较用小写，提取段用原始大小写（避免路径大小写丢失导致展开后 buildLevel 与 m.dir 不匹配）
    const root = rootNorm.toLowerCase();
    const dir = dirNorm.toLowerCase();
    // 1) 严格路径边界匹配（root + '/'），覆盖绝大多数同形态场景
    if (dir === root) {
        return [];
    }
    if (isUnderRoot(rootRaw, dirRaw)) {
        return dirNorm.substring(rootNorm.length).replace(/^\//, '').split('/').filter(Boolean);
    }
    // 2) 容错：root 与 dir 的绝对前缀形态不完全一致（前端 libraryRoot 与后端 cfg.ResourceRoot
    //    在大小写 / 末尾斜杠 / 反斜杠上存在差异），但二者位于同一盘符且父链一致、仅末段后子路径
    //    需恢复时，从该标记之后截取相对段。跨盘或父链不一致（同盘异父）绝不展开，避免记忆串台
    //    （修复 P2 场景2：C:/other/PMX/Sub 不应展开到 C:/text-model/PMX/Sub）。
    const rootDrive = root.match(/^([a-z]):/i)?.[1];
    if (rootDrive) {
        const dirDrive = dir.match(/^([a-z]):/i)?.[1];
        if (dirDrive !== rootDrive) {
            return null;
        }
    }
    const rootSegs = root.split('/').filter(Boolean);
    const dirSegs = dir.split('/').filter(Boolean);
    const marker = rootSegs[rootSegs.length - 1];
    if (marker) {
        const mIdx = dirSegs.lastIndexOf(marker);
        if (mIdx >= 0) {
            // 校验 marker 之前父链与 root 父链一致（已小写），否则为同盘异父串台，拒绝展开
            const rootPrefix = rootSegs.slice(0, -1);
            const dirPrefix = dirSegs.slice(0, mIdx);
            if (rootPrefix.length !== dirPrefix.length || !rootPrefix.every((s, i) => s === dirPrefix[i])) {
                return null;
            }
            const dirNormSegs = dirNorm.split('/').filter(Boolean);
            const relNormSegs = dirNormSegs.slice(mIdx + 1);
            return relNormSegs.length ? relNormSegs : [];
        }
        // dir 以标记段结尾（lastDir 指向的恰是 root 末段目录本身，等同 root）
        if (dirSegs[dirSegs.length - 1] === marker) {
            return [];
        }
    }
    return null;
}

/**
 * [doc:adr-090] 路径边界相对路径推导。
 * 判定 mdirRaw 是否位于 baseDirRaw 之下：精确相等（忽略大小写），或前缀相等且紧随字符为 '/'。
 * 禁止裸字符串前缀（如 ".../PMX" 误命中 ".../PMXSub" → 伪文件夹）。
 * 命中返回相对 baseDir 的路径（去除前导 '/'），否则 null。
 */
export function getRelativePathUnderDir(mdirRaw: string, baseDirRaw: string): string | null {
    const mdir = normPath(mdirRaw);
    const base = normPath(baseDirRaw);
    return isUnderRoot(base, mdir) ? mdir.substring(base.length).replace(/^\//, '') : null;
}

export function isLeafFlattenDir(
    dirPath: string,
    models: LibraryModel[],
    categoryFilter?: (m: LibraryModel) => boolean
): boolean {
    const normDir = normPath(dirPath);
    const entries = models.filter((m) => {
        if (categoryFilter && !categoryFilter(m)) return false;
        return normPath(m.dir) === normDir;
    });
    if (entries.length === 0) return false;
    const hasSubdirs = models.some((m) => {
        if (categoryFilter && !categoryFilter(m)) return false;
        const rel = getRelativePathUnderDir(m.dir, normDir);
        return rel && rel.split('/').filter(Boolean).length > 1;
    });
    if (hasSubdirs) return false;
    const allZip = entries.every((m) => m.container === 'zip');
    const multiZip = allZip && entries.length > 1;
    return !multiZip;
}

export function computeRestoreSegments(
    browseDir: string,
    targetDir: string,
    models: LibraryModel[],
    categoryFilter?: (m: LibraryModel) => boolean
): string[] | null {
    const segs = splitSubdirSegments(browseDir, targetDir);
    if (!segs || segs.length === 0) return null;
    let currentDir = normPath(browseDir);
    let keepSegs = 0;
    for (let i = 0; i < segs.length; i++) {
        const subdirPath = normPath(currentDir + '/' + segs[i]);
        if (isLeafFlattenDir(subdirPath, models, categoryFilter)) {
            break;
        }
        keepSegs = i + 1;
        currentDir = subdirPath;
    }
    return keepSegs > 0 ? segs.slice(0, keepSegs) : null;
}

/**
 * [doc:model-memory] 在已渲染的 level 中按 rowKey 高亮指定模型行并滚动可见。
 * 复用键盘焦点样式 `slide-focused`；先清除既有高亮，避免与 setupFocus 默认高亮的首项重叠。
 */
function highlightRow(root: HTMLElement, rowKey: string): void {
    const list = (root.querySelector('.slide-list') ?? root) as HTMLElement;
    const rows = Array.from(list.querySelectorAll('.slide-item')) as HTMLElement[];
    rows.forEach((r) => r.classList.remove('slide-focused'));
    const el = rows.find((r) => r.dataset.rowKey === rowKey);
    if (el) {
        el.classList.add('slide-focused');
        el.scrollIntoView({ block: 'nearest' });
    } else if (import.meta.env.DEV) {
        console.warn('[restore] focus row not found:', rowKey);
    }
}

// [doc:model-memory] 模块级恢复状态：modelStack 即 makeModelMenu 单例（library-core.ts:1495），无并发冲突。
// onLevelEnter（实例级）已挂好消费逻辑；以下状态由 onFolderEnter('models:browse') 与「更换模型」路径共用填充。
let pendingAutoExpand: string[] | null = null;
let pendingFocusModel: { dir: string; rowKey: string } | null = null;

// [doc:model-memory] 计算并填充恢复计划：自动展开到上次浏览目录 + 高亮上次模型。
// 供 onFolderEnter('models:browse') 与「更换模型」路径（model:replace 卡片 / 替换续接）共用，
// 三者推入同一 modelStack 实例，onLevelEnter 会递归展开 + 高亮。category 决定恢复的记忆维度。
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
        if (lastDir) {
            restoreTarget = normPath(lastDir);
        }
    }
    if (restoreTarget) {
        const fullSegs = splitSubdirSegments(browseDir, restoreTarget);
        if (fromRecentModel) {
            pendingAutoExpand = computeRestoreSegments(
                browseDir,
                restoreTarget,
                allModels,
                categoryFilter
            );
        } else {
            pendingAutoExpand = fullSegs && fullSegs.length > 0 ? fullSegs : null;
        }
    } else {
        pendingAutoExpand = null;
    }
    pendingFocusModel = focusModel
        ? { dir: normPath(focusModel.dir), rowKey: 'model:' + focusModel.file_path }
        : null;
    if (import.meta.env.DEV) {
        console.log('[restore] prepare', {
            category,
            restoreTarget,
            fromRecentModel,
            pendingAutoExpand,
            focusRowKey: pendingFocusModel?.rowKey,
        });
    }
}

const makeModelMenu = (container: HTMLElement): SlideMenu => {
    return new SlideMenu({
        container,
        onClose: closeAllOverlays,
        onFolderEnter: async (row) => {
            if (row.target && row.target.startsWith('scene:')) {
                setMotionBindingTargetId(null);
                const id = row.target.replace('scene:', '');
                const inst = modelRegistry.get(id);
                if (!inst) {
                    return null;
                }
                return inst.kind === 'stage' ? buildStageTransformLevel(id) : buildModelLevel(id);
            }
            if (row.target === '__recent__') {
                const recentMap = new Map<string, number>();
                recentModels.forEach((ref, i) => recentMap.set(ref, i));
                const recentModelsList = allModels
                    .filter((m) => {
                        const ref = computeLibraryRef(m.file_path);
                        return ref && recentMap.has(ref);
                    })
                    .sort((a, b) => {
                        const refA = computeLibraryRef(a.file_path);
                        const refB = computeLibraryRef(b.file_path);
                        return (recentMap.get(refA!) ?? 999) - (recentMap.get(refB!) ?? 999);
                    });
                return {
                    label: t('library.recent'),
                    dir: '',
                    items:
                        recentModelsList.length > 0
                            ? recentModelsList.map((m) => modelToRow(m))
                            : [
                                  {
                                      kind: 'action' as const,
                                      label: t('library.noRecent'),
                                      icon: 'clock',
                                      target: '',
                                      sublabel: t('library.noRecentHint'),
                                  },
                              ],
                };
            }
            if (row.target === '__tags__') {
                return buildTagsOverviewLevel();
            }
            if (row.target && row.target.startsWith('__tag:')) {
                const tagName = row.target.replace('__tag:', '');
                return buildTagDetailLevel(tagName);
            }
            if (row.target === 'models:browse') {
                if (!libraryRoot) {
                    return {
                        label: t('library.title'),
                        dir: '',
                        items: [],
                        renderCustom: (container) => {
                            container.style.cssText =
                                'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                            container.innerHTML = `<div>${t('library.noRootDir')}</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">${t('library.noRootDirHint')}</div>`;
                        },
                    };
                }
                const browseDir = getBrowseDir('pmx');
                // [doc:adr-090] 读取上次浏览子目录记忆（文件夹记忆，作为回退）
                // [doc:model-memory] 优先用 RecentModels[0]（上次加载的模型）定位其容器目录；
                //   zip 模型也能命中：expandZipEntries 已把 zip 内部条目预置进 allModels，
                //   其 dir = <zip父目录>/<zipBase>，buildLevel 按 dir 过滤即可展开到 zip 内。
                //   多 pmx 同 zip 时 computeLibraryRef 仅标识 zip（不含 zip_inner），取首个匹配。
                // [doc:model-memory] 复用恢复逻辑：自动展开到上次浏览目录 + 高亮上次模型
                //   （RecentModels 混存多格式时按 pmx 优先；文件夹记忆作回退，见 prepareModelRestore）
                await prepareModelRestore(browseDir, 'pmx');
                return buildLevel(
                    browseDir,
                    t('library.title'),
                    (m) => m.format === 'pmx',
                    stackRegistry.modelStack!,
                    externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
                );
            }
            if (isModelDirTarget(row.target)) {
                return buildLevel(
                    row.target,
                    row.label,
                    (m) => m.format === 'pmx',
                    stackRegistry.modelStack!
                );
            }
            return null;
        },
        onItemClick: (row: PopupRow) => {
            if (row.model) {
                // closeAllOverlays 会自动清 binding targets，需先取到本地变量
                if (row.model.format === 'vmd' && layerBindingTargetId) {
                    const targetId = layerBindingTargetId;
                    closeAllOverlays();
                    addVmdLayerFromPath(row.model.file_path, targetId);
                    return;
                }
                if (row.model.format === 'vmd' && motionBindingTargetId) {
                    const targetId = motionBindingTargetId;
                    closeAllOverlays();
                    loadManager.load({ kind: 'vmd', path: row.model.file_path, modelId: targetId });
                    return;
                }
                closeAllOverlays();
                replaceModel(row.model);
                return;
            }
            if (row.target === 'models:rescan') {
                refreshLibrary();
                return;
            }
            if (row.target === 'models:import-file') {
                importFile();
                return;
            }
        },
        onHover: (row, entering) => {
            if (!entering) {
                setStatus('', false);
                return;
            }
            const hints: Record<string, string> = {
                'models:browse': t('library.browseHint'),
                'models:import-file': t('library.importHint'),
            };
            const hint = hints[row.target || ''];
            if (hint) {
                setStatus(hint, false);
            }
        },
        // [doc:adr-090] 持久化模型浏览器当前目录，打开时恢复上次位置
        // [展开栈] 打开时从 root 异步串行展开到上次浏览目录（push 为动画驱动，同步多 push 会被 transitioning 拦截，故逐层交由动画结束回调驱动）
        onLevelEnter: (level, menu) => {
            const dir = normPath(level.dir);
            if (!dir || dir === '.' || dir === '/') {
                return;
            }
            const browseRoot = getBrowseDir('pmx');
            if (!browseRoot) {
                return;
            }
            // [doc:model-memory] 到达上次模型的容器目录：高亮该行（focus 默认，直载延后）
            if (pendingFocusModel && normPath(level.dir) === pendingFocusModel.dir) {
                highlightRow(container, pendingFocusModel.rowKey);
                pendingFocusModel = null;
            }
            if (pendingAutoExpand && pendingAutoExpand.length > 0) {
                const seg = pendingAutoExpand[0];
                const nextDir = normPath(dir + '/' + seg);
                // 立即消费剩余段，避免本层动画结束后的 onLevelEnter 重复展开
                pendingAutoExpand = pendingAutoExpand.length > 1 ? pendingAutoExpand.slice(1) : null;
                if (import.meta.env.DEV) {
                    // 捕获 race：若 transitioning 为 true，下方 push 会被 menu.ts:180 静默丢弃（停在根）
                    console.log('[restore] autoExpand push', {
                        from: dir,
                        seg,
                        nextDir,
                        transitioning: menu.isTransitioning,
                    });
                }
                // 与 root 层保持一致：第 4 参用 modelStack（即当前 SlideMenu 实例），并传入外部路径项
                menu.push(
                    buildLevel(
                        nextDir,
                        seg,
                        (m) => m.format === 'pmx',
                        stackRegistry.modelStack!,
                        externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
                    )
                );
                return;
            }
            // 仅在 libraryRoot/PMX/ 下的子目录导航时持久化；排除根菜单、scene/model detail 等
            if (dir === browseRoot) {
                return;
            }
            if (isUnderRoot(browseRoot, dir)) {
                // [doc:adr-090] 同步到后端，持久化到 LastDirs["browse:pmx"]
                void SetLastBrowseDir('pmx', dir);
            }
        },
    });
};

// ======== Thumbnail batch loading ========

async function _loadThumbnailsForLevel(level: PopupLevel): Promise<void> {
    const pmxPaths = level.items
        .filter((r) => r.kind === 'model' && r.model)
        .map((r) => r.model!.file_path);
    if (pmxPaths.length === 0) {
        return;
    }
    try {
        const batch = await GetThumbnailBatch(pmxPaths);
        setThumbnailCache(new Map(Object.entries(batch)));
    } catch (err) {
        console.warn('loadThumbnailsForLevel:', err);
    }
}

async function _ensureModelMeta(pmxPaths: string[]): Promise<void> {
    const uncached = pmxPaths.filter((p) => !modelMetaCache.has(p) && !_pendingMeta.has(p));
    if (uncached.length === 0) {
        return;
    }
    // 标记为飞行中，防止并发重复请求
    for (const p of uncached) {
        _pendingMeta.add(p);
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
        console.warn('ensureModelMeta:', err);
    } finally {
        for (const p of uncached) {
            _pendingMeta.delete(p);
        }
    }
}
const _pendingMeta = new Set<string>();

// ======== Build list from scan data ========

const RAF_BATCH_THRESHOLD = 50;
const RAF_BATCH_SIZE = 20;

function renderItemsWithRAF(
    card: HTMLElement,
    items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined
): void {
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
                () => {
                    if (item.kind === 'folder') {
                        const next = buildLevel(item.target, item.label, filter, targetStack);
                        const stack = targetStack || stackRegistry.modelStack;
                        stack.push(next);
                    } else if (item.model) {
                        if (item.model.format === 'vmd' && layerBindingTargetId) {
                            const id = layerBindingTargetId;
                            setLayerBindingTargetId(null);
                            closeAllOverlays();
                            addVmdLayerFromPath(item.model.file_path, id);
                        } else if (item.model.format === 'vmd' && motionBindingTargetId) {
                            const id = motionBindingTargetId;
                            setMotionBindingTargetId(null);
                            closeAllOverlays();
                            loadManager.load({
                                kind: 'vmd',
                                path: item.model.file_path,
                                modelId: id,
                            });
                        } else {
                            onModelRowClick(item.model);
                        }
                    }
                },
                item.sublabel,
                undefined,
                undefined,
                undefined,
                item.wrapLabel === true ? { wrapLabel: true } : undefined
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
                () => {
                    if (item.kind === 'folder') {
                        const next = buildLevel(item.target, item.label, filter, targetStack);
                        const stack = targetStack || stackRegistry.modelStack;
                        stack.push(next);
                    } else if (item.model) {
                        if (item.model.format === 'vmd' && layerBindingTargetId) {
                            const id = layerBindingTargetId;
                            setLayerBindingTargetId(null);
                            closeAllOverlays();
                            addVmdLayerFromPath(item.model.file_path, id);
                        } else if (item.model.format === 'vmd' && motionBindingTargetId) {
                            const id = motionBindingTargetId;
                            setMotionBindingTargetId(null);
                            closeAllOverlays();
                            loadManager.load({
                                kind: 'vmd',
                                path: item.model.file_path,
                                modelId: id,
                            });
                        } else {
                            onModelRowClick(item.model);
                        }
                    }
                },
                item.sublabel,
                undefined,
                undefined,
                undefined,
                item.wrapLabel === true ? { wrapLabel: true } : undefined
            );
        }
        if (index < items.length) {
            requestAnimationFrame(renderBatch);
        }
    }

    renderBatch();
}

export function buildLevel(
    dir: string,
    label: string,
    filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu,
    extraFolders?: { label: string; path: string }[]
): PopupLevel {
    dir = normPath(dir);
    const isRoot = filter ? false : normPath(libraryRoot) === dir;
    const items: PopupRow[] = [];
    const subdirs = new Set<string>();
    const subdirIsLeaf = new Set<string>();

    const modelList = allModels || [];

    // Background prefetch: warm metadata cache for all models in this level
    // so modelToRow lookups are more likely to hit in subsequent re-renders
    const pmxPaths = modelList
        .filter((m) => !filter || filter(m))
        .map((m) => m.file_path)
        .filter(Boolean) as string[];
    if (pmxPaths.length > 0) {
        _ensureModelMeta(pmxPaths);
    }

    for (const m of modelList) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        const rel = getRelativePathUnderDir(mdir, dir);
        if (rel === null) {
            if (import.meta.env.DEV && items.length === 0 && subdirs.size === 0) {
                console.log('[buildLevel] path mismatch:', { mdir, dir, sample: m.file_path });
            }
            continue;
        }
        const parts = rel.split('/').filter(Boolean);

        if (parts.length === 0) {
            items.push(modelToRow(m));
        } else {
            const topDir = parts[0];
            subdirs.add(topDir);
            if (parts.length === 1) {
                subdirIsLeaf.add(topDir);
            }
        }
    }

    for (const d of Array.from(subdirs).sort()) {
        const fullPath = dir + '/' + d;
        if (subdirIsLeaf.has(d) && !isRoot && isLeafFlattenDir(fullPath, modelList, filter)) {
            const entries = modelList.filter((m) => {
                if (filter && !filter(m)) {
                    return false;
                }
                return normPath(m.dir) === fullPath;
            });
            for (const m of entries) {
                items.push(modelToRow(m));
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

    // Prepend external paths as folder entries
    if (extraFolders) {
        for (const ef of extraFolders) {
            items.unshift({ kind: 'folder', label: ef.label, icon: 'plug', target: ef.path });
        }
    }

    // 排序：'name' 模式按 label 拼音排序；'default' 保持扫描顺序
    if (librarySortMode === 'name') {
        items.sort((a, b) => {
            // 文件夹和模型行混合排序，按 label 比较；collation 随当前语言（ADR-059 §3.4）
            return a.label.localeCompare(b.label, getLang());
        });
    }

    if (import.meta.env.DEV) {
        console.log('[buildLevel] items.length:', items.length, 'subdirs.size:', subdirs.size);
    }
    return {
        label,
        dir,
        items: [],
        filter, // [doc:adr-066] 保留 filter 供视图切换时传递
        renderCustom: (container) => {
            // [doc:adr-066] 根据视图模式选择渲染路径
            if (resourceViewMode === 'grid') {
                renderGridMode(container, dir, items, filter, targetStack);
            } else {
                cardContainer(container, (card) => {
                    // [doc:adr-066] 列表模式也显示视图切换工具栏
                    const allResourceItems = buildResourceItemsForDir(dir, filter);
                    addListViewToolbar(card, dir, items, filter, targetStack, allResourceItems);
                    renderItemsWithRAF(card, items, filter, targetStack);
                });
            }
        },
    };
}

// ======== Grid Mode Rendering [doc:adr-066] ========

/** 构建指定目录下的 ResourceItem 列表（用于全屏内导航） */
export function buildResourceItemsForDir(
    dirPath: string,
    filter?: (m: LibraryModel) => boolean
): ResourceItem[] {
    const normDir = normPath(dirPath);
    const items: ResourceItem[] = [];
    const subdirs = new Set<string>();
    const subdirIsLeaf = new Set<string>();
    const modelList = allModels || [];
    const isRoot = filter ? false : normPath(libraryRoot) === normDir;

    for (const m of modelList) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        const rel = getRelativePathUnderDir(mdir, normDir);
        if (rel === null) {
            continue;
        }
        const parts = rel.split('/').filter(Boolean);
        if (parts.length === 0) {
            items.push(modelToResourceItem(m));
        } else {
            const topDir = parts[0];
            subdirs.add(topDir);
            if (parts.length === 1) {
                subdirIsLeaf.add(topDir);
            }
        }
    }

    const folderItems: ResourceItem[] = [];
    for (const d of Array.from(subdirs).sort()) {
        const fullPath = normDir + '/' + d;
        if (subdirIsLeaf.has(d) && !isRoot && isLeafFlattenDir(fullPath, modelList, filter)) {
            const entries = modelList.filter((m) => {
                if (filter && !filter(m)) return false;
                return normPath(m.dir) === fullPath;
            });
            for (const m of entries) {
                items.push(modelToResourceItem(m));
            }
            continue;
        }
        folderItems.push({
            id: fullPath,
            label: d,
            filePath: '',
            icon: 'folder',
            isFolder: true,
            sublabel: undefined,
            data: undefined,
        });
    }

    return [...folderItems, ...items];
}

/** 渲染全屏 overlay 中的单个文件夹内容（支持递归导航 + 搜索过滤） */
function renderFullscreenFolder(
    container: HTMLElement,
    dirPath: string,
    filter?: (m: LibraryModel) => boolean,
    navigate?: (title: string, render: (c: HTMLElement) => void) => void
): void {
    const allItems = buildResourceItemsForDir(dirPath, filter);

    // [doc:adr-066] 预加载当前文件夹所有缩略图
    const pmxPaths = allItems
        .filter((item) => !item.isFolder && item.filePath)
        .map((item) => item.filePath);
    if (pmxPaths.length > 0) {
        GetThumbnailBatch(pmxPaths)
            .then((batch) => {
                const merged = new Map(thumbnailCache);
                for (const [path, data] of Object.entries(batch)) {
                    merged.set(path, data);
                }
                setThumbnailCache(merged);
                // [fix:thumbnail] 缩略图异步返回后重绘面板，否则已渲染的卡片永远空
                currentPanel?.updateItems(allItems);
            })
            .catch(() => {});
    }

    // [doc:adr-066] 搜索栏
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding: 8px 0 12px;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('library.search') || '搜索...';
    searchInput.className = 'input';
    searchInput.style.cssText = 'width: 100%; box-sizing: border-box;';
    searchWrap.appendChild(searchInput);
    container.appendChild(searchWrap);

    // 资源面板容器
    const panelContainer = document.createElement('div');
    panelContainer.style.cssText = 'flex: 1; min-height: 0;';
    container.appendChild(panelContainer);

    let currentPanel: ReturnType<typeof createResourcePanel> | null = null;

    function renderFiltered(query: string): void {
        if (currentPanel) {
            currentPanel.dispose();
            panelContainer.innerHTML = '';
        }
        const q = query.trim().toLowerCase();
        const filtered = q
            ? allItems.filter(
                  (item) =>
                      item.label.toLowerCase().includes(q) ||
                      item.filePath.toLowerCase().includes(q)
              )
            : allItems;

        currentPanel = createResourcePanel(panelContainer, {
            items: filtered,
            thumbnailCache,
            onSelect: (item) => {
                if (item.data) {
                    closeFullscreen();
                    onModelRowClick(item.data as LibraryModel);
                }
            },
            onEnterFolder: navigate
                ? (path) => {
                      const label =
                          filtered.find((i) => i.id === path)?.label ||
                          getBaseName(path) ||
                          path;
                      navigate(label, (c) => renderFullscreenFolder(c, path, filter, navigate));
                  }
                : undefined,
            layout: 'grid',
        });
    }

    searchInput.addEventListener('input', () => renderFiltered(searchInput.value));
    renderFiltered('');
}

/** [doc:adr-066] 列表模式视图切换工具栏 */
function addListViewToolbar(
    card: HTMLElement,
    dir: string,
    items: PopupRow[],
    filter: ((m: LibraryModel) => boolean) | undefined,
    targetStack: SlideMenu | undefined,
    allResourceItems: ResourceItem[]
): void {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
        display: flex;
        gap: 8px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--white-06);
    `;

    const gridBtn = document.createElement('button');
    gridBtn.className = 'btn btn-ghost btn-sm' + (resourceViewMode === 'grid' ? ' btn-active' : '');
    gridBtn.textContent = '⊞';
    gridBtn.title = t('library.gridView');
    gridBtn.addEventListener('click', () => {
        setResourceViewMode('grid');
        const stack = targetStack || stackRegistry.modelStack;
        if (stack) {
            const cl = stack.currentLevel;
            if (cl) {
                stack.replaceCurrentLevel(buildLevel(cl.dir, cl.label, cl.filter, targetStack));
            }
        }
    });
    toolbar.appendChild(gridBtn);

    const listBtn = document.createElement('button');
    listBtn.className = 'btn btn-ghost btn-sm' + (resourceViewMode === 'list' ? ' btn-active' : '');
    listBtn.textContent = '≡';
    listBtn.title = t('library.listView');
    listBtn.addEventListener('click', () => {
        setResourceViewMode('list');
        const stack = targetStack || stackRegistry.modelStack;
        if (stack) {
            const cl = stack.currentLevel;
            if (cl) {
                stack.replaceCurrentLevel(buildLevel(cl.dir, cl.label, cl.filter, targetStack));
            }
        }
    });
    toolbar.appendChild(listBtn);

    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn btn-ghost btn-sm';
    expandBtn.textContent = '⛶';
    expandBtn.title = t('library.fullscreen');
    expandBtn.style.marginLeft = 'auto';
    expandBtn.addEventListener('click', () => {
        const currentTitle = items[0]?.label || '资源库';
        openFullscreen({
            title: currentTitle,
            onBack: () => setCurrentState('EMBEDDED_GRID'),
            renderContent: (container, navigate) => {
                createResourcePanel(container, {
                    items: allResourceItems,
                    thumbnailCache,
                    onSelect: (item) => {
                        if (item.data) {
                            closeFullscreen();
                            onModelRowClick(item.data as LibraryModel);
                        }
                    },
                    onEnterFolder: (path) => {
                        const folderLabel =
                            allResourceItems.find((i) => i.id === path)?.label ||
                            getBaseName(path) || path;
                        navigate(folderLabel, (c) => {
                            renderFullscreenFolder(c, path, filter, navigate);
                        });
                    },
                    layout: 'grid',
                });
            },
        });
    });
    toolbar.appendChild(expandBtn);

    card.appendChild(toolbar);
}

function renderGridMode(
    container: HTMLElement,
    dir: string,
    items: PopupRow[],
    filter?: (m: LibraryModel) => boolean,
    targetStack?: SlideMenu
): void {
    // [doc:adr-066] 进入 grid 模式时设置状态机
    setCurrentState('EMBEDDED_GRID');

    // [fix:thumbnail] 捕获面板句柄，缩略图异步加载完成后触发重绘
    let resourcePanel: ReturnType<typeof createResourcePanel> | null = null;

    // 复用 buildResourceItemsForDir 获取当前目录的 ResourceItem 列表
    const allResourceItems = buildResourceItemsForDir(dir, filter);

    // [doc:adr-066] 预加载当前目录所有缩略图
    const pmxPaths = allResourceItems
        .filter((item) => !item.isFolder && item.filePath)
        .map((item) => item.filePath);
    if (pmxPaths.length > 0) {
        GetThumbnailBatch(pmxPaths)
            .then((batch) => {
                const merged = new Map(thumbnailCache);
                for (const [path, data] of Object.entries(batch)) {
                    merged.set(path, data);
                }
                setThumbnailCache(merged);
                // [fix:thumbnail] 缩略图异步返回后重绘面板，否则已渲染的卡片永远空
                resourcePanel?.updateItems(allResourceItems);
            })
            .catch(() => {});
    }

    // 渲染容器
    cardContainer(container, (card) => {
        // 视图切换按钮
        const toolbar = document.createElement('div');
        toolbar.style.cssText = `
            display: flex;
            gap: 8px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--white-06);
        `;

        const gridBtn = document.createElement('button');
        gridBtn.className =
            'btn btn-ghost btn-sm' + (resourceViewMode === 'grid' ? ' btn-active' : '');
        gridBtn.textContent = '⊞';
        gridBtn.title = t('library.gridView');
        gridBtn.addEventListener('click', () => {
            setResourceViewMode('grid');
            // 切换视图需要重建当前层级
            const stack = targetStack || stackRegistry.modelStack;
            if (stack) {
                const currentLevel = stack.currentLevel;
                if (currentLevel) {
                    stack.replaceCurrentLevel(
                        buildLevel(
                            currentLevel.dir,
                            currentLevel.label,
                            currentLevel.filter,
                            targetStack
                        )
                    );
                }
            }
        });

        const listBtn = document.createElement('button');
        listBtn.className =
            'btn btn-ghost btn-sm' + (resourceViewMode === 'list' ? ' btn-active' : '');
        listBtn.textContent = '≡';
        listBtn.title = t('library.listView');
        listBtn.addEventListener('click', () => {
            setResourceViewMode('list');
            const stack = targetStack || stackRegistry.modelStack;
            if (stack) {
                const currentLevel = stack.currentLevel;
                if (currentLevel) {
                    stack.replaceCurrentLevel(
                        buildLevel(
                            currentLevel.dir,
                            currentLevel.label,
                            currentLevel.filter,
                            targetStack
                        )
                    );
                }
            }
        });

        toolbar.appendChild(gridBtn);
        toolbar.appendChild(listBtn);

        // 展开全屏按钮
        const expandBtn = document.createElement('button');
        expandBtn.className = 'btn btn-ghost btn-sm';
        expandBtn.textContent = '⛶';
        expandBtn.title = t('library.fullscreen');
        expandBtn.style.marginLeft = 'auto';
        expandBtn.addEventListener('click', () => {
            // 从 items 中获取当前目录名作为标题
            const currentTitle = items[0]?.label || '资源库';
            openFullscreen({
                title: currentTitle,
                onBack: () => {
                    // 返回嵌入模式
                    setCurrentState('EMBEDDED_GRID');
                },
                renderContent: (container, navigate) => {
                    // 渲染全屏网格
                    createResourcePanel(container, {
                        items: allResourceItems,
                        thumbnailCache,
                        onSelect: (item) => {
                            if (item.data) {
                                closeFullscreen();
                                onModelRowClick(item.data as LibraryModel);
                            }
                        },
                        onEnterFolder: (path) => {
                            // [doc:adr-066] 全屏内导航
                            const folderLabel =
                                allResourceItems.find((i) => i.id === path)?.label ||
                                getBaseName(path) ||
                                path;
                            navigate(folderLabel, (c) => {
                                renderFullscreenFolder(c, path, filter, navigate);
                            });
                        },
                        layout: 'grid',
                    });
                },
            });
        });

        toolbar.appendChild(expandBtn);
        card.appendChild(toolbar);

        // 资源面板
        createResourcePanel(card, {
            items: allResourceItems,
            thumbnailCache,
            onSelect: (item) => {
                if (item.data) {
                    onModelRowClick(item.data as LibraryModel);
                }
            },
            onEnterFolder: (path) => {
                const stack = targetStack || stackRegistry.modelStack;
                if (stack) {
                    // 找到文件夹项的 label
                    const folderItem = allResourceItems.find((fi) => fi.id === path);
                    const folderLabel = folderItem?.label || getBaseName(path) || path;
                    stack.push(buildLevel(path, folderLabel, filter, targetStack));
                }
            },
            layout: 'grid',
        });
    });
}

// Register buildLevel for use by motion-popup.ts (avoids circular import)
stackRegistry.buildLevel = buildLevel;

export function modelToRow(m: LibraryModel): PopupRow {
    let icon = 'box';
    if (m.format === 'vmd') {
        icon = 'music';
    } else if (m.format === 'audio') {
        icon = 'volume-2';
    } else if (m.format === 'vpd') {
        icon = 'user';
    } else if (m.container === 'zip' && m.format === 'pmx') {
        icon = 'archive';
    }
    const fp = m.file_path || '';
    const filename =
        m.container === 'zip' && m.zip_inner
            ? getBaseName(m.zip_inner) || t('library.unknown')
            : getBaseName(fp) || t('library.unknown');
    const cached = modelMetaCache.get(fp);
    let label: string;
    switch (displayNamePriority) {
        case 'filename':
            label = filename;
            break;
        case 'name_en':
            label = cached?.name_en || m.name_en || cached?.name_jp || m.name_jp || filename;
            break;
        case 'name_jp':
        default:
            label = cached?.name_jp || m.name_jp || cached?.name_en || m.name_en || filename;
            break;
    }
    return {
        kind: 'model',
        label,
        icon,
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
    const filename =
        m.container === 'zip' && m.zip_inner
            ? getBaseName(m.zip_inner) || ''
            : getBaseName(fp) || '';
    const cached = modelMetaCache.get(fp);
    let label: string;
    switch (displayNamePriority) {
        case 'filename':
            label = filename;
            break;
        case 'name_en':
            label = cached?.name_en || m.name_en || cached?.name_jp || m.name_jp || filename;
            break;
        case 'name_jp':
        default:
            label = cached?.name_jp || m.name_jp || cached?.name_en || m.name_en || filename;
            break;
    }
    let icon = 'box';
    if (m.format === 'vmd') {
        icon = 'music';
    } else if (m.format === 'audio') {
        icon = 'volume-2';
    } else if (m.format === 'vpd') {
        icon = 'user';
    } else if (m.container === 'zip' && m.format === 'pmx') {
        icon = 'archive';
    }
    return {
        id: fp,
        label,
        filePath: fp,
        icon,
        isFolder: false,
        sublabel: cached?.comment || m.comment || undefined,
        data: m,
    };
}

let _isExtracting = false;
/** 链式替换加载中标记：阻止mmku:modelLoaded事件自动重置菜单 */
let _isReplaceLoading = false;

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
    const isStage = m.type === 'stage' || m.type === 'scene' || m.type === 'prop';
    if (m.format === 'pmx') {
        const ref = computeLibraryRef(m.file_path);
        if (ref) {
            AddRecentModel(ref).catch(() => {});
            setRecentModels([ref, ...recentModels.filter((r) => r !== ref)].slice(0, 20));
        }
    }

    // ===== Replace mode: after load, return to library with new model's replace mode active =====
    if (replaceId && m.format === 'pmx') {
        setPendingVmd(null);
        _isReplaceLoading = true;

        const doReplace = (path: string, libraryPath?: string): void => {
            setStatus(t('library.loadingModel'), false);
            // 确定资源类别、浏览目录、过滤器
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
                    if (handle?.id) {
                        // 加载成功后再删除旧模型，失败则保留旧模型
                        removeModel(replaceId);
                        // Auto-activate replace mode for the newly loaded model
                        // so user can immediately pick the next replacement without navigating back
                        setModelReplaceTargetId(handle.id);
                        stackRegistry.modelStack?.resetToRoot();
                        // Push library browser so user sees the model list with replace mode active
                        let newName = handle.name;
                        if (loadKind === 'prop') {
                            const { propRegistry } = await import('../core/config');
                            newName = propRegistry.get(handle.id)?.name ?? handle.name;
                        } else {
                            newName = modelRegistry.get(handle.id)?.name ?? handle.name;
                        }
                        // [doc:model-memory] 替换续接：打开的浏览器同样自动展开+高亮上次模型
                        await prepareModelRestore(getBrowseDir(browseCategory), browseCategory);
                        stackRegistry.modelStack?.push(
                            buildLevel(
                                getBrowseDir(browseCategory),
                                t('model-detail.replaceModelTo', { name: newName }),
                                filter,
                                stackRegistry.modelStack!,
                                externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
                            )
                        );
                        setStatus(t('status.done'), true);
                    } else {
                        // 加载失败恢复替换目标为旧模型，保持状态一致
                        setModelReplaceTargetId(replaceId);
                        stackRegistry.modelStack?.reRender();
                    }
                })
                .catch((err) => {
                    // 加载失败恢复替换目标为旧模型，保持状态一致
                    setModelReplaceTargetId(replaceId);
                    setStatus(t('library.modelLoadFailed') + formatError(err), false);
                    stackRegistry.modelStack?.reRender();
                })
                .finally(() => {
                    _isReplaceLoading = false;
                });
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
                .finally(() => {
                    _isExtracting = false;
                });
        } else {
            doReplace(m.file_path);
        }
        return;
    }

    // ===== Normal mode (add): close overlays and load =====
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
                });
                }
            })
            .catch((err) => {
                setStatus(t('library.extractFailed') + formatError(err), false);
            })
            .finally(() => {
                _isExtracting = false;
            });
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

/** 移除当前聚焦模型后加载新模型。无聚焦模型时直接添加（非严格"替换"语义）。 */
function replaceModel(m: LibraryModel): void {
    if (focusedModelId) {
        setPendingVmd(null);
        removeModel(focusedModelId);
    }
    onModelRowClick(m);
}

// ======== Tag System ========

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
                console.warn('buildTagsOverviewLevel:', err);
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
                console.warn('buildTagDetailLevel:', err);
                container.textContent = t('library.loadFailed');
            }
        },
    };
}

// ======== Popup Show / Hide ========

/** Show function for toggleOverlay — builds the model menu stack. */
/** 模型库根级 items 构建器——items-based，支持全量 reRender */
export function buildModelRootItems(): PopupRow[] {
    const items: PopupRow[] = [];

    // 已加载的角色模型
    const actors = Array.from(modelRegistry.entries()).filter(([, inst]) => inst.kind === 'actor');
    console.log(
        '[buildModelRootItems] actors:',
        actors.length,
        'allModels:',
        allModels.length,
        'libraryRoot:',
        libraryRoot
    );
    for (const [id, inst] of actors) {
        items.push({
            kind: 'folder',
            label: inst.name,
            icon: 'tabler:cube-3d-sphere',
            target: `scene:${id}`,
            wrapLabel: true,
        });
    }

    // 分割线 + 操作入口
    if (actors.length > 0) {
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
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

export function showModelPopup(): void {
    dom.sceneOverlay.classList.remove('sceneOverlay-motion', 'sceneOverlay-settings');
    dom.sceneOverlay.classList.add('sceneOverlay-model'); // 宽度 280px
    dom.sceneOverlay.dataset.popupType = 'model';

    const wrapper = getMenuWrapper('model-popup');
    if (stackRegistry.modelStack) {
        stackRegistry.modelStack.resetToRoot();
        stackRegistry.modelStack.setLevel(0, {
            label: t('library.model'),
            dir: '',
            items: buildModelRootItems(),
        });
        stackRegistry.modelStack.reRender();
        return;
    }

    // 首次：创建 SlideMenu
    stackRegistry.modelStack = makeModelMenu(wrapper);
    stackRegistry.modelStack.reset({
        label: t('library.model'),
        dir: '',
        items: buildModelRootItems(),
    });
}

// ======== Library loading ========

export async function initLibrary(): Promise<void> {
    try {
        const cfg = await GetConfig();
        const cfgRoot = cfg.resource_root || cfg.library_root || cfg.override_paths?.pmx || '';
        if (!cfgRoot) {
            setStatus(t('library.firstUseHint'), false);
            return;
        }
        setLibraryRoot(cfgRoot);
        setResourceRoot(cfgRoot);
        setExternalPaths(cfg.external_paths || []);
        setOverridePaths(cfg.override_paths || {});
        setExternalPaths(cfg.external_paths || []);
        if (cfg.display_name_priority) {
            setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
        }
        // [doc:adr-066] 恢复视图模式
        if (
            cfg.ui_state?.resourceViewMode === 'grid' ||
            cfg.ui_state?.resourceViewMode === 'list'
        ) {
            resourceViewMode = cfg.ui_state.resourceViewMode;
        }
        try {
            const recents = await GetRecentModels();
            if (recents && recents.length > 0) {
                setRecentModels(recents.slice(0, 20));
            }
        } catch (err) {
            console.warn('Load recent models:', err);
        }
        try {
            const cached = await GetLibraryIndex();
            const validCached = cached ? cached.filter((m) => m.file_path) : [];
            if (validCached.length > 0) {
                setAllModels(validCached);
            }
        } catch {
            /* no cache */
        }
        try {
            await rescanAndSync();
        } catch (err) {
            console.warn('ScanModelDir refresh:', err);
        }
        CleanOrphanCache().catch((err) => console.warn('CleanOrphanCache:', err));
        setStatus(t('library.browseHint2'), false);
    } catch (err) {
        console.warn('initLibrary:', err);
        setStatus(t('library.loadLibraryFailed') + formatError(err), false);
    }
}

export async function selectResourceRoot(): Promise<void> {
    if (isAndroidPlatform()) {
        setStatus(t('library.androidDirNotSupported'), false);
        return;
    }
    const ok = await showConfirm(t('library.confirmRescan'), t('library.confirmRescanTitle'));
    if (!ok) {
        return;
    }
    const dir = await tryCatchStatus(async () => {
        const d = await SelectDir();
        if (!d) {
            return undefined;
        }
        return d;
    }, t('library.dirSetFailed'));
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetResourceRoot(dir);
        await reloadConfig();
        await refreshLibrary();
    }, t('library.dirSetFailed'));
}

export async function selectOverridePath(category: string): Promise<void> {
    if (isAndroidPlatform()) {
        setStatus(t('library.androidDirNotSupported'), false);
        return;
    }
    const dir = await tryCatchStatus(async () => {
        const d = await SelectDir();
        if (!d) {
            return undefined;
        }
        return d;
    }, t('library.dirSetFailed'));
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetOverridePath(category, dir);
        await reloadConfig();
        await refreshLibrary();
    }, t('library.dirSetFailed'));
}

export async function switchStorageMode(mode: 'private' | 'shared'): Promise<void> {
    if (!isAndroidPlatform()) {
        return;
    }
    console.log('[switchStorageMode] 1: confirm dialog');
    const ok = await showConfirm(
        mode === 'shared' ? t('library.confirmSwitchShared') : t('library.confirmSwitchPrivate'),
        t('library.confirmSwitchTitle')
    );
    if (!ok) {
        console.log('[switchStorageMode] cancelled');
        return;
    }
    console.log('[switchStorageMode] 2: confirmed, calling SetStorageMode');
    try {
        console.log('[switchStorageMode] 3: SetStorageMode start');
        await SetStorageMode(mode);
        console.log('[switchStorageMode] 4: reloadConfig start');
        await reloadConfig();
        console.log('[switchStorageMode] 5: refreshLibrary start');
        await refreshLibrary();
        console.log('[switchStorageMode] 6: all done');
    } catch (err) {
        console.error('[switchStorageMode] failed:', err);
        setStatus(
            `${t('library.dirSetFailed')}: ${err instanceof Error ? err.message : '未知错误'}`,
            true
        );
        throw err;
    }
    console.log('[switchStorageMode] 8: success');
}

export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
    const models = (await ScanModelDir('', externalPaths)) || [];
    setAllModels(models);
    return models;
}

export async function reloadConfig(): Promise<void> {
    console.log('[reloadConfig] GetConfig start');
    const cfg = await GetConfig();
    console.log('[reloadConfig] GetConfig done, root:', cfg?.resource_root);
    if (cfg) {
        setResourceRoot(cfg.resource_root || '');
        setLibraryRoot(cfg.resource_root || cfg.override_paths?.pmx || '');
        setOverridePaths(cfg.override_paths || {});
        setExternalPaths(cfg.external_paths || []);
    }
    console.log('[reloadConfig] state updated');
}

function getCurrentBrowsePath(): string[] {
    const stack = stackRegistry.modelStack;
    if (!stack || stack.levelCount === 0) {
        return [];
    }
    const dirs: string[] = [];
    for (let i = 0; i < stack.levelCount; i++) {
        const level = stack.getLevel(i);
        if (level && level.dir && level.dir !== '') {
            dirs.push(level.dir);
        }
    }
    return dirs;
}

function hasSubdir(
    parentDir: string,
    childName: string,
    filter?: (m: LibraryModel) => boolean
): boolean {
    const parent = normPath(parentDir);
    for (const m of allModels) {
        if (filter && !filter(m)) {
            continue;
        }
        const mdir = normPath(m.dir);
        if (!isUnderRoot(parent, mdir)) {
            continue;
        }
        const rel = mdir.substring(parent.length + 1);
        const parts = rel.split('/').filter(Boolean);
        if (parts.length > 0 && parts[0] === childName) {
            return true;
        }
    }
    return false;
}

function restoreBrowsePath(pathDirs: string[]): void {
    const stack = stackRegistry.modelStack;
    if (!stack || pathDirs.length <= 1 || !libraryRoot) {
        return;
    }
    const rootDir = normPath(libraryRoot);
    if (pathDirs[0] !== rootDir) {
        return;
    }
    const filter = (m: LibraryModel) => m.format === 'pmx';
    let currentDir = rootDir;
    for (let i = 1; i < pathDirs.length; i++) {
        const targetDir = normPath(pathDirs[i]);
        if (!isUnderRoot(currentDir, targetDir)) {
            break;
        }
        const childName = targetDir.substring(currentDir.length + 1).split('/')[0];
        if (!childName || !hasSubdir(currentDir, childName, filter)) {
            break;
        }
        const nextDir = currentDir + '/' + childName;
        const nextLevel = buildLevel(nextDir, childName, filter, stack);
        stack.push(nextLevel);
        currentDir = nextDir;
    }
}

export async function refreshLibrary(): Promise<void> {
    const prevPath = getCurrentBrowsePath();
    setStatus(t('library.scanning'), false);
    const models = await tryCatchStatus(async () => {
        const m = await rescanAndSync();
        return m;
    }, t('library.scanFailed'));
    if (models === undefined) {
        return;
    }
    setStatus(t('library.entriesCount', { n: (models || []).length }), true);
    CleanOrphanCache().catch((err) => console.warn('CleanOrphanCache (background):', err));
    if (
        dom.sceneOverlay.classList.contains('visible') &&
        dom.sceneOverlay.dataset.popupType === 'model'
    ) {
        showModelPopup();
        if (prevPath.length > 0 && libraryRoot) {
            const rootDir = normPath(libraryRoot);
            const rootLevel = buildLevel(
                rootDir,
                t('library.title'),
                (m) => m.format === 'pmx',
                stackRegistry.modelStack!,
                externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
            );
            stackRegistry.modelStack!.push(rootLevel);
            restoreBrowsePath(prevPath);
        }
    }
}

// ======== Import file via SAF file picker ========

export async function importFile(): Promise<void> {
    let path: string;
    try {
        path = await SelectImportFile();
    } catch (err) {
        // 用户取消文件选择 — Wails 抛 "cancelled by user"，静默忽略
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
        setStatus(t('library.importingZip'), false);
        try {
            await ImportZip(path);
            setStatus(t('library.zipImported'), true);
            await refreshLibrary().catch((err) => console.warn('refresh after zip import:', err));
        } catch (err) {
            setStatus(t('library.importFailed') + formatError(err), false);
            console.error('ImportZip failed:', err);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus(t('library.loadingModel'), false);
        try {
            await loadManager.load({ kind: 'actor', path });
        } catch (err) {
            setStatus(t('library.modelLoadFailed') + formatError(err), false);
            console.error('loadManager actor failed:', err);
        }
    } else if (lower.endsWith('.vmd')) {
        setStatus(t('library.loadingMotion'), false);
        try {
            await loadManager.load({ kind: 'vmd', path });
        } catch (err) {
            setStatus(t('library.vmdLoadFailed') + formatError(err), false);
            console.error('loadManager vmd failed:', err);
        }
    } else {
        setStatus(t('library.unsupportedFormat'), false);
    }
}

// ======== Refresh on external model load (drag-drop) ========

document.addEventListener('mmku:modelLoaded', () => {
    // 链式替换加载中，不自动重置菜单，避免与替换流程的栈操作冲突
    if (_isReplaceLoading) {
        return;
    }
    // 仅弹窗可见时刷新，避免干扰其他弹窗或后台操作
    if (
        !dom.sceneOverlay.classList.contains('visible') ||
        dom.sceneOverlay.dataset.popupType !== 'model'
    ) {
        return;
    }
    // If the popup is visible, this resets the view to top-level (intentional).
    // If not visible, the stack is pre-built and will show fresh content when opened.
    showModelPopup();
});
