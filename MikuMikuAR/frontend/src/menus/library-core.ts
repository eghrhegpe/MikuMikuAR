// [doc:architecture] Library Core — 模型库核心逻辑
// 从 library.ts 提取

import {
    GetConfig,
    SetLibraryRoot,
    SelectDir,
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
} from '../../wailsjs/go/main/App';
import {
    dom,
    setStatus,
    setLibraryRoot,
    libraryRoot,
    setAllModels,
    allModels,
    setExternalPaths,
    externalPaths,
    LibraryModel,
    PopupRow,
    PopupLevel,
    escapeHtml,
    normPath,
    thumbnailCache,
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
    cardContainer,
} from '../core/config';
import { loadPMXFile, loadVMDFromPath, removeModel, resetModelMorphs } from '../scene/scene';
import { buildModelDetailLevel } from './model-detail';
import { buildDanceSetDetailLevel, loadDanceSets } from './motion-popup';
import { SlideMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import { slideRow } from '../core/ui-helpers';
import { stackRegistry } from '../core/config';

// ======== Model Stack ========

const makeModelMenu = (): SlideMenu => {
    return new SlideMenu({
        container: dom.sceneOverlay,
        onClose: closeAllOverlays,
        onFolderEnter: (row) => {
            if (row.target && row.target.startsWith('scene:')) {
                setMotionBindingTargetId(null);
                const id = row.target.replace('scene:', '');
                const inst = modelRegistry.get(id);
                if (!inst) {
                    return null;
                }
                return buildModelDetailLevel(id);
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
            if (row.target && row.target.startsWith('__dance_set:')) {
                const setId = row.target.replace('__dance_set:', '');
                return buildDanceSetDetailLevel(setId);
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
                return buildLevel(
                    libraryRoot,
                    '模型库',
                    (m) => m.format === 'pmx',
                    stackRegistry.modelStack!,
                    externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
                );
            }
            if (row.target && !row.target.startsWith('models:') && !row.target.startsWith('__')) {
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
                if (row.model.format === 'vmd' && motionBindingTargetId) {
                    closeAllOverlays();
                    loadVMDFromPath(row.model.file_path, motionBindingTargetId);
                    setMotionBindingTargetId(null);
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
        },
        onHover: (row, entering) => {
            if (!entering) {
                setStatus('', false);
                return;
            }
            const hints: Record<string, string> = {
                'models:browse': '浏览和加载 PMX 模型',
            };
            const hint = hints[row.target || ''];
            if (hint) {
                setStatus(hint, false);
            }
        },
    });
};

// ======== Thumbnail batch loading ========

async function loadThumbnailsForLevel(level: PopupLevel): Promise<void> {
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

async function ensureModelMeta(pmxPaths: string[]): Promise<void> {
    const uncached = pmxPaths.filter((p) => !modelMetaCache.has(p));
    if (uncached.length === 0) {
        return;
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
    }
}

// ======== Build list from scan data ========

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

    for (const m of allModels) {
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
            const entries = allModels.filter((m) => {
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
    return {
        label,
        dir,
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (card) => {
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
                                const next = buildLevel(
                                    item.target,
                                    item.label,
                                    filter,
                                    targetStack
                                );
                                const stack = targetStack || stackRegistry.modelStack;
                                stack.push(next);
                            } else if (item.model) {
                                if (item.model.format === 'vmd' && motionBindingTargetId) {
                                    const id = motionBindingTargetId;
                                    setMotionBindingTargetId(null);
                                    closeAllOverlays();
                                    loadVMDFromPath(item.model.file_path, id);
                                } else {
                                    onModelRowClick(item.model);
                                }
                            }
                        },
                        item.sublabel,
                        item.catTag
                    );
                }
            });
        },
    };
}

// Register buildLevel for use by motion-popup.ts (avoids circular import)
stackRegistry.buildLevel = buildLevel;

function modelToRow(m: LibraryModel): PopupRow {
    let icon = 'box';
    if (m.format === 'vmd') {
        icon = 'music';
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
            label = cached.name_en || m.name_en || cached.name_jp || m.name_jp || filename;
            break;
        case 'name_jp':
        default:
            label = cached.name_jp || m.name_jp || cached.name_en || m.name_en || filename;
            break;
    }
    const comment = cached.comment || m.comment || '';
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

function onModelRowClick(m: LibraryModel): void {
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
        ExtractZip(m.file_path, m.zip_inner)
            .then((result) => {
                setStatus(result.cached ? '✓ 命中缓存' : '✓ 解压完成', true);
                if (m.format === 'vmd') {
                    loadVMDFromPath(result.file_path);
                } else {
                    loadPMXFile(result.file_path, isStage);
                }
            })
            .catch((err) => {
                setStatus('✗ 解压失败: ' + (err as Error).message, false);
            });
        return;
    }
    closeAllOverlays();
    if (m.format === 'pmx') {
        loadPMXFile(m.file_path, isStage);
    } else if (m.format === 'vmd') {
        loadVMDFromPath(m.file_path);
    }
}

function replaceModel(m: LibraryModel): void {
    if (focusedModelId) {
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
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        const is = document.createElement('span');
                        is.className = 'slide-icon';
                        const ie = createIconifyIcon('lucide:tag');
                        if (ie) {
                            is.appendChild(ie);
                        }
                        row.appendChild(is);
                        const ls = document.createElement('span');
                        ls.className = 'slide-label';
                        ls.textContent = tag;
                        row.appendChild(ls);
                        const ar = document.createElement('span');
                        ar.className = 'slide-arrow';
                        ar.textContent = '>';
                        row.appendChild(ar);
                        row.addEventListener('click', () =>
                            stackRegistry.modelStack.push(buildTagDetailLevel(tag))
                        );
                        c.appendChild(row);
                    }

                    if (regularTags.length === 0) {
                        const em = document.createElement('div');
                        em.className = 'slide-empty';
                        em.textContent = '暂无其他标签';
                        c.appendChild(em);
                    }
                });

                cardContainer(container, (c) => {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const is = document.createElement('span');
                    is.className = 'slide-icon';
                    const ie = createIconifyIcon('lucide:plus');
                    if (ie) {
                        is.appendChild(ie);
                    }
                    row.appendChild(is);
                    const ls = document.createElement('span');
                    ls.className = 'slide-label';
                    ls.textContent = '新建标签';
                    row.appendChild(ls);
                    row.addEventListener('click', () => {
                        setStatus('请先进入模型详情页，在详情中为模型添加标签', false);
                        stackRegistry.modelStack.pop();
                    });
                    c.appendChild(row);
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
                const matched = allModels.filter((m) => {
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
                        const el = document.createElement('div');
                        el.className = 'slide-item';
                        const is = document.createElement('span');
                        is.className = 'slide-icon';
                        const ie = createIconifyIcon(row.icon);
                        if (ie) {
                            is.appendChild(ie);
                        } else {
                            is.textContent = row.icon;
                        }
                        el.appendChild(is);
                        const ls = document.createElement('span');
                        ls.className = 'slide-label';
                        ls.textContent = row.label;
                        el.appendChild(ls);
                        el.addEventListener('click', () => onModelRowClick(m));
                        c.appendChild(el);
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
export function showModelPopup(): void {
    // 不再自管理生命周期，由 toggleOverlay 统一管理
    // 清空旧内容，避免与其他弹窗 DOM 混在一起
    dom.sceneOverlay.innerHTML = '';
    dom.sceneOverlay.classList.remove('sceneOverlay-motion', 'sceneOverlay-settings');
    dom.sceneOverlay.classList.add('sceneOverlay-model'); // 宽度 280px
    dom.sceneOverlay.dataset.popupType = 'model';

    // 强制重建 MenuStack，避免 innerHTML 清空后旧 stack 持有已分离的 DOM 引用
    stackRegistry.modelStack = makeModelMenu();

    stackRegistry.modelStack.reset({
        label: '模型',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');

            // Card 1: loaded models
            try {
                if (modelRegistry.size > 0) {
                    cardContainer(container, (c) => {
                        for (const [id, inst] of modelRegistry) {
                            slideRow(c, 'tabler:cube-3d-sphere', inst.name, true, () => {
                                const level = buildModelDetailLevel(id);
                                stackRegistry.modelStack.push(level);
                            });
                        }
                    });
                }
            } catch (err) {
                console.warn('showModelPopup: loaded models render error:', err);
                const warn = document.createElement('div');
                warn.style.cssText = 'padding:8px 12px;font-size:12px;color:var(--text-dim);';
                warn.textContent = '加载模型列表失败';
                container.appendChild(warn);
            }

            // Card 2: browse & scan
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:folder', '加载模型', true, () => {
                    if (!libraryRoot) {
                        stackRegistry.modelStack.push({
                            label: '模型库',
                            dir: '',
                            items: [],
                            renderCustom: (c2) => {
                                c2.style.cssText =
                                    'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                                c2.innerHTML =
                                    '<div>尚未设置模型库目录</div><div style="font-size:11px;margin-top:8px;color:var(--text-dark);">请前往 设置 → 系统 中设置</div>';
                            },
                        });
                        return;
                    }
                    const level = buildLevel(
                        libraryRoot,
                        '模型库',
                        (m) => m.format === 'pmx',
                        stackRegistry.modelStack!,
                        externalPaths.map((ep) => ({ label: ep.name, path: ep.path }))
                    );
                    stackRegistry.modelStack.push(level);
                });
                slideRow(c, 'lucide:refresh-cw', '重新扫描', false, () => {
                    refreshLibrary();
                });
            });

            // Card 3: recent & tags
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:clock', '最近打开', true, () => {
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
                    stackRegistry.modelStack.push({
                        label: '最近打开',
                        dir: '',
                        items: [],
                        renderCustom: (c2) => {
                            c2.classList.remove('render-card');
                            if (recentModelsList.length === 0) {
                                const empty = document.createElement('div');
                                empty.style.cssText =
                                    'padding:24px;text-align:center;color:var(--text-muted);font-size:13px;';
                                empty.innerHTML =
                                    '<div style="font-size:28px;margin-bottom:6px;">🕐</div><div>暂无记录</div><div style="font-size:11px;margin-top:4px;color:var(--text-dark);">加载模型后会出现在这里</div>';
                                c2.appendChild(empty);
                                return;
                            }
                            cardContainer(c2, (c3) => {
                                for (const m of recentModelsList) {
                                    const row = modelToRow(m);
                                    const el = document.createElement('div');
                                    el.className = 'slide-item';
                                    el.setAttribute('data-hint', row.sublabel || '');
                                    const iconSpan = document.createElement('span');
                                    iconSpan.className = 'slide-icon';
                                    const iconEl = createIconifyIcon(row.icon);
                                    if (iconEl) {
                                        iconSpan.appendChild(iconEl);
                                    }
                                    el.appendChild(iconSpan);
                                    const labelSpan = document.createElement('span');
                                    labelSpan.className = 'slide-label';
                                    labelSpan.textContent = row.label;
                                    el.appendChild(labelSpan);
                                    el.addEventListener('click', () => onModelRowClick(m));
                                    c3.appendChild(el);
                                }
                            });
                        },
                    });
                });
                slideRow(c, 'lucide:tag', '标签', true, () => {
                    const level = buildTagsOverviewLevel();
                    stackRegistry.modelStack.push(level);
                });
            });
        },
    });
}

