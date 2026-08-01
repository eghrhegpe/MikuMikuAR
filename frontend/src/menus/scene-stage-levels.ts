// [doc:architecture] Scene Stage Levels — 舞台管理/舞台变换弹窗层级
// 从 scene-render-levels.ts 拆分

import { cardContainer, modelRegistry } from '../core/config';
import { feedbackInfo, feedbackStatus } from '../core/feedback';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSectionTitle, addCollapsible, addEmptyRow } from '../core/ui-helpers';
import { removeModel, setModelVisibility } from '../scene/manager/model-ops';
import { pushUndoSnapshot, offerSceneUndo } from '../scene/scene';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu-state';
import { buildTransformCard, buildMaterialCard, buildDangerCard } from './resource-detail-helpers';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== 舞台根面板：舞台加载、灯光 ========

function buildStageSchema(): MenuNode[] {
    const stageModels = Array.from(modelRegistry.entries()).filter(
        ([, inst]) => inst.kind === 'stage'
    );

    const nodes: MenuNode[] = [];

    // 卡片 1：功能入口（加载舞台）— CTA 上提，确保首次空状态也能直接看到操作入口
    nodes.push({
        id: 'stage:actions',
        kind: 'custom',
        renderCustom: (c) => {
            cardContainer(c, (inner) => {
                slideRow(
                    inner,
                    'lucide:upload',
                    t('scene.loadStage'),
                    true,
                    () => {
                        (async () => {
                            try {
                                const { getBrowseDir } = await import('../library/library-path');
                                const browseDir = getBrowseDir('stage');
                                if (!browseDir) {
                                    feedbackStatus('scene.statusNoModelLib', undefined, false);
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
                                feedbackStatus('scene.statusOpenStageLibFailed', undefined, false);
                                console.error('Stage library error:', err);
                            }
                        })();
                    },
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    { testId: 'menu:scene:load-stage' }
                );
            });
        },
    });

    // 卡片 2：已加载舞台列表（空时显示引导）
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
                                        feedbackInfo(
                                            newVis ? 'scene.stageShown' : 'scene.stageHidden',
                                            undefined
                                        );
                                    },
                                },
                                trailing: {
                                    icon: '✕',
                                    title: t('scene.unloadStage'),
                                    onClick: (e) => {
                                        e.stopPropagation();
                                        // [doc:adr-127] 场景级撤销保护：与其他 8 处破坏性操作一致
                                        const snap = pushUndoSnapshot();
                                        removeModel(id);
                                        reRenderSceneMenu();
                                        offerSceneUndo(
                                            t('scene.unloaded', { name: inst.name }),
                                            snap,
                                            () => reRenderSceneMenu()
                                        );
                                    },
                                },
                            }
                        );
                    }
                });
            },
        });
    } else {
        nodes.push({
            id: 'stage:empty',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addEmptyRow(inner, t('scene.noLoadedStages'), t('scene.noLoadedStagesHint'));
                });
            },
        });
    }

    return nodes;
}

export function buildStageLevel(): PopupLevel {
    return {
        label: t('scene.stage'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            return renderMenu(buildStageSchema(), container);
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
                title: t('model-detail.dragControl'),
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
