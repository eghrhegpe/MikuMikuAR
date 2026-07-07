// [doc:architecture] Env Menu — 环境弹窗（核心 + barrel export）
// 拆分后保留: 导航/统一面板/环境光照/粒子/入口 + barrel re-export
// 子文件: env-feature-levels.ts, env-preset-levels.ts
// 道具已迁移到 scene-prop-levels.ts（舞台域）

import { envState, PopupLevel, PopupRow, escapeHtml, cardContainer } from '../core/config';
import { registerPopupMenu } from './menu-factory';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    addPresetChip,
} from '../core/ui-helpers';
import {
    setEnvState,
    getEnvSunAngle,
    setEnvSunAngle,
    applyEnvPreset,
    applyEnvPresetObject,
} from '../scene/scene';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import {
    TIME_OF_DAY_PRESETS,
    exportEnvPreset,
    importEnvPreset,
    type EnvPreset,
} from '../scene/env/env-lighting';
import { SelectEnvTextureFile } from '../core/wails-bindings';
import { setStatus } from '../core/config';
import { closeAllOverlays } from '../core/utils';
import { stackRegistry } from '../core/config';
import { t } from '../core/i18n/t';

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
} from './env-feature-levels';
import {
    buildPresetLevel,
    renderUserEnvPresets,
    snapshotCurrentEnvPreset,
    SCENE_PRESETS,
} from './env-preset-levels';

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

type EnvTextureBindingTarget = 'ground' | 'particle' | 'sky' | null;

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

/** 当前选中的环境氛围预设 key */
let _activeEnvPresetKey = 'noon';

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
                _activeEnvPresetKey = key;
                applyEnvPreset(key);
            },
            {
                onUpdate: (btn) => {
                    btn.classList.toggle('active', _activeEnvPresetKey === key);
                },
            }
        );
    }
    container.appendChild(chipGroup);
}

export function buildEnvLightingLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
    return {
        label: t('env.lighting'),
        dir: '',
        items: [{ kind: 'divider' as const, label: '', icon: '', target: '' } as PopupRow],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                renderPresetChips(c);
                addSliderRow(
                    c,
                    t('env.sunAngle'),
                    sunAngle,
                    -15,
                    90,
                    1,
                    (v) => {
                        setEnvSunAngle(v);
                        setEnvState({ sunAngle: v });
                    },
                    'lucide:sun',
                    undefined,
                    {
                        bind: () => getEnvSunAngle(),
                    }
                );
            });
        },
    };
}

