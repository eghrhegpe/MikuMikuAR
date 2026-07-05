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
import {
    modelManager,
    getModelMorphs,
    setModelMorphWeight,
    resetModelMorphs,
    setModelVisibility,
    setModelOpacity,
    removeModel,
} from '../scene/scene';
import { buildMatRootLevel } from './model-material';
import { createIconifyIcon, softwareKindIcon } from '../core/icons';
import {
    slideRow,
    addModeSlider,
    addCollapsible,
} from '../core/ui-helpers';
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

// ======== Open With (software tools submenu) ========

export function buildOpenWithLevel(id: string): PopupLevel {
    return {
        label: '用…打开',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            let entries: SoftwareEntry[];
            try {
                entries = await ScanSoftwareDir();
            } catch {
                entries = [];
            }

            if (entries.length === 0) {
                container.innerHTML =
                    '<div style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px 0;">暂无可用软件<br>请先在设置中添加</div>';
                return;
            }

            cardContainer(container, (c) => {
                for (const sw of entries) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.innerHTML = `<span class="slide-icon"><iconify-icon icon="${softwareKindIcon(sw.kind)}"></iconify-icon></span><span class="slide-label">${escapeHtml(sw.name)}</span>`;
                    row.addEventListener('click', async () => {
                        const inst = modelManager.get(id);
                        if (!inst.filePath) {
                            setStatus('✗ 模型无文件路径', false);
                            return;
                        }
                        try {
                            await OpenWithSoftware(inst.filePath, sw.path, sw.args || '');
                            setStatus(`✓ 已启动: ${sw.name}`, true);
                        } catch (err: unknown) {
                            setStatus('✗ ' + (err instanceof Error ? err.message : String(err)), false);
                        }
                    });
                    c.appendChild(row);
                }

                const manageLink = document.createElement('div');
                manageLink.className = 'slide-item';
                manageLink.innerHTML =
                    '<span class="slide-icon"><iconify-icon icon="lucide:plus"></iconify-icon></span><span class="slide-label" style="color:var(--accent);">管理软件</span>';
                manageLink.addEventListener('click', () => {
                    dom.btnSettings.click();
                });
                c.appendChild(manageLink);
            });
        },
    };
}

// ======== Model Detail Root ========

