// [doc:architecture] Model Material — 材质调节 UI 层（batch/per-mat/root/list）

import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { cardContainer, setStatus, PopupLevel, stackRegistry, escapeHtml } from '../core/config';
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
} from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addCollapsible } from '../core/ui-helpers';
import type { SlideMenu } from './menu';
import { t } from '../core/i18n/t';

let _selectedMat: { cat: string; index: number } | null = null;
/** 参数卡片容器引用（增量更新用，避免 reRender） */
let _paramCardEl: HTMLElement | null = null;

export function buildMatBatchLevel(id: string, modelName: string): PopupLevel {
    const label = t('model-material.batchByPart', { name: modelName });
    return {
        label,
        dir: '',
        items: [],
        renderCustom: (container) => {
            const groups = getMatCatGroups(id);
            const detailList = getMatDetailList(id);
            const overrideCount = detailList.filter((d) => d.modified).length;

            cardContainer(container, (c) => {
                if (overrideCount > 0) {
                    const hint = document.createElement('div');
                    hint.style.cssText =
                        'font-size:11px;color:var(--warn);margin-bottom:8px;padding:4px 10px;background:var(--white-04);border-radius:6px;text-align:center;';
                    hint.textContent = t('model-material.overrideHint', { count: overrideCount });
                    c.appendChild(hint);
                }

                const CATEGORY_ICONS: Record<string, string> = {
                    皮肤: 'droplet',
                    头发: 'feather',
                    眼睛: 'eye',
                    服装: 'shirt',
                };

                for (const [cat, mats] of groups) {
                    const params = getMatCatParams(id, cat);
                    addCollapsible(c, {
                        title: `${cat} (${mats.length})`,
                        icon: CATEGORY_ICONS[cat] || 'box',
                        defaultOpen: false,
                        headerToggle: {
                            value: isMatCategoryAllEnabled(id, cat),
                            onChange: (v) => setMatCategoryEnabled(id, cat, v),
                            bind: () => isMatCategoryAllEnabled(id, cat),
                        },
                        renderContent: (panel) => {
                            addSliderRow(panel, t('model-material.diffuseMul'), params.diffuseMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { diffuseMul: v })
                            );
                            addSliderRow(panel, t('model-material.specularMul'), params.specularMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { specularMul: v })
                            );
                            addSliderRow(panel, t('model-material.shininess'), params.shininess, 0, 200, 1, (v) =>
                                setMatCatParams(id, cat, { shininess: v })
                            );
                            addSliderRow(panel, t('model-material.ambientMul'), params.ambientMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { ambientMul: v })
                            );
                            addSliderRow(panel, t('model-material.emissiveMul'), params.emissiveMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { emissiveMul: v })
                            );
                            addSliderRow(panel, t('model-material.diffuseTexLevel'), params.diffuseTexLevel, 0, 3, 0.1, (v) =>
                                setMatCatParams(id, cat, { diffuseTexLevel: v })
                            );
                            addSliderRow(panel, t('model-material.bumpTexLevel'), params.bumpTexLevel, 0, 3, 0.1, (v) =>
                                setMatCatParams(id, cat, { bumpTexLevel: v })
                            );
                            addSliderRow(panel, t('model-material.toonTexLevel'), params.toonTexLevel, 0, 3, 0.1, (v) =>
                                setMatCatParams(id, cat, { toonTexLevel: v })
                            );
                            addSliderRow(panel, t('model-material.sphereTexLevel'), params.sphereTexLevel, 0, 3, 0.1, (v) =>
                                setMatCatParams(id, cat, { sphereTexLevel: v })
                            );
                            addSliderRow(panel, t('model-material.emissiveTexLevel'), params.emissiveTexLevel, 0, 3, 0.1, (v) =>
                                setMatCatParams(id, cat, { emissiveTexLevel: v })
                            );
                        },
                    });
                }
            });
        },
    };
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
            cardContainer(container, (c) => {
                const nameEl = document.createElement('div');
                nameEl.style.cssText =
                    'font-size:11px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                nameEl.textContent = modelName + ' > ' + matName;
                c.appendChild(nameEl);

                const stackingHint = document.createElement('div');
                stackingHint.style.cssText =
                    'font-size:10px;color:var(--text-muted);margin-bottom:10px;padding:4px 8px;background:var(--accent-dim);border-radius:4px;';
                stackingHint.textContent = t('model-material.stackingHint');
                c.appendChild(stackingHint);

                const current = getMatParams(id, matIndex);
                const params: typeof current = current ?? {
                    diffuseMul: 1,
                    specularMul: 1,
                    shininess: 50,
                    ambientMul: 1,
                    emissiveMul: 1,
                    diffuseTexLevel: 1,
                    bumpTexLevel: 1,
                    toonTexLevel: 1,
                    sphereTexLevel: 1,
                    emissiveTexLevel: 1,
                };
                const isModified = current !== null;

                addSliderRow(c, t('model-material.diffuseMul'), params.diffuseMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { diffuseMul: v });
                });
                addSliderRow(c, t('model-material.specularMul'), params.specularMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { specularMul: v });
                });
                addSliderRow(c, t('model-material.shininess'), params.shininess, 0, 200, 1, (v) => {
                    setMatParams(id, matIndex, { shininess: v });
                });
                addSliderRow(c, t('model-material.ambientMul'), params.ambientMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { ambientMul: v });
                });
                addSliderRow(c, t('model-material.emissiveMul'), params.emissiveMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { emissiveMul: v });
                });
                addSliderRow(c, t('model-material.diffuseTexLevel'), params.diffuseTexLevel, 0, 3, 0.1, (v) => {
                    setMatParams(id, matIndex, { diffuseTexLevel: v });
                });
                addSliderRow(c, t('model-material.bumpTexLevel'), params.bumpTexLevel, 0, 3, 0.1, (v) => {
                    setMatParams(id, matIndex, { bumpTexLevel: v });
                });
                addSliderRow(c, t('model-material.toonTexLevel'), params.toonTexLevel, 0, 3, 0.1, (v) => {
                    setMatParams(id, matIndex, { toonTexLevel: v });
                });
                addSliderRow(c, t('model-material.sphereTexLevel'), params.sphereTexLevel, 0, 3, 0.1, (v) => {
                    setMatParams(id, matIndex, { sphereTexLevel: v });
                });
                addSliderRow(c, t('model-material.emissiveTexLevel'), params.emissiveTexLevel, 0, 3, 0.1, (v) => {
                    setMatParams(id, matIndex, { emissiveTexLevel: v });
                });

                if (isModified) {
                    slideRow(c, 'lucide:rotate-ccw', t('model-material.resetThis'), false, () => {
                        resetSingleMatParams(id, matIndex);
                        (targetStack ?? stackRegistry.modelStack)?.reRender();
                        setStatus(t('model-material.resetDone', { name: matName }), true);
                    });
                }
            });
        },
    };
}

