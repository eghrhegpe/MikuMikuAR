// [doc:architecture] Scene Prop Levels — 舞台道具详情层级
// 从 env-prop-levels.ts 迁移至舞台域

import { cardContainer, propRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addCollapsible } from '../core/ui-helpers';
import { getSceneMenu } from './scene-menu';
import {
    buildTransformCard,
    buildMaterialCard,
    buildDangerCard,
    buildBoneAttachCard,
} from './resource-detail-helpers';
import { t } from '../core/i18n/t';

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
                title: t('model-detail.dragControl'),
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
