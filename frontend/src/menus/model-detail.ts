// [doc:architecture] Model — 模型子菜单（从 library.ts 提取）
// 职责: 模型各层级构建（外观/信息/标签/表情/材质）

import {
    escapeHtml,
    cardContainer,
    setStatus,
    PopupLevel,
    modelMetaCache,
    computeLibraryRef,
    dom,
    stackRegistry,
} from '../core/config';
import { modelManager } from '../scene/scene';
import { getModelMorphs, setModelMorphWeight, resetModelMorphs } from '../scene/manager/model-ops';
import { resetModelTransform, removeModel } from '../scene/manager/model-ops';
import {
    buildTransformCard,
    type ResourceHandle,
} from './resource-detail-helpers';
import { buildMatRootLevel } from './model-material';
import { createIconifyIcon, softwareKindIcon } from '../core/icons';
import { slideRow, addFieldRow } from '../core/ui-helpers';
import { buildOutfitLevel } from './outfit-ui';
import { savePresetToLibDialog, buildPresetListLevel } from './model-preset';
import {
    GetTagsByModel,
    AddTag,
    RemoveTag,
    GetAllTags,
    OpenWithSoftware,
    ScanSoftwareDir,
} from '../core/wails-bindings';
import type { SoftwareEntry } from '../core/wails-bindings';
import { tryCatchStatus, logWarn } from '../core/utils';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== Open With (software tools submenu) ========

function buildOpenWithSchema(id: string): MenuNode[] {
    return [
        {
            id: 'open-with:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                void (async () => {
                    let entries: SoftwareEntry[];
                    try {
                        entries = await ScanSoftwareDir();
                    } catch {
                        entries = [];
                    }

                    if (entries.length === 0) {
                        container.innerHTML =
                            '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px 0;">' +
                            t('model-detail.noSoftware') +
                            '</div>';
                        return;
                    }

                    cardContainer(container, (c) => {
                        for (const sw of entries) {
                            slideRow(c, softwareKindIcon(sw.kind), sw.name, false, async () => {
                                const inst = modelManager.get(id);
                                if (!inst.filePath) {
                                    setStatus(t('model-detail.noFilePath'), false);
                                    return;
                                }
                                const _r = await tryCatchStatus(
                                    () => OpenWithSoftware(inst.filePath, sw.path, sw.args || ''),
                                    t('model-detail.launchFailed')
                                );
                                if (_r !== undefined) {
                                    setStatus(t('model-detail.launched', { name: sw.name }), true);
                                }
                            });
                        }

                        slideRow(
                            c,
                            'lucide:plus',
                            t('model-detail.manageSoftware'),
                            false,
                            () => {
                                // Pop model stack first so returning from settings shows root level
                                stackRegistry.modelStack?.popTo(0);
                                import('./library-core').then((m) => {
                                    stackRegistry.modelStack?.setLevel(0, {
                                        label: t('model-detail.model'),
                                        dir: '',
                                        items: m.buildModelRootItems(),
                                    });
                                    stackRegistry.modelStack?.reRender();
                                });
                                dom.btnSettings.click();
                            },
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            {
                                variant: 'accent',
                            }
                        );
                    });
                })();
            },
        },
    ];
}

export function buildOpenWithLevel(id: string): PopupLevel {
    return {
        label: t('model-detail.openWith'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildOpenWithSchema(id), container);
        },
    };
}

// ======== Model Detail Root ========

function buildModelSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [];
    }
    const handle: ResourceHandle = { id, kind: 'actor', name: inst.name };

    // 外观折叠组子节点
    const appearanceChildren: MenuNode[] = [
        {
            id: 'model:appearance:material',
            kind: 'custom',
            renderCustom: (inner) => {
                slideRow(inner, 'lucide:box', t('model-detail.materialAdjust'), true, () => {
                    const level = buildMatRootLevel(id, inst.name);
                    stackRegistry.modelStack.push(level);
                });
            },
        },
        {
            id: 'model:appearance:morph',
            kind: 'custom',
            renderCustom: (inner) => {
                slideRow(inner, 'lucide:smile', t('model-detail.morphPreview'), true, () => {
                    const level = buildMorphPreviewLevel(id);
                    stackRegistry.modelStack.push(level);
                });
            },
        },
        {
            id: 'model:appearance:outfit',
            kind: 'custom',
            renderCustom: (inner) => {
                slideRow(inner, 'lucide:shirt', t('model-detail.outfitVariant'), true, () => {
                    const level = buildOutfitLevel(id);
                    stackRegistry.modelStack.push(level);
                });
            },
        },
        {
            id: 'model:appearance:info',
            kind: 'custom',
            renderCustom: (inner) => {
                slideRow(inner, 'lucide:info', t('model-detail.basicInfo'), true, () => {
                    const level = buildModelInfoLevel(id);
                    stackRegistry.modelStack.push(level);
                });
            },
        },
        {
            id: 'model:appearance:bone',
            kind: 'custom',
            renderCustom: (inner) => {
                slideRow(inner, 'lucide:git-branch', t('model-detail.boneHierarchy'), true, () => {
                    const level = buildBoneHierarchyLevel(id);
                    stackRegistry.modelStack.push(level);
                });
            },
        },
    ];

    // 卡片 1 内的折叠组 schema
    const foldersSchema: MenuNode[] = [
        {
            id: 'model:appearance',
            kind: 'folder',
            label: 'model-detail.appearance',
            icon: 'lucide:palette',
            defaultOpen: true,
            children: appearanceChildren,
        },
        {
            id: 'model:transform',
            kind: 'folder',
            label: '拖拽操控',
            icon: 'lucide:move-3d',
            defaultOpen: false,
            renderCustom: (inner) => {
                buildTransformCard(inner, handle);
            },
        },
    ];

    return [
        // 卡片 1：折叠组集合
        {
            id: 'model:main',
            kind: 'custom',
            renderCustom: (container) => {
                cardContainer(container, (c) => {
                    renderMenu(foldersSchema, c);
                });
            },
        },
    ];
}

/**
 * 模型工具菜单——角色库根层行右齿轮 trailing 的【唯一】入口。
 * 详情面板内联「工具」折叠组已移除，工具动作统一收敛到此菜单（消除重复）。
 * 采用整体 renderCustom + cardContainer 包裹（与详情面板卡片同 lcard 范式）+ 每行 slideRow 自带 onClick，
 * 不依赖 SlideMenu 级 onItemClick。
 */
export function buildModelToolsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { dir: '', label: t('model-detail.tools'), items: [], renderCustom: () => {} };
    }
    return {
        dir: '',
        label: t('model-detail.tools'),
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:tag', t('model-detail.tags'), true, () => {
                    stackRegistry.modelStack?.push(buildModelTagsLevel(id));
                });
                slideRow(c, 'lucide:save', t('model-detail.savePreset'), false, () => {
                    savePresetToLibDialog(id);
                });
                slideRow(c, 'lucide:folder-open', t('model-detail.loadPreset'), true, () => {
                    stackRegistry.modelStack?.push(buildPresetListLevel(id));
                });
                slideRow(c, 'lucide:external-link', t('model-detail.openWith'), true, () => {
                    stackRegistry.modelStack?.push(buildOpenWithLevel(id));
                });
                slideRow(c, 'lucide:rotate-ccw', t('settings.transformReset', { kind: t('common.model') }), false, () => {
                    resetModelTransform(id);
                    setStatus(
                        t('settings.transformReset', { kind: t('common.model') }),
                        true
                    );
                });
                // 卸载不丢数据——模型可随时从库重新加载，无需二次确认
                slideRow(c, 'lucide:trash-2', t('model-detail.unloadModel'), false, () => {
                    removeModel(id);
                    setStatus(t('settings.unloaded', { name: inst.name }), true);
                    if (stackRegistry.modelStack) {
                        stackRegistry.modelStack.popTo(0);
                        import('./library-core').then((m) => {
                            stackRegistry.modelStack?.setLevel(0, {
                                label: t('model-detail.model'),
                                dir: '',
                                items: m.buildModelRootItems(),
                            });
                            stackRegistry.modelStack?.reRender();
                        });
                    }
                });
            });
        },
    };
}

export function buildModelLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.unknownModel'), dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildModelSchema(id), container);
        },
    };
}

// ======== Model Info ========

function buildModelInfoSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [];
    }
    return [
        {
            id: 'model-info:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                // [fix:meta-key] zip 内模型 inst.filePath 为解压临时路径 ≠ 库 file_path，
                // 而 modelMetaCache 以库绝对路径为 key（library-actions.ts 写入）。
                // 改用 inst.libraryPath（库引用路径）优先，缺失时回退 filePath，对齐写侧 key。
                const meta = modelMetaCache.get(inst.libraryPath ?? inst.filePath) ?? null;
                let vertCount = 0,
                    faceCount = 0;
                for (const m of inst.meshes ?? []) {
                    vertCount += m.getTotalVertices() || 0;
                    faceCount += m.getTotalIndices() || 0;
                }
                const boneCount = inst.mmdModel?.runtimeBones?.length ?? null;
                const morphCount = inst.mmdModel?.morph?.morphs?.length ?? null;
                // [audit-fix] 材质数必须以 PMX 材质列表为准：MMD 模型通常仅 1 个 Babylon 网格，
                // 而 MmdMesh.materials 才是真实材质数组（IMmdModel 不暴露 materials 字段）。
                // 直接对网格材质计数；mesh.material 单值时按 1 计。
                const matCount = (inst.meshes ?? []).reduce((n, m) => {
                    const mm = m as unknown as { materials?: readonly unknown[] };
                    return n + (mm.materials?.length ?? (m.material ? 1 : 0));
                }, 0);
                const fields: Array<{ label: string; value: string }> = [
                    { label: t('model-detail.fName'), value: inst.name },
                    {
                        label: t('model-detail.fFile'),
                        value: inst.filePath.split(/[/\\]/).pop() || inst.filePath,
                    },
                    {
                        label: t('model-detail.fType'),
                        value:
                            inst.kind === 'actor'
                                ? t('model-detail.actorModel')
                                : t('model-detail.stageModel'),
                    },
                    {
                        label: t('model-detail.fMotion'),
                        value: inst.vmdName || t('model-detail.none'),
                    },
                    { label: t('model-detail.fVerts'), value: vertCount.toLocaleString() },
                    { label: t('model-detail.fFaces'), value: (faceCount / 3).toLocaleString() },
                    { label: t('model-detail.fMaterials'), value: String(matCount) },
                    {
                        label: t('model-detail.fBones'),
                        value: boneCount !== null ? boneCount.toLocaleString() : 'N/A',
                    },
                    {
                        label: t('model-detail.fMorphs'),
                        value: morphCount !== null ? morphCount.toLocaleString() : 'N/A',
                    },
                    { label: t('model-detail.fNameJp'), value: meta?.name_jp || '—' },
                    { label: t('model-detail.fNameEn'), value: meta?.name_en || '—' },
                    {
                        label: t('model-detail.fComment'),
                        value: meta?.comment ? meta.comment.substring(0, 80) : '—',
                    },
                ];
                cardContainer(container, (c) => {
                    for (const f of fields) {
                        addFieldRow(c, f.label, escapeHtml(f.value));
                    }
                });
            },
        },
    ];
}

export function buildModelInfoLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.infoTitle'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.infoTitle'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildModelInfoSchema(id), container);
        },
    };
}

// ======== Tags Management ========

function buildModelTagsSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst) {
        return [];
    }
    const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
    return [
        {
            id: 'model-tags:fav',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                cardContainer(container, (c) => {
                    const favRow = document.createElement('div');
                    favRow.className = 'slide-item';
                    favRow.setAttribute('data-hint', t('model-detail.favHint'));
                    const refreshFav = async () => {
                        if (!libRef) {
                            return;
                        }
                        const tags = await GetTagsByModel(libRef);
                        if (!container.isConnected) {
                            return;
                        }
                        const isFav = tags && tags.includes('收藏');
                        favRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:star" style="color:${isFav ? 'var(--accent)' : 'var(--text-muted)'};"></iconify-icon></span><span class="slide-label" style="color:${isFav ? 'var(--accent)' : 'var(--text)'};">${isFav ? t('model-detail.faved') : t('model-detail.addFav')}</span>`;
                        favRow.onclick = async () => {
                            if (!libRef || !container.isConnected) {
                                return;
                            }
                            await tryCatchStatus(async () => {
                                if (isFav) {
                                    await RemoveTag(libRef, '收藏');
                                    setStatus(t('model-detail.unfaved'), true);
                                } else {
                                    await AddTag(libRef, '收藏');
                                    setStatus(t('model-detail.favedStatus'), true);
                                }
                                refreshFav();
                            }, t('model-detail.favFailed'));
                        };
                    };
                    refreshFav();
                    c.appendChild(favRow);
                });
            },
        },
        {
            id: 'model-tags:picker',
            kind: 'custom',
            renderCustom: (container) => {
                cardContainer(container, (c) => {
                    const tagContainer = document.createElement('div');
                    tagContainer.className = 'tag-container';
                    c.appendChild(tagContainer);

                    function refreshTags(): void {
                        if (!libRef) {
                            tagContainer.innerHTML =
                                '<span class="tag-empty">' + t('model-detail.noPath') + '</span>';
                            return;
                        }
                        GetTagsByModel(libRef)
                            .then((tags) => {
                                if (!container.isConnected) {
                                    return;
                                }
                                tagContainer.innerHTML = '';
                                if (!tags || tags.length === 0) {
                                    return;
                                }
                                for (const tag of tags) {
                                    const chip = document.createElement('span');
                                    chip.className = 'tag-chip';
                                    chip.innerHTML = `${escapeHtml(tag)} <span class="tag-del">✕</span>`;
                                    chip.title = t('model-detail.removeTagTitle');
                                    chip.addEventListener('click', async () => {
                                        if (!container.isConnected) {
                                            return;
                                        }
                                        const r = await tryCatchStatus(async () => {
                                            await RemoveTag(libRef, tag);
                                            return true;
                                        }, t('model-detail.favFailed'));
                                        if (r) {
                                            refreshTags();
                                            setStatus(t('model-detail.tagRemoved', { tag }), true);
                                        }
                                    });
                                    tagContainer.appendChild(chip);
                                }
                            })
                            .catch(() => {
                                tagContainer.textContent = t('model-detail.loadTagsFailed');
                            });
                    }
                    refreshTags();

                    const pickerLabel = document.createElement('div');
                    pickerLabel.style.cssText =
                        'font-size:11px;color:var(--text-dim);margin:8px 0 4px;';
                    pickerLabel.textContent = t('model-detail.addExistingTag');
                    c.appendChild(pickerLabel);

                    const picker = document.createElement('div');
                    picker.className = 'tag-container';
                    GetAllTags()
                        .then((allTags) => {
                            if (!container.isConnected) {
                                return;
                            }
                            const assigned = new Set<string>();
                            GetTagsByModel(libRef!)
                                .then((modelTags) => {
                                    if (!container.isConnected) {
                                        return;
                                    }
                                    (modelTags || []).forEach((tm) => assigned.add(tm));
                                    (allTags || []).forEach((tag) => {
                                        if (tag === '收藏') {
                                            return;
                                        }
                                        const chip = document.createElement('span');
                                        chip.className =
                                            'tag-chip' + (assigned.has(tag) ? ' active' : '');
                                        chip.style.cssText = assigned.has(tag)
                                            ? 'border:1px solid var(--accent);color:var(--accent);background:var(--accent-dim);'
                                            : 'border:1px solid var(--white-08);color:var(--text-dim);background:transparent;cursor:pointer;';
                                        chip.textContent = assigned.has(tag)
                                            ? `✓ ${tag}`
                                            : `+ ${tag}`;
                                        chip.title = assigned.has(tag)
                                            ? t('model-detail.tagAddedRemove')
                                            : t('model-detail.tagAdd');
                                        chip.addEventListener('click', () => {
                                            if (!libRef || !container.isConnected) {
                                                return;
                                            }
                                            if (assigned.has(tag)) {
                                                RemoveTag(libRef, tag)
                                                    .then(() => {
                                                        refreshTags();
                                                    })
                                                    .catch((e) =>
                                                        logWarn(
                                                            'model-detail',
                                                            'remove tag failed:',
                                                            e
                                                        )
                                                    );
                                            } else {
                                                AddTag(libRef, tag)
                                                    .then(() => {
                                                        refreshTags();
                                                    })
                                                    .catch((e) =>
                                                        logWarn(
                                                            'model-detail',
                                                            'add tag failed:',
                                                            e
                                                        )
                                                    );
                                            }
                                        });
                                        picker.appendChild(chip);
                                    });
                                    if (
                                        !allTags ||
                                        allTags.filter((tg) => tg !== '收藏').length === 0
                                    ) {
                                        picker.innerHTML =
                                            '<span style="color:var(--text-muted);font-size:11px;">' +
                                            t('model-detail.noGlobalTags') +
                                            '</span>';
                                    }
                                })
                                .catch((e) => logWarn('model-detail', 'tag load failed:', e));
                        })
                        .catch((e) => logWarn('model-detail', 'tag load failed:', e));
                    c.appendChild(picker);
                });
            },
        },
    ];
}