export function buildMatRootLevel(
    id: string,
    modelName: string,
    targetStack?: SlideMenu | null
): PopupLevel {
    _selectedMat = null;
    _paramCardEl = null;
    return {
        label: t('model-material.materialAdjustTitle', { name: modelName }),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const groups = getMatCatGroups(id);
            const detailList = getMatDetailList(id);

            // 卡片 1：材质组（折叠列表）
            cardContainer(container, (c) => {
                if (groups.size === 0) {
                    const empty = document.createElement('div');
                    empty.style.cssText =
                        'padding:12px 14px;text-align:center;font-size:11px;color:var(--text-dim);';
                    empty.textContent = t('model-material.noMaterialData');
                    c.appendChild(empty);
                    return;
                }

                for (const [cat, mats] of groups) {
                    const count = mats.length;
                    addCollapsible(c, {
                        title: `${cat} (${count})`,
                        icon: 'lucide:layers',
                        defaultOpen: false,
                        headerToggle: {
                            value: isMatCategoryAllEnabled(id, cat),
                            onChange: (v) => setMatCategoryEnabled(id, cat, v),
                            bind: () => isMatCategoryAllEnabled(id, cat),
                        },
                        renderContent: (inner) => {
                            for (const matInfo of mats) {
                                const detail = detailList.find((d) => d.name === matInfo.mat.name);
                                const idx = detail ? detail.index : -1;
                                if (idx === -1) {
                                    continue;
                                }
                                const matEnabled = isMatEnabled(id, idx);
                                const mat = matInfo.mat as StandardMaterial;

                                const row = document.createElement('div');
                                row.className = `slide-item${!matEnabled ? ' mat-disabled' : ''}`;
                                row.style.cssText = 'padding-left: 28px;';
                                row.dataset.matIdx = String(idx);
                                row.dataset.matCat = cat;

                                // Label
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

                                // Standard toggle 开关（替代小圆点）
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
                                toggle.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    const newState = !isMatEnabled(id, idx);
                                    setMatEnabled(id, idx, newState);
                                    // 增量更新当前行 DOM
                                    toggleInput.checked = newState;
                                    row.classList.toggle('mat-disabled', !newState);
                                    setStatus(
                                        newState
                                            ? t('model-material.shown', { name: matInfo.mat.name })
                                            : t('model-material.hidden', { name: matInfo.mat.name }),
                                        true
                                    );
                                });
                                row.appendChild(toggle);

                                // 行点击：只更新参数卡片，不重建列表
                                row.addEventListener('click', () => {
                                    // 更新选中高亮
                                    const prev = inner.querySelector('.slide-focused');
                                    if (prev) {
                                        prev.classList.remove('slide-focused');
                                    }
                                    row.classList.add('slide-focused');
                                    // 增量更新参数卡片
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
                                inner.appendChild(row);
                            }
                        },
                    });
                }
            });

            // 卡片 2：参数微调容器（占位，内容由 _renderParamCard 增量填充）
            _paramCardEl = document.createElement('div');
            container.appendChild(_paramCardEl);
            _renderParamCard(id, modelName, null, -1, detailList, targetStack);

            // 卡片 3：重置全部
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:refresh-ccw', t('model-material.resetAll'), false, () => {
                    resetMatCatParams(id);
                    resetAllMatParams(id);
                    _selectedMat = null;
                    (targetStack ?? stackRegistry.modelStack)?.reRender();
                    setStatus(t('model-material.resetAllDone'), true);
                });
            });
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
        const hint = document.createElement('div');
        hint.style.cssText =
            'font-size:11px;color:var(--text-dim);padding:12px 14px;text-align:center;';
        hint.textContent = t('model-material.selectMaterialHint');
        _paramCardEl.appendChild(hint);
        return;
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText =
        'margin:8px;border-radius:var(--radius);background:var(--card-bg);padding:0;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px;';
    const matName = detailList.find((d) => d.index === index)?.name || t('model-material.unknownMaterial');
    title.textContent = t('model-material.paramTune', { cat, matName });
    card.appendChild(title);

    const current = getMatParams(id, index);
    const params = current ?? {
        diffuseMul: 1,
        specularMul: 1,
        shininess: 50,
        ambientMul: 1,
        emissiveMul: 1,
        diffuseTexLevel: 1,
        bumpTexLevel: 1,
        toonTexLevel: 1,
        sphereTexLevel: 1,
        emissiveTexLevel: 1,
    };

    addSliderRow(
        card,
        t('model-material.diffuseMul'),
        params.diffuseMul,
        0,
        2,
        0.05,
        (v) => {
            setMatParams(id, index, { diffuseMul: v });
        },
        'lucide:droplet'
    );
    addSliderRow(
        card,
        t('model-material.specularMul'),
        params.specularMul,
        0,
        2,
        0.05,
        (v) => {
            setMatParams(id, index, { specularMul: v });
        },
        'lucide:sparkle'
    );
    addSliderRow(
        card,
        t('model-material.shininess'),
        params.shininess,
        0,
        200,
        1,
        (v) => {
            setMatParams(id, index, { shininess: v });
        },
        'lucide:zap'
    );
    addSliderRow(
        card,
        t('model-material.ambientMul'),
        params.ambientMul,
        0,
        2,
        0.05,
        (v) => {
            setMatParams(id, index, { ambientMul: v });
        },
        'lucide:sun'
    );
    addSliderRow(
        card,
        t('model-material.emissiveMul'),
        params.emissiveMul,
        0,
        2,
        0.05,
        (v) => {
            setMatParams(id, index, { emissiveMul: v });
        },
        'lucide:flame'
    );
    addSliderRow(
        card,
        t('model-material.diffuseTexLevel'),
        params.diffuseTexLevel,
        0,
        3,
        0.1,
        (v) => {
            setMatParams(id, index, { diffuseTexLevel: v });
        },
        'lucide:image'
    );
    addSliderRow(
        card,
        t('model-material.bumpTexLevel'),
        params.bumpTexLevel,
        0,
        3,
        0.1,
        (v) => {
            setMatParams(id, index, { bumpTexLevel: v });
        },
        'lucide:box'
    );
    addSliderRow(
        card,
        t('model-material.toonTexLevel'),
        params.toonTexLevel,
        0,
        3,
        0.1,
        (v) => {
            setMatParams(id, index, { toonTexLevel: v });
        },
        'lucide:palette'
    );
    addSliderRow(
        card,
        t('model-material.sphereTexLevel'),
        params.sphereTexLevel,
        0,
        3,
        0.1,
        (v) => {
            setMatParams(id, index, { sphereTexLevel: v });
        },
        'lucide:circle-dot'
    );
    addSliderRow(
        card,
        t('model-material.emissiveTexLevel'),
        params.emissiveTexLevel,
        0,
        3,
        0.1,
        (v) => {
            setMatParams(id, index, { emissiveTexLevel: v });
        },
        'lucide:sparkles'
    );

    if (current !== null) {
        // 重置：批量状态变化 + 预期全量刷新，用 reRender。
        // 色块点击：单点切换，用增量更新（内联 DOM 操作），避免 200+ 行折叠列表重建。
        slideRow(card, 'lucide:rotate-ccw', t('model-material.resetThis'), false, () => {
            resetSingleMatParams(id, index);
            _selectedMat = null;
            (targetStack ?? stackRegistry.modelStack)?.reRender();
            setStatus(`✓ 已重置: ${matName}`, true);
        });
    }

    _paramCardEl.appendChild(card);
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
            const detailList = getMatDetailList(id);
            cardContainer(container, (c) => {
                c.style.padding = '6px 10px';
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

                    // Standard toggle 开关（替代小圆点）
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
                    toggle.addEventListener('click', (e) => {
                        e.stopPropagation();
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
                    c.appendChild(row);
                }
            });
        },
    };
}
