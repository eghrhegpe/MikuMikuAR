// settings-filename.ts — 文件名设置子菜单

import { SetDownloadAutoImport, SetDownloadWatchDir, GetDownloadWatchStatus, StopWatchDir, SelectDir } from '../core/wails-bindings';
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
import { slideRow, addSliderRow, addToggleRow, addSectionTitle, addDangerRow } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { showConfirm, showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import { t } from '../core/i18n/t';
import type { PopupLevel } from '../core/config';
import {
    getAutoImportCached,
    setAutoImportCached,
    NAME_PRIORITY_LABELS,
    NAME_PRIORITY_INDEX,
} from './settings-shared';
import type { DisplayNamePriority } from '../core/config';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

function applyDisplayNamePriority(priority: DisplayNamePriority): void {
    setDisplayNamePriority(priority);
    import('../core/wails-bindings').then((m) => m.SetDisplayNamePriority(priority)).catch(console.warn);
}

export function buildSettingsFilenameLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '文件名',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // 排序模式
            cardContainer(container, (c) => {
                slideRow(
                    c,
                    'lucide:arrow-up-down',
                    librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认',
                    true,
                    () => {
                        setLibrarySortMode(librarySortMode === 'name' ? 'default' : 'name');
                        getSettingsMenu()?.updateControls();
                    }
                );
                const sortRow = c.querySelector('.slide-item');
                if (sortRow) {
                    const labelSpan = sortRow.querySelector('.slide-label');
                    if (labelSpan) {
                        getCurrentRenderingMenu()?.registerControl(() => {
                            labelSpan.textContent =
                                librarySortMode === 'name' ? '动作排序：名称' : '动作排序：默认';
                        });
                    }
                }
            });
            // 显示名称优先级
            const priorityIndex =
                displayNamePriority === 'name_jp' ? 0 : displayNamePriority === 'name_en' ? 1 : 2;
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
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
                        bind: () =>
                            displayNamePriority === 'name_jp'
                                ? 0
                                : displayNamePriority === 'name_en'
                                  ? 1
                                  : 2,
                        onUpdate: (el) => {
                            const valEl = el.querySelector('.cs-value');
                            if (valEl) {
                                valEl.textContent = NAME_PRIORITY_LABELS[displayNamePriority];
                            }
                        },
                    }
                );
            });
            // 材质分类映射
            cardContainer(container, (c) => {
                addSectionTitle(c, '材质分类映射（正则 → 分类）');

                const map = uiState.materialCategoryMap || {};
                const entries = Object.entries(map);

                for (const [pattern, category] of entries) {
                    slideRow(
                        c,
                        'lucide:tag',
                        pattern,
                        false,
                        () => {},
                        category,
                        undefined,
                        undefined,
                        undefined,
                        {
                            actionIcon: '✕',
                            onActionClick: () => {
                                delete uiState.materialCategoryMap![pattern];
                                if (Object.keys(uiState.materialCategoryMap!).length === 0) {
                                    delete uiState.materialCategoryMap;
                                }
                                setUIState({ materialCategoryMap: uiState.materialCategoryMap });
                                getSettingsMenu()?.reRender();
                            },
                        }
                    );
                }

                // 添加新映射
                slideRow(c, 'lucide:plus', '添加材质映射', false, async () => {
                    const pattern = await showPrompt('输入正则匹配模式（如 skirt|スカート）：');
                    if (!pattern) {
                        return;
                    }
                    try {
                        new RegExp(pattern);
                    } catch {
                        setStatus(t('settings.invalidRegex'), false);
                        return;
                    }
                    const category = await showPrompt(
                        '输入目标分类（皮肤/头发/眼睛/服装/配件/道具）：'
                    );
                    if (!category) {
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
            // 自动导入
            addSectionTitle(container, '自动导入');
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    '自动导入',
                    getAutoImportCached(),
                    (v) => {
                        setAutoImportCached(v);
                        SetDownloadAutoImport(v).catch(() => {});
                        getSettingsMenu()?.updateControls();
                        setStatus(v ? '✓ 自动导入已开启' : '✓ 自动导入已关闭', true);
                    },
                    'lucide:download',
                    {
                        bind: () => getAutoImportCached(),
                    }
                );
            });
            cardContainer(container, (c) => {
                const statusEl = document.createElement('div');
                statusEl.style.cssText = 'font-size:11px;color:var(--text);padding:4px 14px;';
                c.appendChild(statusEl);

                const refreshStatus = async () => {
                    try {
                        const dir = await GetDownloadWatchStatus();
                        statusEl.textContent = dir ? `监听中: ${dir}` : '监听已停止';
                    } catch {
                        statusEl.textContent = '监听已停止';
                    }
                };
                refreshStatus();

                const dirRow = document.createElement('div');
                dirRow.style.cssText = 'display:flex;gap:6px;padding:6px 14px;';
                const dirInput = document.createElement('input');
                dirInput.type = 'text';
                dirInput.placeholder = '选择监听目录...';
                dirInput.readOnly = true;
                dirInput.style.cssText =
                    'flex:1;background:var(--white-08);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:6px 8px;font-size:12px;';
                const selectBtn = document.createElement('button');
                selectBtn.textContent = '📁';
                selectBtn.className = 'mode-btn';
                selectBtn.addEventListener('click', async () => {
                    try {
                        const dir = await SelectDir();
                        if (!dir) {
                            return;
                        }
                        dirInput.value = dir;
                        await SetDownloadWatchDir(dir);
                        refreshStatus();
                        setStatus(`✓ 监听目录已设置: ${dir}`, true);
                    } catch {
                        setStatus(t('settings.watchDirFailed'), false);
                    }
                });
                dirRow.appendChild(dirInput);
                dirRow.appendChild(selectBtn);
                c.appendChild(dirRow);

                GetDownloadWatchStatus()
                    .then((dir) => {
                        if (dir) {
                            dirInput.value = dir;
                        }
                    })
                    .catch(() => {});
            });

            cardContainer(container, (c) => {
                addDangerRow(c, 'lucide:stop-circle', '停止监听', async () => {
                    const _r = await tryCatchStatus(() => StopWatchDir(), '✗ 停止监听失败');
                    if (_r !== undefined) {
                        setStatus(t('settings.watchStopped'), true);
                    }
                });
            });
        },
    };
}
