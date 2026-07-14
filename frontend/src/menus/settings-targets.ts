// [doc:architecture] Settings target constants — 消除 settings.ts 中的硬编码字符串
// 职责: 定义所有 settings 导航/动作 target 常量，供 settings.ts 及各调用方引用。

/** 设置菜单文件夹导航 target */
export const SETTINGS = {
    APPEARANCE: 'settings:appearance',
    FILENAME: 'settings:filename',
    PERFORMANCE: 'settings:performance',
    PATHS: 'settings:paths',
    SOFTWARE: 'settings:software',
    SCREENSHOT: 'settings:screenshot',
    AUDIO: 'settings:audio',
    SHORTCUTS: 'settings:shortcuts',
    ABOUT: 'settings:about',
    LANGUAGE: 'settings:language', // [doc:adr-059] 语言切换入口
} as const;

/** 设置菜单动作 target（点击后执行操作，不导航） */
export const SETTINGS_ACTION = {
    CLEAR_EXTRACT_CACHE: 'set:clearextractcache',
    CLEAR_THUMBNAIL: 'set:clearthumbnail',
    CLEAR_ALL_CACHE: 'set:clearallcache',
    RESOURCE_ROOT: 'set:resourceroot',
    PATH_PMX: 'set:path:pmx',
    PATH_VMD: 'set:path:vmd',
    PATH_AUDIO: 'set:path:audio',
    PATH_PROP: 'set:path:prop',
    PATH_STAGE: 'set:path:stage',
    PATH_ENVIRONMENT: 'set:path:environment',
    PATH_MD_DRESS: 'set:path:md_dress',
    PATH_SETTING: 'set:path:setting',
} as const;

/** 动态 target 前缀 —— 用于 `settings:software-detail:<path>` 模式 */
export const SOFTWARE_DETAIL_PREFIX = 'settings:software-detail:';

/** 所有文件夹 target 的联合类型 */
export type SettingsFolderTarget = (typeof SETTINGS)[keyof typeof SETTINGS];

/** 所有动作 target 的联合类型 */
export type SettingsActionTarget = (typeof SETTINGS_ACTION)[keyof typeof SETTINGS_ACTION];

/** 所有（静态）settings target 的联合类型 */
export type SettingsTarget = SettingsFolderTarget | SettingsActionTarget;
