// [doc:architecture] Env Menu — 环境弹窗（核心 + barrel export）
// 拆分后保留: 导航/统一面板/环境光照/粒子/入口 + barrel re-export
// 子文件: env-feature-levels.ts, env-prop-levels.ts, env-preset-levels.ts

import {
    envState,
    PopupLevel,
    PopupRow,
    escapeHtml,
    cardContainer,
    dom,
    closeAllOverlays,
    getMenuWrapper,
} from '../core/config';
import { SlideMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
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
} from '../scene/scene-lighting';
import {
    ENV_PRESETS as ENV_LIGHTING_PRESETS,
    exportEnvPreset,
    importEnvPreset,
    type EnvPreset,
} from '../scene/env-lighting';
import {
    SelectEnvTextureFile,
} from '../core/wails-bindings';
import { setStatus } from '../core/config';

// ======== 从子文件导入 ========
import {
    buildSkyLevel, buildGroundLevel, buildWaterLevel, buildWindLevel, buildCloudLevel, buildExperimentalLevel,
} from './env-feature-levels';
import { buildPropLevel, buildPropDetailLevel } from './env-prop-levels';
import { buildPresetLevel, renderUserEnvPresets, snapshotCurrentEnvPreset, ENV_PRESETS } from './env-preset-levels';

// ======== Barrel Re-Exports ========
export { buildSkyLevel, buildGroundLevel, buildWaterLevel, buildWindLevel, buildCloudLevel, buildExperimentalLevel } from './env-feature-levels';
export { buildPropLevel, buildPropDetailLevel } from './env-prop-levels';
export { buildPresetLevel, ENV_PRESETS } from './env-preset-levels';

// ======== Env Menu State ========

let envMenu: SlideMenu | null = null;
export function getEnvMenu(): SlideMenu | null {
    return envMenu;
}

/**
 * 渲染环境氛围预设芯片组（去重：原 buildEnvLevel / buildEnvUnifiedLevel / buildEnvLightingLevel 三处重复）。
 * 点击芯片 → 应用预设 → 触发当前 envMenu 重绘。
 */
function renderPresetChips(container: HTMLElement): void {
    const chipGroup = document.createElement('div');
    chipGroup.className = 'preset-group';
    chipGroup.style.paddingBottom = '6px';
    for (const [key, p] of Object.entries(ENV_LIGHTING_PRESETS)) {
        const btn = document.createElement('button');
        btn.textContent = p.label;
        btn.className = 'preset-chip';
        btn.addEventListener('click', () => {
            applyEnvPreset(key);
            envMenu.reRender();
        });
        chipGroup.appendChild(btn);
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
                renderUserEnvPresets(c);
                addSliderRow(c, '太阳角度', sunAngle, -15, 90, 1, (v) => {
                    setEnvSunAngle(v);
                    setEnvState({ sunAngle: v });
                }, 'lucide:sun');
            });
        },
        reRenderCustom: (container) => {
            // 只更新太阳角度滑块的值
            const angleSlider = container.querySelector('.cs-row:last-child .cs-value');
            if (angleSlider) angleSlider.textContent = String(Math.round(getEnvSunAngle()));
            const angleFill = container.querySelector('.cs-row:last-child .cs-fill') as HTMLElement | null;
            if (angleFill) {
                const v = getEnvSunAngle();
                const pct = Math.max(0, Math.min(100, ((v + 15) / 105) * 100));
                angleFill.style.width = pct + '%';
            }
        },
    };
}

