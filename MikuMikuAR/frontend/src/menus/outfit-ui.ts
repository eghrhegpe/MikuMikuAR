// [doc:architecture] Outfit UI — 服装变体子菜单
// 职责: 服装变体 UI 层级构建（从 model-detail.ts 提取）

import { modelRegistry, cardContainer, PopupLevel, setStatus } from '../core/config';
import type { OutfitFile } from '../core/config';
import { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit';
import { createIconifyIcon } from '../core/icons';

export function buildOutfitLevel(id: string): PopupLevel {
    return {
        label: '服装变体',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            const _render = async () => {
                container.innerHTML = '';
                container.classList.remove('render-card');
                const inst = modelRegistry.get(id);
                if (!inst) {
                    container.textContent = '模型已移除';
                    return;
                }

                let outfit: OutfitFile | undefined | null = inst.outfitFile;
                if (!outfit) {
                    try {
                        outfit = await loadOutfits(id);
                        if (outfit) {
                            inst.outfitFile = outfit;
                        }
                    } catch (err) {
                        console.warn('buildOutfitLevel: loadOutfits failed', err);
                        container.textContent = '⚠ 加载服装配置失败';
                        return;
                    }
                }
                if (!outfit || !outfit.variants || outfit.variants.length === 0) {
                    const empty = document.createElement('div');
                    empty.style.cssText =
                        'font-size:11px;color:var(--text-dim);text-align:center;padding:20px;line-height:1.6;';
                    empty.textContent =
                        '此模型无 outfits.json 配置。在模型所在目录创建 outfits.json 即可启用服装变体。';
                    container.appendChild(empty);
                    return;
                }

                const active = inst.activeVariant;
                let _loading = false;

                // 预创建图标元素，避免 innerHTML 字符串拼接
                const checkIcon = () => createIconifyIcon('lucide:check-circle');
                const circleIcon = () => createIconifyIcon('lucide:circle');

                cardContainer(container, (c) => {
                    const defRow = document.createElement('div');
                    defRow.className = 'slide-item';
                    const defIcon = document.createElement('span');
                    defIcon.className = 'slide-icon';
                    defIcon.appendChild(
                        active === undefined || active === '默认' ? checkIcon() : circleIcon()
                    );
                    defRow.appendChild(defIcon);
                    const defLabel = document.createElement('span');
                    defLabel.className = 'slide-label';
                    defLabel.textContent = '默认';
                    defRow.appendChild(defLabel);
                    defRow.addEventListener('click', async () => {
                        if (_loading) {
                            return;
                        }
                        _loading = true;
                        setStatus('⏳ 切换变体中…', true);
                        try {
                            await applyOutfitVariant(id, '默认');
                            setStatus('✓ 变体已切换', true);
                        } catch (_e) {
                            setStatus('✗ 切换变体失败', false);
                        }
                        _loading = false;
                        await _render();
                    });
                    c.appendChild(defRow);

                    for (const v of outfit.variants) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        const icon = document.createElement('span');
                        icon.className = 'slide-icon';
                        icon.appendChild(active === v.name ? checkIcon() : circleIcon());
                        row.appendChild(icon);
                        const label = document.createElement('span');
                        label.className = 'slide-label';
                        label.textContent = v.name;
                        row.appendChild(label);
                        row.addEventListener('click', async () => {
                            if (_loading) {
                                return;
                            }
                            _loading = true;
                            setStatus('⏳ 切换变体中…', true);
                            try {
                                await applyOutfitVariant(id, v.name);
                                setStatus('✓ 变体已切换', true);
                            } catch (_e) {
                                setStatus('✗ 切换变体失败', false);
                            }
                            _loading = false;
                            await _render();
                        });
                        c.appendChild(row);
                    }

                    const resetBtn = document.createElement('button');
                    resetBtn.className = 'btn btn-sm';
                    resetBtn.textContent = '重置全部';
                    resetBtn.style.cssText = 'width:100%;margin-top:8px;';
                    resetBtn.addEventListener('click', async () => {
                        if (_loading) {
                            return;
                        }
                        _loading = true;
                        setStatus('⏳ 重置服装中…', true);
                        try {
                            const newOutfit = await loadOutfits(id);
                            if (newOutfit) {
                                inst.outfitFile = newOutfit;
                            }
                            resetOutfit(id);
                            setStatus('✓ 服装已重置', true);
                        } catch (_e) {
                            setStatus('✗ 重置服装失败', false);
                        }
                        _loading = false;
                        await _render();
                    });
                    c.appendChild(resetBtn);
                });
            };
            await _render();
        },
    };
}