export function buildModelTagsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: t('model-detail.tagsFallback'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.tagsTitle'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildModelTagsSchema(id), container);
        },
    };
}

// ======== Morph Preview ========

function buildMorphPreviewSchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    const morphs = inst ? (getModelMorphs(id) ?? []) : [];
    const typeLabels: Record<number, string> = {
        0: t('model-detail.morphTypeGroup'),
        1: t('model-detail.morphTypeVertex'),
        2: t('model-detail.morphTypeBone'),
        3: t('model-detail.morphTypeUV'),
        8: t('model-detail.morphTypeMaterial'),
    };
    return [
        {
            id: 'morph-preview:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                cardContainer(container, (c) => {
                    const resetBtn = document.createElement('button');
                    resetBtn.className = 'btn btn-sm full-btn';
                    resetBtn.textContent = t('model-detail.resetAll');
                    resetBtn.addEventListener('click', () => {
                        resetModelMorphs(id);
                        c.querySelectorAll('.morph-slider').forEach((el) => {
                            (el as HTMLInputElement).value = '0';
                            const valLabel = (el as HTMLElement).parentElement.querySelector(
                                '.morph-val'
                            );
                            if (valLabel) {
                                valLabel.textContent = '0.00';
                            }
                        });
                        setStatus(t('model-detail.morphsReset'), true);
                    });
                    c.appendChild(resetBtn);

                    const list = document.createElement('div');
                    list.className = 'morph-list';
                    for (const m of morphs) {
                        const row = document.createElement('div');
                        row.className = 'morph-row';

                        const header = document.createElement('div');
                        header.className = 'morph-header';
                        const name = document.createElement('span');
                        name.className = 'morph-name';
                        name.textContent = m.name;
                        name.title = m.name;
                        const typeTag = document.createElement('span');
                        typeTag.className = 'morph-type';
                        typeTag.textContent =
                            typeLabels[m.type] ||
                            t('model-detail.morphTypeUnknown', { type: m.type });
                        const valLabel = document.createElement('span');
                        valLabel.className = 'morph-val';
                        valLabel.textContent = '0.00';
                        header.appendChild(name);
                        header.appendChild(typeTag);
                        header.appendChild(valLabel);

                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.min = '0';
                        slider.max = '1';
                        slider.step = '0.01';
                        slider.value = '0';
                        slider.className = 'morph-slider rng-input';
                        slider.addEventListener('input', () => {
                            const v = parseFloat(slider.value);
                            setModelMorphWeight(id, m.name, v);
                            valLabel.textContent = v.toFixed(2);
                        });

                        row.appendChild(header);
                        row.appendChild(slider);
                        list.appendChild(row);
                    }

                    if (morphs.length === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'morph-empty';
                        empty.textContent = t('model-detail.noMorph');
                        list.appendChild(empty);
                    }

                    c.appendChild(list);
                });
            },
        },
    ];
}

export function buildMorphPreviewLevel(id: string): PopupLevel {
    return {
        label: t('model-detail.morphPreview'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMorphPreviewSchema(id), container);
        },
    };
}

// ======== Bone Hierarchy ========