export function buildEnvUnifiedLevel(): PopupLevel {
    const s = envState;
    return {
        label: t('env.sky'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    t('env.skyMode'),
                    [
                        { value: 'procedural', label: t('env.procedural') },
                        { value: 'color', label: t('env.solid') },
                        { value: 'texture', label: t('env.texture') },
                    ],
                    s.skyMode,
                    (v) => {
                        setEnvState({ skyMode: v });
                    },
                    'lucide:layers',
                    undefined,
                    {
                        bind: () => envState.skyMode,
                    }
                );

                renderPresetChips(c);

                addCollapsible(c, {
                    title: t('env.skyAppearance'),
                    icon: 'lucide:palette',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addColorSliderRow(
                                inner,
                                t('env.zenithColor'),
                                s.skyColorTop,
                                (v) => {
                                    setEnvState({ skyColorTop: v });
                                },
                                {
                                    bind: () => envState.skyColorTop,
                                }
                            );
                            addColorSliderRow(
                                inner,
                                t('env.horizonColor'),
                                s.skyColorBot,
                                (v) => {
                                    setEnvState({ skyColorBot: v });
                                },
                                {
                                    bind: () => envState.skyColorBot,
                                }
                            );
                        } else if (s.skyMode === 'color') {
                            addColorSliderRow(
                                inner,
                                t('env.skyColorTop'),
                                s.skyColorTop,
                                (v) => {
                                    setEnvState({ skyColorTop: v });
                                },
                                {
                                    bind: () => envState.skyColorTop,
                                }
                            );
                        } else if (s.skyMode === 'texture') {
                            const fileName = s.skyTexture
                                ? s.skyTexture.split(/[/\\]/).pop()
                                : t('env.notSelected');
                            slideRow(
                                inner,
                                'lucide:image',
                                t('env.skyTexture'),
                                false,
                                async () => {
                                    const path = await SelectEnvTextureFile().catch(() => '');
                                    if (path) {
                                        setEnvState({ skyTexture: path });
                                    }
                                },
                                fileName
                            );
                        }
                    },
                });

                addCollapsible(c, {
                    title: t('env.advancedSky'),
                    icon: 'lucide:settings',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addToggleRow(
                                inner,
                                t('env.stars'),
                                s.starsEnabled ?? false,
                                (v) => {
                                    setEnvState({ starsEnabled: v });
                                },
                                'lucide:sparkles',
                                {
                                    bind: () => !!envState.starsEnabled,
                                }
                            );
                        }
                        addSliderRow(
                            inner,
                            t('env.skyRotationSpeed'),
                            s.skyRotationSpeed ?? 0,
                            0,
                            5,
                            0.1,
                            (v) => {
                                setEnvState({ skyRotationSpeed: v });
                            },
                            'lucide:rotate-cw',
                            undefined,
                            {
                                bind: () => envState.skyRotationSpeed ?? 0,
                            }
                        );
                        addSliderRow(
                            inner,
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
                            {
                                bind: () => getEnvSunAngle(),
                            }
                        );
                        if (s.skyMode === 'texture') {
                            addSliderRow(
                                inner,
                                t('env.rotateY'),
                                s.skyRotationY,
                                0,
                                360,
                                1,
                                (v) => {
                                    setEnvState({ skyRotationY: v });
                                },
                                'lucide:refresh-cw',
                                undefined,
                                {
                                    bind: () => envState.skyRotationY,
                                }
                            );
                        }
                    },
                });
            });
        },
    };
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
    // Card 2: 环境功能入口（天空/水面/粒子/风/地面/雾/阴影/实验）
    items.push({ kind: 'folder', label: t('env.sky'), icon: 'lucide:sun', target: 'env:sky' });
    items.push({
        kind: 'folder',
        label: t('env.water'),
        icon: 'lucide:waves',
        target: 'env:water',
        headerToggle: {
            value: envState.waterEnabled,
            onChange: (v) => setEnvState({ waterEnabled: v }),
            bind: () => envState.waterEnabled,
        },
    });
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
        label: t('env.ground'),
        icon: 'lucide:square',
        target: 'env:ground',
        headerToggle: {
            value: envState.groundVisible,
            onChange: (v) => setEnvState({ groundVisible: v }),
            bind: () => envState.groundVisible,
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
    return items;
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: t('env.env'),
        dir: '',
        items: buildEnvRootItems(),
    };
}

