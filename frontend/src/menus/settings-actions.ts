// settings-actions.ts — 设置动作映射表 + 全局点击分发（ADR-157：从 settings-paths 抽出）
// 职责：将 target→handler 路由委托给 ADR-197 统一注册表。
// settings-actions.ts 仍保留 handleSettingsAction 入口供 settings.ts 调用，
// 路由使用 executeActionById 查注册表；SETTINGS_ACTIONS Record 已移除。

import { type PopupRow } from '../core/config';
import { setLang } from '../core/i18n/locale';
import { SETTINGS_ACTION } from './settings-targets';
import { buildSettingsLanguageLevel } from './settings-language';
import type { SlideMenu } from './menu';
import { executeActionById } from '../core/action-executor';

let _settingsRegistered = false;

function _ensureSettingsActions(): void {
    if (!_settingsRegistered) {
        import('../core/action-defs/settings-actions').then((m) => m.registerSettingsActions());
        _settingsRegistered = true;
    }
}

/** 全局设置项点击分发：语言切换 + 动作表。settings.ts 的 onItemClick 使用。 */
export function handleSettingsAction(row: PopupRow, menu?: SlideMenu): void {
    _ensureSettingsActions();

    if (row.target?.startsWith('lang:')) {
        void executeActionById('settings:set-lang', { code: row.target.slice(5) });
        menu?.replaceCurrentLevel(buildSettingsLanguageLevel());
        return;
    }
    if (row.target) {
        void executeActionById(`settings:${row.target}`, {});
    }
}
