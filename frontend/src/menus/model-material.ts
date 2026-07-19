// [doc:architecture] Model Material — 材质调节 UI 层（batch/per-mat/root/list）

import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { cardContainer, setStatus, PopupLevel, stackRegistry } from '../core/config';
import {
    getMatCatGroups,
    getMatCatParams,
    setMatCatParams,
    resetMatCatParams,
    getMatDetailList,
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    resetAllMatParams,
    isMatEnabled,
    setMatEnabled,
    isMatCategoryAllEnabled,
    setMatCategoryEnabled,
    getMaterialMeshes,
    DEFAULT_MAT_PARAMS,
    applyUnlitFallback,
} from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addCollapsible, addSectionTitle } from '../core/ui-helpers';
import type { SlideMenu } from './menu';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { showConfirm } from '../core/dialog';

let _selectedMat: { cat: string; index: number } | null = null;
/** 参数卡片容器引用（增量更新用，避免 reRender） */
let _paramCardEl: HTMLElement | null = null;

/** 添加分组分隔线 + 小标题，将颜色乘率与贴图强度视觉分区。 */
function _addGroupSeparator(panel: HTMLElement, label: string): void {
    addSectionTitle(panel, label);
}

function buildMatBatchSchema(id: string, _modelName: string): MenuNode[] {
    const groups = getMatCatGroups(id);
    const detailList = getMatDetailList(id);
    const overrideCount = detailList.filter((d) => d.modified).length;

    const CATEGORY_ICONS: Record<string, string> = {
        皮肤: 'droplet',
        头发: 'feather',
        眼睛: 'eye',
        服装: 'shirt',
    };

    return [
        {
            id: 'matBatch:list',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (overrideCount > 0) {
                        const hint = document.createElement('div');
                        hint.className = 'warn-hint';
                        hint.textContent = t('model-material.overrideHint', {
                            count: overrideCount,
                        });
                        inner.appendChild(hint);
                    }
                    for (const [cat, mats] of groups) {
                        const params = getMatCatParams(id, cat);
                        addCollapsible(inner, {
                            title: `${cat} (${mats.length})`,
                            icon: CATEGORY_ICONS[cat] || 'box',
                            defaultOpen: false,
                            headerToggle: {
                                value: isMatCategoryAllEnabled(id, cat),
                                onChange: (v) => setMatCategoryEnabled(id, cat, v),
                                bind: () => isMatCategoryAllEnabled(id, cat),
                            },
                            renderContent: (panel) => {
                                addSliderRow(
                                    panel,
                                    t('model-material.diffuseMul'),
                                    params.diffuseMul,
                                    0,
                                    2,
                                    0.05,
                                    (v) => setMatCatParams(id, cat, { diffuseMul: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.specularMul'),
                                    params.specularMul,
                                    0,
                                    2,
                                    0.05,
                                    (v) => setMatCatParams(id, cat, { specularMul: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.shininess'),
                                    params.shininess,
                                    0,
                                    200,
                                    1,
                                    (v) => setMatCatParams(id, cat, { shininess: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.ambientMul'),
                                    params.ambientMul,
                                    0,
                                    2,
                                    0.05,
                                    (v) => setMatCatParams(id, cat, { ambientMul: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.emissiveMul'),
                                    params.emissiveMul,
                                    0,
                                    2,
                                    0.05,
                                    (v) => setMatCatParams(id, cat, { emissiveMul: v })
                                );
                                _addGroupSeparator(panel, t('model-material.texLevelGroup'));
                                addSliderRow(
                                    panel,
                                    t('model-material.diffuseTexLevel'),
                                    params.diffuseTexLevel,
                                    0,
                                    3,
                                    0.1,
                                    (v) => setMatCatParams(id, cat, { diffuseTexLevel: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.bumpTexLevel'),
                                    params.bumpTexLevel,
                                    0,
                                    3,
                                    0.1,
                                    (v) => setMatCatParams(id, cat, { bumpTexLevel: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.toonTexLevel'),
                                    params.toonTexLevel,
                                    0,
                                    3,
                                    0.1,
                                    (v) => setMatCatParams(id, cat, { toonTexLevel: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.sphereTexLevel'),
                                    params.sphereTexLevel,
                                    0,
                                    3,
                                    0.1,
                                    (v) => setMatCatParams(id, cat, { sphereTexLevel: v })
                                );
                                addSliderRow(
                                    panel,
                                    t('model-material.emissiveTexLevel'),
                                    params.emissiveTexLevel,
                                    0,
                                    3,
                                    0.1,
                                    (v) => setMatCatParams(id, cat, { emissiveTexLevel: v })
                                );
                            },
                        });
                    }
                });
            },
        },
    ];
}

export function buildMatBatchLevel(id: string, modelName: string): PopupLevel {
    const label = t('model-material.batchByPart', { name: modelName });
    return {
        label,
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMatBatchSchema(id, modelName), container);
        },
    };
}

function buildPerMatSchema(
    id: string,
    modelName: string,
    matName: string,
    matIndex: number,
    targetStack?: SlideMenu | null
): MenuNode[] {
    const current = getMatParams(id, matIndex);
    const params = current ?? { ...DEFAULT_MAT_PARAMS };
    const isModified = current !== null;

    return [
        {
            id: 'perMat:main',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const nameEl = document.createElement('div');
                    nameEl.style.cssText =
                        'font-size:11px;color:var(--white-65);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    nameEl.textContent = modelName + ' > ' + matName;
                    inner.appendChild(nameEl);

                    const stackingHint = document.createElement('div');
                    stackingHint.className = 'accent-hint';
                    stackingHint.textContent = t('model-material.stackingHint');
                    inner.appendChild(stackingHint);

                    addSliderRow(
                        inner,
                        t('model-material.diffuseMul'),
                        params.diffuseMul,
                        0,
                        2,
                        0.05,
                        (v) => setMatParams(id, matIndex, { diffuseMul: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.specularMul'),
                        params.specularMul,
                        0,
                        2,
                        0.05,
                        (v) => setMatParams(id, matIndex, { specularMul: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.shininess'),
                        params.shininess,
                        0,
                        200,
                        1,
                        (v) => setMatParams(id, matIndex, { shininess: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.ambientMul'),
                        params.ambientMul,
                        0,
                        2,
                        0.05,
                        (v) => setMatParams(id, matIndex, { ambientMul: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.emissiveMul'),
                        params.emissiveMul,
                        0,
                        2,
                        0.05,
                        (v) => setMatParams(id, matIndex, { emissiveMul: v })
                    );
                    _addGroupSeparator(inner, t('model-material.texLevelGroup'));
                    addSliderRow(
                        inner,
                        t('model-material.diffuseTexLevel'),
                        params.diffuseTexLevel,
                        0,
                        3,
                        0.1,
                        (v) => setMatParams(id, matIndex, { diffuseTexLevel: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.bumpTexLevel'),
                        params.bumpTexLevel,
                        0,
                        3,
                        0.1,
                        (v) => setMatParams(id, matIndex, { bumpTexLevel: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.toonTexLevel'),
                        params.toonTexLevel,
                        0,
                        3,
                        0.1,
                        (v) => setMatParams(id, matIndex, { toonTexLevel: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.sphereTexLevel'),
                        params.sphereTexLevel,
                        0,
                        3,
                        0.1,
                        (v) => setMatParams(id, matIndex, { sphereTexLevel: v })
                    );
                    addSliderRow(
                        inner,
                        t('model-material.emissiveTexLevel'),
                        params.emissiveTexLevel,
                        0,
                        3,
                        0.1,
                        (v) => setMatParams(id, matIndex, { emissiveTexLevel: v })
                    );

                    if (isModified) {
                        slideRow(
                            inner,
                            'lucide:rotate-ccw',
                            t('model-material.resetThis'),
                            false,
                            () => {
                                resetSingleMatParams(id, matIndex);
                                (targetStack ?? stackRegistry.modelStack)?.reRender();
                                setStatus(t('model-material.resetDone', { name: matName }), true);
                            }
                        );
                    }
                });
            },
        },
    ];
}

export function buildPerMatLevel(
    id: string,
    modelName: string,
    matName: string,
    mat: Material,
    matIndex: number,
    targetStack?: SlideMenu | null
): PopupLevel {
    const shortName = matName.length > 24 ? matName.slice(0, 24) + '…' : matName;
    return {
        label: shortName,
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPerMatSchema(id, modelName, matName, matIndex, targetStack), container);
        },
    };
}

function buildMatRootSchema(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): MenuNode[] {
    _selectedMat = null;
    _paramCardEl = null;
    const groups = getMatCatGroups(id);
    const detailList = getMatDetailList(id);

    return [
        // 卡片 1：材质组（折叠列表）
        {
            id: 'matRoot:groups',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (groups.size === 0) {
                        const empty = document.createElement('div');
                        empty.className = 'empty-hint';
                        empty.textContent = t('model-material.noMaterialData');
                        inner.appendChild(empty);
                        return;
                    }
                    for (const [cat, mats] of groups) {
                        const count = mats.length;
                        addCollapsible(inner, {
                            title: `${cat} (${count})`,
                            icon: 'lucide:layers',
                            defaultOpen: false,
                            headerToggle: {
                                value: isMatCategoryAllEnabled(id, cat),
                                onChange: (v) => setMatCategoryEnabled(id, cat, v),
                                bind: () => isMatCategoryAllEnabled(id, cat),
                            },
                            renderContent: (inner2) => {
                                for (const matInfo of mats) {
                                    const detail = detailList.find(
                                        (d) => d.name === matInfo.mat.name
                                    );
                                    const idx = detail ? detail.index : -1;
                                    if (idx === -1) {
                                        continue;
                                    }
                                    const matEnabled = isMatEnabled(id, idx);

                                    const row = document.createElement('div');
                                    row.className = `slide-item${!matEnabled ? ' mat-disabled' : ''}`;
                                    row.style.paddingLeft = '28px';
                                    row.dataset.matIdx = String(idx);
                                    row.dataset.matCat = cat;

                                    const label = document.createElement('span');
                                    label.className = 'slide-label';
                                    label.textContent = `#${String(idx + 1).padStart(2, '0')} ${matInfo.mat.name}`;
                                    row.appendChild(label);

                                    if (detail.modified) {
                                        const sub = document.createElement('span');
                                        sub.className = 'slide-sublabel';
                                        sub.style.color = 'var(--accent)';
                                        sub.textContent = t('model-material.modified');
                                        row.appendChild(sub);
                                    }

                                    const toggle = document.createElement('label');
                                    toggle.className = 'toggle header-toggle';
                                    toggle.style.marginLeft = 'auto';
                                    const toggleInput = document.createElement('input');
                                    toggleInput.type = 'checkbox';
                                    toggleInput.checked = matEnabled;
                                    const slider = document.createElement('span');
                                    slider.className = 'slider';
                                    toggle.appendChild(toggleInput);
                                    toggle.appendChild(slider);
                                    // 修复：<label> 包裹 checkbox 时浏览器会「原生二次派发 click」到 input，
                                    // 令本 handler 双触发；因读取的是实时数据状态，两次取值相反而互相抵消（点击无反应）。
                                    // 方案：跳过 synthetic click(target===input)，并用 preventDefault 阻止原生切换造成的视觉错位。
                                    toggle.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        if (e.target === toggleInput) {
                                            return;
                                        }
                                        e.preventDefault();
                                        const newState = !isMatEnabled(id, idx);
                                        setMatEnabled(id, idx, newState);
                                        toggleInput.checked = newState;
                                        row.classList.toggle('mat-disabled', !newState);
                                        setStatus(
                                            newState
                                                ? t('model-material.shown', {
                                                      name: matInfo.mat.name,
                                                  })
                                                : t('model-material.hidden', {
                                                      name: matInfo.mat.name,
                                                  }),
                                            true
                                        );
                                    });
                                    row.appendChild(toggle);

                                    row.addEventListener('click', () => {
                                        const prev = inner2.querySelector('.slide-focused');
                                        if (prev) {
                                            prev.classList.remove('slide-focused');
                                        }
                                        row.classList.add('slide-focused');
                                        _selectedMat = { cat, index: idx };
                                        _renderParamCard(
                                            id,
                                            modelName,
                                            cat,
                                            idx,
                                            detailList,
                                            targetStack
                                        );
                                    });
                                    inner2.appendChild(row);
                                }
                            },
                        });
                    }
                });
            },
        },
        // 卡片 2：参数微调容器（占位，内容由 _renderParamCard 增量填充）
        // 注意：renderCustom 执行时 list 尚未 appendChild 到 panel，isConnected 为 false，
        // 因此用 requestAnimationFrame 延后首次渲染，确保 _paramCardEl 已挂入 DOM 树。
        {
            id: 'matRoot:paramCard',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    _paramCardEl = inner;
                });
                requestAnimationFrame(() => {
                    _renderParamCard(id, modelName, null, -1, detailList, targetStack);
                });
            },
        },
        // 卡片 3：光照兜底（伪 unlit，少数异常模型用）
        {
            id: 'matRoot:unlitFallback',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'lucide:sun-medium',
                        t('model-material.unlitFallback'),
                        false,
                        async () => {
                            const ok = await showConfirm(
                                t('model-material.unlitFallbackConfirm'),
                                t('model-material.unlitFallbackTitle')
                            );
                            if (!ok) {
                                return;
                            }
                            applyUnlitFallback(id);
                            _selectedMat = null;
                            (targetStack ?? stackRegistry.modelStack)?.reRender();
                            setStatus(t('model-material.unlitFallbackDone'), true);
                        }
                    );
                });
            },
        },
        // 卡片 4：重置全部
        {
            id: 'matRoot:reset',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'lucide:refresh-ccw',
                        t('model-material.resetAll'),
                        false,
                        () => {
                            resetMatCatParams(id);
                            resetAllMatParams(id);
                            _selectedMat = null;
                            (targetStack ?? stackRegistry.modelStack)?.reRender();
                            setStatus(t('model-material.resetAllDone'), true);
                        }
                    );
                });
            },
        },
    ];
}

export function buildMatRootLevel(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): PopupLevel {
    return {
        label: t('model-material.materialAdjustTitle', { name: modelName }),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMatRootSchema(id, modelName, targetStack), container);
        },
    };
}