function buildBoneHierarchySchema(id: string): MenuNode[] {
    const inst = modelManager.get(id);
    if (!inst?.mmdModel) {
        return [];
    }
    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return [];
    }

    // Build parent→children map
    const childrenMap = new Map<number, number[]>();
    const rootIndices: number[] = [];
    const physicsSet = new Set<number>();
    // [audit-fix] 预建 骨骼→索引 映射，避免循环内 bones.indexOf 的 O(n²) 冗余查找
    const boneIndex = new Map<(typeof bones)[number], number>();
    for (let i = 0; i < bones.length; i++) {
        boneIndex.set(bones[i], i);
    }
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone.rigidBodyIndices.length > 0) {
            physicsSet.add(i);
        }
        const parentBone = bone.parentBone;
        if (parentBone) {
            const parentIdx = boneIndex.get(parentBone) ?? -1;
            if (parentIdx >= 0) {
                const list = childrenMap.get(parentIdx) ?? [];
                list.push(i);
                childrenMap.set(parentIdx, list);
                continue;
            }
        }
        rootIndices.push(i);
    }

    return [
        {
            id: 'bone-hierarchy:root',
            kind: 'custom',
            renderCustom: (container) => {
                container.classList.remove('render-card');
                cardContainer(container, (c) => {
                    const header = document.createElement('div');
                    header.style.cssText =
                        'font-size:var(--font-ui-sm);color:var(--text-bright);padding:4px 14px 8px;';
                    header.textContent = t('model-detail.boneCount', { n: bones.length });
                    c.appendChild(header);

                    function renderBoneTree(parent: HTMLElement, idx: number, depth: number): void {
                        const bone = bones[idx];
                        const row = document.createElement('div');
                        row.style.cssText = `display:flex;align-items:center;padding:2px 14px 2px ${14 + depth * 16}px;font-size:var(--font-ui);color:var(--text);gap:6px;`;

                        // Collapse/expand for non-leaf
                        const hasChildren = (childrenMap.get(idx)?.length ?? 0) > 0;
                        let expanded = depth < 2; // auto-expand top 2 levels
                        if (hasChildren) {
                            const toggle = document.createElement('span');
                            toggle.textContent = expanded ? '▾' : '▸';
                            toggle.style.cssText =
                                'cursor:pointer;flex:none;width:14px;text-align:center;color:var(--text-dim);font-size:var(--font-ui-sm);';
                            row.appendChild(toggle);

                            // Name label (click expands/collapses)
                            const label = document.createElement('span');
                            label.textContent = bone.name;
                            label.style.cssText =
                                'cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                            row.appendChild(label);

                            const childContainer = document.createElement('div');
                            let childrenRendered = false;

                            toggle.addEventListener('click', (e) => {
                                e.stopPropagation();
                                expanded = !expanded;
                                toggle.textContent = expanded ? '▾' : '▸';
                                childContainer.style.display = expanded ? '' : 'none';
                                if (expanded && !childrenRendered) {
                                    childrenRendered = true;
                                    const childIndices = childrenMap.get(idx) ?? [];
                                    for (const ci of childIndices) {
                                        renderBoneTree(childContainer, ci, depth + 1);
                                    }
                                }
                            });
                            label.addEventListener('click', () => toggle.click());

                            parent.appendChild(row);
                            childContainer.style.display = expanded ? '' : 'none';
                            parent.appendChild(childContainer);

                            if (expanded) {
                                childrenRendered = true;
                                const childIndices = childrenMap.get(idx) ?? [];
                                for (const ci of childIndices) {
                                    renderBoneTree(childContainer, ci, depth + 1);
                                }
                            }
                        } else {
                            // Leaf node
                            row.innerHTML = `<span style="flex:none;width:14px;"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);">${escapeHtml(bone.name)}</span>`;
                            parent.appendChild(row);
                        }

                        // Physics badge
                        if (physicsSet.has(idx)) {
                            const badge = document.createElement('span');
                            const iconEl = createIconifyIcon('lucide:zap');
                            if (iconEl) {
                                badge.appendChild(iconEl);
                            }
                            badge.title = t('model-detail.hasPhysics');
                            badge.style.cssText =
                                'font-size:11px;flex:none;color:var(--accent);display:inline-flex;';
                            row.appendChild(badge);
                        }
                    }

                    for (const ri of rootIndices) {
                        renderBoneTree(c, ri, 0);
                    }
                });
            },
        },
    ];
}

export function buildBoneHierarchyLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst?.mmdModel) {
        return { label: t('model-detail.boneHierarchy'), dir: '', items: [] };
    }
    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return { label: t('model-detail.boneHierarchy'), dir: '', items: [] };
    }
    return {
        label: t('model-detail.boneHierarchy'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildBoneHierarchySchema(id), container);
        },
    };
}
