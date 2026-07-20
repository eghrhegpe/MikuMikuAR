// [doc:architecture] Env Feature Levels — 环境功能弹窗层级（天空/地面/水面/风/云/实验功能）
// 从 env-menu.ts 拆分

import { envState, cardContainer, setStatus, getBrowseDir } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, buildPresetChipGroup, addClearRow } from '../core/ui-helpers';
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import {
    WATER_PRESETS,
    applyWaterPresetToCurrent,
    buildWaterPresetEnvState,
    disposeWater,
    createWater,
} from '../scene/env/env-water';
import { GROUND_PRESETS, buildGroundPresetEnvState } from '../scene/env/env-ground';

/** 预设 key → i18n key 映射 */
const WATER_PRESET_I18N: Record<string, string> = {
    calm: 'env.presetCalm',
    ripple: 'env.presetRipple',
    ocean: 'env.presetOcean',
    storm: 'env.presetStorm',
    tropical: 'env.presetTropical',
};

const GROUND_PRESET_I18N: Record<string, string> = {
    cleanGray: 'env.groundPresetCleanGray',
    mirrorStage: 'env.groundPresetMirrorStage',
    grass: 'env.groundPresetGrass',
    stoneTile: 'env.groundPresetStoneTile',
    woodStage: 'env.groundPresetWoodStage',
    cyberGrid: 'env.groundPresetCyberGrid',
};
import { getEnvMenu, setEnvTextureBindingTarget, type EnvTextureBindingTarget } from './env-menu';
import { getSceneMenu } from './scene-menu';
import { TIME_OF_DAY_PRESETS } from '../scene/env/env-lighting';
import { applyEnvPreset } from '../scene/env/env-bridge';
import { activeTimeOfDayPreset, setActiveTimeOfDayPreset } from '../core/state';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { stackRegistry } from '../core/config';
import { closeAllOverlays } from '../core/utils';

// ======== 公共辅助函数 ========

/** 通用的环境功能层级构建器：包裹 cardContainer + renderMenu 模板 */
export function _buildLevel(
    label: string,
    buildSchema: (c: HTMLElement) => void,
    buildExtraSegments?: Array<(c: HTMLElement) => void>
): PopupLevel {
    const segments: Array<(c: HTMLElement) => void> = buildExtraSegments
        ? [buildSchema, ...buildExtraSegments]
        : [buildSchema];
    return {
        label,
        dir: '',
        items: [],
        renderCustom: (container) => {
            for (const seg of segments) {
                cardContainer(container, seg);
            }
        },
    };
}

/** 打开纹理选择浏览器（环境纹理选择器公共逻辑） */
export function _openTexturePicker(
    target: EnvTextureBindingTarget,
    label: string,
    browseDir?: string,
    noCloseOverlay?: boolean,
    pushMenu?: import('./menu').SlideMenu | null
): void {
    setEnvTextureBindingTarget(target);
    if (!noCloseOverlay) {
        closeAllOverlays();
    }
    const menu = pushMenu ?? getEnvMenu();
    if (!menu) {
        return;
    }
    const level = stackRegistry.buildLevel!(
        browseDir ?? getBrowseDir('environment'),
        label,
        (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format),
        menu
    );
    menu.push(level);
}

