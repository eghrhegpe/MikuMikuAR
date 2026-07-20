// settings-paths.ts — 路径设置子菜单 + 设置动作映射

import {
    ClearExtractCache,
    ClearThumbnailCache,
    ClearAllCaches,
    GetStorageMode,
    SetDownloadWatchEnabled,
    GetDownloadWatchStatus,
    SetDownloadWatchDir,
    SetDownloadAutoImport,
    SelectDir,
    GetCacheStats,
    OpenCacheDir,
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
    addSectionTitle,
} from '../core/ui-helpers';
import { showConfirm } from '../core/dialog';
import { addDisposableListener } from '../core/dom';
import {
    selectResourceRoot,
    selectOverridePath,
    switchStorageMode,
    refreshLibrary,
} from './library-core';
import { t } from '../core/i18n/t';
import { setLang, type LangCode } from '../core/i18n/locale';
import { CATEGORY_DIR } from '../core/utils';
import { logWarn } from '../core/logger';
import { safeCallAsync } from '../core/safe-call';
import { SETTINGS_ACTION } from './settings-targets';
import { isAndroidPlatform } from '../core/platform';
import { buildSettingsLanguageLevel } from './settings-language';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import type { PopupLevel } from '../core/config';
import type { SlideMenu } from './menu';
import type { SettingsMenuHandle } from './settings-shared';
import { truncatePath } from './settings-shared';
import {
    getDownloadWatchEnabledCached,
    setDownloadWatchEnabledCached,
    getAutoImportCached,
    setAutoImportCached,
    formatBytes,
} from './settings-shared';