export function buildParticleLevel(): PopupLevel {
    return {
        label: t('env.particle'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    t('env.particleType'),
                    [
                        { value: 'none', label: t('env.none') },
                        { value: 'sakura', label: '🌸 ' + t('env.sakura') },
                        { value: 'rain', label: '🌧 ' + t('env.rain') },
                        { value: 'snow', label: '❄ ' + t('env.snow') },
                        { value: 'fireworks', label: '🎆 ' + t('env.fireworks') },
                        { value: 'fireflies', label: '✨ ' + t('env.fireflies') },
                        { value: 'leaves', label: '🍂 ' + t('env.leaves') },
                    ],
                    s.particleType,
                    (v) => {
                        setEnvState({ particleType: v });
                    },
                    'lucide:sparkles',
                    undefined,
                    {
                        bind: () => envState.particleType,
                    }
                );
                addSliderRow(
                    c,
                    t('env.density'),
                    s.particleEmitRate,
                    0,
                    3,
                    0.1,
                    (v) => {
                        setEnvState({ particleEmitRate: v });
                    },
                    'lucide:layers',
                    undefined,
                    {
                        bind: () => envState.particleEmitRate,
                    }
                );
                addSliderRow(
                    c,
                    t('env.size'),
                    s.particleSize,
                    0.1,
                    3,
                    0.1,
                    (v) => {
                        setEnvState({ particleSize: v });
                    },
                    'lucide:maximize',
                    undefined,
                    {
                        bind: () => envState.particleSize,
                    }
                );
                addSliderRow(
                    c,
                    t('env.speed'),
                    s.particleSpeed,
                    0.1,
                    5,
                    0.1,
                    (v) => {
                        setEnvState({ particleSpeed: v });
                    },
                    'lucide:gauge',
                    undefined,
                    {
                        bind: () => envState.particleSpeed,
                    }
                );
                addToggleRow(
                    c,
                    t('env.splash'),
                    s.particleSplash,
                    (v) => {
                        setEnvState({ particleSplash: v });
                    },
                    'lucide:splash',
                    {
                        bind: () => envState.particleSplash,
                    }
                );
                // 自定义纹理：slideRow + 库浏览
                const particleFileName = s.particleCustomTexture
                    ? s.particleCustomTexture.split(/[/\\]/).pop() ?? t('env.notSelected')
                    : t('env.notSelected');
                slideRow(
                    c,
                    'lucide:image',
                    t('env.customTexture'),
                    false,
                    () => {
                        setEnvTextureBindingTarget('particle');
                        const level = stackRegistry.buildLevel!(
                            'environment',
                            t('env.customTexture'),
                            (m) =>
                                ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format),
                            getEnvMenu()!
                        );
                        getEnvMenu()!.push(level);
                    },
                    particleFileName
                );
                if (s.particleCustomTexture) {
                    const clearRow = document.createElement('div');
                    clearRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 14px 4px;';
                    const clearBtn = document.createElement('button');
                    clearBtn.className = 'cs-btn cs-btn-sm';
                    clearBtn.textContent = t('env.clear');
                    clearBtn.onclick = () => {
                        setEnvState({ particleCustomTexture: '' });
                    };
                    clearRow.appendChild(clearBtn);
                    c.appendChild(clearRow);
                }
            });
        },
    };
}

// ======== Env Stack onFolderEnter ========

function envOnItemClick(row: PopupRow): void {
    if (!row.model) return;

    const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'hdr', 'dds'];
    if (!IMAGE_FORMATS.includes(row.model.format)) return;

    const target = _envTextureBindingTarget;
    clearEnvTextureBindingTarget();
    closeAllOverlays();

    switch (target) {
        case 'ground':
            setEnvState({
                groundTexture: row.model.file_path,
                groundTextureEnabled: !!row.model.file_path,
            });
            break;
        case 'particle':
            setEnvState({ particleCustomTexture: row.model.file_path });
            break;
        case 'sky':
            setEnvState({ skyTexture: row.model.file_path });
            break;
        default:
            break;
    }

    getEnvMenu()?.reRender();
}

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'env:sky':
            return buildEnvUnifiedLevel();
        case 'env:lighting':
            return buildEnvLightingLevel();
        case 'env:ground':
            return buildGroundLevel();
        case 'env:water':
            return buildWaterLevel();
        case 'env:particle':
            return buildParticleLevel();
        case 'env:wind':
            return buildWindLevel();
        case 'env:cloud':
            return buildCloudLevel();
        case 'env:fog':
            return buildFogLevel();
        case 'env:shadow':
            return buildShadowLevel();
        case 'env:experimental':
            return buildExperimentalLevel();
        case 'env:presets':
            return buildPresetLevel();
        default:
            return null;
    }
}