export function buildEnvUnifiedLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
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
                ], s.skyMode, (v) => { setEnvState({ skyMode: v }); envMenu.reRender(); }, 'lucide:layers');

                renderPresetChips(c);

                renderUserEnvPresets(c);

                addCollapsible(c, {
                    title: '光照控制', icon: 'lucide:sun', defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '太阳强度', getLightState().dirIntensity, 0, 1, 0.05,
                            (v) => { setLightingState({ dirIntensity: v }); setRenderState({ exposure: Math.max(0.3, Math.min(2.0, v + 0.6)) }); },
                            'lucide:sun');
                        addSliderRow(inner, '天空照明', s.envIntensity / 3, 0, 1, 0.05,
                            (v) => setEnvState({ envIntensity: v * 3 }), 'lucide:sun');
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
                            addToggleRow(inner, '星空', s.starsEnabled ?? false, (v) => setEnvState({ starsEnabled: v }), 'lucide:sparkles');
                        }
                        addSliderRow(inner, '天空旋转速度', s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => setEnvState({ skyRotationSpeed: v }), 'lucide:rotate-cw');
                        addSliderRow(inner, '太阳角度', sunAngle, -15, 90, 1, (v) => { setEnvSunAngle(v); setEnvState({ sunAngle: v }); }, 'lucide:sun');
                        if (s.skyMode === 'texture') {
                            addSliderRow(inner, '旋转 Y', s.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), 'lucide:refresh-cw');
                        }
                    },
                });

                addCollapsible(c, {
                    title: '阴影设置', icon: 'lucide:cloud', defaultOpen: false,
                    headerToggle: { value: getLightState().shadowEnabled, onChange: (v) => setLightingState({ shadowEnabled: v }) },
                    renderContent: (inner) => {
                        addModeSlider(inner, '阴影类型', [
                            { value: 'hard', label: '硬阴影' }, { value: 'soft', label: '软阴影' }, { value: 'pcf', label: 'PCF' },
                        ], getLightState().shadowType, (v) => setLightingState({ shadowType: v }), 'lucide:cloud');
                        const shadowQualityRow = document.createElement('div');
                        shadowQualityRow.className = 'preset-group';
                        shadowQualityRow.dataset.shadowChips = '1';
                        for (const sq of [{ label: '低', value: 512 }, { label: '中', value: 1024 }, { label: '高', value: 2048 }, { label: '超高', value: 4096 }]) {
                            const btn = document.createElement('button');
                            btn.textContent = sq.label;
                            btn.className = 'preset-chip';
                            if (getLightState().shadowResolution === sq.value) btn.classList.add('active');
                            btn.addEventListener('click', () => { setLightingState({ shadowResolution: sq.value }); envMenu.reRender(); });
                            shadowQualityRow.appendChild(btn);
                        }
                        inner.appendChild(shadowQualityRow);
                        addSliderRow(inner, '阴影偏移', getLightState().shadowBias, 0, 0.01, 0.0001, (v) => setLightingState({ shadowBias: v }), 'lucide:move');
                        addSliderRow(inner, '阴影级联', getLightState().shadowCascades, 1, 4, 1, (v) => setLightingState({ shadowCascades: v }), 'lucide:layers');
                    },
                });
            });
        },
        reRenderCustom: (container) => {
            // 1. 更新天空模式 mode slider 的显示
            const s = envState;
            const modeOptions: Record<string, string> = { procedural: '程序化', color: '纯色', texture: '贴图' };
            const modeSlider = container.querySelector('.card-container .cs-row:first-child');
            if (modeSlider) {
                const valEl = modeSlider.querySelector('.cs-value');
                if (valEl) valEl.textContent = modeOptions[s.skyMode] || s.skyMode;
                // mode slider 有 thumb
                const idx = ['procedural', 'color', 'texture'].indexOf(s.skyMode);
                if (idx >= 0) {
                    const fill = modeSlider.querySelector('.cs-fill') as HTMLElement | null;
                    const thumb = modeSlider.querySelector('.cs-thumb') as HTMLElement | null;
                    const pct = idx > 0 ? (idx / 2) * 100 : 0;
                    if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                    if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
                }
            }

            // 2. 更新阴影分辨率芯片的 active 状态
            const shadowChips = container.querySelector<HTMLElement>('[data-shadow-chips]');
            if (shadowChips) {
                const currentRes = getLightState().shadowResolution;
                Array.from(shadowChips.children).forEach((btn) => {
                    const value = parseInt((btn as HTMLElement).textContent || '0');
                    (btn as HTMLElement).classList.toggle('active', value === currentRes);
                });
            }
        },
    };
}

