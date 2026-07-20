// [doc:architecture] Settings — 设置页路由 + barrel re-export
// 规范文档: docs/architecture.md §模型库管理
// 职责: 菜单注册、路由表、re-export 公开符号
// ADR-157: 信息架构重组为 7 分类（外观/画面/操控/资源/媒体/系统/关于）。
// 各子页面实现在 settings-*.ts 子模块中。

import { registerPopupMenu } from './menu-factory';
import { t } from '../core/i18n/t';
import { PopupRow, PopupLevel } from '../core/config';
import { SETTINGS, SOFTWARE_DETAIL_PREFIX, type SettingsFolderTarget } from './settings-targets';

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
import { buildSettingsGraphicsLevel } from './settings-graphics';
import { buildSettingsControlsLevel } from './settings-controls';
import { buildSettingsResourcesLevel } from './settings-resources';
import { buildSettingsMediaLevel } from './settings-media';
import { buildSettingsSystemLevel, buildSoftwareDetailLevel } from './settings-system';
import { buildSettingsAboutLevel } from './settings-about';
import { handleSettingsAction } from './settings-actions';

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

// ======== Root items（ADR-157：7 分类） ========

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
        label: t('settings.graphics'),
        icon: 'lucide:monitor',
        target: SETTINGS.GRAPHICS,
    });
    items.push({
        kind: 'folder',
        label: t('settings.controls'),
        icon: 'lucide:gamepad-2',
        target: SETTINGS.CONTROLS,
    });
    items.push({
        kind: 'folder',
        label: t('settings.resources'),
        icon: 'lucide:folder-tree',
        target: SETTINGS.RESOURCES,
    });
    items.push({
        kind: 'folder',
        label: t('settings.media'),
        icon: 'lucide:clapperboard',
        target: SETTINGS.MEDIA,
    });
    items.push({
        kind: 'folder',
        label: t('settings.system'),
        icon: 'lucide:settings-2',
        target: SETTINGS.SYSTEM,
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
            const lvl = buildSoftwareDetailLevel(path, getSettingsMenu);
            lvl.itemBuilder = () => buildSoftwareDetailLevel(path, getSettingsMenu).items;
            return lvl;
        }
    }
    return null;
}

const SETTINGS_FOLDER_ROUTES: Record<SettingsFolderTarget, () => PopupLevel> = {
    [SETTINGS.APPEARANCE]: () => buildSettingsAppearanceLevel(getSettingsMenu),
    [SETTINGS.GRAPHICS]: () => buildSettingsGraphicsLevel(getSettingsMenu),
    [SETTINGS.CONTROLS]: () => buildSettingsControlsLevel(getSettingsMenu),
    [SETTINGS.RESOURCES]: () => buildSettingsResourcesLevel(getSettingsMenu),
    [SETTINGS.MEDIA]: () => buildSettingsMediaLevel(getSettingsMenu),
    [SETTINGS.SYSTEM]: () => buildSettingsSystemLevel(getSettingsMenu),
    [SETTINGS.ABOUT]: () => buildSettingsAboutLevel(getSettingsMenu),
};
