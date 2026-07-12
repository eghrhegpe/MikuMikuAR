// settings-paths.ts — 路径设置子菜单 + 设置动作映射

import {
    ClearExtractCache,
    ClearThumbnailCache,
    ClearAllCaches,
    GetStorageMode,
    SetStorageMode,
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
    PopupRow,
} from '../core/config';
import {
    slideRow,
    addModeRow,
    addToggleRow,
    addWatchDirRow,
} from '../core/ui-helpers';
import { showConfirm } from '../core/dialog';
import {
    selectResourceRoot,
    selectOverridePath,
    switchStorageMode,
    refreshLibrary,
} from './library-core';
import { t } from '../core/i18n/t';
import { setLang, type LangCode } from '../core/i18n/locale';
import { CATEGORY_DIR } from '../core/utils';
import type { PopupLevel } from '../core/config';
import { SETTINGS, SETTINGS_ACTION } from './settings-targets';
import { isAndroidPlatform } from '../core/platform';
import { buildSettingsLanguageLevel } from './settings-language';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { SlideMenu } from './menu';
import type { SettingsMenuHandle } from './settings-shared';
import {
    getDownloadWatchEnabledCached,
    setDownloadWatchEnabledCached,
    getAutoImportCached,
    setAutoImportCached,
} from './settings-shared';

