// [doc:architecture] Env Feature Levels — 环境功能弹窗层级（天空/地面/水面/风/云/实验功能）
// 从 env-menu.ts 拆分

import { envState, cardContainer, setStatus, getBrowseDir } from '../core/config';
import type { PopupLevel, EnvState } from '../core/config';
import { escapeHtml } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    addPresetChip,
} from '../core/ui-helpers';
import { setEnvState, engine } from '../scene/scene';
import { t } from '../core/i18n/t';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import {
    WATER_PRESETS,
    applyWaterPresetToCurrent,
    buildWaterPresetEnvState,
    disposeWater,
    createWater,
} from '../scene/env/env-water';
import { SelectEnvTextureFile, SelectPMXFile } from '../core/wails-bindings';
import { getEnvMenu, setEnvTextureBindingTarget } from './env-menu';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { stackRegistry } from '../core/config';
import { closeAllOverlays } from '../core/utils';

export function buildSkyLevel(): PopupLevel {
    return {
        label: t('env.sky'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const skySchema: MenuNode[] = [
                    { id: 'env:sky:mode', kind: 'modeSlider', label: 'env.skyMode', control: { bind: 'env.skyMode', options: [{ value: 'color', label: 'env.solid' }, { value: 'texture', label: 'env.texture' }, { value: 'procedural', label: 'env.procedural' }] }, icon: 'lucide:sun' },
                    { id: 'env:sky:colorTop', kind: 'colorSlider', label: 'env.skyColorTop', control: { bind: 'env.skyColorTop' }, visibleWhen: () => envState.skyMode === 'color' },
                    { id: 'env:sky:zenith', kind: 'colorSlider', label: 'env.zenithColor', control: { bind: 'env.skyColorTop' }, visibleWhen: () => envState.skyMode === 'procedural' },
                    { id: 'env:sky:horizon', kind: 'colorSlider', label: 'env.horizonColor', control: { bind: 'env.skyColorBot' }, visibleWhen: () => envState.skyMode === 'procedural' },
                    { id: 'env:sky:stars', kind: 'toggle', label: 'env.stars', control: { bind: 'env.starsEnabled' }, visibleWhen: () => envState.skyMode === 'procedural' },
                    { id: 'env:sky:brightness', kind: 'slider', label: 'env.brightness', control: { bind: 'env.skyBrightness', min: 0.1, max: 5, step: 0.1 }, icon: 'lucide:sun', visibleWhen: () => envState.skyMode === 'procedural' },
                    {
                        id: 'env:sky:textureSection',
                        kind: 'custom',
                        visibleWhen: () => envState.skyMode === 'texture',
                        renderCustom: (cc) => {
                            const hint = document.createElement('div');
                            hint.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px 0;';
                            hint.textContent = t('env.skyTextureHint');
                            cc.appendChild(hint);
                            const fileName = envState.skyTexture ? envState.skyTexture.split(/[/\\]/).pop() : t('env.notSelected');
                            slideRow(cc, 'lucide:image', t('env.skyTexture'), false, async () => {
                                setEnvTextureBindingTarget('sky');
                                closeAllOverlays();
                                const level = stackRegistry.buildLevel!(getBrowseDir('environment'), t('env.skyTexture'), (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format), getEnvMenu()!);
                                getEnvMenu()!.push(level);
                            }, fileName);
                            addSliderRow(cc, t('env.rotateY'), envState.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), 'lucide:refresh-cw');
                        },
                    },
                    { id: 'env:sky:rotationSpeed', kind: 'slider', label: 'env.skyRotationSpeed', control: { bind: 'env.skyRotationSpeed', min: 0, max: 5, step: 0.1, get: (v) => (v as number) ?? 0 }, icon: 'lucide:rotate-cw' },
                    {
                        id: 'env:sky:light',
                        kind: 'folder',
                        label: 'env.lightControl',
                        icon: 'lucide:sun',
                        defaultOpen: false,
                        children: [
                            { id: 'env:sky:sunIntensity', kind: 'slider', label: 'env.sunIntensity', control: { bind: 'light.dirIntensity', min: 0, max: 1, step: 0.05 }, icon: 'lucide:sun' },
                            { id: 'env:sky:skyLighting', kind: 'slider', label: 'env.skyLighting', control: { bind: 'env.envIntensity', min: 0, max: 1, step: 0.05, get: (v) => (v as number) / 3, set: (v) => (v as number) * 3 }, icon: 'lucide:sun' },
                        ],
                    },
                ];
                renderMenu(skySchema, c);
            });
        },
    };
}

