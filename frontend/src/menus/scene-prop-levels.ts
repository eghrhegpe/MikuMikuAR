// [doc:architecture] Scene Prop Levels — 舞台道具弹窗层级
// 从 env-prop-levels.ts 迁移至舞台域

import { cardContainer, escapeHtml, propRegistry, modelRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addCollapsible } from '../core/ui-helpers';
import { logWarn } from '../core/utils';
import { loadManager } from '../core/load-manager';
import { removeProp, getPropList } from '../scene/scene';
import { attachPropToBone, detachPropFromBone } from '../scene/env/accessory';
import { SelectPMXFile } from '../core/wails-bindings';
import { getSceneMenu } from './scene-menu';
import { buildTransformCard, buildMaterialCard, buildDangerCard } from './resource-detail-helpers';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildPropSchema(): MenuNode[] {
    const props = getPropList();
    return [
        // 卡片 1：已加载道具列表
        {
            id: 'prop:list',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (props.length > 0) {
                        for (const p of props) {
                            const row = document.createElement('div');
                            row.className = 'slide-item';
                            row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(p.name)}</span><span class="slide-arrow">&gt;</span>`;
                            row.addEventListener('click', () =>
                                getSceneMenu()?.push(buildPropDetailLevel(p.id))
                            );
                            const delBtn = document.createElement('span');
                            delBtn.className = 'slide-del-btn';
                            delBtn.textContent = '×';
                            delBtn.title = t('scene.deleteProp');
                            delBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                removeProp(p.id);
                                getSceneMenu()?.reRender();
                            });
                            row.appendChild(delBtn);
                            inner.appendChild(row);
                        }
                    } else {
                        const empty = document.createElement('div');
                        empty.className = 'empty-hint';
                        empty.textContent = t('scene.noProps');
                        inner.appendChild(empty);
                    }
                });
            },
        },
        // 卡片 2：加载入口
        {
            id: 'prop:add',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'lucide:plus', t('scene.addPropFile'), false, () => {
                        SelectPMXFile().then((path) => {
                            if (path) {
                                loadManager
                                    .load({ kind: 'prop', path })
                                    .then(() => getSceneMenu()?.reRender())
                                    .catch((err) => logWarn('scene-prop-levels', '', err));
                            }
                        });
                    });
                });
            },
        },
    ];
}

export function buildPropLevel(): PopupLevel {
    return {
        label: t('scene.prop'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';
            renderMenu(buildPropSchema(), container);
        },
    };
}

export function buildPropDetailLevel(propId: string): PopupLevel {
    return {
        label: t('scene.propTransform'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const p = propRegistry.get(propId);
            if (!p) {
                const empty = document.createElement('div');
                empty.className = 'empty-hint';
                empty.textContent = t('scene.propNotFound');
                container.appendChild(empty);
                return;
            }
            const sm = getSceneMenu();
            const handle = { id: propId, kind: 'prop' as const, name: p.name };

            // —— 标题 + 变换 ——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText =
                    'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = p.name;
                c.appendChild(title);
            });
            addCollapsible(container, {
                title: '拖拽操控',
                icon: 'lucide:move-3d',
                defaultOpen: false,
                renderContent: (inner) => {
                    buildTransformCard(inner, handle);
                },
            });

            // —— 骨骼挂载（Accessory）——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText =
                    'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = t('scene.accessory.attachToBone');
                c.appendChild(title);

                if (p.boneName && p.targetModelId) {
                    // 已挂载状态
                    const info = document.createElement('div');
                    info.style.cssText = 'font-size:11px;padding:4px 14px;color:var(--text-dim);';
                    info.textContent = `${p.boneName} @ ${p.targetModelId.slice(0, 12)}...`;
                    c.appendChild(info);

                    // 偏移滑块
                    const offsetSliders = [
                        { label: 'X', idx: 0 },
                        { label: 'Y', idx: 1 },
                        { label: 'Z', idx: 2 },
                    ];
                    for (const s of offsetSliders) {
                        const row = document.createElement('div');
                        row.className = 'flex-row';
                        row.style.padding = '2px 14px';
                        const lbl = document.createElement('label');
                        lbl.textContent = s.label;
                        lbl.style.cssText = 'font-size:11px;min-width:16px;color:var(--text-dim);';
                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.min = '-5';
                        slider.max = '5';
                        slider.step = '0.05';
                        const offset = p.boneOffset ?? [0, 0, 0];
                        slider.value = String(offset[s.idx]);
                        slider.className = 'slider-track';
                        slider.addEventListener('input', () => {
                            const newOffset: [number, number, number] = [
                                ...(p.boneOffset ?? [0, 0, 0]),
                            ];
                            newOffset[s.idx] = parseFloat(slider.value);
                            p.boneOffset = newOffset;
                            // Reattach with new offset
                            attachPropToBone(
                                propId,
                                p.boneName!,
                                p.targetModelId!,
                                newOffset,
                                p.boneRotation ?? [0, 0, 0]
                            );
                        });
                        const val = document.createElement('span');
                        val.textContent = slider.value;
                        val.style.cssText =
                            'font-size:11px;min-width:28px;text-align:right;opacity:0.6;';
                        slider.addEventListener('input', () => {
                            val.textContent = parseFloat(slider.value).toFixed(2);
                        });
                        row.appendChild(lbl);
                        row.appendChild(slider);
                        row.appendChild(val);
                        c.appendChild(row);
                    }

                    // 解除按钮
                    const detachBtn = document.createElement('button');
                    detachBtn.className = 'preset-chip';
                    detachBtn.textContent = t('scene.accessory.detachFromBone');
                    detachBtn.style.margin = '4px 14px';
                    detachBtn.addEventListener('click', () => {
                        detachPropFromBone(propId);
                        sm?.reRender();
                    });
                    c.appendChild(detachBtn);
                } else {
                    // 未挂载：选择模型 + 骨骼
                    const modelSelect = document.createElement('select');
                    modelSelect.style.cssText =
                        'width:100%;padding:6px 8px;margin:4px 0;border-radius:6px;' +
                        'background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:12px;';
                    modelSelect.innerHTML =
                        '<option value="">-- ' + t('scene.accessory.selectModel') + ' --</option>';
                    for (const [id, inst] of modelRegistry) {
                        if (inst.kind === 'actor') {
                            const opt = document.createElement('option');
                            opt.value = id;
                            opt.textContent = inst.name;
                            modelSelect.appendChild(opt);
                        }
                    }
                    c.appendChild(modelSelect);

                    const boneSelect = document.createElement('select');
                    boneSelect.style.cssText =
                        'width:100%;padding:6px 8px;margin:4px 0;border-radius:6px;' +
                        'background:var(--surface2);color:var(--text);border:1px solid var(--border);font-size:12px;';
                    boneSelect.innerHTML =
                        '<option value="">-- ' + t('scene.accessory.selectBone') + ' --</option>';
                    // 模型切换时刷新骨骼列表
                    modelSelect.addEventListener('change', () => {
                        const id = modelSelect.value;
                        boneSelect.innerHTML =
                            '<option value="">-- ' +
                            t('scene.accessory.selectBone') +
                            ' --</option>';
                        if (!id) {
                            return;
                        }
                        const inst = modelRegistry.get(id);
                        if (inst?.mmdModel) {
                            for (const b of inst.mmdModel.runtimeBones) {
                                const opt = document.createElement('option');
                                opt.value = b.name;
                                opt.textContent = b.name;
                                boneSelect.appendChild(opt);
                            }
                        }
                    });
                    c.appendChild(boneSelect);

                    const attachBtn = document.createElement('button');
                    attachBtn.className = 'preset-chip';
                    attachBtn.textContent = t('scene.accessory.attachToBone');
                    attachBtn.style.marginTop = '4px';
                    attachBtn.addEventListener('click', () => {
                        const modelId = modelSelect.value;
                        const boneName = boneSelect.value;
                        if (!modelId || !boneName) {
                            return;
                        }
                        const ok = attachPropToBone(
                            propId,
                            boneName,
                            modelId,
                            [0, 0, 0],
                            [0, 0, 0]
                        );
                        if (ok) {
                            sm?.reRender();
                        }
                    });
                    c.appendChild(attachBtn);
                }
            });

            // —— 材质调节 ——
            buildMaterialCard(container, handle, sm);

            // —— 危险操作 ——
            buildDangerCard(container, handle, () => {
                const menu = getSceneMenu();
                if (menu) {
                    menu.pop();
                    menu.reRender();
                }
            });
        },
    };
}
