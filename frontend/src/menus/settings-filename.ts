// settings-filename.ts — 文件名设置子菜单

import {
    setStatus,
    cardContainer,
    uiState,
    setUIState,
    librarySortMode,
    setLibrarySortMode,
    displayNamePriority,
    setDisplayNamePriority,
} from '../core/config';
import { slideRow, addSliderRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { showPrompt, showPrompt2 } from '../core/dialog';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { PopupLevel } from '../core/config';
import type { MenuNode } from './menu-schema';
import {
    NAME_PRIORITY_LABELS,
    NAME_PRIORITY_INDEX,
    PRIORITY_TO_INDEX,
    type SettingsMenuHandle,
} from './settings-shared';
import type { DisplayNamePriority } from '../core/config';

function applyDisplayNamePriority(priority: DisplayNamePriority): void {
    setDisplayNamePriority(priority);
    import('../core/wails-bindings')
        .then((m) => m.SetDisplayNamePriority(priority))
        .catch(() => setStatus(t('settings.saveFailed'), false));
}

function buildFilenameSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：排序模式
        {
            id: 'filename:sort',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '排序模式');
                    slideRow(
                        inner,
                        'lucide:arrow-up-down',
                        librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认',
                        true,
                        () => {
                            setLibrarySortMode(librarySortMode === 'name' ? 'default' : 'name');
                            getSettingsMenu()?.updateControls();
                        }
                    );
                    const sortRow = inner.querySelector('.slide-item');
                    if (sortRow) {
                        const labelSpan = sortRow.querySelector('.slide-label');
                        if (labelSpan) {
                            getCurrentRenderingMenu()?.registerControl(() => {
                                labelSpan.textContent =
                                    librarySortMode === 'name'
                                        ? '动作排序：名称'
                                        : '动作排序：默认';
                            });
                        }
                    }
                });
            },
        },
        // 卡片 2：显示名称优先级
        {
            id: 'filename:priority',
            kind: 'custom',
            renderCustom: (c) => {
                const priorityIndex = PRIORITY_TO_INDEX[displayNamePriority] ?? 0;
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '显示名称优先级');
                    addSliderRow(
                        inner,
                        '显示名称优先级',
                        priorityIndex,
                        0,
                        2,
                        1,
                        (v) => {
                            applyDisplayNamePriority(NAME_PRIORITY_INDEX[v]);
                            getSettingsMenu()?.updateControls();
                        },
                        'lucide:type',
                        undefined,
                        {
                            bind: () => PRIORITY_TO_INDEX[displayNamePriority] ?? 2,
                            onUpdate: (el) => {
                                const valEl = el.querySelector('.cs-value');
                                if (valEl) {
                                    valEl.textContent = NAME_PRIORITY_LABELS[displayNamePriority];
                                }
                            },
                        }
                    );
                });
            },
        },
        // 卡片 3：材质分类映射
        {
            id: 'filename:material-map',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, '材质分类映射（正则 → 分类）');

                    const map = uiState.materialCategoryMap || {};
                    const entries = Object.entries(map);

                    for (const [pattern, category] of entries) {
                        slideRow(
                            inner,
                            'lucide:tag',
                            pattern,
                            false,
                            () => {},
                            category,
                            undefined,
                            undefined,
                            undefined,
                            {
                                actionIcons: [
                                    {
                                        icon: 'lucide:x',
                                        title: '删除',
                                        danger: true,
                                        onClick: () => {
                                            delete uiState.materialCategoryMap![pattern];
                                            if (
                                                Object.keys(uiState.materialCategoryMap!).length ===
                                                0
                                            ) {
                                                delete uiState.materialCategoryMap;
                                            }
                                            setUIState({
                                                materialCategoryMap: uiState.materialCategoryMap,
                                            });
                                            getSettingsMenu()?.reRender();
                                        },
                                    },
                                ],
                            }
                        );
                    }

                    // 添加新映射
                    slideRow(inner, 'lucide:plus', '添加材质映射', false, async () => {
                        const result = await showPrompt2({
                            title: '添加材质映射',
                            label1: '正则匹配模式',
                            placeholder1: '如 skirt|スカート',
                            label2: '目标分类',
                            placeholder2: '皮肤/头发/眼睛/服装/配件/道具',
                        });
                        if (!result) {
                            return;
                        }
                        const [pattern, category] = result;
                        try {
                            new RegExp(pattern);
                        } catch {
                            setStatus(t('settings.invalidRegex'), false);
                            return;
                        }
                        if (!['皮肤', '头发', '眼睛', '服装', '配件', '道具'].includes(category)) {
                            setStatus(t('settings.invalidCategory'), false);
                            return;
                        }
                        if (!uiState.materialCategoryMap) {
                            uiState.materialCategoryMap = {};
                        }
                        uiState.materialCategoryMap[pattern] = category;
                        setUIState({ materialCategoryMap: uiState.materialCategoryMap });
                        getSettingsMenu()?.reRender();
                    });
                });
            },
        },
    ];
}

export function buildSettingsFilenameLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '文件名',
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildFilenameSchema(getSettingsMenu), container);
        },
    };
}
