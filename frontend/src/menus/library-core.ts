// [doc:architecture] Library Core — 模型库核心逻辑
// 从 library.ts 提取

import {
    GetConfig,
    SetResourceRoot,
    SetOverridePath,
    SelectDir,
    SelectImportFile,
    ImportZip,
    ScanModelDir,
    GetLibraryIndex,
    ExtractZip,
    CleanOrphanCache,
    ClearExtractCache,
    GetThumbnailBatch,
    GetModelMetaBatch,
    GetRecentModels,
    AddRecentModel,
    GetAllTags,
    GetModelsByTag,
} from '../core/wails-bindings';
import {
    dom,
    setStatus,
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
import { slideRow } from '../core/ui-helpers';
import { tryCatchStatus, getBrowseDir } from '../core/utils';
import { showConfirm } from '../core/dialog';
import { stackRegistry, getMenuWrapper } from '../core/config';

// ======== Model Stack ========

/** 判断 row.target 是否为文件目录浏览路径（而非内置命令或特殊条目） */
function isModelDirTarget(target: string | undefined): boolean {
    return !!target && !target.startsWith('models:') && !target.startsWith('__');
}

const makeModelMenu = (container: HTMLElement): SlideMenu => {
    return new SlideMenu({
        container,
        onClose: closeAllOverlays,
        onFolderEnter: (row) => {
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
                    label: '最近打开',
                    dir: '',
                    items:
                        recentModelsList.length > 0
                            ? recentModelsList.map((m) => modelToRow(m))
                            : [
                                  {
                                      kind: 'action' as const,
                                      label: '暂无记录',
                                      icon: 'clock',
                                      target: '',
                                      sublabel: '加载模型后会出现在这里',
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
                        label: '模型库',
                        dir: '',
                        items: [],
                        renderCustom: (container) => {
                            container.style.cssText =
                                'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                            container.innerHTML =
                                '<div>尚未设置模型库目录</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">请前往 设置 → 系统 中设置</div>';
                        },
                    };
                }
                const browseDir = getBrowseDir('pmx');
                return buildLevel(
                    browseDir,
                    '模型库',
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
                'models:browse': '浏览和加载 PMX 模型',
                'models:import-file': '从文件选择器导入 PMX/ZIP/VMD 文件',
            };
            const hint = hints[row.target || ''];
            if (hint) {
                setStatus(hint, false);
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
                        if (item.model.format === 'vmd' && motionBindingTargetId) {
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
                item.catTag
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
                        if (item.model.format === 'vmd' && motionBindingTargetId) {
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
                item.catTag
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
        const rel = mdir.startsWith(dir) ? mdir.substring(dir.length).replace(/^\//, '') : null;
        if (rel === null) {
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
        if (subdirIsLeaf.has(d) && !isRoot) {
            const entries = modelList.filter((m) => {
                if (filter && !filter(m)) {
                    return false;
                }
                return normPath(m.dir) === fullPath;
            });
            const allZip = entries.length > 0 && entries.every((m) => m.container === 'zip');
            if (!allZip) {
                for (const m of entries) {
                    items.push(modelToRow(m));
                }
                continue;
            }
        }
        items.unshift({
            kind: 'folder',
            label: d,
            icon: 'folder',
            target: fullPath,
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
            // 文件夹和模型行混合排序，按 label 比较
            return a.label.localeCompare(b.label, 'zh');
        });
    }

    return {
        label,
        dir,
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (card) => {
                renderItemsWithRAF(card, items, filter, targetStack);
            });
        },
    };
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
            ? m.zip_inner.split('/').pop() || '未知'
            : fp.split('/').pop() || '未知';
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
    const comment = cached?.comment || m.comment || '';
    return {
        kind: 'model',
        label,
        icon,
        target: m.file_path,
        sublabel: comment ? comment.substring(0, 28) : undefined,
        model: m,
        catTag: m.category || undefined,
        editable: m.format === 'pmx',
        onAddClick: () => {
            closeAllOverlays();
            onModelRowClick(m);
        },
    };
}

let _isExtracting = false;

function onModelRowClick(m: LibraryModel): void {
    if (_isExtracting) {
        setStatus('正在解压中，请稍候...', false);
        return;
    }
    const isStage = m.type === 'stage' || m.type === 'scene';
    if (m.format === 'pmx') {
        const ref = computeLibraryRef(m.file_path);
        if (ref) {
            AddRecentModel(ref).catch(() => {});
            setRecentModels([ref, ...recentModels.filter((r) => r !== ref)].slice(0, 20));
        }
    }
    if (m.container === 'zip') {
        closeAllOverlays();
        setStatus('正在解压 zip...', false);
        _isExtracting = true;
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? '✓ 命中缓存' : '✓ 解压完成', true);
                if (m.format === 'vmd') {
                    loadManager.load({ kind: 'vmd', path: result.file_path });
                } else {
                    loadManager.load({ kind: isStage ? 'stage' : 'actor', path: result.file_path });
                }
            })
            .catch((err) => {
                setStatus('✗ 解压失败: ' + formatError(err), false);
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
        label: '标签',
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
                    fl.textContent = '收藏';
                    favRow.appendChild(fl);
                    const fs = document.createElement('span');
                    fs.className = 'slide-sublabel';
                    fs.textContent = `${favRefs ? favRefs.length : 0} 个模型`;
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
                        em.textContent = '暂无其他标签';
                        c.appendChild(em);
                    }
                });

                cardContainer(container, (c) => {
                    slideRow(c, 'lucide:plus', '新建标签', false, () => {
                        setStatus('请先进入模型页，在模型页中为模型添加标签', false);
                        stackRegistry.modelStack.pop();
                    });
                });
            } catch (err) {
                console.warn('buildTagsOverviewLevel:', err);
                container.textContent = '加载标签失败';
            }
        },
    };
}

