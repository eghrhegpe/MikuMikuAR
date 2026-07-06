// [doc:architecture] Outfit UI — 服装变体子菜单
// 职责: 服装变体 UI 层级构建（从 model-detail.ts 提取）

import { modelRegistry, cardContainer, PopupLevel, setStatus } from '../core/config';
import type { OutfitFile } from '../core/config';
import { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit';
import { createIconifyIcon } from '../core/icons';
import { slideRow } from '../core/ui-helpers';
import { tryCatchStatus } from '../core/utils';

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
                    slideRow(c, '', '默认', false, async () => {
                        if (_loading) return;
                        _loading = true;
                        setStatus('⏳ 切换变体中…', true);
                        const _r = await tryCatchStatus(() => applyOutfitVariant(id, '默认'), '✗ 切换变体失败');
                        if (_r !== undefined) {
                            setStatus('✓ 变体已切换', true);
                        }
                        _loading = false;
                        await _render();
                    }, undefined, undefined, undefined, undefined, {
                        iconFactory: () => createIconifyIcon(active === undefined || active === '默认' ? 'lucide:check-circle' : 'lucide:circle'),
                    });

                    for (const v of outfit.variants) {
                        // 带 meshFile 的变体显示 FBX 标记
                        const label = v.meshFile ? 'FBX' : '';
                        slideRow(c, label, v.name, false, async () => {
                            if (_loading) return;
                            _loading = true;
                            setStatus('⏳ 切换变体中…', true);
                            const _r = await tryCatchStatus(() => applyOutfitVariant(id, v.name), '✗ 切换变体失败');
                            if (_r !== undefined) {
                                setStatus('✓ 变体已切换', true);
                            }
                            _loading = false;
                            await _render();
                        }, undefined, undefined, undefined, undefined, {
                            iconFactory: () => createIconifyIcon(active === v.name ? 'lucide:check-circle' : 'lucide:circle'),
                        });
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
                        const _r = await tryCatchStatus(async () => {
                            const newOutfit = await loadOutfits(id);
                            if (newOutfit) {
                                inst.outfitFile = newOutfit;
                            }
                            resetOutfit(id);
                        }, '✗ 重置服装失败');
                        if (_r !== undefined) {
                            setStatus('✓ 服装已重置', true);
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
