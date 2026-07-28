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
        label: '清理解压缓存',
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
        label: '清理缩略图缓存',
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
        label: '清理全部缓存',
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
        label: '选择资源根目录',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectResourceRoot();
        },
    });

    registerAction({
        id: 'settings:set:path:pmx',
        label: '选择 PMX 覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('pmx');
        },
    });

    registerAction({
        id: 'settings:set:path:vmd',
        label: '选择 VMD 覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('vmd');
        },
    });

    registerAction({
        id: 'settings:set:path:audio',
        label: '选择音频覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('audio');
        },
    });

    registerAction({
        id: 'settings:set:path:prop',
        label: '选择道具覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('prop');
        },
    });

    registerAction({
        id: 'settings:set:path:stage',
        label: '选择舞台覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('stage');
        },
    });

    registerAction({
        id: 'settings:set:path:environment',
        label: '选择环境覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('environment');
        },
    });

    registerAction({
        id: 'settings:set:path:md_dress',
        label: '选择 MD 服装覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('md_dress');
        },
    });

    registerAction({
        id: 'settings:set:path:setting',
        label: '选择设置覆盖路径',
        domain: 'settings',
        params: [],
        destructive: false,
        execute: async () => {
            await selectOverridePath('setting');
        },
    });

    registerAction({
        id: 'settings:set-lang',
        label: '切换语言',
        domain: 'settings',
        params: [{ name: 'code', type: 'enum', enum: ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] }],
        destructive: false,
        execute: async (p) => {
            setLang(p.code as LangCode);
        },
    });
}