export function buildGroundLevel(): PopupLevel {
    return {
        label: t('env.ground'),
        dir: '',
        items: [],

renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {

                // ===== 基础设置（schema 驱动，ADR-093 PoC）=====
                const baseSchema: MenuNode[] = [
                    {
                        id: 'env:ground:base',
                        kind: 'folder',
                        label: 'env.baseSettings',
                        icon: 'lucide:settings-2',
                        defaultOpen: true,
                        children: [
                            { id: 'env:ground:color', kind: 'colorSlider', label: 'env.groundColor', control: { bind: 'env.groundColor' } },
                            { id: 'env:ground:opacity', kind: 'slider', label: 'env.opacity', control: { bind: 'env.groundAlpha', min: 0, max: 1, step: 0.05 }, icon: 'lucide:eye' },
                            { id: 'env:ground:height', kind: 'slider', label: 'env.groundHeight', control: { bind: 'env.groundLevel', min: -5, max: 5, step: 0.1 }, icon: 'lucide:move-vertical' },
                            { id: 'env:ground:size', kind: 'slider', label: 'env.range', control: { bind: 'env.groundSize', min: 10, max: 200, step: 5 }, icon: 'lucide:maximize' },
                            { id: 'env:ground:edgeFade', kind: 'slider', label: 'env.edgeFade', control: { bind: 'env.groundEdgeFade', min: 0, max: 1, step: 0.01 }, icon: 'lucide:droplet' },
                        ],
                    },
                ];
                renderMenu(baseSchema, c);

                // ===== 贴图 =====
                const textureSchema: MenuNode[] = [
                    {
                        id: 'env:ground:texture',
                        kind: 'folder',
                        label: 'env.textureMode',
                        icon: 'lucide:image',
                        defaultOpen: false,
                        headerToggle: { bind: 'env.groundTextureEnabled' },
                        renderCustom: (cc) => {
                            const texturePresets = [
                                { value: 'textures/grass.png', label: t('env.grass') },
                                { value: 'textures/stone.png', label: t('env.stone') },
                                { value: 'textures/sand.png', label: t('env.sand') },
                            ];
                            const chipRow = document.createElement('div');
                            chipRow.className = 'preset-group';
                            for (const tp of texturePresets) {
                                addPresetChip(chipRow, tp.label, envState.groundTexture === tp.value, () => {
                                    const hasTex = !!tp.value;
                                    const patch: Record<string, unknown> = { groundTexture: tp.value, groundTextureEnabled: hasTex, groundStyle: hasTex ? 'texture' : 'solid' };
                                    // 选贴图时若装饰未开启，自动启用 grid overlay
                                    if (hasTex && envState.groundDecoStyle === 'none') {
                                        patch.groundDecoStyle = 'grid';
                                    }
                                    setEnvState(patch as any);
                                }, { onUpdate: (btn) => { btn.classList.toggle('active', envState.groundTexture === tp.value); } });
                            }
                            cc.appendChild(chipRow);
                            const groundFileName = envState.groundTexture && !envState.groundTexture.startsWith('textures/') ? (envState.groundTexture.split(/[/\\]/).pop() ?? t('env.notSelected')) : t('env.notSelected');
                            slideRow(cc, 'lucide:image', t('env.customTexture'), false, () => {
                                setEnvTextureBindingTarget('ground');
                                const level = stackRegistry.buildLevel!('environment', t('env.customTexture'), (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format), getEnvMenu()!);
                                getEnvMenu()!.push(level);
                            }, groundFileName);
                            if (envState.groundTexture && !envState.groundTexture.startsWith('textures/')) {
                                const clearRow = document.createElement('div');
                                clearRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 14px 4px;';
                                const clearBtn = document.createElement('button');
                                clearBtn.className = 'cs-btn cs-btn-sm';
                                clearBtn.textContent = t('env.clear');
                                clearBtn.onclick = () => { setEnvState({ groundTexture: '', groundTextureEnabled: false, groundStyle: 'solid', groundDecoStyle: 'none' }); };
                                clearRow.appendChild(clearBtn);
                                cc.appendChild(clearRow);
                            }
                            addSliderRow(cc, t('env.textureScale'), envState.groundTextureScale, 0.1, 5, 0.1, (v) => setEnvState({ groundTextureScale: v }), 'lucide:zoom-in');
                            addSliderRow(cc, t('env.textureRotation'), envState.groundTextureRotation, 0, 360, 1, (v) => setEnvState({ groundTextureRotation: v }), 'lucide:rotate-cw');
                        },
                    },
                ];
                renderMenu(textureSchema, c);

                // ===== 装饰 =====
                const decoSchema: MenuNode[] = [
                    {
                        id: 'env:ground:deco',
                        kind: 'folder',
                        label: 'env.decoration',
                        icon: 'lucide:grid-3x3',
                        defaultOpen: true,
                        headerToggle: {
                            bind: 'env.groundDecoStyle',
                            get: (v) => v !== 'none',
                            set: (on) => (on ? 'grid' : 'none'),
                        },
                        children: [
                            { id: 'env:ground:decoStyle', kind: 'custom', renderCustom: (cc) => {
                                const chipRow = document.createElement('div');
                                chipRow.className = 'preset-group';
                                const decoPresets = [
                                    { value: 'grid', label: t('env.grid') },
                                    { value: 'checker', label: t('env.checker') },
                                ] as const;
                                for (const dp of decoPresets) {
                                    addPresetChip(chipRow, dp.label, envState.groundDecoStyle === dp.value, () => {
                                        setEnvState({ groundDecoStyle: dp.value });
                                    }, { onUpdate: (btn) => { btn.classList.toggle('active', envState.groundDecoStyle === dp.value); } });
                                }
                                cc.appendChild(chipRow);
                            } },
                            { id: 'env:ground:gridSize', kind: 'slider', label: 'env.gridSize', control: { bind: 'env.groundGridSize', min: 0.5, max: 5, step: 0.1 }, icon: 'lucide:grid-3x3' },
                            { id: 'env:ground:lineColor', kind: 'colorSlider', label: 'env.gridLineColor', control: { bind: 'env.groundLineColor' } },
                            { id: 'env:ground:pattern', kind: 'modeSlider', label: 'env.groundPattern', control: { bind: 'env.groundPattern', options: [{ value: 'checker', label: 'env.checker' }, { value: 'dots', label: 'env.dots' }, { value: 'stripes', label: 'env.stripes' }, { value: 'radial', label: 'env.radial' }] }, icon: 'lucide:grid-3x3', visibleWhen: () => envState.groundDecoStyle === 'checker' },
                        ],
                    },
                ];
                renderMenu(decoSchema, c);

                // ===== 地形（schema 驱动）=====
                const terrainSchema: MenuNode[] = [
                    {
                        id: 'env:ground:terrain',
                        kind: 'folder',
                        label: 'env.terrain',
                        icon: 'lucide:mountain',
                        defaultOpen: false,
                        headerToggle: {
                            bind: 'env.groundType',
                            get: (v) => v === 'terrain',
                            set: (on) => (on ? 'terrain' : 'flat'),
                        },
                        children: [
                            { id: 'env:ground:terrainHeight', kind: 'slider', label: 'env.terrainHeight', control: { bind: 'env.groundTerrainHeight', min: 0, max: 15, step: 0.1 }, icon: 'lucide:mountain' },
                            { id: 'env:ground:terrainScale', kind: 'slider', label: 'env.terrainScale', control: { bind: 'env.groundTerrainScale', min: 0.01, max: 5, step: 0.05 }, icon: 'lucide:ruler' },
                            { id: 'env:ground:terrainSeed', kind: 'slider', label: 'env.terrainSeed', control: { bind: 'env.groundTerrainSeed', min: 0, max: 9999, step: 1 }, icon: 'lucide:hash' },
                            { id: 'env:ground:terrainOctaves', kind: 'slider', label: 'env.terrainOctaves', control: { bind: 'env.groundTerrainOctaves', min: 1, max: 8, step: 1 }, icon: 'lucide:layers' },
                        ],
                    },
                ];
                renderMenu(terrainSchema, c);

                // ===== 地面增强 =====
                const enhanceSchema: MenuNode[] = [
                    {
                        id: 'env:ground:enhance',
                        kind: 'folder',
                        label: 'env.groundEnhance',
                        icon: 'lucide:sliders-horizontal',
                        defaultOpen: false,
                        children: [
                            { id: 'env:ground:pitch', kind: 'slider', label: 'env.groundPitch', control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 }, icon: 'lucide:arrow-up-down' },
                            { id: 'env:ground:roll', kind: 'slider', label: 'env.groundRoll', control: { bind: 'env.groundRoll', min: -45, max: 45, step: 1 }, icon: 'lucide:rotate-cw' },
                            { id: 'env:ground:scrollX', kind: 'slider', label: 'env.groundScrollX', control: { bind: 'env.groundScrollSpeedX', min: -2, max: 2, step: 0.1 }, icon: 'lucide:move-right', visibleWhen: () => envState.groundDecoStyle === 'checker' || (envState.groundTextureEnabled && !!envState.groundTexture) },
                            { id: 'env:ground:scrollZ', kind: 'slider', label: 'env.groundScrollZ', control: { bind: 'env.groundScrollSpeedZ', min: -2, max: 2, step: 0.1 }, icon: 'lucide:move-down', visibleWhen: () => envState.groundDecoStyle === 'checker' || (envState.groundTextureEnabled && !!envState.groundTexture) },
                            { id: 'env:ground:followCam', kind: 'toggle', label: 'env.groundFollowCamera', control: { bind: 'env.groundFollowCamera' }, icon: 'lucide:map-pin' },
                        ],
                    },
                ];
                renderMenu(enhanceSchema, c);

                // ===== 地面反射 =====
                const reflectionSchema: MenuNode[] = [
                    {
                        id: 'env:ground:reflection',
                        kind: 'folder',
                        label: 'env.groundReflection',
                        icon: 'lucide:reflection',
                        defaultOpen: false,
                        children: [
                            { id: 'env:ground:reflectQuality', kind: 'modeSlider', label: 'env.groundReflectQuality', control: { bind: 'env.groundReflectionQuality', options: [{ value: 'off', label: 'env.off' }, { value: 'low', label: 'env.low' }, { value: 'medium', label: 'env.medium' }, { value: 'high', label: 'env.high' }] }, icon: 'lucide:monitor' },
                            { id: 'env:ground:reflectBlend', kind: 'slider', label: 'env.groundReflectBlend', control: { bind: 'env.groundReflectionBlend', min: 0, max: 1, step: 0.05 }, icon: 'lucide:blend' },
                            { id: 'env:ground:normalStrength', kind: 'slider', label: 'env.groundNormalStrength', control: { bind: 'env.groundNormalStrength', min: 0, max: 2, step: 0.05 }, icon: 'lucide:layers' },
                            { id: 'env:ground:elevationColoring', kind: 'toggle', label: 'env.groundElevationColoring', control: { bind: 'env.groundElevationColoring' }, icon: 'lucide:mountain-snow', visibleWhen: () => envState.groundType === 'terrain' },
                        ],
                    },
                ];
                renderMenu(reflectionSchema, c);
            });
        },
    };
}