/**
 * 增量渲染参数卡片（替代 reRender 全量重建）。
 * 只更新 _paramCardEl 容器的内容，不影响材质列表。
 */
function _renderParamCard(
    id: string,
    modelName: string,
    cat: string | null,
    index: number,
    detailList: { name: string; index: number; modified: boolean }[],
    targetStack?: SlideMenu | null
): void {
    if (!_paramCardEl) {
        return;
    }
    // 防止幽灵引用：容器被销毁后置 null
    if (!_paramCardEl.isConnected) {
        _paramCardEl = null;
        return;
    }
    _paramCardEl.innerHTML = '';

    if (index === -1 || !cat) {
        return;
    }

    const matName =
        detailList.find((d) => d.index === index)?.name || t('model-material.unknownMaterial');
    const current = getMatParams(id, index);
    const params = current ?? { ...DEFAULT_MAT_PARAMS };

    addCollapsible(_paramCardEl, {
        title: t('model-material.paramTuneTitle'),
        icon: 'lucide:sliders-horizontal',
        defaultOpen: true,
        renderContent: (panel) => {
            addSectionTitle(panel, `${cat} > ${matName}`);

            addSliderRow(
                panel,
                t('model-material.diffuseMul'),
                params.diffuseMul,
                0,
                2,
                0.05,
                (v) => setMatParams(id, index, { diffuseMul: v }),
                'lucide:droplet'
            );
            addSliderRow(
                panel,
                t('model-material.specularMul'),
                params.specularMul,
                0,
                2,
                0.05,
                (v) => setMatParams(id, index, { specularMul: v }),
                'lucide:sparkle'
            );
            addSliderRow(
                panel,
                t('model-material.shininess'),
                params.shininess,
                0,
                200,
                1,
                (v) => setMatParams(id, index, { shininess: v }),
                'lucide:zap'
            );
            addSliderRow(
                panel,
                t('model-material.ambientMul'),
                params.ambientMul,
                0,
                2,
                0.05,
                (v) => setMatParams(id, index, { ambientMul: v }),
                'lucide:sun'
            );
            addSliderRow(
                panel,
                t('model-material.emissiveMul'),
                params.emissiveMul,
                0,
                2,
                0.05,
                (v) => setMatParams(id, index, { emissiveMul: v }),
                'lucide:flame'
            );
            _addGroupSeparator(panel, t('model-material.texLevelGroup'));
            addSliderRow(
                panel,
                t('model-material.diffuseTexLevel'),
                params.diffuseTexLevel,
                0,
                3,
                0.1,
                (v) => setMatParams(id, index, { diffuseTexLevel: v }),
                'lucide:image'
            );
            addSliderRow(
                panel,
                t('model-material.bumpTexLevel'),
                params.bumpTexLevel,
                0,
                3,
                0.1,
                (v) => setMatParams(id, index, { bumpTexLevel: v }),
                'lucide:box'
            );
            addSliderRow(
                panel,
                t('model-material.toonTexLevel'),
                params.toonTexLevel,
                0,
                3,
                0.1,
                (v) => setMatParams(id, index, { toonTexLevel: v }),
                'lucide:palette'
            );
            addSliderRow(
                panel,
                t('model-material.sphereTexLevel'),
                params.sphereTexLevel,
                0,
                3,
                0.1,
                (v) => setMatParams(id, index, { sphereTexLevel: v }),
                'lucide:circle-dot'
            );
            addSliderRow(
                panel,
                t('model-material.emissiveTexLevel'),
                params.emissiveTexLevel,
                0,
                3,
                0.1,
                (v) => setMatParams(id, index, { emissiveTexLevel: v }),
                'lucide:sparkles'
            );

            if (current !== null) {
                slideRow(panel, 'lucide:rotate-ccw', t('model-material.resetThis'), false, () => {
                    resetSingleMatParams(id, index);
                    _selectedMat = null;
                    (targetStack ?? stackRegistry.modelStack)?.reRender();
                    setStatus(t('model.materialReset', { name: matName }), true);
                });
            }
        },
    });
}