/** 环境弹窗根级 items 构建器——动态反映 envState 各 toggle 状态。 */
function buildEnvRootItems(): PopupRow[] {
    const items: PopupRow[] = [];
    // Card 1: 氛围预设芯片组——新手一键切换
    items.push({
        kind: 'chips',
        label: '', icon: '', target: 'env:presets-chips',
        chips: Object.entries(ENV_LIGHTING_PRESETS).map(([key, p]) => ({
            label: p.label,
            onClick: () => {
                applyEnvPreset(key);
                envMenu?.reRender();
            },
        })),
    });
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
    items.push({ kind: 'folder', label: '实验功能', icon: 'lucide:flask-conical', target: 'env:experimental' });
    items.push({ kind: 'folder', label: '道具', icon: 'lucide:box', target: 'env:prop' });
    items.push({ kind: 'divider', label: '', icon: '', target: '' });
    // Card 3: 系统预设
    items.push({ kind: 'folder', label: '系统预设', icon: 'lucide:bookmark', target: 'env:presets' });
    return items;
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: '环境',
        dir: '',
        items: buildEnvRootItems(),
    };
}

/** 重新计算根级 items 并触发 reRender（toggle 状态变化后调用）。 */
export function refreshEnvRoot(): void {
    if (!envMenu) return;
    const root = envMenu.getLevel(0);
    if (root) {
        root.items = buildEnvRootItems();
        envMenu.reRender();
    }
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
                ], s.particleType, (v) => { setEnvState({ particleType: v }); envMenu.reRender(); }, 'lucide:sparkles');
                addSliderRow(c, '密度', s.particleEmitRate, 0, 3, 0.1, (v) => setEnvState({ particleEmitRate: v }), 'lucide:layers');
                addSliderRow(c, '大小', s.particleSize, 0.1, 3, 0.1, (v) => setEnvState({ particleSize: v }), 'lucide:maximize');
                addSliderRow(c, '速度', s.particleSpeed, 0.1, 5, 0.1, (v) => setEnvState({ particleSpeed: v }), 'lucide:gauge');
            });
        },
        reRenderCustom: (container) => {
            // 更新粒子类型 mode slider 的显示
            const s = envState;
            const options = ['none', 'sakura', 'rain', 'snow', 'fireworks', 'fireflies', 'leaves'];
            const idx = options.indexOf(s.particleType);
            if (idx < 0) return;
            const labels = ['无', '🌸 樱花', '🌧 雨', '❄ 雪', '🎆 烟花', '✨ 萤火虫', '🍂 落叶'];
            const csRow = container.querySelector('.card-container .cs-row:first-child');
            if (!csRow) return;
            const valEl = csRow.querySelector('.cs-value');
            if (valEl) valEl.textContent = labels[idx];
            const fill = csRow.querySelector('.cs-fill') as HTMLElement | null;
            if (fill) {
                const pct = idx > 0 ? (idx / (options.length - 1)) * 100 : 0;
                fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
            }
            const thumb = csRow.querySelector('.cs-thumb') as HTMLElement | null;
            if (thumb) {
                const pct = idx > 0 ? (idx / (options.length - 1)) * 100 : 0;
                thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
            }
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
        case 'env:prop': return buildPropLevel();
        case 'env:presets': return buildPresetLevel();
        default: return null;
    }
}

// ======== Show Env Menu ========

export function showEnvMenu(): void {
    dom.sceneOverlay.classList.remove('sceneOverlay-model', 'sceneOverlay-motion', 'sceneOverlay-settings');
    dom.sceneOverlay.dataset.popupType = 'env';

    const wrapper = getMenuWrapper('env-menu');
    if (envMenu) {
        envMenu.resetToRoot();
        envMenu.reRender();
        return;
    }

    envMenu = new SlideMenu({
        container: wrapper,
        onClose: () => closeAllOverlays(),
        onItemClick: () => {},
        onFolderEnter: envOnFolderEnter,
        onAfterRender: () => {},
    });

    envMenu.reset(buildEnvLevel());
}