export function buildWaterLevel(): PopupLevel {
    return {
        label: t('env.water'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const waterSchema: MenuNode[] = [
                    {
                        id: 'env:water:presets',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const row = document.createElement('div');
                            row.className = 'preset-group';
                            for (const [_key, wp] of Object.entries(WATER_PRESETS)) {
                                addPresetChip(row, wp.label, false, () => {
                                    setEnvState(buildWaterPresetEnvState(wp));
                                    applyWaterPresetToCurrent(wp);
                                });
                            }
                            cc.appendChild(row);
                        },
                    },
                    {
                        id: 'env:water:colorF',
                        kind: 'folder',
                        label: 'env.color',
                        icon: 'lucide:palette',
                        defaultOpen: true,
                        children: [
                            { id: 'env:water:color', kind: 'colorSlider', label: 'env.waterColor', control: { bind: 'env.waterColor' } },
                            { id: 'env:water:transparency', kind: 'slider', label: 'env.opacity', control: { bind: 'env.waterTransparency', min: 0, max: 1, step: 0.05 }, icon: 'lucide:eye' },
                            { id: 'env:water:fogColor', kind: 'colorSlider', label: 'env.waterFogColor', control: { bind: 'env.waterFogColor' } },
                            { id: 'env:water:fogDensity', kind: 'slider', label: 'env.waterFogDensity', control: { bind: 'env.waterFogDensity', min: 0, max: 0.05, step: 0.001 }, icon: 'lucide:cloud-fog' },
                        ],
                    },
                    {
                        id: 'env:water:basic',
                        kind: 'folder',
                        label: 'env.basicParams',
                        icon: 'lucide:sliders',
                        defaultOpen: true,
                        children: [
                            { id: 'env:water:level', kind: 'slider', label: 'env.height', control: { bind: 'env.waterLevel', min: -10, max: 30, step: 0.1 }, icon: 'lucide:arrow-up' },
                            { id: 'env:water:size', kind: 'slider', label: 'env.range', control: { bind: 'env.waterSize', min: 10, max: 200, step: 5 }, icon: 'lucide:maximize' },
                            { id: 'env:water:waveHeight', kind: 'slider', label: 'env.waveHeight', control: { bind: 'env.waterWaveHeight', min: 0, max: 3, step: 0.1 }, icon: 'lucide:waves' },
                            { id: 'env:water:animSpeed', kind: 'slider', label: 'env.animSpeed', control: { bind: 'env.waterAnimSpeed', min: 0.1, max: 5, step: 0.1, get: (v) => (v as number) ?? 1 }, icon: 'lucide:fast-forward' },
                        ],
                    },
                    {
                        id: 'env:water:underwater',
                        kind: 'folder',
                        label: 'env.underwaterEffects',
                        icon: 'lucide:waves',
                        children: [
                            { id: 'env:water:underFogDensity', kind: 'slider', label: 'env.fogDensity', control: { bind: 'env.underwaterFogDensity', min: 0, max: 0.15, step: 0.005 } },
                            { id: 'env:water:toneIntensity', kind: 'slider', label: 'env.toneIntensity', control: { bind: 'env.underwaterToneIntensity', min: 0, max: 1, step: 0.05 }, icon: 'lucide:palette' },
                            { id: 'env:water:tintStrength', kind: 'slider', label: 'env.underwaterTintStrength', control: { bind: 'env.underwaterTintStrength', min: 0, max: 1, step: 0.05 }, icon: 'lucide:palette' },
                        ],
                    },
                    {
                        id: 'env:water:advanced',
                        kind: 'folder',
                        label: 'env.waterAdvanced',
                        icon: 'lucide:settings-2',
                        defaultOpen: false,
                        children: [
                            { id: 'env:water:fresnelAlpha', kind: 'slider', label: 'env.fresnelAlpha', control: { bind: 'env.fresnelAlphaInfluence', min: 0, max: 1, step: 0.05 } },
                            { id: 'env:water:foamThreshold', kind: 'slider', label: 'env.foamThreshold', control: { bind: 'env.foamThreshold', min: 0, max: 1, step: 0.01 } },
                            { id: 'env:water:foamIntensity', kind: 'slider', label: 'env.foamIntensity', control: { bind: 'env.foamIntensity', min: 0, max: 1, step: 0.05 }, icon: 'lucide:sparkles' },
                            { id: 'env:water:foamOpacity', kind: 'slider', label: 'env.foamOpacity', control: { bind: 'env.foamOpacity', min: 0, max: 1, step: 0.05 } },
                        ],
                    },
                ];
                renderMenu(waterSchema, c);
            });
            // —— 反射（ADR-062 P1）——
            cardContainer(container, (rc) => {
                const reflectionSchema: MenuNode[] = [
                    {
                        id: 'env:water:reflection',
                        kind: 'folder',
                        label: 'env.reflection',
                        icon: 'lucide:mirror',
                        defaultOpen: false,
                        children: [
                            { id: 'env:water:reflectIntensity', kind: 'slider', label: 'env.reflectionIntensity', control: { bind: 'env.planarReflectBlend', min: 0, max: 1, step: 0.05 }, icon: 'lucide:sliders-horizontal' },
                            { id: 'env:water:reflectQuality', kind: 'modeSlider', label: 'env.reflectionQuality', control: { bind: 'env.reflectionQuality', options: [{ value: 'high', label: 'env.reflectionQualityHigh' }, { value: 'medium', label: 'env.reflectionQualityMedium' }, { value: 'low', label: 'env.reflectionQualityLow' }, { value: 'off', label: 'env.reflectionQualityOff' }], onChange: () => { disposeWater(); createWater(envState); } }, icon: 'lucide:gauge' },
                        ],
                    },
                ];
                renderMenu(reflectionSchema, rc);
            });
        },
    };
}

