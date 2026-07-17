// [doc:architecture] Env Menu — 环境弹窗（核心 + barrel export）
// 拆分后保留: 导航/统一面板/环境光照/粒子/入口 + barrel re-export
// 子文件: env-feature-levels.ts, env-preset-levels.ts
// 道具已迁移到 scene-prop-levels.ts（舞台域）

import { envState, PopupLevel, PopupRow } from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { slideRow, addSliderRow, addPresetChip, addClearRow } from '../core/ui-helpers';
import { setEnvState, getEnvSunAngle, setEnvSunAngle, applyEnvPreset } from '../scene/scene';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import { TIME_OF_DAY_PRESETS } from '../scene/env/env-lighting';
import { closeAllOverlays } from '../core/utils';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { activeTimeOfDayPreset, setActiveTimeOfDayPreset } from '../core/state';

// ======== 从子文件导入 ========
import {
    buildSkyLevel,
    buildGroundLevel,
    buildWaterLevel,
    buildWindLevel,
    buildCloudLevel,
    buildExperimentalLevel,
    buildFogLevel,
    buildShadowLevel,
    _buildLevel,
    _openTexturePicker,
} from './env-feature-levels';
import { buildPresetLevel } from './env-preset-levels';
import { buildPostProcessLevel } from './scene-render-levels';

// ======== Barrel Re-Exports ========
export {
    buildSkyLevel,
    buildGroundLevel,
    buildWaterLevel,
    buildWindLevel,
    buildCloudLevel,
    buildExperimentalLevel,
    buildFogLevel,
    buildShadowLevel,
} from './env-feature-levels';
export { buildPresetLevel, SCENE_PRESETS } from './env-preset-levels';

// ======== Env Texture Binding Target ========

export type EnvTextureBindingTarget = 'ground' | 'particle' | 'sky' | 'stars' | null;

let _envTextureBindingTarget: EnvTextureBindingTarget = null;

export function setEnvTextureBindingTarget(target: EnvTextureBindingTarget): void {
    _envTextureBindingTarget = target;
}

export function clearEnvTextureBindingTarget(): void {
    _envTextureBindingTarget = null;
}

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

export { getEnvMenu, refreshEnvRoot, showEnvMenu };

// 当库扫描完成时，如果环境菜单已打开则 reRender，
// 使自定义纹理库等依赖 allModels 的 renderCustom 回调拿到最新数据。
window.addEventListener('mmar:library-scanned', () => {
    getEnvMenu()?.reRender();
});

/**
 * 渲染环境氛围预设芯片组（紧凑 preset-chip 布局，替代旧 slideRow 全宽行）。
 */
function renderPresetChips(container: HTMLElement): void {
    const chipGroup = document.createElement('div');
    chipGroup.className = 'preset-group';
    chipGroup.style.paddingBottom = '6px';
    for (const [key, p] of Object.entries(TIME_OF_DAY_PRESETS)) {
        addPresetChip(
            chipGroup,
            p.label,
            false,
            () => {
                setActiveTimeOfDayPreset(key);
                applyEnvPreset(key);
            },
            {
                onUpdate: (btn) => {
                    btn.classList.toggle('active', activeTimeOfDayPreset === key);
                },
            }
        );
    }
    container.appendChild(chipGroup);
}

function buildEnvLightingSchema(): MenuNode[] {
    return [
        {
            id: 'env:lighting:presets',
            kind: 'custom',
            renderCustom: (c) => {
                renderPresetChips(c);
            },
        },
        {
            id: 'env:lighting:sunAngle',
            kind: 'custom',
            renderCustom: (c) => {
                addSliderRow(
                    c,
                    t('env.sunAngle'),
                        getEnvSunAngle(),
                        -15,
                        90,
                        1,
                        (v) => {
                            setEnvSunAngle(v);
                            setEnvState({ sunAngle: v });
                        },
                        'lucide:sun',
                        undefined,
                        { bind: () => getEnvSunAngle() }
                    );
            },
        },
    ];
}

export function buildEnvLightingLevel(): PopupLevel {
    return _buildLevel(t('env.lighting'), (c) => renderMenu(buildEnvLightingSchema(), c));
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
        icon: 'lucide:cloud',
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
        icon: 'lucide:sparkles',
        target: 'env:postprocess',
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
                    t('env.clear')
                );
            },
        },
    ];
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

    const target = _envTextureBindingTarget;
    clearEnvTextureBindingTarget();
    closeAllOverlays();

    switch (target) {
        case 'ground':
            setEnvState({
                groundTexture: row.model.file_path,
                groundTextureEnabled: !!row.model.file_path,
                groundStyle: 'texture',
            });
            break;
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
    'env:lighting': buildEnvLightingLevel,
    'env:ground': buildGroundLevel,
    'env:water': buildWaterLevel,
    'env:particle': buildParticleLevel,
    'env:wind': buildWindLevel,
    'env:cloud': buildCloudLevel,
    'env:fog': buildFogLevel,
    'env:shadow': buildShadowLevel,
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