export function buildModelLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: '未知模型', dir: '', items: [] };
    }
    return {
        label: inst.name,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // 外观折叠组
                addCollapsible(c, {
                    title: '外观',
                    icon: 'lucide:palette',
                    defaultOpen: true,
                    renderContent: (inner) => {
                        slideRow(inner, 'lucide:box', '材质调节', true, () => {
                            const level = buildMatRootLevel(id, inst.name);
                            stackRegistry.modelStack.push(level);
                        });
                        slideRow(inner, 'lucide:smile', '表情预览', true, () => {
                            const level = buildMorphPreviewLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                        slideRow(inner, 'lucide:shirt', '服装变体', true, () => {
                            const level = buildOutfitLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                    },
                });

                // 信息折叠组
                addCollapsible(c, {
                    title: '信息',
                    icon: 'lucide:info',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        slideRow(inner, 'lucide:info', '基本信息', true, () => {
                            const level = buildModelInfoLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                        slideRow(inner, 'lucide:git-branch', '骨骼层级', true, () => {
                            const level = buildBoneHierarchyLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                        slideRow(inner, 'lucide:tag', '标签管理', true, () => {
                            const level = buildModelTagsLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                        // 可见性直接嵌入信息处
                        let visMode: 'visible' | 'semi' | 'hidden';
                        if (inst.visible && inst.opacity >= 0.99) {
                            visMode = 'visible';
                        } else if (inst.visible && inst.opacity < 0.99) {
                            visMode = 'semi';
                        } else {
                            visMode = 'hidden';
                        }
                        addModeSlider(
                            inner,
                            '可见性',
                            [
                                { value: 'visible', label: '显示' },
                                { value: 'semi', label: '半透明' },
                                { value: 'hidden', label: '隐藏' },
                            ],
                            visMode,
                            (v) => {
                                if (v === 'visible') {
                                    setModelVisibility(id, true);
                                    setModelOpacity(id, 1);
                                } else if (v === 'semi') {
                                    setModelVisibility(id, true);
                                    setModelOpacity(id, 0.5);
                                } else {
                                    setModelVisibility(id, false);
                                }
                                stackRegistry.modelStack.updateControls();
                                setStatus(
                                    v === 'visible' ? '完全可见' : v === 'semi' ? '半透明 50%' : '完全隐藏',
                                    true
                                );
                            },
                            'lucide:eye',
                            undefined,
                            {
                                bind: () => {
                                    const inst = modelManager.get(id);
                                    if (!inst) return 'visible';
                                    if (inst.visible && inst.opacity >= 0.99) return 'visible';
                                    if (inst.visible && inst.opacity < 0.99) return 'semi';
                                    return 'hidden';
                                },
                            }
                        );
                    },
                });

                // 工具折叠组
                addCollapsible(c, {
                    title: '工具',
                    icon: 'lucide:wrench',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        slideRow(inner, 'lucide:save', '保存预设', false, () => {
                            savePresetToLibDialog(id);
                        });
                        slideRow(inner, 'lucide:folder-open', '加载预设', true, () => {
                            const level = buildPresetListLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                        slideRow(inner, 'lucide:external-link', '用…打开', true, () => {
                            const level = buildOpenWithLevel(id);
                            stackRegistry.modelStack.push(level);
                        });
                    },
                });
            });

            // 危险操作：移除（独立在底部）
            cardContainer(container, (c) => {
                const removeBtn = document.createElement('div');
                removeBtn.className = 'slide-item';
                const removeIcon = document.createElement('span');
                removeIcon.className = 'slide-icon';
                const removeIconEl = createIconifyIcon('lucide:trash-2');
                if (removeIconEl) {
                    removeIcon.appendChild(removeIconEl);
                }
                const removeLabel = document.createElement('span');
                removeLabel.className = 'slide-label danger-text';
                removeLabel.textContent = '移除模型';
                removeBtn.appendChild(removeIcon);
                removeBtn.appendChild(removeLabel);
                removeBtn.addEventListener('click', async () => {
                    const { getSceneMenu } = await import('./scene-menu');
                    getSceneMenu()?.popTo(0);
                    removeModel(id);
                });
                c.appendChild(removeBtn);
            });
        },
    };
}

// ======== Model Info ========

export function buildModelInfoLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: '模型信息', dir: '', items: [] };
    }
    return {
        label: '模型信息',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            const meta = modelMetaCache.get(inst.filePath) ?? null;
            let vertCount = 0,
                faceCount = 0;
            for (const m of inst.meshes ?? []) {
                vertCount += m.getTotalVertices() || 0;
                faceCount += m.getTotalIndices() || 0;
            }
            const boneCount = inst.mmdModel?.runtimeBones?.length ?? null;
            const morphCount = inst.mmdModel?.morph?.morphs?.length ?? null;
            const fields: Array<{ label: string; value: string }> = [
                { label: '名称', value: inst.name },
                { label: '文件', value: inst.filePath.split('/').pop() || inst.filePath },
                { label: '类型', value: inst.kind === 'actor' ? '角色模型' : '舞台模型' },
                { label: '动作', value: inst.vmdName || '无' },
                { label: '顶点数', value: vertCount.toLocaleString() },
                { label: '面数', value: (faceCount / 3).toLocaleString() },
                { label: '材质数', value: String(inst.meshes?.length ?? 0) },
                { label: '骨骼数', value: boneCount !== null ? boneCount.toLocaleString() : 'N/A' },
                {
                    label: '表情数',
                    value: morphCount !== null ? morphCount.toLocaleString() : 'N/A',
                },
                { label: '日文名', value: meta?.name_jp || '—' },
                { label: '英文名', value: meta?.name_en || '—' },
                { label: '备注', value: meta?.comment ? meta.comment.substring(0, 80) : '—' },
            ];
            cardContainer(container, (c) => {
                for (const f of fields) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    row.style.cssText =
                        'display:flex;justify-content:space-between;padding:6px 14px;min-height:auto;margin:0;';
                    row.innerHTML = `<span class="slide-label" style="color:var(--text-dim);flex:none;">${f.label}</span><span class="slide-label" style="text-align:right;max-width:60%;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(f.value)}</span>`;
                    c.appendChild(row);
                }
            });
        },
    };
}

// ======== Tags Management ========

export function buildModelTagsLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst) {
        return { label: '标签', dir: '', items: [] };
    }
    const libRef = inst.filePath ? computeLibraryRef(inst.filePath) : null;
    return {
        label: '模型标签',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');

            cardContainer(container, (c) => {
                const favRow = document.createElement('div');
                favRow.className = 'slide-item';
                favRow.setAttribute('data-hint', '收藏此模型到收藏夹');
                const refreshFav = async () => {
                    if (!libRef) {
                        return;
                    }
                    const tags = await GetTagsByModel(libRef);
                    const isFav = tags && tags.includes('收藏');
                    favRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:star" style="color:${isFav ? 'var(--accent)' : 'var(--text-muted)'};"></iconify-icon></span><span class="slide-label" style="color:${isFav ? 'var(--accent)' : 'var(--text)'};">${isFav ? '★ 已收藏' : '☆ 加入收藏'}</span>`;
                    favRow.onclick = async () => {
                        if (!libRef) {
                            return;
                        }
                        try {
                            if (isFav) {
                                await RemoveTag(libRef, '收藏');
                                setStatus('✓ 已取消收藏', true);
                            } else {
                                await AddTag(libRef, '收藏');
                                setStatus('✓ 已收藏', true);
                            }
                            refreshFav();
                        } catch (_err) {
                            setStatus('✗ 收藏操作失败', false);
                        }
                    };
                };
                refreshFav();
                c.appendChild(favRow);
            });

            cardContainer(container, (c) => {
                const tagContainer = document.createElement('div');
                tagContainer.className = 'tag-container';
                c.appendChild(tagContainer);

                function refreshTags(): void {
                    if (!libRef) {
                        tagContainer.innerHTML = '<span class="tag-empty">无法识别模型路径</span>';
                        return;
                    }
                    GetTagsByModel(libRef)
                        .then((tags) => {
                            tagContainer.innerHTML = '';
                            if (!tags || tags.length === 0) {
                                return;
                            }
                            for (const tag of tags) {
                                const chip = document.createElement('span');
                                chip.className = 'tag-chip';
                                chip.innerHTML = `${escapeHtml(tag)} <span class="tag-del">✕</span>`;
                                chip.title = '点击移除标签';
                                chip.addEventListener('click', () => {
                                    RemoveTag(libRef, tag)
                                        .then(() => {
                                            refreshTags();
                                            setStatus(`✓ 已移除标签: ${tag}`, true);
                                        })
                                        .catch(() => setStatus('✗ 移除标签失败', false));
                                });
                                tagContainer.appendChild(chip);
                            }
                        })
                        .catch(() => {
                            tagContainer.textContent = '加载标签失败';
                        });
                }
                refreshTags();

                const pickerLabel = document.createElement('div');
                pickerLabel.style.cssText =
                    'font-size:11px;color:var(--text-dim);margin:8px 0 4px;';
                pickerLabel.textContent = '添加已有标签';
                c.appendChild(pickerLabel);

                const picker = document.createElement('div');
                picker.className = 'tag-container';
                GetAllTags()
                    .then((allTags) => {
                        const assigned = new Set<string>();
                        GetTagsByModel(libRef!)
                            .then((modelTags) => {
                                (modelTags || []).forEach((t) => assigned.add(t));
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
                                    chip.textContent = assigned.has(tag) ? `✓ ${tag}` : `+ ${tag}`;
                                    chip.title = assigned.has(tag)
                                        ? '已添加，点击移除'
                                        : '点击添加此标签';
                                    chip.addEventListener('click', () => {
                                        if (!libRef) {
                                            return;
                                        }
                                        if (assigned.has(tag)) {
                                            RemoveTag(libRef, tag)
                                                .then(() => {
                                                    refreshTags();
                                                })
                                                .catch(() => {});
                                        } else {
                                            AddTag(libRef, tag)
                                                .then(() => {
                                                    refreshTags();
                                                })
                                                .catch(() => {});
                                        }
                                    });
                                    picker.appendChild(chip);
                                });
                                if (!allTags || allTags.filter((t) => t !== '收藏').length === 0) {
                                    picker.innerHTML =
                                        '<span style="color:var(--text-muted);font-size:11px;">暂无全局标签，可返回标签管理创建</span>';
                                }
                            })
                            .catch(() => {});
                    })
                    .catch(() => {});
                c.appendChild(picker);
            });
        },
    };
}