export function buildWindLevel(): PopupLevel {
    return {
        label: t('env.wind'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const windSchema: MenuNode[] = [
                    {
                        id: 'env:wind',
                        kind: 'folder',
                        label: '',
                        defaultOpen: true,
                        children: [
                            {
                                id: 'env:wind:angle',
                                kind: 'slider',
                                label: 'env.windAngle',
                                control: {
                                    bind: 'env.windDirection',
                                    min: 0,
                                    max: 360,
                                    step: 1,
                                    get: (v) => {
                                        const d = v as [number, number, number];
                                        return ((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360;
                                    },
                                    set: (angle) => {
                                        const rad = ((angle as number) * Math.PI) / 180;
                                        return [Math.sin(rad), envState.windDirection[1], Math.cos(rad)];
                                    },
                                },
                                icon: 'lucide:compass',
                            },
                            { id: 'env:wind:speed', kind: 'slider', label: 'env.windSpeed', control: { bind: 'env.windSpeed', min: 0, max: 10, step: 0.1 }, icon: 'lucide:gauge' },
                        ],
                    },
                ];
                renderMenu(windSchema, c);
            });
        },
    };
}

export function buildCloudLevel(): PopupLevel {
    return {
        label: t('env.cloud'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const cloudSchema: MenuNode[] = [
                    {
                        id: 'env:cloud',
                        kind: 'folder',
                        label: '',
                        defaultOpen: true,
                        children: [
                            { id: 'env:cloud:cover', kind: 'slider', label: 'env.cloudCover', control: { bind: 'env.cloudCover', min: 0, max: 1, step: 0.01 }, icon: 'lucide:cloud' },
                            { id: 'env:cloud:gap', kind: 'slider', label: 'env.cloudGap', control: { bind: 'env.cloudGap', min: 0, max: 1, step: 0.01, get: (v) => (v as number) ?? 0.5 }, icon: 'lucide:columns' },
                            { id: 'env:cloud:height', kind: 'slider', label: 'env.height', control: { bind: 'env.cloudHeight', min: 50, max: 800, step: 5 }, icon: 'lucide:arrow-up' },
                            { id: 'env:cloud:scale', kind: 'slider', label: 'env.scale', control: { bind: 'env.cloudScale', min: 0.1, max: 1, step: 0.05 }, icon: 'lucide:maximize' },
                            { id: 'env:cloud:thickness', kind: 'slider', label: 'env.thickness', control: { bind: 'env.cloudThickness', min: 10, max: 50, step: 1, get: (v) => (v as number) ?? 15 }, icon: 'lucide:move-vertical' },
                            { id: 'env:cloud:visibility', kind: 'slider', label: 'env.visibility', control: { bind: 'env.cloudVisibility', min: 500, max: 8000, step: 100, get: (v) => (v as number) ?? 2000 }, icon: 'lucide:eye' },
                        ],
                    },
                ];
                renderMenu(cloudSchema, c);
            });
        },
    };
}