function buildTagDetailLevel(tagName: string): PopupLevel {
    return {
        label: `标签: ${tagName}`,
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            try {
                const modelRefs = await GetModelsByTag(tagName);
                if (!modelRefs || modelRefs.length === 0) {
                    container.innerHTML =
                        '<div class="slide-empty" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">该标签下没有模型</div>';
                    return;
                }
                const matched = (allModels || []).filter((m) => {
                    const ref = computeLibraryRef(m.file_path);
                    return ref && modelRefs.includes(ref);
                });
                if (matched.length === 0) {
                    container.innerHTML =
                        '<div class="slide-empty" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;">未找到匹配的模型（库可能已变更）</div>';
                    return;
                }
                cardContainer(container, (c) => {
                    for (const m of matched) {
                        const row = modelToRow(m);
                        slideRow(c, row.icon, row.label, false, () => onModelRowClick(m));
                    }
                });
            } catch (err) {
                console.warn('buildTagDetailLevel:', err);
                container.textContent = '加载失败';
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
    for (const [id, inst] of actors) {
        items.push({
            kind: 'folder',
            label: inst.name,
            icon: 'tabler:cube-3d-sphere',
            target: `scene:${id}`,
        });
    }

    // 分割线 + 操作入口
    if (actors.length > 0) {
        items.push({ kind: 'divider', label: '', icon: '', target: '' });
    }
    items.push({
        kind: 'folder',
        label: '加载模型',
        icon: 'lucide:folder',
        target: 'models:browse',
    });
    items.push({
        kind: 'action',
        label: '导入文件',
        icon: 'lucide:file-plus',
        target: 'models:import-file',
    });
    items.push({
        kind: 'action',
        label: '重新扫描',
        icon: 'lucide:refresh-cw',
        target: 'models:rescan',
    });
    items.push({ kind: 'folder', label: '最近打开', icon: 'lucide:clock', target: '__recent__' });
    items.push({ kind: 'folder', label: '标签', icon: 'lucide:tag', target: '__tags__' });

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
            label: '模型',
            dir: '',
            items: buildModelRootItems(),
        });
        stackRegistry.modelStack.reRender();
        return;
    }

    // 首次：创建 SlideMenu
    stackRegistry.modelStack = makeModelMenu(wrapper);
    stackRegistry.modelStack.reset({
        label: '模型',
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
            setStatus(
                '📦 首次使用：点击这里打开模型库 → 加载模型，模型目录请在 ⚙ 设置中配置',
                false
            );
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
        setStatus('📦 点击这里浏览模型 · 💃 点击这里加载动作 · 拖拽旋转 · 滚轮缩放', false);
    } catch (err) {
        console.warn('initLibrary:', err);
        setStatus('✗ 模型库加载失败: ' + formatError(err), false);
    }
}

