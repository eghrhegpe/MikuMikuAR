// settings-actions.ts — 设置动作映射表 + 全局点击分发（ADR-157：从 settings-paths 抽出）
// 职责：集中管理 target→handler 映射。各设置页直接调用 SETTINGS_ACTIONS[target]()，
// 不再构造假 PopupRow 套娃；settings.ts 的 onItemClick 仍经 handleSettingsAction 分发。

import {
    ClearExtractCache,
    ClearThumbnailCache,
    ClearAllCaches,
} from '../core/wails-bindings';
import { setStatus, type PopupRow } from '../core/config';
import { showConfirm } from '../core/dialog';
import { selectResourceRoot, selectOverridePath } from './library-core';
import { t } from '../core/i18n/t';
import { setLang, type LangCode } from '../core/i18n/locale';
import { safeCallAsync } from '../core/safe-call';
import { SETTINGS_ACTION } from './settings-targets';
import { buildSettingsLanguageLevel } from './settings-language';
import type { SlideMenu } from './menu';

/** 设置动作映射表——替代原 handleSettingsAction 的 switch 链 */
export const SETTINGS_ACTIONS: Record<string, (row?: PopupRow) => void> = {
    [SETTINGS_ACTION.CLEAR_EXTRACT_CACHE]: () => {
        safeCallAsync('paths', '', () =>
            ClearExtractCache().then(() => {
                setStatus(t('settings.extractCacheCleared'), true);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            })
        );
    },
    [SETTINGS_ACTION.CLEAR_THUMBNAIL]: () => {
        void (async () => {
            if (await showConfirm(t('settings.paths.clearThumbConfirm'))) {
                safeCallAsync('paths', '', () =>
                    ClearThumbnailCache().then(() => {
                        setStatus(t('settings.thumbnailCacheCleared'), true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                );
            }
        })();
    },
    [SETTINGS_ACTION.CLEAR_ALL_CACHE]: () => {
        void (async () => {
            if (await showConfirm(t('settings.paths.clearAllConfirm'))) {
                safeCallAsync('paths', '', () =>
                    ClearAllCaches().then(() => {
                        setStatus(t('settings.allCacheCleared'), true);
                        window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
                    })
                );
            }
        })();
    },
    [SETTINGS_ACTION.RESOURCE_ROOT]: () => safeCallAsync('paths', '', () => selectResourceRoot()),
    [SETTINGS_ACTION.PATH_PMX]: () => safeCallAsync('paths', '', () => selectOverridePath('pmx')),
    [SETTINGS_ACTION.PATH_VMD]: () => safeCallAsync('paths', '', () => selectOverridePath('vmd')),
    [SETTINGS_ACTION.PATH_AUDIO]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('audio')),
    [SETTINGS_ACTION.PATH_PROP]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('prop')),
    [SETTINGS_ACTION.PATH_STAGE]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('stage')),
    [SETTINGS_ACTION.PATH_ENVIRONMENT]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('environment')),
    [SETTINGS_ACTION.PATH_MD_DRESS]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('md_dress')),
    [SETTINGS_ACTION.PATH_SETTING]: () =>
        safeCallAsync('paths', '', () => selectOverridePath('setting')),
};

/** 全局设置项点击分发：语言切换 + 动作表。settings.ts 的 onItemClick 使用。 */
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