/** 设置动作映射表——替代原 handleSettingsAction 的 switch 链 */
export const SETTINGS_ACTIONS: Record<string, (row: PopupRow) => void> = {
    [SETTINGS_ACTION.CLEAR_EXTRACT_CACHE]: () => {
        ClearExtractCache()
            .then(() => {
                setStatus(t('settings.extractCacheCleared'), true);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            })
            .catch(console.warn);
    },
    [SETTINGS_ACTION.CLEAR_THUMBNAIL]: () => {
        (async () => {
            if (await showConfirm(t('settings.paths.clearThumbConfirm'))) {
                ClearThumbnailCache()
                    .then(() => {
                        setStatus(t('settings.thumbnailCacheCleared'), true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                    .catch(console.warn);
            }
        })();
    },
    [SETTINGS_ACTION.CLEAR_ALL_CACHE]: () => {
        (async () => {
            if (await showConfirm(t('settings.paths.clearAllConfirm'))) {
                ClearAllCaches()
                    .then(() => {
                        setStatus(t('settings.allCacheCleared'), true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                    .catch(console.warn);
            }
        })();
    },
    [SETTINGS_ACTION.RESOURCE_ROOT]: () => selectResourceRoot().catch(console.warn),
    [SETTINGS_ACTION.PATH_PMX]: (row) => selectOverridePath('pmx').catch(console.warn),
    [SETTINGS_ACTION.PATH_VMD]: (row) => selectOverridePath('vmd').catch(console.warn),
    [SETTINGS_ACTION.PATH_AUDIO]: (row) => selectOverridePath('audio').catch(console.warn),
    [SETTINGS_ACTION.PATH_PROP]: (row) => selectOverridePath('prop').catch(console.warn),
    [SETTINGS_ACTION.PATH_STAGE]: (row) => selectOverridePath('stage').catch(console.warn),
    [SETTINGS_ACTION.PATH_ENVIRONMENT]: (row) =>
        selectOverridePath('environment').catch(console.warn),
    [SETTINGS_ACTION.PATH_MD_DRESS]: (row) => selectOverridePath('md_dress').catch(console.warn),
    [SETTINGS_ACTION.PATH_SETTING]: (row) => selectOverridePath('setting').catch(console.warn),
};

export function handleSettingsAction(row: PopupRow, menu?: SlideMenu): void {
    if (row.target?.startsWith('lang:')) {
        setLang(row.target.slice(5) as LangCode);
        // 重建当前（语言）层级 → 勾选标记即时移动到新语言
        menu?.replaceCurrentLevel(buildSettingsLanguageLevel());
        return;
    }
    if (row.target) {
        SETTINGS_ACTIONS[row.target]?.(row);
    }
}

function buildPathsSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    const root = resourceRoot;
    const rootSub = root
        ? root.length > 20
            ? '...' + root.slice(-17)
            : root
        : t('settings.paths.notSet');
    const paths = overridePaths || {};
    const isAndroid = isAndroidPlatform();
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
        return actual.length > 20 ? '...' + actual.slice(-17) : actual;
    };

    return [
        // sectionTitle: 存储
        {
            id: 'paths:storage-title',
            kind: 'sectionTitle',
            label: t('settings.paths.storage'),
        },
        // Card 1: 资源根目录 / 存储位置（Android）
        {
            id: 'paths:storage',
            kind: 'custom',
            renderCustom: async (c) => {
                if (isAndroid) {
                    let currentMode = 'private';
                    try {
                        currentMode = (await GetStorageMode()) || 'private';
                    } catch {
                        // ignore
                    }
                    cardContainer(c, (inner) => {
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
                                                console.warn('[paths] refreshLibrary failed:', err);
                                            });
                                    })
                                    .catch((err) => {
                                        console.error('[paths] switchStorageMode failed:', err);
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
                        diag.innerHTML = `
                        <div><b>存储模式：</b>${currentMode === 'shared' ? t('settings.paths.storageModeShared') : t('settings.paths.storageModePrivate')}</div>
                        <div><b>资源目录：</b>${resourceRoot || '<span style="color:var(--danger)">' + t('settings.paths.notSet') + '</span>'}</div>
                        <div><b>模型数量：</b>${allModels.length}</div>
                    `;
                        inner.appendChild(diag);
                    });
                } else {
                    cardContainer(c, (inner) => {
                        slideRow(
                            inner,
                            'lucide:folder',
                            t('settings.paths.resourceRoot'),
                            false,
                            () =>
                                handleSettingsAction({
                                    kind: 'action',
                                    label: '',
                                    icon: '',
                                    target: SETTINGS_ACTION.RESOURCE_ROOT,
                                }),
                            rootSub
                        );
                    });
                }
            },
        },
        // sectionTitle: 资源路径覆盖
        {
            id: 'paths:override-title',
            kind: 'sectionTitle',
            label: t('settings.paths.override'),
        },
        // Card 2: 资源路径覆盖
        {
            id: 'paths:override',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(
                        inner,
                        'lucide:box',
                        t('settings.paths.pmx'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_PMX,
                            }),
                        pathSub('pmx', t('settings.paths.default'))
                    );
                    slideRow(
                        inner,
                        'lucide:music',
                        t('settings.paths.vmd'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_VMD,
                            }),
                        pathSub('vmd', t('settings.paths.default'))
                    );
                    slideRow(
                        inner,
                        'lucide:headphones',
                        t('settings.paths.audio'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_AUDIO,
                            }),
                        pathSub('audio', t('settings.paths.default'))
                    );
                    slideRow(
                        inner,
                        'lucide:gem',
                        t('settings.paths.prop'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_PROP,
                            }),
                        pathSub('prop', t('settings.paths.default'))
                    );
                    slideRow(
                        inner,
                        'lucide:home',
                        t('settings.paths.stage'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_STAGE,
                            }),
                        pathSub('stage', t('settings.paths.default'))
                    );
                    slideRow(
                        inner,
                        'lucide:cloud',
                        t('settings.paths.environment'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.PATH_ENVIRONMENT,
                            }),
                        pathSub('environment', t('settings.paths.default'))
                    );
                });
            },
        },
        // sectionTitle: 外部库
        {
            id: 'paths:external-title',
            kind: 'sectionTitle',
            label: t('settings.paths.externalLib'),
        },
        // Card 3: 外部库
        {
            id: 'paths:external',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    slideRow(inner, 'lucide:plug', t('settings.paths.externalLib'), true, () =>
                        handleSettingsAction({
                            kind: 'folder',
                            label: '',
                            icon: '',
                            target: SETTINGS.EXTERNAL,
                        })
                    );
                });
            },
        },
        // sectionTitle: 下载监听（桌面端）
        {
            id: 'paths:watch-title',
            kind: 'sectionTitle',
            label: t('settings.paths.downloadWatch'),
            visibleWhen: () => !isAndroidPlatform(),
        },
        // Card 4: 下载监听
        {
            id: 'paths:watch',
            kind: 'custom',
            visibleWhen: () => !isAndroidPlatform(),
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addToggleRow(
                        inner,
                        t('settings.paths.watchDownloadDir'),
                        getDownloadWatchEnabledCached(),
                        (v) => {
                            setDownloadWatchEnabledCached(v);
                            SetDownloadWatchEnabled(v).catch((err) =>
                                console.warn('[watch] SetDownloadWatchEnabled failed', err)
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
                                console.warn('[watch] SetDownloadWatchDir failed', err);
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
                                console.warn('[watch] SetDownloadAutoImport failed', err)
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

export function buildSettingsPathsLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.paths.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildPathsSchema(getSettingsMenu), container);
        },
    };
}