/** 设置动作映射表——替代原 handleSettingsAction 的 switch 链 */
export const SETTINGS_ACTIONS: Record<string, (row: PopupRow) => void> = {
    [SETTINGS_ACTION.CLEAR_EXTRACT_CACHE]: () => {
        safeCallAsync('paths', '', () => ClearExtractCache().then(() => {
            setStatus(t('settings.extractCacheCleared'), true);
            window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
        }));
    },
    [SETTINGS_ACTION.CLEAR_THUMBNAIL]: () => {
        (async () => {
            if (await showConfirm(t('settings.paths.clearThumbConfirm'))) {
                safeCallAsync('paths', '', () => ClearThumbnailCache().then(() => {
                    setStatus(t('settings.thumbnailCacheCleared'), true);
                    window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                }));
            }
        })();
    },
    [SETTINGS_ACTION.CLEAR_ALL_CACHE]: () => {
        (async () => {
            if (await showConfirm(t('settings.paths.clearAllConfirm'))) {
                safeCallAsync('paths', '', () => ClearAllCaches().then(() => {
                    setStatus(t('settings.allCacheCleared'), true);
                    window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                }));
            }
        })();
    },
    [SETTINGS_ACTION.RESOURCE_ROOT]: () =>
        safeCallAsync('paths', '', () => selectResourceRoot()),
    [SETTINGS_ACTION.PATH_PMX]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('pmx')),
    [SETTINGS_ACTION.PATH_VMD]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('vmd')),
    [SETTINGS_ACTION.PATH_AUDIO]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('audio')),
    [SETTINGS_ACTION.PATH_PROP]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('prop')),
    [SETTINGS_ACTION.PATH_STAGE]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('stage')),
    [SETTINGS_ACTION.PATH_ENVIRONMENT]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('environment')),
    [SETTINGS_ACTION.PATH_MD_DRESS]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('md_dress')),
    [SETTINGS_ACTION.PATH_SETTING]: (_row) =>
        safeCallAsync('paths', '', () => selectOverridePath('setting')),
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
    const rootSub = root ? truncatePath(root) : t('settings.paths.notSet');
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
        return truncatePath(actual);
    };

    return [
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
                                                logWarn('paths', 'refreshLibrary failed:', err);
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
                        countRow.textContent =
                            t('settings.paths.modelCount') || '模型数量：' + allModels.length;
                        diag.appendChild(countRow);

                        inner.appendChild(diag);
                    });
                } else {
                    cardContainer(c, (inner) => {
                        addSectionTitle(inner, t('settings.paths.storage'));
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
        // Card 2: 资源路径覆盖
        {
            id: 'paths:override',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.paths.override'));
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
        // Card 4: 下载监听（桌面端）
        {
            id: 'paths:watch',
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
        // Card 5: 缓存管理
        {
            id: 'paths:cache',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.about.cache'));
                    // 缓存统计
                    const statRow = document.createElement('div');
                    statRow.className = 'slide-item';
                    statRow.style.cssText =
                        'padding:8px 14px;flex-direction:column;align-items:stretch;gap:4px;';
                    statRow.innerHTML =
                        '<div data-cache-total style="font-size:13px;color:var(--text);font-weight:500;">统计中…</div><div data-cache-detail style="font-size:10px;color:var(--text-dim);line-height:1.6;font-family:monospace;"></div>';
                    inner.appendChild(statRow);

                    const refreshCacheStats = () => {
                        safeCallAsync('paths', '', () =>
                            GetCacheStats()
                                .then((s) => {
                                const total =
                                    statRow.querySelector<HTMLElement>('[data-cache-total]');
                                const detail =
                                    statRow.querySelector<HTMLElement>('[data-cache-detail]');
                                if (total) {
                                    total.textContent = `${t('settings.about.cache.total')} ${formatBytes(s.totalBytes)}`;
                                }
                                if (detail) {
                                    detail.innerHTML = '';
                                    const resourceRow = document.createElement('div');
                                    resourceRow.textContent = `${t('settings.about.cache.resource')}: ${formatBytes(s.resourceBytes)}`;
                                    detail.appendChild(resourceRow);
                                    const extractedRow = document.createElement('div');
                                    extractedRow.textContent = `${t('settings.about.cache.extracted')}: ${formatBytes(s.extractedBytes)} (${s.extractedCount} ${t('common.items') || 'items'})`;
                                    detail.appendChild(extractedRow);
                                    const thumbRow = document.createElement('div');
                                    thumbRow.textContent = `${t('settings.about.cache.thumbnails')}: ${formatBytes(s.thumbnailBytes)} (${s.thumbnailCount} ${t('common.items') || 'items'})`;
                                    detail.appendChild(thumbRow);
                                }
                            })
                        );
                    };
                    refreshCacheStats();
                    const refreshDisp = addDisposableListener(
                        window,
                        'mmar:cache-cleared',
                        refreshCacheStats
                    );
                    const cleanupObserver = new MutationObserver(() => {
                        if (!c.isConnected) {
                            refreshDisp.dispose();
                            cleanupObserver.disconnect();
                        }
                    });
                    cleanupObserver.observe(document.documentElement, {
                        childList: true,
                        subtree: true,
                    });

                    // 缓存清理按钮
                    slideRow(
                        inner,
                        'lucide:folder-open',
                        t('settings.about.maintenance.openExtract'),
                        false,
                        () => {
                            OpenCacheDir('extracted').catch((err: unknown) => {
                                const msg =
                                    typeof err === 'object' && err !== null && 'message' in err
                                        ? String((err as { message: unknown }).message)
                                        : String(err);
                                setStatus(`✗ ${msg}`, false);
                            });
                        }
                    );
                    slideRow(
                        inner,
                        'lucide:trash-2',
                        t('settings.about.maintenance.clearExtract'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_EXTRACT_CACHE,
                            })
                    );
                    slideRow(
                        inner,
                        'lucide:folder-open',
                        t('settings.about.maintenance.openThumbnail'),
                        false,
                        () => {
                            OpenCacheDir('thumbnails').catch((err: unknown) => {
                                const msg =
                                    typeof err === 'object' && err !== null && 'message' in err
                                        ? String((err as { message: unknown }).message)
                                        : String(err);
                                setStatus(`✗ ${msg}`, false);
                            });
                        }
                    );
                    slideRow(
                        inner,
                        'lucide:image',
                        t('settings.about.maintenance.clearThumbnail'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_THUMBNAIL,
                            })
                    );
                    slideRow(
                        inner,
                        'lucide:trash',
                        t('settings.about.maintenance.clearAll'),
                        false,
                        () =>
                            handleSettingsAction({
                                kind: 'action',
                                label: '',
                                icon: '',
                                target: SETTINGS_ACTION.CLEAR_ALL_CACHE,
                            })
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
