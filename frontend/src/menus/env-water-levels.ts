// [doc:architecture] Env Water Level — 水面功能面板
// 从 env-feature-levels.ts 拆分

import { envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { buildPresetChipGroup } from '../core/ui-helpers';
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t';
import {
    WATER_PRESETS,
    applyWaterPresetToCurrent,
    buildWaterPresetEnvState,
    disposeWater,
    createWater,
} from '../scene/env/env-water';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel } from './env-level-helpers';
import { getEnvMenu } from './env-menu-state';

/** 预设 key → i18n key 映射 */
const WATER_PRESET_I18N: Record<string, string> = {
    calm: 'env.presetCalm',
    ripple: 'env.presetRipple',
    ocean: 'env.presetOcean',
    storm: 'env.presetStorm',
    tropical: 'env.presetTropical',
};

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