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
import { buildLevel } from './env-level-helpers';
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
    return buildLevel(
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
                            id: 'env:water:anim-speed',
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
                    id: 'env:water:bigWave',
                    kind: 'folder',
                    label: 'env.bigWaveHeight',
                    icon: 'lucide:mountain',
                    defaultOpen: false,
                    headerToggle: { bind: 'env.bigWaveEnabled' },
                    children: [
                        {
                            id: 'env:water:big-wave-height',
                            kind: 'slider',
                            label: 'env.bigWaveHeight',
                            control: { bind: 'env.bigWaveHeight', min: 0, max: 3, step: 0.1 },
                            icon: 'lucide:mountain',
                        },
                    ],
                },
                {
                    id: 'env:water:small-wave',
                    kind: 'folder',
                    label: 'env.smallWaveHeight',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    headerToggle: { bind: 'env.smallWaveEnabled' },
                    children: [
                        {
                            id: 'env:water:small-wave-height',
                            kind: 'slider',
                            label: 'env.smallWaveHeight',
                            control: { bind: 'env.smallWaveHeight', min: 0, max: 3, step: 0.1 },
                            icon: 'lucide:waves',
                        },
                    ],
                },
                {
                    id: 'env:water:color-fog',
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
                            id: 'env:water:fog-color',
                            kind: 'colorSlider',
                            label: 'env.waterFogColor',
                            control: { bind: 'env.waterFogColor' },
                        },
                        {
                            id: 'env:water:fog-start',
                            kind: 'slider',
                            label: 'env.waterFogStart',
                            control: {
                                bind: 'env.waterFogStart',
                                min: 0,
                                max: 500,
                                step: 10,
                            },
                            icon: 'lucide:cloud-fog',
                        },
                        {
                            id: 'env:water:fog-end',
                            kind: 'slider',
                            label: 'env.waterFogEnd',
                            control: {
                                bind: 'env.waterFogEnd',
                                min: 50,
                                max: 1000,
                                step: 10,
                            },
                            icon: 'lucide:cloud-fog',
                        },
                        {
                            id: 'env:water:sky-color-blend',
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
                    id: 'env:water:wave-fresnel',
                    kind: 'folder',
                    label: 'env.waveFresnel',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    children: [
                        {
                            id: 'env:water:fresnel-bias',
                            kind: 'slider',
                            label: 'env.fresnelBias',
                            control: { bind: 'env.fresnelBias', min: 0, max: 1, step: 0.01 },
                        },
                        {
                            id: 'env:water:fresnel-power',
                            kind: 'slider',
                            label: 'env.fresnelPower',
                            control: { bind: 'env.fresnelPower', min: 0.5, max: 8, step: 0.1 },
                        },
                        {
                            id: 'env:water:fresnel-alpha',
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
                            id: 'env:water:diffuse-strength',
                            kind: 'slider',
                            label: 'env.diffuseStrength',
                            control: { bind: 'env.diffuseStrength', min: 0, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:ambient-strength',
                            kind: 'slider',
                            label: 'env.ambientStrength',
                            control: { bind: 'env.ambientStrength', min: 0, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:ripple-slots',
                            kind: 'slider',
                            label: 'env.waterRippleSlots',
                            control: { bind: 'env.waterRippleSlots', min: 16, max: 1024, step: 16 },
                        },
                        {
                            id: 'env:water:ripple-normal',
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
                            id: 'env:water:ripple-glint',
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
                            id: 'env:water:normal-strength',
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
                            id: 'env:water:glint-strength',
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
                            id: 'env:water:low-freq-normal',
                            kind: 'slider',
                            label: 'env.lowFreqNormalStrength',
                            control: {
                                bind: 'env.lowFreqNormalStrength',
                                min: 0,
                                max: 0.5,
                                step: 0.01,
                            },
                        },
                        {
                            id: 'env:water:horizon-fade',
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
                    headerToggle: { bind: 'env.causticEnabled' },
                    children: [
                        {
                            id: 'env:water:caustic-intensity',
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
                            id: 'env:water:caustic-color-1',
                            kind: 'colorSlider',
                            label: 'env.causticColor1',
                            control: { bind: 'env.causticColor1' },
                        },
                        {
                            id: 'env:water:caustic-color-2',
                            kind: 'colorSlider',
                            label: 'env.causticColor2',
                            control: { bind: 'env.causticColor2' },
                        },
                        {
                            id: 'env:water:caustic-scroll-x',
                            kind: 'slider',
                            label: 'env.causticScrollX',
                            control: { bind: 'env.causticScrollX', min: -2, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:caustic-scroll-y',
                            kind: 'slider',
                            label: 'env.causticScrollY',
                            control: { bind: 'env.causticScrollY', min: -2, max: 2, step: 0.05 },
                        },
                        {
                            id: 'env:water:fog-opacity',
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
                            label: 'env.waterFlipEnabled',
                            control: { bind: 'env.waterFlipEnabled' },
                        },
                    ],
                },
                {
                    id: 'env:water:foam',
                    kind: 'folder',
                    label: 'env.foam',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    headerToggle: { bind: 'env.foamEnabled' },
                    children: [
                        {
                            id: 'env:water:foam-threshold',
                            kind: 'slider',
                            label: 'env.foamThreshold',
                            control: {
                                bind: 'env.foamThreshold',
                                min: 0,
                                max: 2,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:foam-intensity',
                            kind: 'slider',
                            label: 'env.foamIntensity',
                            control: {
                                bind: 'env.foamIntensity',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:foam-transition',
                            kind: 'slider',
                            label: 'env.foamTransition',
                            control: {
                                bind: 'env.foamTransitionRange',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:foam-opacity',
                            kind: 'slider',
                            label: 'env.foamOpacity',
                            control: {
                                bind: 'env.foamOpacity',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:foam-noise',
                            kind: 'slider',
                            label: 'env.foamNoise',
                            control: {
                                bind: 'env.foamNoiseStrength',
                                min: 0,
                                max: 1,
                                step: 0.05,
                            },
                        },
                        {
                            id: 'env:water:foam-color',
                            kind: 'colorSlider',
                            label: 'env.foamColor',
                            control: { bind: 'env.foamColor' },
                        },
                    ],
                },
                {
                    id: 'env:water:underwater',
                    kind: 'folder',
                    label: 'env.underwaterEffects',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    headerToggle: { bind: 'env.underwaterEnabled' },
                    children: [
                        {
                            id: 'env:water:tone-intensity',
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
                            id: 'env:water:tint-strength',
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
            return renderMenu(waterSchema, c);
        },
        [
            // —— 质量档位（ADR-130 Phase 2.3）——
            (rc) => {
                const profileSchema: MenuNode[] = [
                    {
                        id: 'env:water:quality-profile',
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
                return renderMenu(profileSchema, rc);
            },
            // —— 反射（ADR-062 P1）——
            (rc) => {
                const reflectionSchema: MenuNode[] = [
                    {
                        id: 'env:water:reflection',
                        kind: 'folder',
                        label: 'env.reflection',
                        icon: 'lucide:rotate-ccw',
                        defaultOpen: false,
                        children: [
                            {
                                id: 'env:water:reflect-intensity',
                                kind: 'slider',
                                label: 'env.reflectionIntensity',
                                control: {
                                    bind: 'env.planarReflectionBlend',
                                    min: 0,
                                    max: 1,
                                    step: 0.05,
                                },
                                icon: 'lucide:sliders-horizontal',
                            },
                        ],
                    },
                ];
                return renderMenu(reflectionSchema, rc);
            },
        ]
    );
}