export function buildExperimentalLevel(): PopupLevel {
    return {
        label: t('env.experimental'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const expSchema: MenuNode[] = [
                    {
                        id: 'env:exp:warn',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const warning = document.createElement('div');
                            warning.className = 'experimental-warning';
                            warning.innerHTML = '<iconify-icon icon="lucide:alert-triangle" style="margin-right:6px;"></iconify-icon><span>' + t('env.experimentalWarn') + '</span>';
                            cc.appendChild(warning);
                        },
                    },
                    {
                        id: 'env:exp:volCloud',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const isWebGL2 = engine.webGLVersion >= 2;
                            slideRow(cc, 'lucide:cloud', t('env.volumetricCloud'), true, () => getEnvMenu()?.push(buildCloudLevel()), undefined, undefined, undefined, {
                                value: envState.cloudsEnabled,
                                onChange: (v) => setEnvState({ cloudsEnabled: v }),
                                disabled: !isWebGL2,
                                disabledHint: t('env.volumetricCloudNeedWebGL'),
                                onDisabledClick: () => {
                                    setStatus(t('env.volumetricCloudNeedWebGL') + '，当前引擎版本：' + engine.webGLVersion.toFixed(1), false);
                                },
                            });
                            if (!isWebGL2) {
                                const hint = document.createElement('div');
                                hint.className = 'experimental-hint';
                                hint.textContent = t('env.volumetricCloudUnsupported');
                                cc.appendChild(hint);
                            }
                        },
                    },
                ];
                renderMenu(expSchema, c);
            });
        },
    };
}

