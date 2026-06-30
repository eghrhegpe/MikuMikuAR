// [doc:architecture] Model Material — 材质调节 UI 层（batch/per-mat/root/list）

import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import {
    modelRegistry,
    cardContainer,
    setStatus,
    PopupLevel,
    stackRegistry,
    escapeHtml,
} from '../core/config';
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
} from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addCollapsible } from '../core/ui-helpers';

let _selectedMat: { cat: string; index: number } | null = null;

export function buildMatBatchLevel(id: string, modelName: string): PopupLevel {
    const label = '按部位批量 — ' + modelName;
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
                    hint.textContent = `⚠ ${overrideCount} 个材质有单独覆盖（分类调整不影响已覆盖材质）`;
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
                        renderContent: (panel) => {
                            addSliderRow(panel, '漫反射倍率', params.diffuseMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { diffuseMul: v })
                            );
                            addSliderRow(panel, '高光倍率', params.specularMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { specularMul: v })
                            );
                            addSliderRow(panel, '高光指数', params.shininess, 0, 200, 1, (v) =>
                                setMatCatParams(id, cat, { shininess: v })
                            );
                            addSliderRow(panel, '环境光倍率', params.ambientMul, 0, 2, 0.05, (v) =>
                                setMatCatParams(id, cat, { ambientMul: v })
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
    matIndex: number
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
                stackingHint.textContent = '覆盖分类设置，分类调整仍生效于其他材质';
                c.appendChild(stackingHint);

                const current = getMatParams(id, matIndex);
                const params = current ?? {
                    diffuseMul: 1,
                    specularMul: 1,
                    shininess: 50,
                    ambientMul: 1,
                };
                const isModified = current !== null;

                addSliderRow(c, '漫反射倍率', params.diffuseMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { diffuseMul: v });
                });
                addSliderRow(c, '高光倍率', params.specularMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { specularMul: v });
                });
                addSliderRow(c, '高光指数', params.shininess, 0, 200, 1, (v) => {
                    setMatParams(id, matIndex, { shininess: v });
                });
                addSliderRow(c, '环境光倍率', params.ambientMul, 0, 2, 0.05, (v) => {
                    setMatParams(id, matIndex, { ambientMul: v });
                });

                if (isModified) {
                    const resetRow = document.createElement('div');
                    resetRow.className = 'slide-item';
                    const ri = document.createElement('span');
                    ri.className = 'slide-icon';
                    const re = createIconifyIcon('lucide:rotate-ccw');
                    if (re) {
                        ri.appendChild(re);
                    }
                    resetRow.appendChild(ri);
                    const rl = document.createElement('span');
                    rl.className = 'slide-label';
                    rl.textContent = '重置此材质';
                    resetRow.appendChild(rl);
                    resetRow.addEventListener('click', () => {
                        resetSingleMatParams(id, matIndex);
                        stackRegistry.modelStack.reRender();
                        setStatus(`✓ 已重置: ${matName}`, true);
                    });
                    c.appendChild(resetRow);
                }
            });
        },
    };
}

export function buildMatRootLevel(id: string, modelName: string): PopupLevel {
    return {
        label: '材质调节 — ' + modelName,
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
                    empty.textContent = '此模型无材质数据';
                    c.appendChild(empty);
                    return;
                }

                for (const [cat, mats] of groups) {
                    const count = mats.length;
                    addCollapsible(c, {
                        title: `${cat} (${count})`,
                        icon: 'lucide:layers',
                        defaultOpen: false,
                        renderContent: (inner) => {
                            for (const matInfo of mats) {
                                const detail = detailList.find((d) => d.name === matInfo.mat.name);
                                const idx = detail ? detail.index : -1;
                                if (idx === -1) {
                                    continue;
                                }
                                const isSelected =
                                    _selectedMat.cat === cat && _selectedMat.index === idx;
                                const row = document.createElement('div');
                                row.className = `slide-item${isSelected ? ' slide-focused' : ''}`;
                                row.style.cssText = 'padding-left: 28px;';
                                row.innerHTML = `
                  <span class="slide-icon"><iconify-icon icon="lucide:circle"></iconify-icon></span>
                  <span class="slide-label">#${String(idx + 1).padStart(2, '0')} ${escapeHtml(matInfo.mat.name)}</span>
                  ${detail.modified ? '<span class="slide-sublabel" style="color:var(--accent);">已修改</span>' : ''}
                `;
                                row.addEventListener('click', () => {
                                    _selectedMat = { cat, index: idx };
                                    stackRegistry.modelStack.reRender();
                                });
                                inner.appendChild(row);
                            }
                        },
                    });
                }
            });

            // 卡片 2：参数微调（选中材质时显示）
            cardContainer(container, (c) => {
                if (_selectedMat) {
                    const { cat, index } = _selectedMat;
                    const current = getMatParams(id, index);
                    const params = current ?? {
                        diffuseMul: 1,
                        specularMul: 1,
                        shininess: 50,
                        ambientMul: 1,
                    };
                    const matName = detailList.find((d) => d.index === index).name || '未知材质';

                    const title = document.createElement('div');
                    title.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px;';
                    title.textContent = `参数微调 — ${cat} › ${matName}`;
                    c.appendChild(title);

                    addSliderRow(
                        c,
                        '漫反射倍率',
                        params.diffuseMul,
                        0,
                        2,
                        0.05,
                        (v) => {
                            setMatParams(id, index, { diffuseMul: v });
                            stackRegistry.modelStack.reRender();
                        },
                        'lucide:droplet'
                    );
                    addSliderRow(
                        c,
                        '高光倍率',
                        params.specularMul,
                        0,
                        2,
                        0.05,
                        (v) => {
                            setMatParams(id, index, { specularMul: v });
                            stackRegistry.modelStack.reRender();
                        },
                        'lucide:sparkle'
                    );
                    addSliderRow(
                        c,
                        '高光指数',
                        params.shininess,
                        0,
                        200,
                        1,
                        (v) => {
                            setMatParams(id, index, { shininess: v });
                            stackRegistry.modelStack.reRender();
                        },
                        'lucide:bolt'
                    );
                    addSliderRow(
                        c,
                        '环境光倍率',
                        params.ambientMul,
                        0,
                        2,
                        0.05,
                        (v) => {
                            setMatParams(id, index, { ambientMul: v });
                            stackRegistry.modelStack.reRender();
                        },
                        'lucide:sun'
                    );

                    const resetRow = document.createElement('div');
                    resetRow.className = 'slide-item';
                    resetRow.innerHTML =
                        '<span class="slide-icon"><iconify-icon icon="lucide:rotate-ccw"></iconify-icon></span><span class="slide-label">重置此材质</span>';
                    resetRow.addEventListener('click', () => {
                        resetSingleMatParams(id, index);
                        _selectedMat = null;
                        stackRegistry.modelStack.reRender();
                        setStatus(`✓ 已重置: ${matName}`, true);
                    });
                    c.appendChild(resetRow);
                } else {
                    const hint = document.createElement('div');
                    hint.style.cssText =
                        'font-size:11px;color:var(--text-dim);padding:12px 14px;text-align:center;';
                    hint.textContent = '请从上方材质列表中选择一个材质进行微调';
                    c.appendChild(hint);
                }
            });

            // 卡片 3：重置全部
            cardContainer(container, (c) => {
                const resetAllRow = document.createElement('div');
                resetAllRow.className = 'slide-item';
                resetAllRow.innerHTML =
                    '<span class="slide-icon"><iconify-icon icon="lucide:refresh-ccw"></iconify-icon></span><span class="slide-label">重置全部材质参数</span>';
                resetAllRow.addEventListener('click', () => {
                    resetMatCatParams(id);
                    resetAllMatParams(id);
                    _selectedMat = null;
                    stackRegistry.modelStack.reRender();
                    setStatus('✓ 全部材质参数已重置', true);
                });
                c.appendChild(resetAllRow);
            });
        },
    };
}

