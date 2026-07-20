// [doc:architecture] Env Sky Level — 天空功能面板
// 从 env-feature-levels.ts 拆分

import { envState, cardContainer, setStatus, getBrowseDir } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, buildPresetChipGroup, addClearRow } from '../core/ui-helpers';
import { setEnvState } from '../scene/scene';
import { t } from '../core/i18n/t';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import { TIME_OF_DAY_PRESETS } from '../scene/env/env-lighting';
import { applyEnvPreset } from '../scene/env/env-bridge';
import { activeTimeOfDayPreset, setActiveTimeOfDayPreset } from '../core/state';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { _buildLevel, _openTexturePicker } from './env-level-helpers';

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