export function buildFogLevel(): PopupLevel {
    return {
        label: t('env.fog'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const fogSchema: MenuNode[] = [
                    { id: 'env:fog:mode', kind: 'modeSlider', label: 'env.fogMode', control: { bind: 'env.fogMode', options: [{ value: 'exp2', label: 'EXP2' }, { value: 'exp', label: 'EXP' }, { value: 'linear', label: 'env.linear' }] }, icon: 'lucide:layers' },
                    { id: 'env:fog:color', kind: 'colorSlider', label: 'env.fogColor', control: { bind: 'env.fogColor' } },
                    { id: 'env:fog:density', kind: 'slider', label: 'env.fogDensity', control: { bind: 'env.fogDensity', min: 0, max: 0.1, step: 0.001 }, icon: 'lucide:droplets', visibleWhen: () => envState.fogMode !== 'linear' },
                    { id: 'env:fog:start', kind: 'slider', label: 'env.fogStart', control: { bind: 'env.fogStart', min: 0, max: 200, step: 1, get: (v) => (v as number) ?? 10 }, visibleWhen: () => envState.fogMode === 'linear' },
                    { id: 'env:fog:end', kind: 'slider', label: 'env.fogEnd', control: { bind: 'env.fogEnd', min: 0, max: 200, step: 1, get: (v) => (v as number) ?? 100 }, visibleWhen: () => envState.fogMode === 'linear' },
                ];
                renderMenu(fogSchema, c);
            });
        },
    };
}