function buildMatListSchema(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): MenuNode[] {
    return [
        {
            id: 'matList:main',
            kind: 'custom',
            renderCustom: (c) => {
                const detailList = getMatDetailList(id);
                cardContainer(c, (inner) => {
                    inner.style.padding = '6px 10px';
                    for (const detail of detailList) {
                        const meshes = getMaterialMeshes(id);
                        const mat = meshes?.[detail.index]?.material as StandardMaterial;
                        if (!mat) {
                            continue;
                        }
                        const matEnabled = isMatEnabled(id, detail.index);

                        const row = document.createElement('div');
                        row.className = `mat-row${detail.modified ? ' modified' : ''}${!matEnabled ? ' mat-disabled' : ''}`;

                        const idxSpan = document.createElement('span');
                        idxSpan.className = 'mat-index';
                        idxSpan.textContent = `#${String(detail.index + 1).padStart(2, '0')}`;
                        row.appendChild(idxSpan);

                        const nameSpan = document.createElement('span');
                        nameSpan.className = 'mat-name';
                        nameSpan.title = detail.name;
                        nameSpan.textContent = detail.name;
                        row.appendChild(nameSpan);

                        if (detail.modified) {
                            const modSpan = document.createElement('span');
                            modSpan.className = 'mat-modified';
                            const icon = createIconifyIcon('check-circle');
                            if (icon) {
                                modSpan.appendChild(icon);
                            }
                            row.appendChild(modSpan);
                        }

                        const toggle = document.createElement('label');
                        toggle.className = 'toggle header-toggle';
                        toggle.style.marginLeft = 'auto';
                        const toggleInput = document.createElement('input');
                        toggleInput.type = 'checkbox';
                        toggleInput.checked = matEnabled;
                        const slider = document.createElement('span');
                        slider.className = 'slider';
                        toggle.appendChild(toggleInput);
                        toggle.appendChild(slider);
                        // 修复：同 matRoot，<label> 原生二次派发 click 导致 handler 双触发互相抵消。
                        toggle.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (e.target === toggleInput) {
                                return;
                            }
                            e.preventDefault();
                            const newState = !isMatEnabled(id, detail.index);
                            setMatEnabled(id, detail.index, newState);
                            toggleInput.checked = newState;
                            row.classList.toggle('mat-disabled', !newState);
                            setStatus(
                                newState ? `✓ 已显示: ${detail.name}` : `✕ 已隐藏: ${detail.name}`,
                                true
                            );
                        });
                        row.appendChild(toggle);

                        row.addEventListener('click', () => {
                            (targetStack ?? stackRegistry.modelStack)?.push(
                                buildPerMatLevel(
                                    id,
                                    modelName,
                                    detail.name,
                                    mat,
                                    detail.index,
                                    targetStack
                                )
                            );
                        });
                        inner.appendChild(row);
                    }
                });
            },
        },
    ];
}

export function buildMatListLevel(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): PopupLevel {
    return {
        label: t('model-material.perMaterial', { name: modelName }),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildMatListSchema(id, modelName, targetStack), container);
        },
    };
}
