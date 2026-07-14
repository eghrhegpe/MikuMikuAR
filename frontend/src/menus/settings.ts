// [doc:architecture] Settings — 设置页路由 + barrel re-export
// 规范文档: docs/architecture.md §模型库管理
// 职责: 菜单注册、路由表、re-export 公开符号
// 各子页面实现在 settings-*.ts 子模块中。

import { registerPopupMenu } from './menu-factory';
import { t } from '../core/i18n/t';
import { PopupRow, PopupLevel } from '../core/config';
import {
    SETTINGS,
    SETTINGS_ACTION,
    SOFTWARE_DETAIL_PREFIX,
    type SettingsFolderTarget,
} from './settings-targets';

// ======== Re-exports for backward compatibility ========
export { refreshLibrary } from './library';
export {
    preloadAutoImportState,
    preloadDownloadWatchState,
    isAutoLoadCompanionAudioEnabled,
    setAutoLoadCompanionAudio,
    generateTextColors,
} from './settings-shared';
export { getSettingsMenu, refreshSettingsRoot, showSettings };

// ======== Sub-module imports ========
import { buildSettingsAppearanceLevel } from './settings-appearance';
import { buildSettingsFilenameLevel } from './settings-filename';
import { buildSettingsPathsLevel, handleSettingsAction } from './settings-paths';
import { buildSettingsPerformanceLevel } from './settings-performance';
import { buildSettingsScreenshotLevel } from './settings-screenshot';
import { buildSettingsAudioLevel } from './settings-audio';
import { buildSettingsAboutLevel } from './settings-about';
import { buildSettingsShortcutsLevel } from './settings-shortcuts';
import { buildSettingsLanguageLevel } from './settings-language';
import { buildSettingsSoftwareLevel, buildSoftwareDetailLevel } from './settings-software';

// ======== Menu registration ========

const {
    getMenu: getSettingsMenu,
    refreshRoot: refreshSettingsRoot,
    show: showSettings,
} = registerPopupMenu({
    wrapperKey: 'settings-menu',
    popupType: 'settings',
    overlayClass: 'sceneOverlay-settings',
    buildRoot: () => buildSettingsRoot(),
    buildRootItems: () => buildSettingsRootItems(),
    handlers: {
        onItemClick: (row, menu) => handleSettingsAction(row, menu),
        onFolderEnter: settingsOnFolderEnter,
    },
});

// ======== Root items ========

function buildSettingsRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    items.push({
        kind: 'folder',
        label: t('settings.appearance'),
        icon: 'lucide:palette',
        target: SETTINGS.APPEARANCE,
    });
    items.push({
        kind: 'folder',
        label: t('settings.filename'),
        icon: 'lucide:file-text',
        target: SETTINGS.FILENAME,
    });
    items.push({
        kind: 'folder',
        label: t('settings.performance'),
        icon: 'lucide:zap',
        target: SETTINGS.PERFORMANCE,
    });
    items.push({
        kind: 'folder',
        label: t('settings.paths'),
        icon: 'lucide:folder-tree',
        target: SETTINGS.PATHS,
    });
    items.push({
        kind: 'folder',
        label: t('settings.software'),
        icon: 'lucide:package',
        target: SETTINGS.SOFTWARE,
    });
    items.push({
        kind: 'folder',
        label: t('settings.screenshot'),
        icon: 'lucide:camera',
        target: SETTINGS.SCREENSHOT,
    });
    items.push({
        kind: 'folder',
        label: t('settings.audio'),
        icon: 'lucide:volume-2',
        target: SETTINGS.AUDIO,
    });
    items.push({
        kind: 'folder',
        label: t('settings.shortcuts'),
        icon: 'lucide:keyboard',
        target: SETTINGS.SHORTCUTS,
    });
    items.push({
        kind: 'folder',
        label: t('settings.language'),
        icon: 'lucide:languages',
        target: SETTINGS.LANGUAGE,
    });
    items.push({
        kind: 'folder',
        label: t('settings.about'),
        icon: 'lucide:info',
        target: SETTINGS.ABOUT,
    });
    return items;
}

function buildSettingsRoot() {
    return {
        label: t('settings.title'),
        dir: '',
        items: buildSettingsRootItems(),
    };
}

// ======== Route table ========

function settingsOnFolderEnter(row: PopupRow) {
    if (row.target) {
        const builder = SETTINGS_FOLDER_ROUTES[row.target as SettingsFolderTarget];
        if (builder) {
            // [doc:adr-065] 挂 itemBuilder 使纯 items 子层随语言热刷新
            const lvl = builder();
            lvl.itemBuilder = () => builder().items;
            return lvl;
        }

        if (row.target.startsWith(SOFTWARE_DETAIL_PREFIX)) {
            const path = row.target.slice(SOFTWARE_DETAIL_PREFIX.length);
            const lvl = buildSoftwareDetailLevel(path);
            lvl.itemBuilder = () => buildSoftwareDetailLevel(path).items;
            return lvl;
        }
    }
    return null;
}

const SETTINGS_FOLDER_ROUTES: Record<SettingsFolderTarget, () => PopupLevel> = {
    [SETTINGS.APPEARANCE]: () => buildSettingsAppearanceLevel(getSettingsMenu),
    [SETTINGS.FILENAME]: () => buildSettingsFilenameLevel(getSettingsMenu),
    [SETTINGS.PERFORMANCE]: () => buildSettingsPerformanceLevel(getSettingsMenu),
    [SETTINGS.PATHS]: () => buildSettingsPathsLevel(getSettingsMenu),
    [SETTINGS.SOFTWARE]: () => buildSettingsSoftwareLevel(),
    [SETTINGS.SCREENSHOT]: () => buildSettingsScreenshotLevel(getSettingsMenu),
    [SETTINGS.AUDIO]: () => buildSettingsAudioLevel(getSettingsMenu),
    [SETTINGS.SHORTCUTS]: () => buildSettingsShortcutsLevel(getSettingsMenu),
    [SETTINGS.ABOUT]: () => buildSettingsAboutLevel(getSettingsMenu),
    [SETTINGS.LANGUAGE]: () => buildSettingsLanguageLevel(),
};