export function buildShadowLevel(): PopupLevel {
    return {
        label: t('env.shadow'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const shadowSchema: MenuNode[] = [
                    {
                        id: 'env:shadow:env',
                        kind: 'folder',
                        label: 'env.envShadow',
                        icon: 'lucide:cloud',
                        defaultOpen: true,
                        children: [
                            { id: 'env:shadow:type', kind: 'modeSlider', label: 'env.shadowType', control: { bind: 'light.shadowType', options: [{ value: 'hard', label: 'env.hardShadow' }, { value: 'soft', label: 'env.softShadow' }, { value: 'pcf', label: 'PCF' }] }, icon: 'lucide:cloud' },
                            {
                                id: 'env:shadow:quality',
                                kind: 'custom',
                                renderCustom: (cc) => {
                                    const row = document.createElement('div');
                                    row.className = 'preset-group';
                                    for (const sq of [{ label: t('env.low'), value: 512 }, { label: t('env.medium'), value: 1024 }, { label: t('env.high'), value: 2048 }, { label: t('env.ultra'), value: 4096 }]) {
                                        addPresetChip(row, sq.label, getLightState().shadowResolution === sq.value, () => { setLightingState({ shadowResolution: sq.value }); }, { onUpdate: (btn) => { btn.classList.toggle('active', getLightState().shadowResolution === sq.value); } });
                                    }
                                    cc.appendChild(row);
                                },
                            },
                            { id: 'env:shadow:bias', kind: 'slider', label: 'env.shadowBias', control: { bind: 'light.shadowBias', min: 0, max: 0.01, step: 0.0001 }, icon: 'lucide:move' },
                            { id: 'env:shadow:cascades', kind: 'slider', label: 'env.shadowCascades', control: { bind: 'light.shadowCascades', min: 2, max: 4, step: 1 }, icon: 'lucide:layers' },
                        ],
                    },
                    {
                        id: 'env:shadow:charHint',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const charRow = document.createElement('div');
                            charRow.className = 'slide-item';
                            charRow.style.opacity = '0.6';
                            charRow.style.cursor = 'default';
                            const ci = document.createElement('span');
                            ci.className = 'slide-icon';
                            const ce = createIconifyIcon('lucide:user');
                            if (ce) ci.appendChild(ce);
                            charRow.appendChild(ci);
                            const cl = document.createElement('span');
                            cl.className = 'slide-label';
                            cl.textContent = t('env.characterShadow');
                            charRow.appendChild(cl);
                            const cs = document.createElement('span');
                            cs.className = 'slide-sublabel';
                            cs.textContent = t('env.characterShadowHint');
                            charRow.appendChild(cs);
                            cc.appendChild(charRow);
                        },
                    },
                    {
                        id: 'env:shadow:stageHint',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            slideRow(cc, 'lucide:lightbulb', t('env.stageLightShadow'), false, () => { setStatus(t('env.shadowHint'), true); }, '→ ' + t('env.sceneMenu'));
                        },
                    },
                ];
                renderMenu(shadowSchema, c);
            });
        },
    };
}
