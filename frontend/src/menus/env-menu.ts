// [doc:architecture] Env Menu — 环境弹窗（核心 + barrel export）
// 拆分后保留: 导航/统一面板/环境光照/粒子/入口 + barrel re-export
// 子文件: env-sky-levels.ts, env-ground-levels.ts, env-water-levels.ts, env-wind-levels.ts,
//         env-cloud-levels.ts, env-fog-levels.ts, env-shadow-levels.ts, env-experimental-levels.ts,
//         env-preset-levels.ts
// 道具已迁移到 scene-prop-levels.ts（舞台域）

import { envState, PopupLevel, PopupRow } from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addClearRow } from '../core/ui-helpers';
import { setEnvState } from '../scene/scene';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import { closeAllOverlays } from '../core/utils';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import { addDisposableListener } from '../core/dom';
import type { MenuNode } from './menu-schema';
// ======== 从子文件导入 ========
import { buildSkyLevel } from './env-sky-levels';
import { buildWindLevel } from './env-wind-levels';
import { buildExperimentalLevel } from './env-experimental-levels';
import { buildFogLevel } from './env-fog-levels';
import { buildShadowLevel } from './env-shadow-levels';
import { buildCloudLevel } from './env-cloud-levels';
import { _buildLevel } from './env-level-helpers';
import { _openTexturePicker } from './env-level-helpers';
import { buildPresetLevel } from './env-preset-levels';
import { buildPostProcessLevel } from './scene-render-levels';
import type { EnvTextureBindingTarget } from './env-menu-state';
import {
    setEnvTextureBindingTarget,
    clearEnvTextureBindingTarget,
    getEnvTextureBindingTarget,
    setEnvMenu,
} from './env-menu-state';

// ======== Barrel Re-Exports ========
export { buildSkyLevel } from './env-sky-levels';
export { buildWindLevel } from './env-wind-levels';
export { buildExperimentalLevel } from './env-experimental-levels';
export { buildFogLevel } from './env-fog-levels';
export { buildShadowLevel } from './env-shadow-levels';
export { buildCloudLevel } from './env-cloud-levels';
export { buildPresetLevel, SCENE_PRESETS } from './env-preset-levels';

// ======== Env Texture Binding Target ========
// 已迁移到 env-menu-state.ts，此处保留 re-export 保持向后兼容
export type { EnvTextureBindingTarget } from './env-menu-state';
export {
    setEnvTextureBindingTarget,
    clearEnvTextureBindingTarget,
    getEnvTextureBindingTarget,
} from './env-menu-state';

// ======== Env Menu State ========

const {
    getMenu: getEnvMenu,
    refreshRoot: refreshEnvRoot,
    show: showEnvMenu,
} = registerPopupMenu({
    wrapperKey: 'env-menu',
    popupType: 'env',
    buildRoot: () => buildEnvLevel(),
    buildRootItems: () => buildEnvRootItems(),
    handlers: {
        onFolderEnter: envOnFolderEnter,
        onItemClick: envOnItemClick,
    },
});

// 注册到 env-menu-state.ts，供 env-*-levels.ts 通过 getEnvMenu() 获取菜单实例
setEnvMenu(getEnvMenu());

export { getEnvMenu, refreshEnvRoot, showEnvMenu };

// 当库扫描完成时，如果环境菜单已打开则 reRender，
// 使自定义纹理库等依赖 allModels 的 renderCustom 回调拿到最新数据。
const _onLibraryScanned = (): void => {
    getEnvMenu()?.reRender();
};
const _libraryScannedDisp = addDisposableListener(
    window,
    'mmar:library-scanned',
    _onLibraryScanned
);

/** 清理环境菜单的全局事件监听（测试/HMR 时调用，配对 removeEventListener） */
export function disposeEnvMenuListeners(): void {
    _libraryScannedDisp.dispose();
}

/** 环境弹窗根级 items 构建器——动态反映 envState 各 toggle 状态。 */
function buildEnvRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // Card 1: 环境预设（L2 精选组合 + 用户自定义）
    items.push({
        kind: 'folder',
        label: t('env.presets'),
        icon: 'lucide:bookmark',
        target: 'env:presets',
    });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    // Card 2: 环境功能入口（天空/粒子/风/雾/阴影/实验 — 地面/水面已迁至场景→舞台）
    items.push({ kind: 'folder', label: t('env.sky'), icon: 'lucide:sun', target: 'env:sky' });
    items.push({
        kind: 'folder',
        label: t('env.particle'),
        icon: 'lucide:sparkles',
        target: 'env:particle',
        headerToggle: {
            value: envState.particleEnabled,
            onChange: (v) => setEnvState({ particleEnabled: v }),
            bind: () => envState.particleEnabled,
        },
    });
    items.push({
        kind: 'folder',
        label: t('env.wind'),
        icon: 'lucide:wind',
        target: 'env:wind',
        headerToggle: {
            value: envState.windEnabled,
            onChange: (v) => setEnvState({ windEnabled: v }),
            bind: () => envState.windEnabled,
        },
    });
    items.push({
        kind: 'folder',
        label: t('env.fog'),
        icon: 'lucide:cloud-fog',
        target: 'env:fog',
        headerToggle: {
            value: envState.fogEnabled,
            onChange: (v) => setEnvState({ fogEnabled: v }),
            bind: () => envState.fogEnabled,
        },
    });
    items.push({
        kind: 'folder',
        label: t('env.shadow'),
        icon: 'lucide:umbrella',
        target: 'env:shadow',
        headerToggle: {
            value: getLightState().shadowEnabled,
            onChange: (v) => setLightingState({ shadowEnabled: v }),
            bind: () => getLightState().shadowEnabled,
        },
    });
    items.push({
        kind: 'folder',
        label: t('env.experimental'),
        icon: 'lucide:flask-conical',
        target: 'env:experimental',
    });
    // [adr-111] 后处理（Bloom/DOF/色调映射）从场景菜单迁入
    items.push({
        kind: 'folder',
        label: t('scene.postProcess'),
        icon: 'lucide:wand-2',
        target: 'env:postprocess',
    });
    // 体积云（正式功能，非实验特性，WebGL2 自动检测）
    items.push({
        kind: 'folder',
        label: t('env.cloud'),
        icon: 'lucide:cloud',
        target: 'env:cloud',
        headerToggle: {
            value: envState.cloudsEnabled,
            onChange: (v) => setEnvState({ cloudsEnabled: v }),
            bind: () => envState.cloudsEnabled,
        },
    });
    return items;
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: t('env.env'),
        dir: '',
        items: buildEnvRootItems(),
    };
}

