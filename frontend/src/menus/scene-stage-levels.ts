// [doc:architecture] Scene Stage Levels — 舞台管理/舞台变换弹窗层级
// 从 scene-render-levels.ts 拆分

import {
    setStatus,
    cardContainer,
    modelRegistry,
    overridePaths,
    libraryRoot,
    escapeHtml,
    propRegistry,
} from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSectionTitle, addCollapsible } from '../core/ui-helpers';
import { removeModel, setModelVisibility } from '../scene/manager/model-ops';
import { loadManager } from '../core/load-manager';
import { getPropList, removeProp, modelManager } from '../scene/scene';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { buildStageLightLevel } from './scene-stage-lights';
import { buildTransformCard, buildMaterialCard, buildDangerCard } from './resource-detail-helpers';

import { buildPropDetailLevel } from './scene-prop-levels';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import { isUnderRoot } from '../core/utils';
import type { MenuNode } from './menu-schema';

// ======== 舞台根面板：舞台加载、灯光、道具 ========

function buildStageSchema(): MenuNode[] {
    const stageModels = Array.from(modelRegistry.entries()).filter(
        ([, inst]) => inst.kind === 'stage'
    );
    const propDir = (
        overridePaths.prop || (libraryRoot ? libraryRoot + '/prop' : '')
    ).toLowerCase();
    const propModels = Array.from(modelManager.modelRegistry.entries()).filter(
        ([, inst]) => inst.kind === 'actor' && isUnderRoot(propDir, inst.filePath)
    );
    const propItems = [
        ...getPropList().map((p) => ({
            id: p.id,
            name: p.name,
            fromPropRegistry: true,
        })),
        ...propModels.map(([id, inst]) => ({
            id,
            name: inst.name,
            fromPropRegistry: false,
        })),
    ];

    return [
        // 卡片 1：已加载舞台列表
        {
            id: 'stage:loaded',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (stageModels.length > 0) {
                        addSectionTitle(inner, t('scene.loadedStages'));
                        for (const [id, inst] of stageModels) {
                            const row = document.createElement('div');
                            row.className = 'slide-item';
                            row.style.cursor = 'pointer';

                            const eyeSpan = document.createElement('span');
                            eyeSpan.className = 'slide-icon';
                            const eyeIcon = createIconifyIcon(
                                inst.visible ? 'lucide:eye' : 'lucide:eye-off'
                            );
                            if (eyeIcon) {
                                eyeSpan.appendChild(eyeIcon);
                            }
                            eyeSpan.style.cursor = 'pointer';
                            eyeSpan.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const newVis = !inst.visible;
                                setModelVisibility(id, newVis);
                                reRenderSceneMenu();
                                setStatus(
                                    newVis ? t('scene.stageShown') : t('scene.stageHidden'),
                                    true
                                );
                            });
                            row.appendChild(eyeSpan);

                            const label = document.createElement('span');
                            label.className = 'slide-label';
                            label.textContent = inst.name;
                            row.appendChild(label);

                            const arrow = document.createElement('span');
                            arrow.className = 'slide-arrow';
                            arrow.textContent = '>';
                            row.appendChild(arrow);

                            const del = document.createElement('span');
                            del.textContent = '✕';
                            del.style.cssText =
                                'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;margin-left:4px;';
                            del.title = t('scene.unloadStage');
                            del.addEventListener('click', (e) => {
                                e.stopPropagation();
                                removeModel(id);
                                reRenderSceneMenu();
                                setStatus(t('scene.unloaded', { name: inst.name }), true);
                            });
                            row.appendChild(del);

                            row.addEventListener('click', () => {
                                const sm = getSceneMenu();
                                if (sm) {
                                    sm.push(buildStageTransformLevel(id));
                                }
                            });

                            inner.appendChild(row);
                        }
                    } else {
                        const empty = document.createElement('div');
                        empty.style.cssText =
                            'font-size:11px;color:var(--text-dim);text-align:center;padding:8px 0;';
                        empty.textContent = t('scene.noLoadedStages');
                        inner.appendChild(empty);
                    }
                });
            },
        },
        // 卡片 2：已加载道具列表
        {
            id: 'stage:props',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (propItems.length > 0) {
                        for (const item of propItems) {
                            const row = document.createElement('div');
                            row.className = 'slide-item';
                            row.style.cursor = 'pointer';
                            row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(item.name)}</span><span class="slide-arrow">&gt;</span>`;
                            row.addEventListener('click', () =>
                                getSceneMenu()?.push(buildPropDetailLevel(item.id))
                            );
                            const delBtn = document.createElement('span');
                            delBtn.className = 'slide-del-btn';
                            delBtn.textContent = '×';
                            delBtn.title = t('scene.deleteProp');
                            delBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (item.fromPropRegistry) {
                                    removeProp(item.id);
                                } else {
                                    removeModel(item.id);
                                }
                                reRenderSceneMenu();
                            });
                            row.appendChild(delBtn);
                            inner.appendChild(row);
                        }
                    } else {
                        const empty = document.createElement('div');
                        empty.style.cssText =
                            'font-size:11px;color:var(--text-dim);text-align:center;padding:8px 0;';
                        empty.textContent = t('scene.noProps');
                        inner.appendChild(empty);
                    }
                });
            },
        },
        // 卡片 3：功能入口
        {
            id: 'stage:actions',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'lucide:upload', t('scene.loadStage'), true, () => {
                        (async () => {
                            try {
                                const { getBrowseDir } = await import('../core/utils');
                                const browseDir = getBrowseDir('stage');
                                if (!browseDir) {
                                    setStatus(t('scene.statusNoModelLib'), false);
                                    return;
                                }
                                const { buildLevel } = await import('./library-core');
                                const sm = getSceneMenu();
                                if (!sm) {
                                    return;
                                }
                                const level = buildLevel(
                                    browseDir,
                                    t('scene.loadStage'),
                                    (m) => m.type === 'stage' || m.type === 'scene',
                                    sm
                                );
                                sm.push(level);
                            } catch (err) {
                                setStatus(t('scene.statusOpenStageLibFailed'), false);
                                console.error('Stage library error:', err);
                            }
                        })();
                    });
                    slideRow(inner, 'lucide:lightbulb', t('scene.stageLight'), true, () => {
                        const sm = getSceneMenu();
                        if (sm) {
                            sm.push(buildStageLightLevel());
                        }
                    });
                    slideRow(inner, 'lucide:box', t('scene.loadProp'), true, () => {
                        (async () => {
                            try {
                                const { getBrowseDir } = await import('../core/utils');
                                const browseDir = getBrowseDir('prop');
                                if (!browseDir) {
                                    setStatus(t('scene.statusNoPropLib'), false);
                                    return;
                                }
                                const { buildLevel } = await import('./library-core');
                                const sm = getSceneMenu();
                                if (!sm) {
                                    return;
                                }
                                const level = buildLevel(
                                    browseDir,
                                    t('scene.propLibrary'),
                                    (m) => m.format === 'pmx',
                                    sm
                                );
                                sm.push(level);
                            } catch (err) {
                                setStatus(t('scene.statusOpenPropLibFailed'), false);
                                console.error('Prop library error:', err);
                            }
                        })();
                    });
                });
            },
        },
    ];
}

export function buildStageLevel(): PopupLevel {
    return {
        label: t('scene.stage'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            renderMenu(buildStageSchema(), container);
        },
    };
}

// ======== Stage Transform Panel ========

export function buildStageTransformLevel(id: string): PopupLevel {
    const inst = modelRegistry.get(id);
    const name = inst?.name ?? id;

    return {
        label: t('scene.stageLabel', { name }),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const sm = getSceneMenu();
            const handle = { id, kind: 'stage' as const, name };

            // —— 拖拽操控 ——
            addCollapsible(container, {
                title: '拖拽操控',
                icon: 'lucide:move-3d',
                defaultOpen: false,
                renderContent: (inner) => {
                    buildTransformCard(inner, handle);
                },
            });

            // —— 材质调节 ——
            buildMaterialCard(container, handle, sm);

            // —— 重置 + 卸载 ——
            buildDangerCard(container, handle, () => {
                reRenderSceneMenu();
                // 卸载后回到舞台根面板
                const menu = getSceneMenu();
                if (menu) {
                    menu.pop();
                }
            });
        },
    };
}