// ======== Morph Preview ========

export function buildMorphPreviewLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    const morphs = inst ? (getModelMorphs(id) ?? []) : [];
    const typeLabels: Record<number, string> = {
        0: '组',
        1: '顶点',
        2: '骨骼',
        3: 'UV',
        8: '材质',
    };
    return {
        label: '表情预览',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                const resetBtn = document.createElement('button');
                resetBtn.className = 'btn btn-sm';
                resetBtn.textContent = '全部重置';
                resetBtn.style.cssText = 'width:100%;margin-bottom:8px;';
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
                    setStatus('✓ 已重置所有表情', true);
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
                    typeTag.textContent = typeLabels[m.type] || `类型${m.type}`;
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
                    empty.textContent = '此模型无表情数据';
                    list.appendChild(empty);
                }

                c.appendChild(list);
            });
        },
    };
}

// ======== Bone Hierarchy ========

export function buildBoneHierarchyLevel(id: string): PopupLevel {
    const inst = modelManager.get(id);
    if (!inst?.mmdModel) {
        return { label: '骨骼层级', dir: '', items: [] };
    }
    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) {
        return { label: '骨骼层级', dir: '', items: [] };
    }

    // Build parent→children map
    const childrenMap = new Map<number, number[]>();
    const rootIndices: number[] = [];
    const physicsSet = new Set<number>();
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (bone.rigidBodyIndices.length > 0) {
            physicsSet.add(i);
        }
        const parentBone = bone.parentBone;
        if (parentBone) {
            const parentIdx = bones.indexOf(parentBone);
            if (parentIdx >= 0) {
                const list = childrenMap.get(parentIdx) ?? [];
                list.push(i);
                childrenMap.set(parentIdx, list);
                continue;
            }
        }
        rootIndices.push(i);
    }

    return {
        label: '骨骼层级',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                const header = document.createElement('div');
                header.style.cssText =
                    'font-size:var(--font-ui-sm);color:var(--text-bright);padding:4px 14px 8px;';
                header.textContent = `共 ${bones.length} 个骨骼`;
                c.appendChild(header);

                function renderBoneTree(
                    parent: HTMLElement,
                    idx: number,
                    depth: number
                ): void {
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
                        label.style.cssText = 'cursor:pointer;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
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
                        badge.title = '有物理刚体';
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
    };
}
