// [doc:architecture] Env Menu — 环境弹窗（核心 + barrel export）
// 拆分后保留: 导航/统一面板/环境光照/粒子/入口 + barrel re-export
// 子文件: env-feature-levels.ts, env-preset-levels.ts
// 道具已迁移到 scene-prop-levels.ts（舞台域）

import {
    envState,
    PopupLevel,
    PopupRow,
    escapeHtml,
    cardContainer,
} from '../core/config';
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
    setRenderState,
    engine,
} from '../scene/scene';
import {
    getLightState,
    setLightState as setLightingState,
    transitionLighting,
} from '../scene/render/lighting';
import {
    ENV_PRESETS as ENV_LIGHTING_PRESETS,
    exportEnvPreset,
    importEnvPreset,
    type EnvPreset,
} from '../scene/env/env-lighting';
import {
    SelectEnvTextureFile,
} from '../core/wails-bindings';
import { setStatus } from '../core/config';

// ======== 从子文件导入 ========
import {
    buildSkyLevel, buildGroundLevel, buildWaterLevel, buildWindLevel, buildCloudLevel, buildExperimentalLevel,
} from './env-feature-levels';
import { buildPresetLevel, renderUserEnvPresets, snapshotCurrentEnvPreset, ENV_PRESETS } from './env-preset-levels';

// ======== Barrel Re-Exports ========
export { buildSkyLevel, buildGroundLevel, buildWaterLevel, buildWindLevel, buildCloudLevel, buildExperimentalLevel } from './env-feature-levels';
export { buildPresetLevel, ENV_PRESETS } from './env-preset-levels';

// ======== Env Menu State ========

const { getMenu: getEnvMenu, refreshRoot: refreshEnvRoot, show: showEnvMenu } = registerPopupMenu({
    wrapperKey: 'env-menu',
    popupType: 'env',
    buildRoot: () => buildEnvLevel(),
    buildRootItems: () => buildEnvRootItems(),
    handlers: { onFolderEnter: envOnFolderEnter },
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
    for (const [key, p] of Object.entries(ENV_LIGHTING_PRESETS)) {
        addPresetChip(chipGroup, p.label, false, () => {
            _activeEnvPresetKey = key;
            applyEnvPreset(key);
            getEnvMenu()?.updateControls();
        }, {
            onUpdate: (btn) => {
                btn.classList.toggle('active', _activeEnvPresetKey === key);
            }
        });
    }
    container.appendChild(chipGroup);
}

export function buildEnvLightingLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
    return {
        label: '环境光照',
        dir: '',
        items: [{ kind: 'divider' as const, label: '', icon: '', target: '' } as PopupRow],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                renderPresetChips(c);
                addSliderRow(c, '太阳角度', sunAngle, -15, 90, 1, (v) => {
                    setEnvSunAngle(v);
                    setEnvState({ sunAngle: v });
                    getEnvMenu()?.updateControls();
                }, 'lucide:sun', undefined, {
                    bind: () => getEnvSunAngle(),
                });
            });
        },
    };
}

