// settings-paths.ts — 路径设置子菜单 + 设置动作映射

import {
    ClearExtractCache,
    ClearThumbnailCache,
    ClearAllCaches,
    GetStorageMode,
    SetStorageMode,
} from '../core/wails-bindings';
import { setStatus, resourceRoot, overridePaths, cardContainer, PopupRow } from '../core/config';
import { slideRow, addDangerRow, addModeRow } from '../core/ui-helpers';
import { showConfirm } from '../core/dialog';
import { selectResourceRoot, selectOverridePath, switchStorageMode } from './library-core';
import { t } from '../core/i18n/t';
import type { PopupLevel } from '../core/config';
import { SETTINGS, SETTINGS_ACTION } from './settings-targets';
import { isAndroidPlatform } from '../core/platform';

type SettingsMenuHandle = { updateControls: () => void; reRender: () => void } | null;

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
            if (await showConfirm('确定要清除所有缩略图缓存吗？下次加载模型时将重新生成。')) {
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
            if (
                await showConfirm(
                    '确定要清除全部缓存吗？包括提取缓存、缩略图、HTTP 隔离目录。下次加载模型时将重新生成。'
                )
            ) {
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

export function handleSettingsAction(row: PopupRow): void {
    if (row.target.startsWith('lang:')) {
        import('../core/i18n/locale').then((m) => m.setLang(row.target!.slice(5) as any));
        return;
    }
    if (row.target) {
        SETTINGS_ACTIONS[row.target]?.(row);
    }
}

export function buildSettingsPathsLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    const root = resourceRoot;
    const rootSub = root ? (root.length > 20 ? '...' + root.slice(-17) : root) : '未设置';
    const paths = overridePaths || {};
    const isAndroid = isAndroidPlatform();
    // key → 默认子目录名（与 Go 端 GetPath 的目录名一致，大小写不统一）
    const defaultDirName: Record<string, string> = {
        pmx: 'PMX',
        vmd: 'VMD',
        audio: 'audio',
        stage: 'stage',
        prop: 'prop',
        environment: 'environment',
        md_dress: 'MD-dress',
        setting: 'setting',
    };
    const pathSub = (key: string, defSub: string) => {
        const val = paths[key as keyof typeof paths];
        let actual: string;
        if (val) {
            actual = val as string;
        } else if (root) {
            actual = `${root}/${defaultDirName[key] || key}`;
        } else {
            return defSub;
        }
        return actual.length > 20 ? '...' + actual.slice(-17) : actual;
    };
    return {
        label: '路径',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            // Card 1: 资源根目录 / 存储位置（Android）
            if (isAndroid) {
                let currentMode = 'private';
                try {
                    currentMode = (await GetStorageMode()) || 'private';
                } catch {
                    // ignore
                }
                cardContainer(container, (c) => {
                    addModeRow<string>(
                        c,
                        t('settings.storageMode'),
                        [
                            { value: 'private', label: t('settings.storagePrivate') },
                            { value: 'shared', label: t('settings.storageShared') },
                        ],
                        currentMode,
                        (mode) => {
                            switchStorageMode(mode as 'private' | 'shared').then(() => {
                                getSettingsMenu()?.reRender();
                            });
                        }
                    );
                    const desc = document.createElement('div');
                    desc.className = 'storage-mode-desc';
                    desc.style.cssText = 'font-size:11px;color:var(--text-secondary);padding:2px 12px 8px;line-height:1.4';
                    desc.textContent = t('settings.storageModeDesc');
                    c.appendChild(desc);
                });
            } else {
                cardContainer(container, (c) => {
                    slideRow(
                        c,
                        'lucide:folder',
                        '资源根目录',
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
            // Card 2: 资源路径覆盖
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:box', 'PMX 模型', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_PMX }), pathSub('pmx', '默认'));
                slideRow(c, 'lucide:music', 'VMD 动作', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_VMD }), pathSub('vmd', '默认'));
                slideRow(c, 'lucide:headphones', 'Audio 音乐', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_AUDIO }), pathSub('audio', '默认'));
                slideRow(c, 'lucide:box', 'Prop 道具', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_PROP }), pathSub('prop', '默认'));
                slideRow(c, 'lucide:home', 'Stage 场景', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_STAGE }), pathSub('stage', '默认'));
                slideRow(c, 'lucide:cloud', 'Environment', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_ENVIRONMENT }), pathSub('environment', '默认'));
                slideRow(c, 'lucide:shirt', 'MD-dress', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_MD_DRESS }), pathSub('md_dress', '默认'));
                slideRow(c, 'lucide:settings', '配置目录', false, () => handleSettingsAction({ kind: 'action', label: '', icon: '', target: SETTINGS_ACTION.PATH_SETTING }), pathSub('setting', '默认'));
            });
            // Card 3: 外部库
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plug', '外部库管理', true, () =>
                    handleSettingsAction({
                        kind: 'folder',
                        label: '',
                        icon: '',
                        target: SETTINGS.EXTERNAL,
                    })
                );
            });
        },
    };
}