export function buildSkyLevel(): PopupLevel {
    return _buildLevel(t('env.sky'), (c) => {
        const skySchema: MenuNode[] = [
            // 时光预设芯片（黎明/正午/夕阳/夜景/阴天/霓虹）
            {
                id: 'env:sky:presets',
                kind: 'custom',
                renderCustom: (cc) => {
                    buildPresetChipGroup(
                        cc,
                        Object.entries(TIME_OF_DAY_PRESETS).map(([key, p]) => ({
                            label: p.label,
                            isActive: () => activeTimeOfDayPreset === key,
                            onClick: () => {
                                setActiveTimeOfDayPreset(key);
                                applyEnvPreset(key);
                            },
                        })),
                        { paddingBottom: 6 }
                    );
                },
            },
            {
                id: 'env:sky:mode',
                kind: 'modeSlider',
                label: 'env.skyMode',
                control: {
                    bind: 'env.skyMode',
                    options: [
                        { value: 'color', label: 'env.solid' },
                        { value: 'texture', label: 'env.texture' },
                        { value: 'procedural', label: 'env.procedural' },
                    ],
                },
                icon: 'lucide:sun',
            },
            {
                id: 'env:sky:colorTop',
                kind: 'colorSlider',
                label: 'env.skyColorTop',
                control: { bind: 'env.skyColorTop' },
                visibleWhen: () => envState.skyMode === 'color',
            },
            {
                id: 'env:sky:zenith',
                kind: 'colorSlider',
                label: 'env.zenithColor',
                control: { bind: 'env.skyColorTop' },
                // 与 env:sky:colorTop 共享 skyColorTop 字段（故意的颜色继承：color↔procedural 切换时颜色不中断）
                // 勿拆分为两独立字段——两个控件通过 visibleWhen 互斥（color vs procedural 模式），UI 不会同时出现
                visibleWhen: () => envState.skyMode === 'procedural',
            },
            {
                id: 'env:sky:horizon',
                kind: 'colorSlider',
                label: 'env.horizonColor',
                control: { bind: 'env.skyColorBot' },
                visibleWhen: () => envState.skyMode === 'procedural',
            },

            {
                id: 'env:sky:textureSection',
                kind: 'custom',
                visibleWhen: () => envState.skyMode === 'texture',
                renderCustom: (cc) => {
                    const hint = document.createElement('div');
                    hint.className = 'info-text';
                    hint.style.paddingTop = '4px';
                    hint.textContent = t('env.skyTextureHint');
                    cc.appendChild(hint);
                    const fileName = envState.skyTexture
                        ? envState.skyTexture.split(/[/\\]/).pop()
                        : t('env.notSelected');
                    slideRow(
                        cc,
                        'lucide:image',
                        t('env.skyTexture'),
                        false,
                        () => _openTexturePicker('sky', t('env.skyTexture')),
                        fileName
                    );
                    addSliderRow(
                        cc,
                        t('env.rotateY'),
                        envState.skyRotationY,
                        0,
                        360,
                        1,
                        (v) => setEnvState({ skyRotationY: v }),
                        'lucide:refresh-cw'
                    );
                },
            },
            {
                id: 'env:sky:rotationSpeed',
                kind: 'slider',
                label: 'env.skyRotationSpeed',
                control: {
                    bind: 'env.skyRotationSpeed',
                    min: 0,
                    max: 5,
                    step: 0.1,
                    get: (v) => (v as number) ?? 0,
                },
                icon: 'lucide:rotate-cw',
            },
            {
                id: 'env:sky:light',
                kind: 'folder',
                label: 'env.lightControl',
                icon: 'lucide:sun',
                defaultOpen: false,
                children: [
                    {
                        id: 'env:sky:sunIntensity',
                        kind: 'slider',
                        label: 'env.sunIntensity',
                        control: { bind: 'light.dirIntensity', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:sun',
                    },
                    {
                        id: 'env:sky:skyLighting',
                        kind: 'slider',
                        label: 'env.skyLighting',
                        control: {
                            bind: 'env.envIntensity',
                            min: 0,
                            max: 1,
                            step: 0.05,
                            get: (v) => (v as number) / 3,
                            set: (v) => (v as number) * 3,
                        },
                        icon: 'lucide:sun',
                    },
                    {
                        id: 'env:sky:stars',
                        kind: 'toggle',
                        label: 'env.stars',
                        control: { bind: 'env.starsEnabled' },
                        visibleWhen: () => envState.skyMode === 'procedural',
                    },
                    {
                        id: 'env:sky:brightness',
                        kind: 'slider',
                        label: 'env.brightness',
                        control: { bind: 'env.skyBrightness', min: 0.1, max: 5, step: 0.1 },
                        icon: 'lucide:sun',
                        visibleWhen: () => envState.skyMode === 'procedural',
                    },
                    {
                        id: 'env:sky:starsTexture',
                        kind: 'custom',
                        visibleWhen: () =>
                            envState.skyMode === 'procedural' && envState.starsEnabled,
                        renderCustom: (cc) => {
                            const fileName = envState.starsTexture
                                ? (envState.starsTexture.split(/[/\\]/).pop() ??
                                  t('env.notSelected'))
                                : t('env.notSelected');
                            slideRow(
                                cc,
                                'lucide:image',
                                t('env.starsTexture'),
                                false,
                                () => _openTexturePicker('stars', t('env.starsTexture')),
                                fileName
                            );
                            addClearRow(
                                cc,
                                !!envState.starsTexture,
                                () => setEnvState({ starsTexture: '' }),
                                t('env.clear'),
                                'env:sky:stars-clear'
                            );
                        },
                    },
                ],
            },
        ];
        renderMenu(skySchema, c);
    });
}

export function buildGroundLevel(): PopupLevel {
    return _buildLevel(t('env.ground'), (c) => {
        // ===== 地面预设（顶部 chips，一键应用）=====
        const presetsSchema: MenuNode[] = [
            {
                id: 'env:ground:presets',
                kind: 'custom',
                renderCustom: (cc) => {
                    buildPresetChipGroup(
                        cc,
                        Object.entries(GROUND_PRESETS).map(([key, gp]) => ({
                            label: t(GROUND_PRESET_I18N[key] ?? gp.label),
                            onClick: () => {
                                setEnvState({
                                    ...buildGroundPresetEnvState(gp),
                                    groundVisible: true,
                                });
                                getEnvMenu()?.reRender();
                            },
                        }))
                    );
                },
            },
        ];
        renderMenu(presetsSchema, c);

        // ===== 基础设置（schema 驱动，ADR-093 PoC）=====
        const baseSchema: MenuNode[] = [
            {
                id: 'env:ground:base',
                kind: 'folder',
                label: 'env.baseSettings',
                icon: 'lucide:settings-2',
                defaultOpen: true,
                children: [
                    {
                        id: 'env:ground:color',
                        kind: 'colorSlider',
                        label: 'env.groundColor',
                        control: { bind: 'env.groundColor' },
                    },
                    {
                        id: 'env:ground:opacity',
                        kind: 'slider',
                        label: 'env.opacity',
                        control: { bind: 'env.groundAlpha', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:eye',
                    },
                    {
                        id: 'env:ground:height',
                        kind: 'slider',
                        label: 'env.groundHeight',
                        control: { bind: 'env.groundLevel', min: -5, max: 5, step: 0.1 },
                        icon: 'lucide:move-vertical',
                    },
                    {
                        id: 'env:ground:size',
                        kind: 'slider',
                        label: 'env.range',
                        control: { bind: 'env.groundSize', min: 10, max: 1000, step: 10 },
                        icon: 'lucide:maximize',
                    },
                    {
                        id: 'env:ground:edgeFade',
                        kind: 'slider',
                        label: 'env.edgeFade',
                        control: { bind: 'env.groundEdgeFade', min: 0, max: 1, step: 0.01 },
                        icon: 'lucide:droplet',
                    },
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
                headerToggle: {
                    bind: 'env.groundTextureEnabled',
                    get: (v) => !!(v as boolean) || envState.groundProceduralTexture !== 'none',
                    set: (on) => {
                        if (!on) {
                            setEnvState({
                                groundProceduralTexture: 'none' as const,
                                groundTexture: '',
                                groundTextureEnabled: false,
                            });
                        }
                        return on;
                    },
                },
                renderCustom: (cc) => {
                    const texturePresets = [
                        { value: 'textures/grass.png', label: t('env.grass'), isProc: false },
                        { value: 'textures/stone.png', label: t('env.stone'), isProc: false },
                        { value: 'textures/sand.png', label: t('env.sand'), isProc: false },
                        { value: 'wood', label: t('env.wood'), isProc: true },
                        { value: 'marble', label: t('env.marble'), isProc: true },
                        { value: 'concrete', label: t('env.concrete'), isProc: true },
                    ];
                    buildPresetChipGroup(
                        cc,
                        texturePresets.map((tp) => ({
                            label: tp.label,
                            isActive: () =>
                                tp.isProc
                                    ? envState.groundProceduralTexture === tp.value
                                    : envState.groundTexture === tp.value,
                            onClick: () => {
                                if (tp.isProc) {
                                    const patch: Record<string, string | boolean> = {
                                        groundTexture: '',
                                        groundTextureEnabled: false,
                                        groundProceduralTexture: tp.value,
                                        groundStyle: 'solid',
                                    };
                                    setEnvState(patch as Parameters<typeof setEnvState>[0]);
                                } else {
                                    const patch: Record<string, string | boolean> = {
                                        groundTexture: tp.value,
                                        groundTextureEnabled: true,
                                        groundProceduralTexture: 'none',
                                        groundStyle: 'texture',
                                    };
                                    setEnvState(patch as Parameters<typeof setEnvState>[0]);
                                }
                            },
                        }))
                    );
                    const groundFileName =
                        envState.groundTexture && !envState.groundTexture.startsWith('textures/')
                            ? (envState.groundTexture.split(/[/\\]/).pop() ?? t('env.notSelected'))
                            : t('env.notSelected');
                    slideRow(
                        cc,
                        'lucide:image',
                        t('env.customTexture'),
                        false,
                        () =>
                            _openTexturePicker(
                                'ground',
                                t('env.customTexture'),
                                'environment',
                                true,
                                getSceneMenu()
                            ),
                        groundFileName
                    );
                    addClearRow(
                        cc,
                        !!envState.groundTexture && !envState.groundTexture.startsWith('textures/'),
                        () =>
                            setEnvState({
                                groundTexture: '',
                                groundTextureEnabled: false,
                                groundStyle: 'solid',
                                groundDecoStyle: 'none',
                            }),
                        t('env.clear'),
                        'env:ground:custom-texture-clear'
                    );
                    addSliderRow(
                        cc,
                        t('env.textureScale'),
                        envState.groundTextureScale,
                        0.1,
                        5,
                        0.1,
                        (v) => setEnvState({ groundTextureScale: v }),
                        'lucide:zoom-in'
                    );
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
                    {
                        id: 'env:ground:decoStyle',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const decoPresets = [
                                { value: 'grid', label: t('env.grid') },
                                { value: 'checker', label: t('env.checker') },
                            ] as const;
                            buildPresetChipGroup(
                                cc,
                                decoPresets.map((dp) => ({
                                    label: dp.label,
                                    isActive: () => envState.groundDecoStyle === dp.value,
                                    onClick: () => setEnvState({ groundDecoStyle: dp.value }),
                                }))
                            );
                        },
                    },
                    {
                        id: 'env:ground:gridSize',
                        kind: 'slider',
                        label: 'env.gridSize',
                        control: {
                            bind: 'env.groundGridSize',
                            min: 0.5,
                            max: 5,
                            step: 0.1,
                        },
                        icon: 'lucide:grid-3x3',
                    },
                    {
                        id: 'env:ground:lineColor',
                        kind: 'colorSlider',
                        label: 'env.gridLineColor',
                        control: { bind: 'env.groundLineColor' },
                    },
                    {
                        id: 'env:ground:pattern',
                        kind: 'modeSlider',
                        label: 'env.groundPattern',
                        control: {
                            bind: 'env.groundPattern',
                            options: [
                                { value: 'checker', label: 'env.checker' },
                                { value: 'dots', label: 'env.dots' },
                                { value: 'stripes', label: 'env.stripes' },
                                { value: 'radial', label: 'env.radial' },
                            ],
                        },
                        icon: 'lucide:grid-3x3',
                        visibleWhen: () => envState.groundDecoStyle === 'checker',
                    },
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
                    {
                        id: 'env:ground:terrainHeight',
                        kind: 'slider',
                        label: 'env.terrainHeight',
                        control: {
                            bind: 'env.groundTerrainHeight',
                            min: 0,
                            max: 15,
                            step: 0.1,
                        },
                        icon: 'lucide:mountain',
                    },
                    {
                        id: 'env:ground:terrainScale',
                        kind: 'slider',
                        label: 'env.terrainScale',
                        control: {
                            bind: 'env.groundTerrainScale',
                            min: 0.01,
                            max: 5,
                            step: 0.05,
                        },
                        icon: 'lucide:ruler',
                    },
                    {
                        id: 'env:ground:terrainSeed',
                        kind: 'slider',
                        label: 'env.terrainSeed',
                        control: {
                            bind: 'env.groundTerrainSeed',
                            min: 0,
                            max: 9999,
                            step: 1,
                        },
                        icon: 'lucide:hash',
                    },
                    {
                        id: 'env:ground:terrainOctaves',
                        kind: 'slider',
                        label: 'env.terrainOctaves',
                        control: {
                            bind: 'env.groundTerrainOctaves',
                            min: 1,
                            max: 8,
                            step: 1,
                        },
                        icon: 'lucide:layers',
                    },
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
                    {
                        id: 'env:ground:pitch',
                        kind: 'slider',
                        label: 'env.groundPitch',
                        control: { bind: 'env.groundPitch', min: -45, max: 45, step: 1 },
                        icon: 'lucide:arrow-up-down',
                    },
                    {
                        id: 'env:ground:roll',
                        kind: 'slider',
                        label: 'env.groundRoll',
                        control: { bind: 'env.groundRoll', min: -45, max: 45, step: 1 },
                        icon: 'lucide:rotate-cw',
                    },
                    {
                        id: 'env:ground:scrollX',
                        kind: 'slider',
                        label: 'env.groundScrollX',
                        control: {
                            bind: 'env.groundScrollSpeedX',
                            min: -2,
                            max: 2,
                            step: 0.1,
                        },
                        icon: 'lucide:move-right',
                        visibleWhen: () =>
                            envState.groundDecoStyle === 'checker' ||
                            (envState.groundTextureEnabled && !!envState.groundTexture),
                    },
                    {
                        id: 'env:ground:scrollZ',
                        kind: 'slider',
                        label: 'env.groundScrollZ',
                        control: {
                            bind: 'env.groundScrollSpeedZ',
                            min: -2,
                            max: 2,
                            step: 0.1,
                        },
                        icon: 'lucide:move-down',
                        visibleWhen: () =>
                            envState.groundDecoStyle === 'checker' ||
                            (envState.groundTextureEnabled && !!envState.groundTexture),
                    },
                    {
                        id: 'env:ground:infinite',
                        kind: 'toggle',
                        label: 'env.groundInfinite',
                        control: { bind: 'env.groundInfinite' },
                        icon: 'lucide:infinity',
                    },
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
                    {
                        id: 'env:ground:reflectBlend',
                        kind: 'slider',
                        label: 'env.groundReflectBlend',
                        control: {
                            bind: 'env.groundReflectionBlend',
                            min: 0,
                            max: 1,
                            step: 0.05,
                        },
                        icon: 'lucide:blend',
                    },
                    {
                        id: 'env:ground:normalStrength',
                        kind: 'slider',
                        label: 'env.groundNormalStrength',
                        control: {
                            bind: 'env.groundNormalStrength',
                            min: 0,
                            max: 2,
                            step: 0.05,
                        },
                        icon: 'lucide:layers',
                    },
                    // ADR-114 Phase 2: 反射模糊 + 法线扭曲（PBR 专属）
                    {
                        id: 'env:ground:reflectionBlur',
                        kind: 'slider',
                        label: 'env.reflectionBlur',
                        control: {
                            bind: 'env.groundReflectionBlur',
                            min: 0,
                            max: 1,
                            step: 0.05,
                        },
                        icon: 'lucide:droplets',
                        visibleWhen: () => envState.groundPbrEnabled,
                    },
                    {
                        id: 'env:ground:reflectionDistort',
                        kind: 'slider',
                        label: 'env.reflectionDistort',
                        control: {
                            bind: 'env.groundReflectionDistort',
                            min: 0,
                            max: 1,
                            step: 0.05,
                        },
                        icon: 'lucide:waves',
                        visibleWhen: () => envState.groundPbrEnabled,
                    },
                    // ADR-114 Phase 3: 接触阴影（屏幕空间 ray marching 后处理）
                    {
                        id: 'env:ground:contactShadow',
                        kind: 'toggle',
                        label: 'env.contactShadow',
                        control: { bind: 'env.groundContactShadowEnabled' },
                        icon: 'lucide:contact',
                        visibleWhen: () =>
                            envState.reflectionQuality === 'medium' ||
                            envState.reflectionQuality === 'high',
                    },
                    {
                        id: 'env:ground:contactShadowIntensity',
                        kind: 'slider',
                        label: 'env.contactShadowIntensity',
                        control: {
                            bind: 'env.groundContactShadowIntensity',
                            min: 0,
                            max: 1,
                            step: 0.05,
                        },
                        icon: 'lucide:contrast',
                        visibleWhen: () =>
                            envState.groundContactShadowEnabled &&
                            (envState.reflectionQuality === 'medium' ||
                                envState.reflectionQuality === 'high'),
                    },
                    {
                        id: 'env:ground:contactShadowDistance',
                        kind: 'slider',
                        label: 'env.contactShadowDistance',
                        control: {
                            bind: 'env.groundContactShadowDistance',
                            min: 0.1,
                            max: 2,
                            step: 0.05,
                        },
                        icon: 'lucide:ruler',
                        visibleWhen: () =>
                            envState.groundContactShadowEnabled &&
                            (envState.reflectionQuality === 'medium' ||
                                envState.reflectionQuality === 'high'),
                    },
                    {
                        id: 'env:ground:elevationColoring',
                        kind: 'toggle',
                        label: 'env.groundElevationColoring',
                        control: { bind: 'env.groundElevationColoring' },
                        icon: 'lucide:mountain-snow',
                        visibleWhen: () => envState.groundType === 'terrain',
                    },
                ],
            },
        ];
        renderMenu(reflectionSchema, c);

        // ===== PBR 材质（ADR-114）=====
        const pbrSchema: MenuNode[] = [
            {
                id: 'env:ground:pbr',
                kind: 'folder',
                label: 'env.pbr',
                icon: 'lucide:sparkles',
                defaultOpen: false,
                headerToggle: { bind: 'env.groundPbrEnabled' },
                children: [
                    {
                        id: 'env:ground:metallic',
                        kind: 'slider',
                        label: 'env.metallic',
                        control: { bind: 'env.groundMetallic', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:circle-dot',
                    },
                    {
                        id: 'env:ground:roughness',
                        kind: 'slider',
                        label: 'env.roughness',
                        control: { bind: 'env.groundRoughness', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:grid-2x2',
                    },
                ],
            },
        ];
        renderMenu(pbrSchema, c);
    });
}

export function buildWaterLevel(): PopupLevel {
    return _buildLevel(
        t('env.water'),
        (c) => {
            // ===== 水面预设（顶部 chips，一键应用）=====
            const waterSchema: MenuNode[] = [
                {
                    id: 'env:water:presets',
                    kind: 'custom',
                    renderCustom: (cc) => {
                        buildPresetChipGroup(
                            cc,
                            Object.entries(WATER_PRESETS).map(([key, wp]) => ({
                                label: t(WATER_PRESET_I18N[key] ?? wp.label),
                                onClick: () => {
                                    // 水面预设必须同时开启水面：buildWaterPresetEnvState 只映射
                                    // 水色/透明度等参数，不含 waterEnabled。若漏开启，点预设时
                                    // 水面保持关闭（表现为“材质没了”），且持久化把关闭态固化，
                                    // 后续拨开关也因从未建立水面而“没用”。
                                    setEnvState({
                                        ...buildWaterPresetEnvState(wp),
                                        waterEnabled: true,
                                    });
                                    applyWaterPresetToCurrent(wp);
                                    getEnvMenu()?.reRender();
                                },
                            }))
                        );
                    },
                },
                {
                    id: 'env:water:basic',
                    kind: 'folder',
                    label: 'env.basicParams',
                    icon: 'lucide:sliders',
                    defaultOpen: true,
                    children: [
                        {
                            id: 'env:water:level',
                            kind: 'slider',
                            label: 'env.height',
                            control: { bind: 'env.waterLevel', min: -10, max: 30, step: 0.1 },
                            icon: 'lucide:arrow-up',
                        },
                        {
                            id: 'env:water:size',
                            kind: 'slider',
                            label: 'env.range',
                            control: { bind: 'env.waterSize', min: 10, max: 200, step: 5 },
                            icon: 'lucide:maximize',
                        },
                        {
                            id: 'env:water:bigWaveHeight',
                            kind: 'slider',
                            label: 'env.bigWaveHeight',
                            control: { bind: 'env.bigWaveHeight', min: 0, max: 3, step: 0.1 },
                            icon: 'lucide:mountain',
                        },
                        {
                            id: 'env:water:smallWaveHeight',
                            kind: 'slider',
                            label: 'env.smallWaveHeight',
                            control: { bind: 'env.smallWaveHeight', min: 0, max: 3, step: 0.1 },
                            icon: 'lucide:waves',
                        },
                        {
                            id: 'env:water:animSpeed',
                            kind: 'slider',
                            label: 'env.animSpeed',
                            control: {
                                bind: 'env.waterAnimSpeed',
                                min: 0.1,
                                max: 5,
                                step: 0.1,
                                get: (v) => (v as number) ?? 1,
                            },
                            icon: 'lucide:fast-forward',
                        },
                    ],
                },
                {
                    id: 'env:water:colorFog',
                    kind: 'folder',
                    label: 'env.colorAndFog',
                    icon: 'lucide:palette',
                    defaultOpen: false,
                    children: [
                        {
                            id: 'env:water:color',
                            kind: 'colorSlider',
                            label: 'env.waterColor',
                            control: { bind: 'env.waterColor' },
                        },
                        {
                            id: 'env:water:transparency',
                            kind: 'slider',
                            label: 'env.opacity',
                            control: {
                                bind: 'env.waterTransparency',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                            icon: 'lucide:eye',
                        },
                        {
                            id: 'env:water:fogColor',
                            kind: 'colorSlider',
                            label: 'env.waterFogColor',
                            control: { bind: 'env.waterFogColor' },
                        },
                        {
                            id: 'env:water:fogDensity',
                            kind: 'slider',
                            label: 'env.waterFogDensity',
                            control: {
                                bind: 'env.waterFogDensity',
                                min: 0,
                                max: 0.05,
                                step: 0.001,
                            },
                            icon: 'lucide:cloud-fog',
                        },
                        {
                            id: 'env:water:skyColorBlend',
                            kind: 'slider',
                            label: 'env.waterSkyColorBlend',
                            control: {
                                bind: 'env.waterSkyColorBlend',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                            icon: 'lucide:cloud',
                        },
                    ],
                },
                // —— 波浪与菲涅尔（从原"高级参数"拆出）——
                {
                    id: 'env:water:waveFresnel',
                    kind: 'folder',
                    label: 'env.waveFresnel',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    children: [
                        {
                            id: 'env:water:fresnelBias',
                            kind: 'slider',
                            label: 'env.fresnelBias',
                            control: { bind: 'env.fresnelBias', min: 0, max: 1, step: 0.01 },
                        },
                        {
                            id: 'env:water:fresnelPower',
                            kind: 'slider',
                            label: 'env.fresnelPower',
                            control: { bind: 'env.fresnelPower', min: 0.5, max: 8, step: 0.1 },
                        },
                        {
                            id: 'env:water:fresnelAlpha',
                            kind: 'slider',
                            label: 'env.fresnelAlpha',
                            control: {
                                bind: 'env.fresnelAlphaInfluence',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:diffuseStrength',
                            kind: 'slider',
                            label: 'env.diffuseStrength',
                            control: { bind: 'env.diffuseStrength', min: 0, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:ambientStrength',
                            kind: 'slider',
                            label: 'env.ambientStrength',
                            control: { bind: 'env.ambientStrength', min: 0, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:rippleNormal',
                            kind: 'slider',
                            label: 'env.rippleNormal',
                            control: {
                                bind: 'env.rippleNormalStrength',
                                min: 0,
                                max: 2,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:rippleGlint',
                            kind: 'slider',
                            label: 'env.rippleGlint',
                            control: {
                                bind: 'env.rippleGlintStrength',
                                min: 0,
                                max: 2,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:normalStrength',
                            kind: 'slider',
                            label: 'env.waterNormalStrength',
                            control: {
                                bind: 'env.waterNormalStrength',
                                min: 0,
                                max: 1.5,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:glintStrength',
                            kind: 'slider',
                            label: 'env.waterGlintStrength',
                            control: {
                                bind: 'env.waterGlintStrength',
                                min: 0,
                                max: 2,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:horizonFade',
                            kind: 'slider',
                            label: 'env.waterHorizonFade',
                            icon: 'lucide:mountain',
                            control: {
                                bind: 'env.waterHorizonFade',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                    ],
                },
                // —— 焦散（密度 + 颜色 + 滚动 + 翻转）——
                {
                    id: 'env:water:caustics',
                    kind: 'folder',
                    label: 'env.caustics',
                    icon: 'lucide:sun',
                    defaultOpen: false,
                    children: [
                        {
                            id: 'env:water:causticIntensity',
                            kind: 'slider',
                            label: 'env.causticIntensity',
                            control: {
                                bind: 'env.causticIntensity',
                                min: 0,
                                max: 0.5,
                                step: 0.01,
                            },
                            icon: 'lucide:sun',
                        },
                        {
                            id: 'env:water:causticColor1',
                            kind: 'colorSlider',
                            label: 'env.causticColor1',
                            control: { bind: 'env.causticColor1' },
                        },
                        {
                            id: 'env:water:causticColor2',
                            kind: 'colorSlider',
                            label: 'env.causticColor2',
                            control: { bind: 'env.causticColor2' },
                        },
                        {
                            id: 'env:water:causticScrollX',
                            kind: 'slider',
                            label: 'env.causticScrollX',
                            control: { bind: 'env.causticScrollX', min: -2, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:causticScrollY',
                            kind: 'slider',
                            label: 'env.causticScrollY',
                            control: { bind: 'env.causticScrollY', min: -2, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:fogOpacity',
                            kind: 'slider',
                            label: 'env.waterFogOpacityInfluence',
                            control: {
                                bind: 'env.waterFogOpacityInfluence',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:flip',
                            kind: 'toggle',
                            label: 'env.waterFlip',
                            control: { bind: 'env.waterFlip' },
                        },
                    ],
                },
                {
                    id: 'env:water:underwater',
                    kind: 'folder',
                    label: 'env.underwaterEffects',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    children: [
                        {
                            id: 'env:water:underFogDensity',
                            kind: 'slider',
                            label: 'env.fogDensity',
                            control: {
                                bind: 'env.underwaterFogDensity',
                                min: 0,
                                max: 0.15,
                                step: 0.005,
                            },
                        },
                        {
                            id: 'env:water:toneIntensity',
                            kind: 'slider',
                            label: 'env.toneIntensity',
                            control: {
                                bind: 'env.underwaterToneIntensity',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                            icon: 'lucide:palette',
                        },
                        {
                            id: 'env:water:tintStrength',
                            kind: 'slider',
                            label: 'env.underwaterTintStrength',
                            control: {
                                bind: 'env.underwaterTintStrength',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                            icon: 'lucide:palette',
                        },
                    ],
                },
            ];
            renderMenu(waterSchema, c);
        },
        [
            // —— 质量档位（ADR-130 Phase 2.3）——
            (rc) => {
                const profileSchema: MenuNode[] = [
                    {
                        id: 'env:water:qualityProfile',
                        kind: 'modeSlider',
                        label: 'env.qualityProfile',
                        control: {
                            bind: 'env.qualityProfile',
                            options: [
                                { value: 'high', label: 'env.qualityProfileHigh' },
                                { value: 'medium', label: 'env.qualityProfileMedium' },
                                { value: 'low', label: 'env.qualityProfileLow' },
                            ],
                            onChange: () => {
                                disposeWater();
                                createWater(envState);
                            },
                        },
                        icon: 'lucide:gauge',
                    },
                ];
                renderMenu(profileSchema, rc);
            },
            // —— 反射（ADR-062 P1）——
            (rc) => {
                const reflectionSchema: MenuNode[] = [
                    {
                        id: 'env:water:reflection',
                        kind: 'folder',
                        label: 'env.reflection',
                        icon: 'lucide:mirror',
                        defaultOpen: false,
                        children: [
                            {
                                id: 'env:water:reflectIntensity',
                                kind: 'slider',
                                label: 'env.reflectionIntensity',
                                control: {
                                    bind: 'env.planarReflectBlend',
                                    min: 0,
                                    max: 1,
                                    step: 0.05,
                                },
                                icon: 'lucide:sliders-horizontal',
                            },
                            {
                                id: 'env:water:reflectQuality',
                                kind: 'modeSlider',
                                label: 'env.reflectionQuality',
                                control: {
                                    bind: 'env.reflectionQuality',
                                    options: [
                                        { value: 'high', label: 'env.reflectionQualityHigh' },
                                        { value: 'medium', label: 'env.reflectionQualityMedium' },
                                        { value: 'low', label: 'env.reflectionQualityLow' },
                                        { value: 'off', label: 'env.reflectionQualityOff' },
                                    ],
                                    onChange: () => {
                                        disposeWater();
                                        createWater(envState);
                                    },
                                },
                                icon: 'lucide:gauge',
                            },
                        ],
                    },
                ];
                renderMenu(reflectionSchema, rc);
            },
        ]
    );
}

export function buildWindLevel(): PopupLevel {
    return _buildLevel(t('env.wind'), (c) => {
        const windSchema: MenuNode[] = [
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
            {
                id: 'env:wind:speed',
                kind: 'slider',
                label: 'env.windSpeed',
                control: { bind: 'env.windSpeed', min: 0, max: 10, step: 0.1 },
                icon: 'lucide:gauge',
            },
        ];
        renderMenu(windSchema, c);
    });
}

export function buildCloudLevel(): PopupLevel {
    return _buildLevel(t('env.cloud'), (c) => {
        const cloudSchema: MenuNode[] = [
            {
                id: 'env:cloud:cover',
                kind: 'slider',
                label: 'env.cloudCover',
                control: { bind: 'env.cloudCover', min: 0, max: 1, step: 0.01 },
                icon: 'lucide:cloud',
            },
            {
                id: 'env:cloud:gap',
                kind: 'slider',
                label: 'env.cloudGap',
                control: {
                    bind: 'env.cloudGap',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.1,
                },
                icon: 'lucide:columns',
            },
            {
                id: 'env:cloud:sectionDetail',
                kind: 'sectionTitle',
                label: 'env.cloudDetail',
            },
            {
                id: 'env:cloud:erosion',
                kind: 'slider',
                label: 'env.cloudErosion',
                control: {
                    bind: 'env.cloudErosion',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.4,
                },
                icon: 'lucide:wind',
            },
            {
                id: 'env:cloud:weather',
                kind: 'slider',
                label: 'env.cloudWeatherStrength',
                control: {
                    bind: 'env.cloudWeatherStrength',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.6,
                },
                icon: 'lucide:cloud-sun',
            },
            {
                id: 'env:cloud:height',
                kind: 'slider',
                label: 'env.height',
                control: { bind: 'env.cloudHeight', min: 50, max: 3000, step: 5 },
                icon: 'lucide:arrow-up',
            },
            {
                id: 'env:cloud:scale',
                kind: 'slider',
                label: 'env.scale',
                control: { bind: 'env.cloudScale', min: 0.1, max: 1, step: 0.05 },
                icon: 'lucide:maximize',
            },
            {
                id: 'env:cloud:thickness',
                kind: 'slider',
                label: 'env.thickness',
                control: {
                    bind: 'env.cloudThickness',
                    min: 10,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 60,
                },
                icon: 'lucide:move-vertical',
            },
            {
                id: 'env:cloud:visibility',
                kind: 'slider',
                label: 'env.visibility',
                control: {
                    bind: 'env.cloudVisibility',
                    min: 500,
                    max: 12000,
                    step: 100,
                    get: (v) => (v as number) ?? 8000,
                },
                icon: 'lucide:eye',
            },
            {
                id: 'env:cloud:sectionLighting',
                kind: 'sectionTitle',
                label: 'env.cloudLighting',
            },
            {
                id: 'env:cloud:backlight',
                kind: 'slider',
                label: 'env.cloudBacklight',
                control: {
                    bind: 'env.cloudBacklight',
                    min: 0,
                    max: 1,
                    step: 0.01,
                    get: (v) => (v as number) ?? 0.5,
                },
                icon: 'lucide:sun',
            },
            {
                id: 'env:cloud:powder',
                kind: 'slider',
                label: 'env.cloudPowder',
                control: {
                    bind: 'env.cloudPowder',
                    min: 0,
                    max: 2,
                    step: 0.05,
                    get: (v) => (v as number) ?? 0.8,
                },
                icon: 'lucide:snowflake',
            },
        ];
        renderMenu(cloudSchema, c);
    });
}

export function buildExperimentalLevel(): PopupLevel {
    return _buildLevel(t('env.experimental'), (c) => {
        const expSchema: MenuNode[] = [
            {
                id: 'env:exp:warn',
                kind: 'custom',
                renderCustom: (cc) => {
                    const warning = document.createElement('div');
                    warning.className = 'experimental-warning';
                    warning.innerHTML =
                        '<iconify-icon icon="lucide:alert-triangle" style="margin-right:6px;"></iconify-icon><span>' +
                        t('env.experimentalWarn') +
                        '</span>';
                    cc.appendChild(warning);
                },
            },
        ];
        renderMenu(expSchema, c);
    });
}

export function buildFogLevel(): PopupLevel {
    return _buildLevel(t('env.fog'), (c) => {
        const fogSchema: MenuNode[] = [
            {
                id: 'env:fog:mode',
                kind: 'modeSlider',
                label: 'env.fogMode',
                control: {
                    bind: 'env.fogMode',
                    options: [
                        { value: 'exp2', label: 'EXP2' },
                        { value: 'exp', label: 'EXP' },
                        { value: 'linear', label: 'env.linear' },
                    ],
                },
                icon: 'lucide:layers',
            },
            {
                id: 'env:fog:color',
                kind: 'colorSlider',
                label: 'env.fogColor',
                control: { bind: 'env.fogColor' },
            },
            {
                id: 'env:fog:density',
                kind: 'slider',
                label: 'env.fogDensity',
                control: { bind: 'env.fogDensity', min: 0, max: 0.1, step: 0.001 },
                icon: 'lucide:droplets',
                visibleWhen: () => envState.fogMode !== 'linear',
            },
            {
                id: 'env:fog:start',
                kind: 'slider',
                label: 'env.fogStart',
                control: {
                    bind: 'env.fogStart',
                    min: 0,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 10,
                },
                visibleWhen: () => envState.fogMode === 'linear',
            },
            {
                id: 'env:fog:end',
                kind: 'slider',
                label: 'env.fogEnd',
                control: {
                    bind: 'env.fogEnd',
                    min: 0,
                    max: 200,
                    step: 1,
                    get: (v) => (v as number) ?? 100,
                },
                visibleWhen: () => envState.fogMode === 'linear',
            },
        ];
        renderMenu(fogSchema, c);
    });
}

export function buildShadowLevel(): PopupLevel {
    return _buildLevel(t('env.shadow'), (c) => {
        const shadowSchema: MenuNode[] = [
            {
                id: 'env:shadow:env',
                kind: 'folder',
                label: 'env.envShadow',
                icon: 'lucide:cloud',
                defaultOpen: true,
                children: [
                    {
                        id: 'env:shadow:type',
                        kind: 'modeSlider',
                        label: 'env.shadowType',
                        control: {
                            bind: 'light.shadowType',
                            options: [
                                { value: 'hard', label: 'env.hardShadow' },
                                { value: 'soft', label: 'env.softShadow' },
                                { value: 'pcf', label: 'PCF' },
                            ],
                        },
                        icon: 'lucide:cloud',
                    },
                    {
                        id: 'env:shadow:quality',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            buildPresetChipGroup(
                                cc,
                                [
                                    { label: t('env.low'), value: 512 },
                                    { label: t('env.medium'), value: 1024 },
                                    { label: t('env.high'), value: 2048 },
                                    { label: t('env.ultra'), value: 4096 },
                                ].map((sq) => ({
                                    label: sq.label,
                                    isActive: () => getLightState().shadowResolution === sq.value,
                                    onClick: () => setLightingState({ shadowResolution: sq.value }),
                                }))
                            );
                        },
                    },
                    {
                        id: 'env:shadow:bias',
                        kind: 'slider',
                        label: 'env.shadowBias',
                        control: {
                            bind: 'light.shadowBias',
                            min: 0,
                            max: 0.01,
                            step: 0.0001,
                        },
                        icon: 'lucide:move',
                    },
                    {
                        id: 'env:shadow:cascades',
                        kind: 'slider',
                        label: 'env.shadowCascades',
                        control: { bind: 'light.shadowCascades', min: 2, max: 4, step: 1 },
                        icon: 'lucide:layers',
                    },
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
                    if (ce) {
                        ci.appendChild(ce);
                    }
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
                    slideRow(
                        cc,
                        'lucide:lightbulb',
                        t('env.stageLightShadow'),
                        false,
                        () => {
                            setStatus(t('env.shadowHint'), true);
                        },
                        '→ ' + t('env.sceneMenu')
                    );
                },
            },
        ];
        renderMenu(shadowSchema, c);
    });
}