// ======== Library loading ========

export async function initLibrary(): Promise<void> {
    try {
        const cfg = await GetConfig();
        if (!cfg.library_root) {
            setStatus(
                '📦 首次使用：点击这里打开模型库 → 加载模型，模型目录请在 ⚙ 设置中配置',
                false
            );
            return;
        }
        setLibraryRoot(cfg.library_root);
        setExternalPaths(cfg.external_paths || []);
        if (cfg.display_name_priority) {
            setDisplayNamePriority(cfg.display_name_priority as DisplayNamePriority);
        }
        try {
            const recents = await GetRecentModels();
            if (recents && recents.length > 0) {
                setRecentModels(recents);
            }
        } catch (err) {
            console.warn('Load recent models:', err);
        }
        try {
            await loadDanceSets();
        } catch (err) {
            console.warn('Load dance sets:', err);
        }
        try {
            const cached = await GetLibraryIndex();
            const validCached = cached ? cached.filter((m: any) => m.file_path) : [];
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
        setStatus('✗ 模型库加载失败', false);
    }
}

async function selectAndSetLibraryRoot(): Promise<void> {
    try {
        const dir = await SelectDir();
        if (!dir) {
            return;
        }
        setLibraryRoot(dir);
        setStatus('扫描模型库...', false);
        const models = await rescanAndSync();
        setStatus(`✓ ${models.length} 个条目`, true);
        showModelPopup();
    } catch (err) {
        console.error('Error setting library root:', err);
        setStatus('✗ 目录选择失败', false);
    }
}

export async function rescanAndSync(dir?: string): Promise<LibraryModel[]> {
    const root = dir ?? libraryRoot;
    const models = await ScanModelDir(root, externalPaths);
    setAllModels(models);
    await SetLibraryRoot(root);
    return models;
}

export async function reloadConfig(): Promise<void> {
    const cfg = await GetConfig();
    if (cfg) {
        setLibraryRoot(cfg.library_root || '');
        setExternalPaths(cfg.external_paths || []);
    }
}

export async function refreshLibrary(): Promise<void> {
    setStatus('扫描中...', false);
    try {
        await ClearExtractCache();
        const models = await rescanAndSync();
        setStatus(`✓ ${models.length} 个条目`, true);
        CleanOrphanCache().catch((err) => console.warn('CleanOrphanCache (background):', err));
        if (
            dom.sceneOverlay.classList.contains('visible') &&
            dom.sceneOverlay.dataset.popupType === 'model'
        ) {
            showModelPopup();
        }
    } catch (err) {
        setStatus('✗ 扫描失败', false);
    }
}

// ======== Refresh on external model load (drag-drop) ========

document.addEventListener('mmku:modelLoaded', () => {
    // Always refresh the stack so the loaded-models list is up-to-date.
    // If the popup is visible, this resets the view to top-level (intentional).
    // If not visible, the stack is pre-built and will show fresh content when opened.
    showModelPopup();
});
