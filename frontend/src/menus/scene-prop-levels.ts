// [doc:architecture] Scene Prop Levels — 舞台道具弹窗层级
// 从 env-prop-levels.ts 迁移至舞台域

import { cardContainer, escapeHtml, propRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow } from '../core/ui-helpers';
import { loadManager } from '../core/load-manager';
import { removeProp, getPropList } from '../scene/scene';
import { SelectPMXFile } from '../core/wails-bindings';
import { getSceneMenu } from './scene-menu';
import { buildTransformCard, buildMaterialCard, buildDangerCard } from './resource-detail-helpers';

export function buildPropLevel(): PopupLevel {
    return {
        label: '道具',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';

            // —— 卡片 1：已加载道具列表（上）——
            const props = getPropList();
            if (props.length > 0) {
                cardContainer(container, (c) => {
                    for (const p of props) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(p.name)}</span><span class="slide-arrow">&gt;</span>`;
                        row.addEventListener('click', () => getSceneMenu()?.push(buildPropDetailLevel(p.id)));
                        const delBtn = document.createElement('span');
                        delBtn.className = 'slide-del-btn';
                        delBtn.textContent = '×';
                        delBtn.title = '删除道具';
                        delBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            removeProp(p.id);
                            getSceneMenu()?.reRender();
                        });
                        row.appendChild(delBtn);
                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:8px 4px;text-align:center;';
                    empty.textContent = '暂无道具';
                    c.appendChild(empty);
                });
            }

            // —— 卡片 2：加载入口（下）——
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加道具文件', false, () => {
                    SelectPMXFile().then((path) => {
                        if (path) {
                            loadManager.load({ kind: 'prop', path }).then(() => getSceneMenu()?.reRender()).catch(() => {});
                        }
                    });
                });
            });
        },
    };
}

export function buildPropDetailLevel(propId: string): PopupLevel {
    return {
        label: '道具变换',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const p = propRegistry.get(propId);
            if (!p) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:8px 4px;';
                empty.textContent = '道具不存在（可能已被删除）';
                container.appendChild(empty);
                return;
            }
            const sm = getSceneMenu();
            const handle = { id: propId, kind: 'prop' as const, name: p.name };

            // —— 标题 + 变换 ——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText = 'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = p.name;
                c.appendChild(title);
            });
            buildTransformCard(container, handle);

            // —— 材质调节 ——
            buildMaterialCard(container, handle, sm);

            // —— 危险操作 ——
            buildDangerCard(container, handle, () => {
                const menu = getSceneMenu();
                if (menu) { menu.pop(); menu.reRender(); }
            });
        },
    };
}
