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
/** 参数卡片容器引用（增量更新用，避免 reRender） */
let _paramCardEl: HTMLElement | null = null;

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
                    slideRow(c, 'lucide:rotate-ccw', '重置此材质', false, () => {
                        resetSingleMatParams(id, matIndex);
                        stackRegistry.modelStack.reRender();
                        setStatus(`✓ 已重置: ${matName}`, true);
                    });
                }
            });
        },
    };
}

export function buildMatRootLevel(id: string, modelName: string): PopupLevel {
    _selectedMat = null;
    _paramCardEl = null;
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
                                const matEnabled = isMatEnabled(id, idx);
                                const mat = matInfo.mat as StandardMaterial;

                                // 色块样式
                                let swatchStyle: string;
                                if (!matEnabled) {
                                    swatchStyle = 'background:transparent;border:2px dashed var(--text-muted);';
                                } else {
                                    swatchStyle = 'background:#555';
                                    try {
                                        if (mat.diffuseColor) {
                                            swatchStyle = `background:rgb(${Math.round(mat.diffuseColor.r * 255)},${Math.round(mat.diffuseColor.g * 255)},${Math.round(mat.diffuseColor.b * 255)})`;
                                        }
                                    } catch { /* ignore */ }
                                }

                                const row = document.createElement('div');
                                row.className = `slide-item${!matEnabled ? ' mat-disabled' : ''}`;
                                row.style.cssText = 'padding-left: 28px;';
                                row.dataset.matIdx = String(idx);
                                row.dataset.matCat = cat;
                                row.innerHTML = `
                  <span class="mat-swatch${!matEnabled ? ' mat-swatch-disabled' : ''}" style="${swatchStyle}"></span>
                  <span class="slide-label">#${String(idx + 1).padStart(2, '0')} ${escapeHtml(matInfo.mat.name)}</span>
                  ${detail.modified ? '<span class="slide-sublabel" style="color:var(--accent);">已修改</span>' : ''}
                `;

                                // 色块点击：增量更新当前行（不 reRender）
                                const swatch = row.querySelector('.mat-swatch') as HTMLElement;
                                swatch.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    const newState = !isMatEnabled(id, idx);
                                    setMatEnabled(id, idx, newState);
                                    // 增量更新当前行 DOM
                                    if (newState) {
                                        let newStyle = 'background:#555';
                                        try {
                                            if (mat.diffuseColor) {
                                                newStyle = `background:rgb(${Math.round(mat.diffuseColor.r * 255)},${Math.round(mat.diffuseColor.g * 255)},${Math.round(mat.diffuseColor.b * 255)})`;
                                            }
                                        } catch { /* ignore */ }
                                        swatch.style.cssText = newStyle;
                                        swatch.classList.remove('mat-swatch-disabled');
                                        row.classList.remove('mat-disabled');
                                    } else {
                                        swatch.style.cssText = 'background:transparent;border:2px dashed var(--text-muted);';
                                        swatch.classList.add('mat-swatch-disabled');
                                        row.classList.add('mat-disabled');
                                    }
                                    setStatus(
                                        newState ? `✓ 已显示: ${matInfo.mat.name}` : `✕ 已隐藏: ${matInfo.mat.name}`,
                                        true
                                    );
                                });

                                // 行点击：只更新参数卡片，不重建列表
                                row.addEventListener('click', () => {
                                    // 更新选中高亮
                                    const prev = inner.querySelector('.slide-focused');
                                    if (prev) prev.classList.remove('slide-focused');
                                    row.classList.add('slide-focused');
                                    // 增量更新参数卡片
                                    _selectedMat = { cat, index: idx };
                                    _renderParamCard(id, modelName, cat, idx, detailList);
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
            _renderParamCard(id, modelName, null, -1, detailList);

            // 卡片 3：重置全部
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:refresh-ccw', '重置全部材质参数', false, () => {
                    resetMatCatParams(id);
                    resetAllMatParams(id);
                    _selectedMat = null;
                    stackRegistry.modelStack.reRender();
                    setStatus('✓ 全部材质参数已重置', true);
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
    detailList: { name: string; index: number; modified: boolean }[]
): void {
    if (!_paramCardEl) return;
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
        hint.textContent = '请从上方材质列表中选择一个材质进行微调';
        _paramCardEl.appendChild(hint);
        return;
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'margin:8px;border-radius:var(--radius);background:var(--card-bg);padding:0;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px;';
    const matName = detailList.find((d) => d.index === index)?.name || '未知材质';
    title.textContent = `参数微调 — ${cat} › ${matName}`;
    card.appendChild(title);

    const current = getMatParams(id, index);
    const params = current ?? {
        diffuseMul: 1,
        specularMul: 1,
        shininess: 50,
        ambientMul: 1,
    };

    addSliderRow(card, '漫反射倍率', params.diffuseMul, 0, 2, 0.05, (v) => {
        setMatParams(id, index, { diffuseMul: v });
    }, 'lucide:droplet');
    addSliderRow(card, '高光倍率', params.specularMul, 0, 2, 0.05, (v) => {
        setMatParams(id, index, { specularMul: v });
    }, 'lucide:sparkle');
    addSliderRow(card, '高光指数', params.shininess, 0, 200, 1, (v) => {
        setMatParams(id, index, { shininess: v });
    }, 'lucide:zap');
    addSliderRow(card, '环境光倍率', params.ambientMul, 0, 2, 0.05, (v) => {
        setMatParams(id, index, { ambientMul: v });
    }, 'lucide:sun');

    if (current !== null) {
        // 重置：批量状态变化 + 预期全量刷新，用 reRender。
        // 色块点击：单点切换，用增量更新（内联 DOM 操作），避免 200+ 行折叠列表重建。
        slideRow(card, 'lucide:rotate-ccw', '重置此材质', false, () => {
            resetSingleMatParams(id, index);
            _selectedMat = null;
            stackRegistry.modelStack.reRender();
            setStatus(`✓ 已重置: ${matName}`, true);
        });
    }

    _paramCardEl.appendChild(card);
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
                        } catch {
                            // Intentionally empty — 材质颜色读取失败时使用默认灰底，不影响功能
                        }
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
                            } catch {
                                // Intentionally empty — 材质颜色读取失败时使用默认灰底，不影响功能
                            }
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
