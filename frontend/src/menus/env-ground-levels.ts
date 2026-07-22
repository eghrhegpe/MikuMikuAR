// [doc:architecture] Env Ground Level — 地面功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addSliderRow, addClearRow, buildPresetChipGroup } from '../core/ui-helpers';
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t';
import { GROUND_PRESETS, buildGroundPresetEnvState } from '../scene/env/env-ground';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel, _openTexturePicker } from './env-level-helpers';
import { getEnvMenu } from './env-menu-state';
import { getSceneMenu } from './scene-menu-state';

/** 预设 key → i18n key 映射 */
const GROUND_PRESET_I18N: Record<string, string> = {
    cleanGray: 'env.groundPresetCleanGray',
    mirrorStage: 'env.groundPresetMirrorStage',
    grass: 'env.groundPresetGrass',
    stoneTile: 'env.groundPresetStoneTile',
    woodStage: 'env.groundPresetWoodStage',
    cyberGrid: 'env.groundPresetCyberGrid',
    metalStage: 'env.groundPresetMetalStage',
};

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
                        visibleWhen: () => !envState.groundInfinite,
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
                    // ADR-072: 文件纹理（草地/石板/沙滩）已移至顶部预设，贴图面板仅保留程序化纹理
                    const texturePresets = [
                        { value: 'wood', label: t('env.wood'), isProc: true },
                        { value: 'marble', label: t('env.marble'), isProc: true },
                        { value: 'concrete', label: t('env.concrete'), isProc: true },
                        { value: 'tile', label: t('env.tile'), isProc: true },
                        { value: 'carpet', label: t('env.carpet'), isProc: true },
                        { value: 'metal', label: t('env.metal'), isProc: true },
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
                                        groundPbrEnabled: true,
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
                                groundOverlay: 'none',
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
                    if (envState.groundProceduralTexture !== 'none') {
                        addSliderRow(
                            cc,
                            t('env.proceduralScale'),
                            envState.groundProceduralScale,
                            0.1,
                            5,
                            0.1,
                            (v) => setEnvState({ groundProceduralScale: v }),
                            'lucide:zoom-in'
                        );
                    }
                },
            },
        ];
        renderMenu(textureSchema, c);

        // ===== 装饰 =====
        const overlaySchema: MenuNode[] = [
            {
                id: 'env:ground:overlay',
                kind: 'folder',
                label: 'env.groundOverlay',
                icon: 'lucide:grid-3x3',
                defaultOpen: true,
                headerToggle: {
                    bind: 'env.groundOverlay',
                    get: (v) => v !== 'none',
                    set: (on) => (on ? 'grid' : 'none'),
                },
                children: [
                    {
                        id: 'env:ground:overlayStyle',
                        kind: 'custom',
                        renderCustom: (cc) => {
                            const overlayPresets = [
                                { value: 'grid', label: t('env.grid') },
                                { value: 'checker', label: t('env.overlayPattern') },
                            ] as const;
                            buildPresetChipGroup(
                                cc,
                                overlayPresets.map((dp) => ({
                                    label: dp.label,
                                    isActive: () => envState.groundOverlay === dp.value,
                                    onClick: () => setEnvState({ groundOverlay: dp.value }),
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
                                { value: 'checker', label: 'env.patternChecker' },
                                { value: 'dots', label: 'env.patternDots' },
                                { value: 'stripes', label: 'env.patternStripes' },
                                { value: 'radial', label: 'env.patternRadial' },
                            ],
                        },
                        icon: 'lucide:grid-3x3',
                        visibleWhen: () => envState.groundOverlay === 'checker',
                    },
                ],
            },
        ];
        renderMenu(overlaySchema, c);

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
                            envState.groundOverlay === 'checker' ||
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
                            envState.groundOverlay === 'checker' ||
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

        // ===== 材质与反射（ADR-114 合并，消除「反射」vs「PBR」边界模糊）=====
        const mergedSchema: MenuNode[] = [
            {
                id: 'env:ground:material',
                kind: 'folder',
                label: 'env.groundMaterial',
                icon: 'lucide:sparkles',
                defaultOpen: false,
                headerToggle: { bind: 'env.groundPbrEnabled' },
                children: [
                    // ── PBR 参数（PBR 开启时显示）──
                    {
                        id: 'env:ground:metallic',
                        kind: 'slider',
                        label: 'env.metallic',
                        control: { bind: 'env.groundMetallic', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:circle-dot',
                        visibleWhen: () => envState.groundPbrEnabled,
                    },
                    {
                        id: 'env:ground:roughness',
                        kind: 'slider',
                        label: 'env.roughness',
                        control: { bind: 'env.groundRoughness', min: 0, max: 1, step: 0.05 },
                        icon: 'lucide:grid-2x2',
                        visibleWhen: () => envState.groundPbrEnabled,
                    },
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
                    // ── 反射（始终显示）──
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
                    // ── 接触阴影（反射质量 ≥ medium）──
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
                    // ── 地形专属（terrain 模式）──
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
        renderMenu(mergedSchema, c);

        // ===== 接触阴影提示（反射质量不足时显示）=====
        const csHintSchema: MenuNode[] = [
            {
                id: 'env:ground:contactShadowHint',
                kind: 'custom',
                visibleWhen: () =>
                    envState.reflectionQuality !== 'medium' &&
                    envState.reflectionQuality !== 'high',
                renderCustom: (cc) => {
                    const hint = document.createElement('div');
                    hint.textContent = t('env.contactShadowHint');
                    hint.style.cssText =
                        'font-size:11px;color:var(--text-dim);padding:4px 12px;opacity:0.7;';
                    cc.appendChild(hint);
                },
            },
        ];
        renderMenu(csHintSchema, c);
    });
}
