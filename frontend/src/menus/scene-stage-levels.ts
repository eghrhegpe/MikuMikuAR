// [doc:architecture] Scene Stage Levels — 舞台管理/舞台变换弹窗层级
// 从 scene-render-levels.ts 拆分

import {
    setStatus,
    cardContainer,
    modelRegistry,
    overridePaths,
    libraryRoot,
    escapeHtml,
} from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSectionTitle, addCollapsible } from '../core/ui-helpers';
import { removeModel, setModelVisibility } from '../scene/manager/model-ops';
import { getPropList, removeProp, modelManager } from '../scene/scene';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { buildTransformCard, buildMaterialCard, buildDangerCard } from './resource-detail-helpers';

import { buildPropDetailLevel } from './scene-prop-levels';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import { isUnderRoot } from '../core/utils';
import type { MenuNode } from './menu-schema';
import { buildGroundLevel, buildWaterLevel } from './env-feature-levels';
import { setDebugMirrorSize, setDebugMirrorResolution, getDebugMirrorInfo } from '../scene/env/env';
import { addModeSlider } from '../core/ui-helpers';
import { envState } from '../core/state';
import { setEnvState } from '../scene/env/env-bridge';

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

    const nodes: MenuNode[] = [];

    // 卡片 1：已加载舞台列表（空时隐藏）
    if (stageModels.length > 0) {
        nodes.push({
            id: 'stage:loaded',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('scene.loadedStages'));
                    for (const [id, inst] of stageModels) {
                        slideRow(
                            inner,
                            '',
                            inst.name,
                            false,
                            () => {
                                const sm = getSceneMenu();
                                if (sm) {
                                    sm.push(buildStageTransformLevel(id));
                                }
                            },
                            undefined,
                            undefined,
                            false,
                            undefined,
                            {
                                iconFactory: () => {
                                    const iconEl = createIconifyIcon(
                                        inst.visible ? 'lucide:eye' : 'lucide:eye-off'
                                    );
                                    const span = document.createElement('span');
                                    span.className = 'slide-icon';
                                    if (iconEl) {
                                        span.appendChild(iconEl);
                                    }
                                    return span;
                                },
                                leading: {
                                    icon: inst.visible ? 'lucide:eye' : 'lucide:eye-off',
                                    title: t('scene.toggleVisibility'),
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        const newVis = !inst.visible;
                                        setModelVisibility(id, newVis);
                                        reRenderSceneMenu();
                                        setStatus(
                                            newVis ? t('scene.stageShown') : t('scene.stageHidden'),
                                            true
                                        );
                                    },
                                },
                                trailing: {
                                    icon: '✕',
                                    title: t('scene.unloadStage'),
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        removeModel(id);
                                        reRenderSceneMenu();
                                        setStatus(t('scene.unloaded', { name: inst.name }), true);
                                    },
                                },
                            }
                        );
                    }
                });
            },
        });
    }

    // 卡片 2：已加载道具列表（空时隐藏）
    if (propItems.length > 0) {
        nodes.push({
            id: 'stage:props',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    for (const item of propItems) {
                        slideRow(
                            inner,
                            'lucide:box',
                            item.name,
                            false,
                            () => getSceneMenu()?.push(buildPropDetailLevel(item.id)),
                            undefined,
                            undefined,
                            false,
                            undefined,
                            {
                                trailing: {
                                    icon: '×',
                                    title: t('scene.deleteProp'),
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        if (item.fromPropRegistry) {
                                            removeProp(item.id);
                                        } else {
                                            removeModel(item.id);
                                        }
                                        reRenderSceneMenu();
                                    },
                                },
                            }
                        );
                    }
                });
            },
        });
    }

    nodes.push(
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
        // [adr-111] 地面/水面：从环境菜单迁入，恢复 headerToggle 快速开关
        {
            id: 'stage:ground',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const sm = getSceneMenu();
                    // 地面行：开关 + 导航
                    const groundRow = document.createElement('div');
                    groundRow.className = 'slide-item';
                    groundRow.style.cursor = 'pointer';
                    const gIcon = document.createElement('span');
                    gIcon.className = 'slide-icon';
                    const gIconEl = createIconifyIcon('lucide:square');
                    if (gIconEl) {
                        gIcon.appendChild(gIconEl);
                    }
                    groundRow.appendChild(gIcon);
                    const gLabel = document.createElement('span');
                    gLabel.className = 'slide-label';
                    gLabel.textContent = '地面';
                    groundRow.appendChild(gLabel);
                    const gToggle = document.createElement('label');
                    gToggle.className = 'toggle';
                    gToggle.innerHTML = '<input type="checkbox"><span class="slider"></span>';
                    const gCheckbox = gToggle.querySelector('input')!;
                    gCheckbox.checked = envState.groundVisible;
                    gCheckbox.addEventListener('change', () =>
                        setEnvState({ groundVisible: gCheckbox.checked })
                    );
                    gToggle.style.marginLeft = 'auto';
                    gToggle.style.marginRight = '4px';
                    groundRow.appendChild(gToggle);
                    const gArrow = document.createElement('span');
                    gArrow.className = 'slide-arrow';
                    gArrow.textContent = '>';
                    groundRow.appendChild(gArrow);
                    groundRow.addEventListener('click', (e) => {
                        if ((e.target as HTMLElement).closest('.toggle')) {
                            return;
                        }
                        sm?.push(buildGroundLevel());
                    });
                    inner.appendChild(groundRow);

                    // 水面行：开关 + 导航
                    const waterRow = document.createElement('div');
                    waterRow.className = 'slide-item';
                    waterRow.style.cursor = 'pointer';
                    const wIcon = document.createElement('span');
                    wIcon.className = 'slide-icon';
                    const wIconEl = createIconifyIcon('lucide:waves');
                    if (wIconEl) {
                        wIcon.appendChild(wIconEl);
                    }
                    waterRow.appendChild(wIcon);
                    const wLabel = document.createElement('span');
                    wLabel.className = 'slide-label';
                    wLabel.textContent = '水面';
                    waterRow.appendChild(wLabel);
                    const wToggle = document.createElement('label');
                    wToggle.className = 'toggle';
                    wToggle.innerHTML = '<input type="checkbox"><span class="slider"></span>';
                    const wCheckbox = wToggle.querySelector('input')!;
                    wCheckbox.checked = envState.waterEnabled;
                    wCheckbox.addEventListener('change', () =>
                        setEnvState({ waterEnabled: wCheckbox.checked })
                    );
                    wToggle.style.marginLeft = 'auto';
                    wToggle.style.marginRight = '4px';
                    waterRow.appendChild(wToggle);
                    const wArrow = document.createElement('span');
                    wArrow.className = 'slide-arrow';
                    wArrow.textContent = '>';
                    waterRow.appendChild(wArrow);
                    waterRow.addEventListener('click', (e) => {
                        if ((e.target as HTMLElement).closest('.toggle')) {
                            return;
                        }
                        sm?.push(buildWaterLevel());
                    });
                    inner.appendChild(waterRow);
                });
            },
        },
        // 调试镜面：舞台反射调试工具
        {
            id: 'stage:debugMirror',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    renderMenu(
                        [
                            {
                                id: 'debugMirror',
                                kind: 'folder',
                                label: 'scene.debugMirror',
                                icon: 'lucide:scan',
                                defaultOpen: false,
                                headerToggle: { bind: 'env.debugMirrorEnabled' },
                                children: [
                                    {
                                        id: 'debugMirror:controls',
                                        kind: 'custom',
                                        renderCustom: (cc) => {
                                            const info = getDebugMirrorInfo();
                                            addModeSlider(
                                                cc,
                                                t('scene.debugMirrorWidth'),
                                                Array.from({ length: 15 }, (_, i) => ({
                                                    value: String(2 + i * 2),
                                                    label: `${2 + i * 2}m`,
                                                })),
                                                String(info.width),
                                                (v) => {
                                                    const w = parseFloat(v);
                                                    const cur = getDebugMirrorInfo();
                                                    setDebugMirrorSize(w, cur.height);
                                                },
                                                'lucide:move-horizontal'
                                            );
                                            addModeSlider(
                                                cc,
                                                t('scene.debugMirrorHeight'),
                                                Array.from({ length: 10 }, (_, i) => ({
                                                    value: String(1 + i * 2),
                                                    label: `${1 + i * 2}m`,
                                                })),
                                                String(info.height),
                                                (v) => {
                                                    const h = parseFloat(v);
                                                    const cur = getDebugMirrorInfo();
                                                    setDebugMirrorSize(cur.width, h);
                                                },
                                                'lucide:move-vertical'
                                            );
                                            addModeSlider(
                                                cc,
                                                t('scene.debugMirrorResolution'),
                                                [
                                                    { value: '128', label: '128' },
                                                    { value: '256', label: '256' },
                                                    { value: '512', label: '512' },
                                                    { value: '1024', label: '1024' },
                                                ],
                                                String(info.resolution),
                                                (v) => setDebugMirrorResolution(parseInt(v)),
                                                'lucide:grid-3x3'
                                            );
                                            const p = info.position;
                                            const infoDiv = document.createElement('div');
                                            infoDiv.style.cssText =
                                                'padding:4px 12px;font-size:11px;color:var(--text-dim);';
                                            infoDiv.textContent = info.active
                                                ? `mesh: ${info.meshCount} | pos: (${p[0].toFixed(1)}, ${p[1].toFixed(1)}, ${p[2].toFixed(1)}) | ${info.width}×${info.height}m @ ${info.resolution}px`
                                                : t('scene.debugMirrorHint');
                                            cc.appendChild(infoDiv);
                                        },
                                    },
                                ],
                            },
                        ],
                        inner
                    );
                });
            },
        }
    );

    return nodes;
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