export function buildEnvUnifiedLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
    const s = envState;

    return {
        label: '天空氛围',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addModeSlider(c, '天空模式', [
                    { value: 'procedural', label: '程序化' },
                    { value: 'color', label: '纯色' },
                    { value: 'texture', label: '贴图' },
                ], s.skyMode, (v) => { setEnvState({ skyMode: v }); getEnvMenu()?.updateControls(); }, 'lucide:layers', undefined, {
                    bind: () => envState.skyMode,
                });

                renderPresetChips(c);

                addCollapsible(c, {
                    title: '光照控制', icon: 'lucide:sun', defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '太阳强度', getLightState().dirIntensity, 0, 1, 0.05,
                            (v) => { setLightingState({ dirIntensity: v }); setRenderState({ exposure: Math.max(0.3, Math.min(2.0, v + 0.6)) }); getEnvMenu()?.updateControls(); },
                            'lucide:sun', undefined, {
                                bind: () => getLightState().dirIntensity,
                            });
                        addSliderRow(inner, '天空照明', s.envIntensity / 3, 0, 1, 0.05,
                            (v) => { setEnvState({ envIntensity: v * 3 }); getEnvMenu()?.updateControls(); }, 'lucide:sun', undefined, {
                                bind: () => envState.envIntensity / 3,
                            });
                    },
                });

                addCollapsible(c, {
                    title: '天空外观', icon: 'lucide:palette', defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addColorSliderRow(inner, '天顶色', s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
                            addColorSliderRow(inner, '地平色', s.skyColorBot, (v) => setEnvState({ skyColorBot: v }));
                        } else if (s.skyMode === 'color') {
                            addColorSliderRow(inner, '天空色', s.skyColorTop, (v) => setEnvState({ skyColorTop: v }));
                        } else if (s.skyMode === 'texture') {
                            const texRow = document.createElement('div');
                            texRow.className = 'slide-item';
                            const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : '未选择';
                            texRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:image"></iconify-icon></span><span class="slide-label">环境贴图</span><span class="slide-sublabel">${escapeHtml(fileName)}</span>`;
                            texRow.addEventListener('click', async () => {
                                const path = await SelectEnvTextureFile().catch(() => '');
                                if (path) setEnvState({ skyTexture: path });
                            });
                            inner.appendChild(texRow);
                        }
                    },
                });

                addCollapsible(c, {
                    title: '高级天空设置', icon: 'lucide:settings', defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addToggleRow(inner, '星空', s.starsEnabled ?? false, (v) => { setEnvState({ starsEnabled: v }); getEnvMenu()?.updateControls(); }, 'lucide:sparkles', {
                                bind: () => !!envState.starsEnabled,
                            });
                        }
                        addSliderRow(inner, '天空旋转速度', s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => { setEnvState({ skyRotationSpeed: v }); getEnvMenu()?.updateControls(); }, 'lucide:rotate-cw', undefined, {
                            bind: () => envState.skyRotationSpeed ?? 0,
                        });
                        addSliderRow(inner, '太阳角度', sunAngle, -15, 90, 1, (v) => { setEnvSunAngle(v); setEnvState({ sunAngle: v }); getEnvMenu()?.updateControls(); }, 'lucide:sun', undefined, {
                            bind: () => getEnvSunAngle(),
                        });
                        if (s.skyMode === 'texture') {
                            addSliderRow(inner, '旋转 Y', s.skyRotationY, 0, 360, 1, (v) => { setEnvState({ skyRotationY: v }); getEnvMenu()?.updateControls(); }, 'lucide:refresh-cw', undefined, {
                                bind: () => envState.skyRotationY,
                            });
                        }
                    },
                });

                addCollapsible(c, {
                    title: '阴影设置', icon: 'lucide:cloud', defaultOpen: false,
                    headerToggle: { value: getLightState().shadowEnabled, onChange: (v) => { setLightingState({ shadowEnabled: v }); getEnvMenu()?.reRender(); } },
                    renderContent: (inner) => {
                        addModeSlider(inner, '阴影类型', [
                            { value: 'hard', label: '硬阴影' }, { value: 'soft', label: '软阴影' }, { value: 'pcf', label: 'PCF' },
                        ], getLightState().shadowType, (v) => { setLightingState({ shadowType: v }); getEnvMenu()?.updateControls(); }, 'lucide:cloud', undefined, {
                            bind: () => getLightState().shadowType,
                        });
                        const shadowQualityRow = document.createElement('div');
                        shadowQualityRow.className = 'preset-group';
                        for (const sq of [{ label: '低', value: 512 }, { label: '中', value: 1024 }, { label: '高', value: 2048 }, { label: '超高', value: 4096 }]) {
                            addPresetChip(shadowQualityRow, sq.label, getLightState().shadowResolution === sq.value, () => {
                                setLightingState({ shadowResolution: sq.value });
                                getEnvMenu()?.updateControls();
                            }, {
                                onUpdate: (btn) => {
                                    btn.classList.toggle('active', getLightState().shadowResolution === sq.value);
                                }
                            });
                        }
                        inner.appendChild(shadowQualityRow);
                        addSliderRow(inner, '阴影偏移', getLightState().shadowBias, 0, 0.01, 0.0001, (v) => { setLightingState({ shadowBias: v }); getEnvMenu()?.updateControls(); }, 'lucide:move', undefined, {
                            bind: () => getLightState().shadowBias,
                        });
                        addSliderRow(inner, '阴影级联', getLightState().shadowCascades, 2, 4, 1, (v) => { setLightingState({ shadowCascades: v }); getEnvMenu()?.updateControls(); }, 'lucide:layers', undefined, {
                            bind: () => getLightState().shadowCascades,
                        });
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
    items.push({ kind: 'folder', label: '环境预设', icon: 'lucide:bookmark', target: 'env:presets' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    // Card 2: 环境功能入口（天空/水面/粒子/风/实验/道具）
    items.push({ kind: 'folder', label: '天空', icon: 'lucide:sun', target: 'env:unified' });
    items.push({
        kind: 'folder', label: '水面', icon: 'lucide:waves', target: 'env:water',
        headerToggle: { value: envState.waterEnabled, onChange: (v) => setEnvState({ waterEnabled: v }) },
    });
    items.push({
        kind: 'folder', label: '粒子', icon: 'lucide:sparkles', target: 'env:particle',
        headerToggle: { value: envState.particleEnabled, onChange: (v) => setEnvState({ particleEnabled: v }) },
    });
    items.push({
        kind: 'folder', label: '风', icon: 'lucide:wind', target: 'env:wind',
        headerToggle: { value: envState.windEnabled, onChange: (v) => setEnvState({ windEnabled: v }) },
    });
    items.push(
        { kind: 'folder', label: '实验功能', icon: 'lucide:flask-conical', target: 'env:experimental' },
    );
    return items;
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: '环境',
        dir: '',
        items: buildEnvRootItems(),
    };
}



export function buildParticleLevel(): PopupLevel {
    return {
        label: '粒子',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(c, '粒子类型', [
                    { value: 'none', label: '无' },
                    { value: 'sakura', label: '🌸 樱花' },
                    { value: 'rain', label: '🌧 雨' },
                    { value: 'snow', label: '❄ 雪' },
                    { value: 'fireworks', label: '🎆 烟花' },
                    { value: 'fireflies', label: '✨ 萤火虫' },
                    { value: 'leaves', label: '🍂 落叶' },
                ], s.particleType, (v) => { setEnvState({ particleType: v }); getEnvMenu()?.updateControls(); }, 'lucide:sparkles', undefined, {
                    bind: () => envState.particleType,
                });
                addSliderRow(c, '密度', s.particleEmitRate, 0, 3, 0.1, (v) => { setEnvState({ particleEmitRate: v }); getEnvMenu()?.updateControls(); }, 'lucide:layers', undefined, {
                    bind: () => envState.particleEmitRate,
                });
                addSliderRow(c, '大小', s.particleSize, 0.1, 3, 0.1, (v) => { setEnvState({ particleSize: v }); getEnvMenu()?.updateControls(); }, 'lucide:maximize', undefined, {
                    bind: () => envState.particleSize,
                });
                addSliderRow(c, '速度', s.particleSpeed, 0.1, 5, 0.1, (v) => { setEnvState({ particleSpeed: v }); getEnvMenu()?.updateControls(); }, 'lucide:gauge', undefined, {
                    bind: () => envState.particleSpeed,
                });
            });
        },
    };
}

// ======== Env Stack onFolderEnter ========

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'env:unified': return buildEnvUnifiedLevel();
        case 'env:lighting': return buildEnvLightingLevel();
        case 'env:sky': return buildSkyLevel();
        case 'env:ground': return buildGroundLevel();
        case 'env:water': return buildWaterLevel();
        case 'env:particle': return buildParticleLevel();
        case 'env:wind': return buildWindLevel();
        case 'env:cloud': return buildCloudLevel();
        case 'env:experimental': return buildExperimentalLevel();
        case 'env:presets': return buildPresetLevel();
        default: return null;
    }
}


