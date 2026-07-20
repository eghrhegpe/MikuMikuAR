// settings-resources.ts — 资源设置子菜单（ADR-157：合并原 library + paths 的存储/路径/监听部分）
// 页面流：存储位置 → 模型库 → 路径覆盖 → 下载监听。路径行直接调用 SETTINGS_ACTIONS，消除假 PopupRow 套娃。

import {
    GetStorageMode,
    SetDownloadWatchEnabled,
    GetDownloadWatchStatus,
    SetDownloadWatchDir,
    SetDownloadAutoImport,
    SelectDir,
} from '../core/wails-bindings';
import {
    setStatus,
    resourceRoot,
    overridePaths,
    allModels,
    cardContainer,
    uiState,
    setUIState,
    librarySortMode,
    setLibrarySortMode,
    displayNamePriority,
    setDisplayNamePriority,
    type PopupLevel,
    type DisplayNamePriority,
} from '../core/config';
import {
    slideRow,
    addModeRow,
    addToggleRow,
    addWatchDirRow,
    addSectionTitle,
    addSliderRow,
} from '../core/ui-helpers';
import { showPrompt2 } from '../core/dialog';
import { getCurrentRenderingMenu } from './menu';
import { switchStorageMode, refreshLibrary } from './library-core';
import { t } from '../core/i18n/t';
import { CATEGORY_DIR } from '../core/utils';
import { logWarn } from '../core/logger';
import { SETTINGS_ACTION } from './settings-targets';
import { SETTINGS_ACTIONS } from './settings-actions';
import { isAndroidPlatform } from '../core/platform';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import {
    truncatePath,
    NAME_PRIORITY_LABELS,
    NAME_PRIORITY_INDEX,
    PRIORITY_TO_INDEX,
    getDownloadWatchEnabledCached,
    setDownloadWatchEnabledCached,
    getAutoImportCached,
    setAutoImportCached,
    type SettingsMenuHandle,
} from './settings-shared';

// ======== 模型库：显示名优先级持久化 ========
function applyDisplayNamePriority(priority: DisplayNamePriority): void {
    setDisplayNamePriority(priority);
    import('../core/wails-bindings')
        .then((m) => m.SetDisplayNamePriority(priority))
        .catch(() => setStatus(t('settings.saveFailed'), false));
}

// ======== 卡片 1：存储位置（桌面=资源根目录；Android=私有/共享存储） ========
function renderAndroidStorage(
    c: HTMLElement,
    currentMode: string,
    getSettingsMenu: () => SettingsMenuHandle
): void {
    cardContainer(c, (inner) => {
        addSectionTitle(inner, t('settings.paths.storage'));
        addModeRow<string>(
            inner,
            t('settings.storageMode'),
            [
                { value: 'private', label: t('settings.storagePrivate') },
                { value: 'shared', label: t('settings.storageShared') },
            ],
            currentMode,
            (mode) => {
                switchStorageMode(mode as 'private' | 'shared')
                    .then(() => {
                        getSettingsMenu()?.reRender();
                        refreshLibrary()
                            .then(() => {
                                const msg =
                                    allModels.length > 0
                                        ? t('settings.paths.modelsLoaded', {
                                              count: allModels.length,
                                          })
                                        : t('settings.paths.noModels');
                                setStatus(msg, allModels.length === 0);
                            })
                            .catch((err) => {
                                logWarn('resources', 'refreshLibrary failed:', err);
                            });
                    })
                    .catch((err) => {
                        console.error('[resources] switchStorageMode failed:', err);
                        setStatus(t('settings.storageModeFail', { err }), true);
                    });
            }
        );
        const desc = document.createElement('div');
        desc.className = 'storage-mode-desc';
        desc.style.cssText =
            'font-size:11px;color:var(--text-secondary);padding:2px 12px 8px;line-height:1.4';
        desc.textContent = t('settings.storageModeDesc');
        inner.appendChild(desc);
        const diag = document.createElement('div');
        diag.style.cssText =
            'margin:6px 12px 8px;padding:8px 10px;background:rgba(0,0,0,0.12);border-radius:6px;font-size:11px;color:var(--text-secondary);line-height:1.7;word-break:break-all';

        const modeRow = document.createElement('div');
        modeRow.textContent =
            t('settings.storageMode') +
            '：' +
            (currentMode === 'shared'
                ? t('settings.paths.storageModeShared')
                : t('settings.paths.storageModePrivate'));
        diag.appendChild(modeRow);

        const rootRow = document.createElement('div');
        rootRow.textContent = t('settings.paths.resourceRoot') + '：';
        if (resourceRoot) {
            rootRow.textContent += resourceRoot;
        } else {
            const notSet = document.createElement('span');
            notSet.style.color = 'var(--danger)';
            notSet.textContent = t('settings.paths.notSet');
            rootRow.appendChild(notSet);
        }
        diag.appendChild(rootRow);

        const countRow = document.createElement('div');
        countRow.textContent = t('settings.paths.modelCount') + allModels.length;
        diag.appendChild(countRow);

        inner.appendChild(diag);
    });
}

function buildStorageSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const root = resourceRoot;
    const rootSub = root ? truncatePath(root) : t('settings.paths.notSet');
    const isAndroid = isAndroidPlatform();

    return [
        {
            id: 'resources:storage',
            kind: 'custom',
            renderCustom: (c) => {
                if (!isAndroid) {
                    cardContainer(c, (inner) => {
                        addSectionTitle(inner, t('settings.paths.storage'));
                        slideRow(
                            inner,
                            'lucide:folder',
                            t('settings.paths.resourceRoot'),
                            false,
                            () => SETTINGS_ACTIONS[SETTINGS_ACTION.RESOURCE_ROOT](),
                            rootSub
                        );
                    });
                    return;
                }
                // Android：异步取存储模式后再渲染；disposed 守卫防止卸载后写 DOM
                let disposed = false;
                GetStorageMode()
                    .then((mode) => {
                        if (!disposed) {
                            renderAndroidStorage(c, mode || 'private', getSettingsMenu);
                        }
                    })
                    .catch(() => {
                        if (!disposed) {
                            renderAndroidStorage(c, 'private', getSettingsMenu);
                        }
                    });
                return () => {
                    disposed = true;
                };
            },
        },
    ];
}

// ======== 卡片 2：模型库（排序 / 显示名优先级 / 材质分类映射） ========
function buildLibrarySchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'resources:library-sort',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.library.sortMode'));
                    slideRow(
                        inner,
                        'lucide:arrow-up-down',
                        librarySortMode === 'name'
                            ? t('settings.library.sortByName')
                            : t('settings.library.sortByDefault'),
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
                                        ? t('settings.library.sortByName')
                                        : t('settings.library.sortByDefault');
                            });
                        }
                    }
                });
            },
        },
        {
            id: 'resources:library-priority',
            kind: 'custom',
            renderCustom: (c) => {
                const priorityIndex = PRIORITY_TO_INDEX[displayNamePriority] ?? 0;
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.library.namePriority'));
                    addSliderRow(
                        inner,
                        t('settings.library.namePriority'),
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
        {
            id: 'resources:library-material-map',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.library.materialMap'));

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
                                trailing: {
                                    icon: 'lucide:x',
                                    title: t('common.delete'),
                                    danger: true,
                                    onClick: () => {
                                        delete uiState.materialCategoryMap![pattern];
                                        if (
                                            Object.keys(uiState.materialCategoryMap!).length === 0
                                        ) {
                                            delete uiState.materialCategoryMap;
                                        }
                                        setUIState({
                                            materialCategoryMap: uiState.materialCategoryMap,
                                        });
                                        getSettingsMenu()?.reRender();
                                    },
                                },
                            }
                        );
                    }

                    // 添加新映射
                    slideRow(inner, 'lucide:plus', t('settings.library.addMaterialMap'), false, async () => {
                        const result = await showPrompt2({
                            title: t('settings.library.addMaterialMap'),
                            label1: t('settings.library.patternLabel'),
                            placeholder1: t('settings.library.patternPlaceholder'),
                            label2: t('settings.library.categoryLabel'),
                            placeholder2: t('settings.library.categoryPlaceholder'),
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

// ======== 卡片 3：路径覆盖（直接调用 SETTINGS_ACTIONS，无套娃） ========
function buildOverrideSchema(): MenuNode[] {
    const root = resourceRoot;
    const paths = overridePaths || {};
    const pathSub = (key: string, defSub: string) => {
        const val = paths[key as keyof typeof paths];
        let actual: string;
        if (val) {
            actual = val as string;
        } else if (root) {
            actual = `${root}/${CATEGORY_DIR[key] || key}`;
        } else {
            return defSub;
        }
        return truncatePath(actual);
    };

    const overrideRows: Array<{ icon: string; labelKey: string; action: string; key: string }> = [
        { icon: 'lucide:box', labelKey: 'settings.paths.pmx', action: SETTINGS_ACTION.PATH_PMX, key: 'pmx' },
        { icon: 'lucide:music', labelKey: 'settings.paths.vmd', action: SETTINGS_ACTION.PATH_VMD, key: 'vmd' },
        { icon: 'lucide:headphones', labelKey: 'settings.paths.audio', action: SETTINGS_ACTION.PATH_AUDIO, key: 'audio' },
        { icon: 'lucide:gem', labelKey: 'settings.paths.prop', action: SETTINGS_ACTION.PATH_PROP, key: 'prop' },
        { icon: 'lucide:home', labelKey: 'settings.paths.stage', action: SETTINGS_ACTION.PATH_STAGE, key: 'stage' },
        { icon: 'lucide:cloud', labelKey: 'settings.paths.environment', action: SETTINGS_ACTION.PATH_ENVIRONMENT, key: 'environment' },
    ];

    return [
        {
            id: 'resources:override',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.paths.override'));
                    for (const r of overrideRows) {
                        slideRow(
                            inner,
                            r.icon,
                            t(r.labelKey),
                            false,
                            () => SETTINGS_ACTIONS[r.action](),
                            pathSub(r.key, t('settings.paths.default'))
                        );
                    }
                });
            },
        },
    ];
}

// ======== 卡片 4：下载监听（仅桌面端） ========
function buildWatchSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'resources:watch',
            kind: 'custom',
            visibleWhen: () => !isAndroidPlatform(),
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.paths.downloadWatch'));
                    addToggleRow(
                        inner,
                        t('settings.paths.watchDownloadDir'),
                        getDownloadWatchEnabledCached(),
                        (v) => {
                            setDownloadWatchEnabledCached(v);
                            SetDownloadWatchEnabled(v).catch((err) =>
                                logWarn('watch', 'SetDownloadWatchEnabled failed', err)
                            );
                            getSettingsMenu()?.updateControls();
                            setStatus(v ? t('settings.watchOn') : t('settings.watchOff'), true);
                        },
                        'lucide:folder-search',
                        { bind: () => getDownloadWatchEnabledCached() }
                    );
                    addWatchDirRow(
                        inner,
                        async (setStatusText) => {
                            const status = await GetDownloadWatchStatus();
                            setStatusText(
                                status
                                    ? t('settings.paths.watching', { dir: status })
                                    : t('settings.paths.watchStopped')
                            );
                        },
                        async () => {
                            const dir = await SelectDir();
                            if (!dir) {
                                return undefined;
                            }
                            try {
                                await SetDownloadWatchDir(dir);
                                setDownloadWatchEnabledCached(true);
                                getSettingsMenu()?.updateControls();
                                setStatus(t('settings.watchDirSet', { dir }), true);
                            } catch (err) {
                                logWarn('watch', 'SetDownloadWatchDir failed', err);
                                setStatus(t('settings.watchDirFail', { err }), true);
                            }
                            return dir;
                        }
                    );
                    addToggleRow(
                        inner,
                        t('settings.paths.autoImport'),
                        getAutoImportCached(),
                        (v) => {
                            setAutoImportCached(v);
                            SetDownloadAutoImport(v).catch((err) =>
                                logWarn('watch', 'SetDownloadAutoImport failed', err)
                            );
                            getSettingsMenu()?.updateControls();
                            setStatus(
                                v ? t('settings.autoImportOn') : t('settings.autoImportOff'),
                                true
                            );
                        },
                        'lucide:download',
                        { bind: () => getAutoImportCached() }
                    );
                });
            },
        },
    ];
}

function buildResourcesSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        ...buildStorageSchema(getSettingsMenu),
        ...buildLibrarySchema(getSettingsMenu),
        ...buildOverrideSchema(),
        ...buildWatchSchema(getSettingsMenu),
    ];
}

export function buildSettingsResourcesLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.resources'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildResourcesSchema(getSettingsMenu), container);
        },
    };
}
