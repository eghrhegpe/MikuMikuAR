// [doc:adr-238] 文件选择器经 ui-action-bridge 调用（定义留 core、实现归 menus）
import { registerAction } from '../action-registry';
import { ClearExtractCache, ClearThumbnailCache, ClearAllCaches } from '../wails-bindings';
import { feedbackInfo } from '../feedback';
import { getUiAction } from '../ui-action-bridge';
import { setLang, type LangCode } from '../i18n/locale';

function _selectResourceRoot(): Promise<void> {
    return getUiAction('selectResourceRoot')?.() ?? Promise.resolve();
}

function _selectOverridePath(kind: string): Promise<void> {
    return getUiAction('selectOverridePath')?.(kind) ?? Promise.resolve();
}

/**
 * [doc:adr-238] 同构样板：注册一个「打开路径选择器」的 uiOnly 动作。
 * 全部路径分支共享此 helper，仅 kind 参数不同——数据驱动避免 7 份重复样板。
 */
function registerOverridePathAction(kind: string, id: string, label: string): void {
    registerAction({
        id,
        label,
        domain: 'settings',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            await _selectOverridePath(kind);
        },
    });
}

export function registerSettingsActions(): void {
    registerAction({
        id: 'settings:set:clearextractcache',
        label: 'ai.actions.settings.clearExtractCache',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            await ClearExtractCache();
            feedbackInfo('settings.extractCacheCleared', undefined);
            window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
        },
    });

    registerAction({
        id: 'settings:set:clearthumbnail',
        label: 'ai.actions.settings.clearThumbnail',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            await ClearThumbnailCache();
            feedbackInfo('settings.thumbnailCacheCleared', undefined);
            window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
        },
    });

    registerAction({
        id: 'settings:set:clearallcache',
        label: 'ai.actions.settings.clearAllCache',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            await ClearAllCaches();
            feedbackInfo('settings.allCacheCleared', undefined);
            window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
        },
    });

    registerAction({
        id: 'settings:set:resourceroot',
        label: 'ai.actions.settings.resourceRoot',
        domain: 'settings',
        params: [],
        destructive: false,
        uiOnly: true,
        execute: async () => {
            await _selectResourceRoot();
        },
    });

    registerOverridePathAction('pmx', 'settings:set:path:pmx', 'ai.actions.settings.path.pmx');
    registerOverridePathAction('vmd', 'settings:set:path:vmd', 'ai.actions.settings.path.vmd');
    registerOverridePathAction(
        'audio',
        'settings:set:path:audio',
        'ai.actions.settings.path.audio'
    );
    registerOverridePathAction(
        'stage',
        'settings:set:path:stage',
        'ai.actions.settings.path.stage'
    );
    registerOverridePathAction(
        'environment',
        'settings:set:path:environment',
        'ai.actions.settings.path.environment'
    );
    registerOverridePathAction(
        'md_dress',
        'settings:set:path:md_dress',
        'ai.actions.settings.path.mdDress'
    );
    registerOverridePathAction(
        'setting',
        'settings:set:path:setting',
        'ai.actions.settings.path.setting'
    );

    registerAction({
        id: 'settings:set-lang',
        label: 'ai.actions.settings.setLang',
        domain: 'settings',
        params: [{ name: 'code', type: 'enum', enum: ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] }],
        destructive: false,
        execute: async (p) => {
            setLang(p.code as LangCode);
        },
    });
}
