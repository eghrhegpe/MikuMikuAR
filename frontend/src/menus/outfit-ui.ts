// [doc:architecture] Outfit UI — 替换纹理子菜单
// 职责: 替换纹理 UI 层级构建（从 model-detail.ts 提取）

import { modelRegistry, cardContainer, PopupLevel, setStatus } from '../core/config';
import type { OutfitFile } from '../core/config';
import { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit';
import { createIconifyIcon } from '../core/icons';
import { slideRow } from '../core/ui-helpers';
import { tryCatchStatus, LoadingGuard } from '../core/utils';
import { logWarn } from '../core/logger';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function buildOutfitSchema(id: string): MenuNode[] {
    return [
        {
            id: 'outfit:main',
            kind: 'custom',
            renderCustom: (c) => {
                const _render = async () => {
                    c.innerHTML = '';
                    c.classList.remove('render-card');
                    const inst = modelRegistry.get(id);
                    if (!inst) {
                        c.textContent = t('outfit.modelRemoved');
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
                            logWarn('outfit-ui', 'buildOutfitLevel: loadOutfits failed', err);
                            c.textContent = t('outfit.loadConfigFailed');
                            return;
                        }
                    }
                    if (!outfit || !outfit.variants || outfit.variants.length === 0) {
                        const empty = document.createElement('div');
                        empty.style.cssText =
                            'font-size:11px;color:var(--text-dim);text-align:center;padding:20px;line-height:1.6;';
                        empty.textContent = t('outfit.noOutfitsConfig');
                        c.appendChild(empty);
                        return;
                    }

                    const outfitData = outfit;
                    const active = inst.activeVariant;
                    const _loadingGuard = new LoadingGuard();

                    cardContainer(c, (inner) => {
                        slideRow(
                            inner,
                            '',
                            t('outfit.default'),
                            false,
                            async () => {
                                if (!_loadingGuard.tryEnter()) {
                                    return;
                                }
                                setStatus(t('outfit.switching'), true);
                                const _r = await tryCatchStatus(
                                    () => applyOutfitVariant(id, '默认'),
                                    t('outfit.switchFailed')
                                );
                                if (_r !== undefined) {
                                    setStatus(t('outfit.switched'), true);
                                }
                                _loadingGuard.leave();
                                await _render();
                            },
                            undefined,
                            undefined,
                            undefined,
                            undefined,
                            {
                                iconFactory: () =>
                                    createIconifyIcon(
                                        active === undefined || active === '默认'
                                            ? 'lucide:check-circle'
                                            : 'lucide:circle'
                                    ),
                            }
                        );

                        for (const v of outfitData.variants) {
                            // 带 meshFile 的变体显示 FBX 标记（slideRow 第7位 tag）
                            const tag = v.meshFile ? 'FBX' : undefined;
                            slideRow(
                                inner,
                                '',
                                v.name,
                                false,
                                async () => {
                                    if (!_loadingGuard.tryEnter()) {
                                        return;
                                    }
                                    setStatus(t('outfit.switching'), true);
                                    const _r = await tryCatchStatus(
                                        () => applyOutfitVariant(id, v.name),
                                        t('outfit.switchFailed')
                                    );
                                    if (_r !== undefined) {
                                        setStatus(t('outfit.switched'), true);
                                    }
                                    _loadingGuard.leave();
                                    await _render();
                                },
                                undefined,
                                tag,
                                undefined,
                                undefined,
                                {
                                    iconFactory: () =>
                                        createIconifyIcon(
                                            active === v.name
                                                ? 'lucide:check-circle'
                                                : 'lucide:circle'
                                        ),
                                }
                            );
                        }

                        const resetBtn = document.createElement('button');
                        resetBtn.className = 'btn btn-sm';
                        resetBtn.textContent = t('outfit.resetAll');
                        resetBtn.style.cssText = 'width:100%;margin-top:8px;';
                        resetBtn.addEventListener('click', async () => {
                            if (!_loadingGuard.tryEnter()) {
                                return;
                            }
                            setStatus(t('outfit.resetting'), true);
                            const _r = await tryCatchStatus(async () => {
                                await resetOutfit(id);
                            }, t('outfit.resetFailed'));
                            if (_r !== undefined) {
                                setStatus(t('outfit.resetDone'), true);
                            }
                            _loadingGuard.leave();
                            await _render();
                        });
                        inner.appendChild(resetBtn);
                    });
                };
                void _render();
            },
        },
    ] satisfies MenuNode[];
}

export function buildOutfitLevel(id: string): PopupLevel {
    return {
        label: t('outfit.variant'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildOutfitSchema(id), container);
        },
    };
}
