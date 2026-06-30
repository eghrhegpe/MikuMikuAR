// [doc:architecture] Outfit UI — 服装变体子菜单
// 职责: 服装变体 UI 层级构建（从 model-detail.ts 提取）

import { modelRegistry, cardContainer, PopupLevel } from '../core/config';
import type { OutfitFile } from '../core/config';
import { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit';

export function buildOutfitLevel(id: string): PopupLevel {
    return {
        label: '服装变体',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            const inst = modelRegistry.get(id);
            if (!inst) {
                container.textContent = '';
                return;
            }

            let outfit: OutfitFile | undefined | null = inst.outfitFile;
            if (!outfit) {
                outfit = await loadOutfits(id);
            }

            if (!outfit.variants || outfit.variants.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText =
                    'font-size:11px;color:var(--text-dim);text-align:center;padding:20px;line-height:1.6;';
                empty.innerHTML =
                    '此模型无 outfits.json 配置。<br>在模型所在目录创建 outfits.json 即可启用服装变体。';
                container.appendChild(empty);
                return;
            }

            const active = inst.activeVariant;

            cardContainer(container, (c) => {
                const defRow = document.createElement('div');
                defRow.className = 'slide-item';
                const defIcon = document.createElement('span');
                defIcon.className = 'slide-icon';
                defIcon.innerHTML =
                    active === undefined || active === '默认'
                        ? '<iconify-icon icon="lucide:check-circle"></iconify-icon>'
                        : '<iconify-icon icon="lucide:circle"></iconify-icon>';
                defRow.appendChild(defIcon);
                const defLabel = document.createElement('span');
                defLabel.className = 'slide-label';
                defLabel.textContent = '默认';
                defRow.appendChild(defLabel);
                defRow.addEventListener('click', () => applyOutfitVariant(id, '默认'));
                c.appendChild(defRow);

                for (const v of outfit.variants) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const icon = document.createElement('span');
                    icon.className = 'slide-icon';
                    icon.innerHTML =
                        active === v.name
                            ? '<iconify-icon icon="lucide:check-circle"></iconify-icon>'
                            : '<iconify-icon icon="lucide:circle"></iconify-icon>';
                    row.appendChild(icon);
                    const label = document.createElement('span');
                    label.className = 'slide-label';
                    label.textContent = v.name;
                    row.appendChild(label);
                    row.addEventListener('click', () => applyOutfitVariant(id, v.name));
                    c.appendChild(row);
                }

                const resetBtn = document.createElement('button');
                resetBtn.className = 'btn btn-sm';
                resetBtn.textContent = '重置全部';
                resetBtn.style.cssText = 'width:100%;margin-top:8px;';
                resetBtn.addEventListener('click', () => {
                    resetOutfit(id);
                    loadOutfits(id);
                });
                c.appendChild(resetBtn);
            });
        },
    };
}
