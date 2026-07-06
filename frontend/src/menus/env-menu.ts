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
} from '../scene/scene';
import {
    getLightState,
    setLightState as setLightingState,
} from '../scene/render/lighting';
import {
    TIME_OF_DAY_PRESETS,
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
    buildFogLevel, buildShadowLevel,
} from './env-feature-levels';
import { buildPresetLevel, renderUserEnvPresets, snapshotCurrentEnvPreset, SCENE_PRESETS } from './env-preset-levels';

// ======== Barrel Re-Exports ========
export { buildSkyLevel, buildGroundLevel, buildWaterLevel, buildWindLevel, buildCloudLevel, buildExperimentalLevel, buildFogLevel, buildShadowLevel } from './env-feature-levels';
export { buildPresetLevel, SCENE_PRESETS } from './env-preset-levels';

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
    for (const [key, p] of Object.entries(TIME_OF_DAY_PRESETS)) {
        addPresetChip(chipGroup, p.label, false, () => {
            _activeEnvPresetKey = key;
            applyEnvPreset(key);
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
                }, 'lucide:sun', undefined, {
                    bind: () => getEnvSunAngle(),
                });
            });
        },
    };
}

export function buildEnvUnifiedLevel(): PopupLevel {
    const s = envState;
    return {
        label: '天空',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addModeSlider(c, '天空模式', [
                    { value: 'procedural', label: '程序化' },
                    { value: 'color', label: '纯色' },
                    { value: 'texture', label: '贴图' },
                ], s.skyMode, (v) => { setEnvState({ skyMode: v }); }, 'lucide:layers', undefined, {
                    bind: () => envState.skyMode,
                });

                renderPresetChips(c);

                addCollapsible(c, {
                    title: '天空外观', icon: 'lucide:palette', defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addColorSliderRow(inner, '天顶色', s.skyColorTop, (v) => { setEnvState({ skyColorTop: v }); }, {
                                bind: () => envState.skyColorTop,
                            });
                            addColorSliderRow(inner, '地平色', s.skyColorBot, (v) => { setEnvState({ skyColorBot: v }); }, {
                                bind: () => envState.skyColorBot,
                            });
                        } else if (s.skyMode === 'color') {
                            addColorSliderRow(inner, '天空色', s.skyColorTop, (v) => { setEnvState({ skyColorTop: v }); }, {
                                bind: () => envState.skyColorTop,
                            });
                        } else if (s.skyMode === 'texture') {
                            const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : '未选择';
                            slideRow(inner, 'lucide:image', '环境贴图', false, async () => {
                                const path = await SelectEnvTextureFile().catch(() => '');
                                if (path) setEnvState({ skyTexture: path });
                            }, fileName);
                        }
                    },
                });

                addCollapsible(c, {
                    title: '高级天空设置', icon: 'lucide:settings', defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addToggleRow(inner, '星空', s.starsEnabled ?? false, (v) => { setEnvState({ starsEnabled: v }); }, 'lucide:sparkles', {
                                bind: () => !!envState.starsEnabled,
                            });
                        }
                        addSliderRow(inner, '天空旋转速度', s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => { setEnvState({ skyRotationSpeed: v }); }, 'lucide:rotate-cw', undefined, {
                            bind: () => envState.skyRotationSpeed ?? 0,
                        });
                        addSliderRow(inner, '太阳角度', getEnvSunAngle(), -15, 90, 1, (v) => { setEnvSunAngle(v); setEnvState({ sunAngle: v }); }, 'lucide:sun', undefined, {
                            bind: () => getEnvSunAngle(),
                        });
                        if (s.skyMode === 'texture') {
                            addSliderRow(inner, '旋转 Y', s.skyRotationY, 0, 360, 1, (v) => { setEnvState({ skyRotationY: v }); }, 'lucide:refresh-cw', undefined, {
                                bind: () => envState.skyRotationY,
                            });
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
    items.push({ kind: 'folder', label: '环境预设', icon: 'lucide:bookmark', target: 'env:presets' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    // Card 2: 环境功能入口（天空/水面/粒子/风/地面/雾/阴影/实验）
    items.push({ kind: 'folder', label: '天空', icon: 'lucide:sun', target: 'env:sky' });
    items.push({
        kind: 'folder', label: '水面', icon: 'lucide:waves', target: 'env:water',
        headerToggle: { value: envState.waterEnabled, onChange: (v) => setEnvState({ waterEnabled: v }), bind: () => envState.waterEnabled },
    });
    items.push({
        kind: 'folder', label: '粒子', icon: 'lucide:sparkles', target: 'env:particle',
        headerToggle: { value: envState.particleEnabled, onChange: (v) => setEnvState({ particleEnabled: v }), bind: () => envState.particleEnabled },
    });
    items.push({
        kind: 'folder', label: '风', icon: 'lucide:wind', target: 'env:wind',
        headerToggle: { value: envState.windEnabled, onChange: (v) => setEnvState({ windEnabled: v }), bind: () => envState.windEnabled },
    });
    items.push({
        kind: 'folder', label: '地面', icon: 'lucide:square', target: 'env:ground',
        headerToggle: { value: envState.groundVisible, onChange: (v) => setEnvState({ groundVisible: v }), bind: () => envState.groundVisible },
    });
    items.push({
        kind: 'folder', label: '雾', icon: 'lucide:cloud-fog', target: 'env:fog',
        headerToggle: { value: envState.fogEnabled, onChange: (v) => setEnvState({ fogEnabled: v }), bind: () => envState.fogEnabled },
    });
    items.push({
        kind: 'folder', label: '阴影', icon: 'lucide:cloud', target: 'env:shadow',
        headerToggle: { value: getLightState().shadowEnabled, onChange: (v) => setLightingState({ shadowEnabled: v }), bind: () => getLightState().shadowEnabled },
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
                ], s.particleType, (v) => { setEnvState({ particleType: v }); }, 'lucide:sparkles', undefined, {
                    bind: () => envState.particleType,
                });
                addSliderRow(c, '密度', s.particleEmitRate, 0, 3, 0.1, (v) => { setEnvState({ particleEmitRate: v }); }, 'lucide:layers', undefined, {
                    bind: () => envState.particleEmitRate,
                });
                addSliderRow(c, '大小', s.particleSize, 0.1, 3, 0.1, (v) => { setEnvState({ particleSize: v }); }, 'lucide:maximize', undefined, {
                    bind: () => envState.particleSize,
                });
                addSliderRow(c, '速度', s.particleSpeed, 0.1, 5, 0.1, (v) => { setEnvState({ particleSpeed: v }); }, 'lucide:gauge', undefined, {
                    bind: () => envState.particleSpeed,
                });
                addToggleRow(c, '落地溅射', s.particleSplash, (v) => { setEnvState({ particleSplash: v }); }, 'lucide:splash', {
                    bind: () => envState.particleSplash,
                });
                // 自定义纹理按钮
                const texRow = document.createElement('div');
                texRow.className = 'cs-row';
                const texLabel = document.createElement('span');
                texLabel.textContent = '自定义纹理';
                texRow.appendChild(texLabel);
                const texBtn = document.createElement('button');
                texBtn.className = 'cs-btn cs-btn-sm';
                texBtn.textContent = envState.particleCustomTexture ? '更换' : '选择';
                const ensureClearBtn = (): HTMLButtonElement => {
                    const existing = texRow.querySelector<HTMLButtonElement>('button.cs-btn[data-clear]');
                    if (existing) return existing;
                    const btn = document.createElement('button');
                    btn.className = 'cs-btn cs-btn-sm';
                    btn.dataset.clear = '1';
                    btn.textContent = '清除';
                    btn.onclick = () => {
                        setEnvState({ particleCustomTexture: '' });
                        texBtn.textContent = '选择';
                        btn.remove();
                    };
                    texRow.appendChild(btn);
                    return btn;
                };
                texBtn.onclick = () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const url = e.target?.result as string ?? '';
                            setEnvState({ particleCustomTexture: url });
                            texBtn.textContent = '更换';
                            ensureClearBtn();
                        };
                        reader.readAsDataURL(file);
                    };
                    input.click();
                };
                texRow.appendChild(texBtn);
                if (envState.particleCustomTexture) {
                    ensureClearBtn();
                }
                c.appendChild(texRow);
            });
        },
    };
}

// ======== Env Stack onFolderEnter ========

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'env:sky': return buildEnvUnifiedLevel();
        case 'env:lighting': return buildEnvLightingLevel();
        case 'env:ground': return buildGroundLevel();
        case 'env:water': return buildWaterLevel();
        case 'env:particle': return buildParticleLevel();
        case 'env:wind': return buildWindLevel();
        case 'env:cloud': return buildCloudLevel();
        case 'env:fog': return buildFogLevel();
        case 'env:shadow': return buildShadowLevel();
        case 'env:experimental': return buildExperimentalLevel();
        case 'env:presets': return buildPresetLevel();
        default: return null;
    }
}