function buildParticleSchema(): MenuNode[] {
    return [
        {
            id: 'env:particle:type',
            kind: 'modeSlider',
            label: 'env.particleType',
            icon: 'lucide:sparkles',
            control: {
                bind: 'env.particleType',
                options: [
                    { value: 'none', label: 'env.none' },
                    { value: 'sakura', label: 'env.sakura' },
                    { value: 'rain', label: 'env.rain' },
                    { value: 'snow', label: 'env.snow' },
                    { value: 'fireworks', label: 'env.fireworks' },
                    { value: 'fireflies', label: 'env.fireflies' },
                    { value: 'leaves', label: 'env.leaves' },
                ],
            },
        },
        {
            id: 'env:particle:density',
            kind: 'slider',
            label: 'env.density',
            icon: 'lucide:layers',
            control: { bind: 'env.particleEmitRate', min: 0, max: 3, step: 0.1 },
        },
        {
            id: 'env:particle:size',
            kind: 'slider',
            label: 'env.size',
            icon: 'lucide:maximize',
            control: { bind: 'env.particleSize', min: 0.1, max: 3, step: 0.1 },
        },
        {
            id: 'env:particle:speed',
            kind: 'slider',
            label: 'env.speed',
            icon: 'lucide:gauge',
            control: { bind: 'env.particleSpeed', min: 0.1, max: 5, step: 0.1 },
        },
        {
            id: 'env:particle:splash',
            kind: 'toggle',
            label: 'env.splash',
            icon: 'lucide:droplets',
            control: { bind: 'env.particleSplash' },
        },
        {
            id: 'env:particle:texture',
            kind: 'custom',
            renderCustom: (c) => {
                const fileName = envState.particleCustomTexture
                    ? (envState.particleCustomTexture.split(/[/\\]/).pop() ?? t('env.notSelected'))
                    : t('env.notSelected');
                slideRow(
                    c,
                    'lucide:image',
                    t('env.customTexture'),
                    false,
                    () => _openTexturePicker('particle', t('env.customTexture')),
                    fileName
                );
                addClearRow(
                    c,
                    !!envState.particleCustomTexture,
                    () => setEnvState({ particleCustomTexture: '' }),
                    t('env.clear'),
                    'env:particle:custom-texture-clear'
                );
            },
        },
    ] satisfies MenuNode[];
}

export function buildParticleLevel(): PopupLevel {
    return _buildLevel(t('env.particle'), (c) => renderMenu(buildParticleSchema(), c));
}

// ======== Env Stack onFolderEnter ========

function envOnItemClick(row: PopupRow): void {
    if (!row.model) {
        return;
    }

    const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'hdr', 'dds'];
    if (!IMAGE_FORMATS.includes(row.model.format)) {
        return;
    }

    const target = getEnvTextureBindingTarget();
    clearEnvTextureBindingTarget();
    closeAllOverlays();

    switch (target) {
        case 'particle':
            setEnvState({ particleCustomTexture: row.model.file_path });
            break;
        case 'sky':
            setEnvState({ skyTexture: row.model.file_path });
            break;
        case 'stars':
            setEnvState({ starsTexture: row.model.file_path });
            break;
        default:
            break;
    }

    getEnvMenu()?.reRender();
}

// [doc:adr-065] 子层路由表：target → 纯 items 构建器；自动挂 itemBuilder 实现语言热刷新
const ENV_FOLDER_ROUTES: Record<string, () => PopupLevel> = {
    'env:sky': buildSkyLevel,
    'env:particle': buildParticleLevel,
    'env:wind': buildWindLevel,
    'env:fog': buildFogLevel,
    'env:shadow': buildShadowLevel,
    'env:cloud': buildCloudLevel,
    'env:experimental': buildExperimentalLevel,
    'env:presets': buildPresetLevel,
    'env:postprocess': buildPostProcessLevel,
};

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    const builder = ENV_FOLDER_ROUTES[row.target as string];
    if (builder) {
        const lvl = builder();
        lvl.itemBuilder = () => builder().items;
        return lvl;
    }
    return null;
}
