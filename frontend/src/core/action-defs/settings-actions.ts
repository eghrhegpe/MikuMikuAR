import { registerAction } from '../action-registry';
import { ClearExtractCache, ClearThumbnailCache, ClearAllCaches } from '../wails-bindings';
import { feedbackInfo } from '../feedback';
import { showConfirm } from '../dialog';
import { selectResourceRoot, selectOverridePath } from '../../menus/library-core';
import { t } from '../i18n/t';
import { setLang, type LangCode } from '../i18n/locale';

export function registerSettingsActions(): void {
    registerAction({
        id: 'settings:set:clearextractcache',
        label: 'ai.actions.settings.clearExtractCache',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            if (await showConfirm(t('settings.paths.clearExtractConfirm'))) {
                await ClearExtractCache();
                feedbackInfo('settings.extractCacheCleared', undefined);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            }
        },
    });

    registerAction({
        id: 'settings:set:clearthumbnail',
        label: 'ai.actions.settings.clearThumbnail',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            if (await showConfirm(t('settings.paths.clearThumbConfirm'))) {
                await ClearThumbnailCache();
                feedbackInfo('settings.thumbnailCacheCleared', undefined);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            }
        },
    });

    registerAction({
        id: 'settings:set:clearallcache',
        label: 'ai.actions.settings.clearAllCache',
        domain: 'settings',
        params: [],
        destructive: true,
        execute: async () => {
            if (await showConfirm(t('settings.paths.clearAllConfirm'))) {
                await ClearAllCaches();
                feedbackInfo('settings.allCacheCleared', undefined);
                window.dispatchEvent(new CustomEvent('mmar:cache-cleared'));
            }
        },
    });

    registerAction({
        id: 'settings:set:resourceroot',
        label: 'ai.actions.settings.resourceRoot',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectResourceRoot();
        },
    });

    registerAction({
        id: 'settings:set:path:pmx',
        label: 'ai.actions.settings.path.pmx',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('pmx');
        },
    });

    registerAction({
        id: 'settings:set:path:vmd',
        label: 'ai.actions.settings.path.vmd',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('vmd');
        },
    });

    registerAction({
        id: 'settings:set:path:audio',
        label: 'ai.actions.settings.path.audio',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('audio');
        },
    });

    registerAction({
        id: 'settings:set:path:prop',
        label: 'ai.actions.settings.path.prop',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('prop');
        },
    });

    registerAction({
        id: 'settings:set:path:stage',
        label: 'ai.actions.settings.path.stage',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('stage');
        },
    });

    registerAction({
        id: 'settings:set:path:environment',
        label: 'ai.actions.settings.path.environment',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('environment');
        },
    });

    registerAction({
        id: 'settings:set:path:md_dress',
        label: 'ai.actions.settings.path.mdDress',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('md_dress');
        },
    });

    registerAction({
        id: 'settings:set:path:setting',
        label: 'ai.actions.settings.path.setting',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('setting');
        },
    });

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
