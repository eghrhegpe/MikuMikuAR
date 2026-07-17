// [doc:architecture] Scene Prop Levels — 舞台道具弹窗层级
// 从 env-prop-levels.ts 迁移至舞台域

import { cardContainer, propRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addCollapsible } from '../core/ui-helpers';
import { logWarn } from '../core/utils';
import { loadManager } from '../core/load-manager';
import { removeProp, getPropList } from '../scene/scene';
import { SelectPMXFile } from '../core/wails-bindings';
import { getSceneMenu } from './scene-menu';
import {
    buildTransformCard,
    buildMaterialCard,
    buildDangerCard,
    buildBoneAttachCard,
} from './resource-detail-helpers';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildPropSchema(): MenuNode[] {
    const props = getPropList();
    const nodes: MenuNode[] = [];

    // 卡片 1：已加载道具列表（空时显示引导）
    if (props.length > 0) {
        nodes.push({
            id: 'prop:list',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    for (const p of props) {
                        slideRow(
                            inner,
                            'lucide:box',
                            p.name,
                            false,
                            () => getSceneMenu()?.push(buildPropDetailLevel(p.id)),
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
                                        removeProp(p.id);
                                        getSceneMenu()?.reRender();
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
            id: 'prop:empty',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.style.cssText =
                        'padding:12px 14px;text-align:center;font-size:var(--font-ui);color:var(--text-dim);';
                    emptyDiv.textContent = t('scene.noProps');
                    inner.appendChild(emptyDiv);
                });
            },
        });
    }

    // 卡片 2：加载入口
    nodes.push({
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
    });

    return nodes;
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
            buildBoneAttachCard(container, handle, () => sm?.reRender());

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