export function buildMatListLevel(id: string, modelName: string): PopupLevel {
    return {
        label: '逐材质 — ' + modelName,
        dir: '',
        items: [],
        renderCustom: (container) => {
            const detailList = getMatDetailList(id);
            cardContainer(container, (c) => {
                c.style.padding = '6px 10px';
                for (const detail of detailList) {
                    const inst = modelRegistry.get(id);
                    const mat = inst.meshes[detail.index]?.material as StandardMaterial;
                    if (!mat) {
                        continue;
                    }

                    const matEnabled = isMatEnabled(id, detail.index);
                    let swatchStyle: string;
                    if (!matEnabled) {
                        swatchStyle = 'background:transparent;border:2px dashed var(--text-muted);';
                    } else {
                        swatchStyle = 'background:#555';
                        try {
                            if (mat.diffuseColor) {
                                swatchStyle = `background:rgb(${Math.round(mat.diffuseColor.r * 255)},${Math.round(mat.diffuseColor.g * 255)},${Math.round(mat.diffuseColor.b * 255)})`;
                            }
                        } catch {}
                    }

                    const row = document.createElement('div');
                    row.className = `mat-row${detail.modified ? ' modified' : ''}${!matEnabled ? ' mat-disabled' : ''}`;
                    row.innerHTML = `
            <span class="mat-swatch${!matEnabled ? ' mat-swatch-disabled' : ''}" style="${swatchStyle}"></span>
            <span class="mat-index">#${String(detail.index + 1).padStart(2, '0')}</span>
            <span class="mat-name" title="${escapeHtml(detail.name)}">${escapeHtml(detail.name)}</span>
            ${detail.modified ? '<span class="mat-modified"><iconify-icon icon="check-circle"></iconify-icon></span>' : ''}
          `;
                    const swatch = row.querySelector('.mat-swatch') as HTMLElement;
                    swatch.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const newState = !isMatEnabled(id, detail.index);
                        setMatEnabled(id, detail.index, newState);
                        if (newState) {
                            let newStyle = 'background:#555';
                            try {
                                if ((mat as StandardMaterial).diffuseColor) {
                                    newStyle = `background:rgb(${Math.round((mat as StandardMaterial).diffuseColor.r * 255)},${Math.round((mat as StandardMaterial).diffuseColor.g * 255)},${Math.round((mat as StandardMaterial).diffuseColor.b * 255)})`;
                                }
                            } catch {}
                            swatch.style.cssText = newStyle;
                            swatch.classList.remove('mat-swatch-disabled');
                            row.classList.remove('mat-disabled');
                        } else {
                            swatch.style.cssText =
                                'background:transparent;border:2px dashed var(--text-muted);';
                            swatch.classList.add('mat-swatch-disabled');
                            row.classList.add('mat-disabled');
                        }
                        setStatus(
                            newState ? `✓ 已显示: ${detail.name}` : `✕ 已隐藏: ${detail.name}`,
                            true
                        );
                    });
                    row.addEventListener('click', () => {
                        stackRegistry.modelStack.push(
                            buildPerMatLevel(id, modelName, detail.name, mat, detail.index)
                        );
                    });
                    c.appendChild(row);
                }
            });
        },
    };
}