export async function selectResourceRoot(): Promise<void> {
    const ok = await showConfirm(
        '修改资源根目录会导致模型库重新扫描。确定继续吗？',
        '切换资源根目录'
    );
    if (!ok) {
        return;
    }
    const dir = await SelectDir();
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetResourceRoot(dir);
        await reloadConfig();
        await refreshLibrary();
    }, '✗ 目录设置失败');
}

export async function selectOverridePath(category: string): Promise<void> {
    const dir = await SelectDir();
    if (!dir) {
        return;
    }
    await tryCatchStatus(async () => {
        await SetOverridePath(category, dir);
        await reloadConfig();
        await refreshLibrary();
    }, '✗ 目录设置失败');
}

export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
    const models = (await ScanModelDir('', externalPaths)) || [];
    setAllModels(models);
    return models;
}

export async function reloadConfig(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg) {
        setResourceRoot(cfg.resource_root || '');
        setLibraryRoot(cfg.resource_root || cfg.override_paths?.pmx || ''); // keep in sync, fallback to pmx override
        setOverridePaths(cfg.override_paths || {});
        setExternalPaths(cfg.external_paths || []);
    }
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
        if (!mdir.startsWith(parent + '/')) {
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
        if (!targetDir.startsWith(currentDir + '/')) {
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
    setStatus('扫描中...', false);
    const models = await tryCatchStatus(async () => {
        await ClearExtractCache();
        const m = await rescanAndSync();
        return m;
    }, '✗ 扫描失败');
    if (models === undefined) {
        return;
    }
    setStatus(`✓ ${(models || []).length} 个条目`, true);
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
                '模型库',
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
        setStatus('✗ 选择文件失败: ' + formatError(err), false);
        return;
    }
    if (!path) {
        return;
    }
    const lower = path.toLowerCase();
    if (lower.endsWith('.zip')) {
        setStatus('⏳ 导入压缩包...', false);
        try {
            await ImportZip(path);
            setStatus('✓ 压缩包已导入', true);
            await refreshLibrary().catch((err) => console.warn('refresh after zip import:', err));
        } catch (err) {
            setStatus('✗ 导入失败: ' + formatError(err), false);
            console.error('ImportZip failed:', err);
        }
    } else if (lower.endsWith('.pmx')) {
        setStatus('⏳ 加载模型...', false);
        try {
            await loadManager.load({ kind: 'actor', path });
        } catch (err) {
            setStatus('✗ 模型加载失败: ' + formatError(err), false);
            console.error('loadManager actor failed:', err);
        }
    } else if (lower.endsWith('.vmd')) {
        setStatus('⏳ 加载动作...', false);
        try {
            await loadManager.load({ kind: 'vmd', path });
        } catch (err) {
            setStatus('✗ VMD 加载失败: ' + formatError(err), false);
            console.error('loadManager vmd failed:', err);
        }
    } else {
        setStatus('不支持的文件格式（支持 PMX / ZIP / VMD）', false);
    }
}

// ======== Refresh on external model load (drag-drop) ========

document.addEventListener('mmku:modelLoaded', () => {
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
