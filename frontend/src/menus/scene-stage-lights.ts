// [doc:architecture] Scene Stage Lights — 舞台灯光弹窗层级
// 从 scene-render-levels.ts 拆分

import { setStatus, cardContainer, envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { showConfirm } from '../core/dialog';
import {
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    addSectionTitle,
    addPresetChip,
    addDangerRow,
    addToggleRow,
} from '../core/ui-helpers';
import {
    setStageLightState,
    getStageLights,
    addStageLight,
    removeStageLight,
    getActiveStageLightId,
    setActiveStageLightId,
    type StageLightState,
} from '../scene/scene';
import { buildTransformCard } from './resource-detail-helpers';
import { LIGHTING_PRESETS, PRESET_NAMES } from '../scene/render/lighting-presets';
import { setEnvState } from '../scene/env/env-bridge';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu-state';
import { t } from '../core/i18n/t';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

/** 提取「获取当前活跃灯光 + 读取属性」的公共 bind 工厂，消除 21 处重复 */
function _activeLightBind<T>(key: keyof StageLightState, fallback: T): () => T {
    return () => {
        const s =
            getStageLights().find((l) => l.id === getActiveStageLightId()) ?? getStageLights()[0];
        return (s ? (s[key] as T) : undefined) ?? fallback;
    };
}

// 灯光预设 key 映射（热切换安全：仅存 i18n key，不含中文）
const LIGHTING_PRESET_KEYS: Record<string, string> = {
    'character-portrait': 'scene.lightPreset.characterPortrait',
    'prop-product': 'scene.lightPreset.propProduct',
    'stage-drama': 'scene.lightPreset.stageDrama',
    'dance-performance': 'scene.lightPreset.dancePerformance',
};

// ======== Stage Light ========

function buildStageLightSchema(): MenuNode[] {
    const lights = getStageLights();
    const activeId = getActiveStageLightId();
    const state = lights.find((l) => l.id === activeId) ?? lights[0];

    return [
        // 卡片 1：预设芯片组
        {
            id: 'light:presets',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const chipGroup = document.createElement('div');
                    chipGroup.className = 'preset-group';
                    chipGroup.style.paddingBottom = '4px';
                    const currentPreset = envState.lightingPresetName;
                    for (const name of PRESET_NAMES) {
                        const p = LIGHTING_PRESETS[name];
                        addPresetChip(
                            chipGroup,
                            t(LIGHTING_PRESET_KEYS[name] || p.label),
                            currentPreset === name,
                            () => {
                                setEnvState({ lightingPresetName: name });
                            },
                            {
                                onUpdate: (btn) => {
                                    btn.classList.toggle(
                                        'active',
                                        envState.lightingPresetName === name
                                    );
                                },
                            }
                        );
                    }
                    addPresetChip(
                        chipGroup,
                        t('scene.custom'),
                        false,
                        () => {
                            setEnvState({ lightingPresetName: undefined });
                        },
                        {
                            onUpdate: (btn) => {
                                btn.style.display = envState.lightingPresetName ? '' : 'none';
                                btn.classList.toggle('active', !envState.lightingPresetName);
                            },
                        }
                    );
                    inner.appendChild(chipGroup);
                });
            },
        },
        // 卡片 2：灯光列表
        {
            id: 'light:list',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('scene.lightList'));
                    const chipGroup = document.createElement('div');
                    chipGroup.className = 'preset-group';
                    chipGroup.style.paddingBottom = '4px';
                    for (const light of lights) {
                        const btn = addPresetChip(
                            chipGroup,
                            light.name,
                            light.id === activeId,
                            () => {
                                setActiveStageLightId(light.id);
                                reRenderSceneMenu();
                            }
                        );
                        // 禁用态半透明（active 类管选中态，opacity 管启用态）
                        // 选中 chip 保持全不透明，避免 accent 选中色被冲淡
                        btn.style.opacity = light.enabled || light.id === activeId ? '1' : '0.5';
                    }
                    addPresetChip(
                        chipGroup,
                        '+',
                        false,
                        () => {
                            addStageLight('spot');
                            reRenderSceneMenu();
                        },
                        { icon: 'lucide:plus', title: t('scene.addLight') }
                    );
                    inner.appendChild(chipGroup);
                });
            },
        },
        // 卡片 3：基础参数（条件：有选中灯光）
        {
            id: 'light:basic',
            kind: 'custom',
            visibleWhen: () => !!state,
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: state.name,
                        icon: 'lucide:lightbulb',
                        defaultOpen: true,
                        headerToggle: {
                            value: state.enabled,
                            onChange: (v) => {
                                setStageLightState({ enabled: v }, state.id);
                                getSceneMenu()?.updateControls();
                            },
                            bind: _activeLightBind('enabled', true),
                        },
                        renderContent: (ci) => {
                            addModeSlider(
                                ci,
                                t('scene.type'),
                                [
                                    { value: 'spot', label: t('scene.spot') },
                                    { value: 'point', label: t('scene.point') },
                                    { value: 'directional', label: t('scene.directional') },
                                ],
                                state.type,
                                (v) => {
                                    setStageLightState(
                                        { type: v as 'spot' | 'point' | 'directional' },
                                        state.id
                                    );
                                    reRenderSceneMenu();
                                },
                                'lucide:lightbulb',
                                undefined,
                                {
                                    bind: _activeLightBind('type', 'spot'),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.intensity'),
                                state.intensity,
                                0,
                                2,
                                0.05,
                                () => {},
                                'lucide:sun',
                                (v) => setStageLightState({ intensity: v }, state.id),
                                {
                                    bind: _activeLightBind('intensity', 1),
                                }
                            );
                            addColorSliderRow(
                                ci,
                                t('scene.color'),
                                state.color,
                                (v) => {
                                    setStageLightState({ color: v }, state.id);
                                    getSceneMenu()?.updateControls();
                                },
                                {
                                    bind: _activeLightBind<[number, number, number]>(
                                        'color',
                                        [1, 1, 1]
                                    ),
                                }
                            );
                        },
                    });
                });
            },
        },
        // 卡片 3.5：光锥（真实锥形光柱可视化）
        {
            id: 'light:cone',
            kind: 'custom',
            visibleWhen: () => !!state && state.type === 'spot',
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: t('scene.lightCone'),
                        icon: 'lucide:flashlight',
                        defaultOpen: false,
                        headerToggle: {
                            value: state.coneEnabled,
                            onChange: (v) => {
                                setStageLightState({ coneEnabled: v }, state.id);
                                getSceneMenu()?.updateControls();
                            },
                            bind: _activeLightBind('coneEnabled', false),
                        },
                        renderContent: (ci) => {
                            addSliderRow(
                                ci,
                                t('scene.coneIntensity'),
                                state.coneIntensity,
                                0,
                                2,
                                0.05,
                                () => {},
                                'lucide:sun',
                                (v) => setStageLightState({ coneIntensity: v }, state.id),
                                {
                                    bind: _activeLightBind('coneIntensity', 0.5),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.coneLength'),
                                state.coneLength,
                                1,
                                50,
                                0.5,
                                () => {},
                                'lucide:ruler',
                                (v) => setStageLightState({ coneLength: v }, state.id),
                                {
                                    bind: _activeLightBind('coneLength', 20),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.coneSoftness'),
                                state.coneSoftness,
                                0,
                                1,
                                0.05,
                                () => {},
                                'lucide:circle-dashed',
                                (v) => setStageLightState({ coneSoftness: v }, state.id),
                                {
                                    bind: _activeLightBind('coneSoftness', 0.5),
                                }
                            );
                        },
                    });
                });
            },
        },
        // 卡片 4：Spot 参数
        {
            id: 'light:spot-params',
            kind: 'custom',
            visibleWhen: () => state?.type === 'spot',
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: t('scene.params'),
                        icon: 'lucide:sliders',
                        defaultOpen: false,
                        renderContent: (ci) => {
                            addSliderRow(
                                ci,
                                t('scene.coneAngle'),
                                state.angle,
                                0.1,
                                2.0,
                                0.05,
                                () => {},
                                'lucide:circle',
                                (v) => setStageLightState({ angle: v }, state.id),
                                {
                                    bind: _activeLightBind('angle', 1.0),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.falloff'),
                                state.exponent,
                                0,
                                4,
                                0.1,
                                () => {},
                                'lucide:arrow-down',
                                (v) => setStageLightState({ exponent: v }, state.id),
                                {
                                    bind: _activeLightBind('exponent', 1),
                                }
                            );
                            addCollapsible(ci, {
                                title: t('scene.targetPoint'),
                                icon: 'lucide:target',
                                defaultOpen: false,
                                renderContent: (ci2) => {
                                    addSliderRow(
                                        ci2,
                                        t('scene.targetX'),
                                        state.targetX,
                                        -10,
                                        10,
                                        0.1,
                                        () => {},
                                        'lucide:move-horizontal',
                                        (v) => setStageLightState({ targetX: v }, state.id),
                                        {
                                            bind: _activeLightBind('targetX', 0),
                                        }
                                    );
                                    addSliderRow(
                                        ci2,
                                        t('scene.targetY'),
                                        state.targetY,
                                        0,
                                        15,
                                        0.1,
                                        () => {},
                                        'lucide:move-vertical',
                                        (v) => setStageLightState({ targetY: v }, state.id),
                                        {
                                            bind: _activeLightBind('targetY', 5),
                                        }
                                    );
                                    addSliderRow(
                                        ci2,
                                        t('scene.targetZ'),
                                        state.targetZ,
                                        -10,
                                        10,
                                        0.1,
                                        () => {},
                                        'lucide:move',
                                        (v) => setStageLightState({ targetZ: v }, state.id),
                                        {
                                            bind: _activeLightBind('targetZ', 0),
                                        }
                                    );
                                },
                            });
                        },
                    });
                });
            },
        },
        // 卡片 5：Point 参数
        {
            id: 'light:point-params',
            kind: 'custom',
            visibleWhen: () => state?.type === 'point',
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: t('scene.params'),
                        icon: 'lucide:sliders',
                        defaultOpen: false,
                        renderContent: (ci) => {
                            addSliderRow(
                                ci,
                                t('scene.attenuationDist'),
                                state.range,
                                1,
                                100,
                                0.5,
                                () => {},
                                'lucide:ruler',
                                (v) => setStageLightState({ range: v }, state.id),
                                {
                                    bind: _activeLightBind('range', 10),
                                }
                            );
                        },
                    });
                });
            },
        },
        // 卡片 6：Directional 参数
        {
            id: 'light:dir-params',
            kind: 'custom',
            visibleWhen: () => state?.type === 'directional',
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: t('scene.directionTarget'),
                        icon: 'lucide:compass',
                        defaultOpen: false,
                        renderContent: (ci) => {
                            addSliderRow(
                                ci,
                                t('scene.targetX'),
                                state.targetX,
                                -10,
                                10,
                                0.1,
                                () => {},
                                'lucide:move-horizontal',
                                (v) => setStageLightState({ targetX: v }, state.id),
                                {
                                    bind: _activeLightBind('targetX', 0),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.targetY'),
                                state.targetY,
                                0,
                                15,
                                0.1,
                                () => {},
                                'lucide:move-vertical',
                                (v) => setStageLightState({ targetY: v }, state.id),
                                {
                                    bind: _activeLightBind('targetY', 5),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.targetZ'),
                                state.targetZ,
                                -10,
                                10,
                                0.1,
                                () => {},
                                'lucide:move',
                                (v) => setStageLightState({ targetZ: v }, state.id),
                                {
                                    bind: _activeLightBind('targetZ', 0),
                                }
                            );
                        },
                    });
                });
            },
        },
        // 卡片 7：阴影参数（条件：非 point 灯光）
        {
            id: 'light:shadow',
            kind: 'custom',
            visibleWhen: () => !!state && state.type !== 'point',
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addCollapsible(inner, {
                        title: t('scene.shadow'),
                        icon: 'lucide:cloud',
                        defaultOpen: false,
                        headerToggle: {
                            value: state.shadowEnabled,
                            onChange: (v) => {
                                setStageLightState({ shadowEnabled: v }, state.id);
                                getSceneMenu()?.updateControls();
                            },
                            bind: _activeLightBind('shadowEnabled', false),
                        },
                        renderContent: (ci) => {
                            addModeSlider(
                                ci,
                                t('scene.shadowType'),
                                [
                                    { value: 'hard', label: t('scene.hardShadow') },
                                    { value: 'soft', label: t('scene.softShadow') },
                                    { value: 'pcf', label: 'PCF' },
                                ],
                                state.shadowType,
                                (v) => {
                                    setStageLightState(
                                        { shadowType: v as 'hard' | 'soft' | 'pcf' },
                                        state.id
                                    );
                                },
                                'lucide:cloud',
                                undefined,
                                {
                                    bind: _activeLightBind('shadowType', 'hard'),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.resolution'),
                                state.shadowResolution,
                                256,
                                4096,
                                256,
                                () => {},
                                'lucide:grid-3x3',
                                (v) => setStageLightState({ shadowResolution: v }, state.id),
                                {
                                    bind: _activeLightBind('shadowResolution', 1024),
                                }
                            );
                            addSliderRow(
                                ci,
                                t('scene.shadowBias'),
                                state.shadowBias,
                                0,
                                0.01,
                                0.0001,
                                () => {},
                                'lucide:move',
                                (v) => setStageLightState({ shadowBias: v }, state.id),
                                {
                                    bind: _activeLightBind('shadowBias', 0.001),
                                }
                            );
                        },
                    });
                });
            },
        },
        // 卡片 8：拖拽操控
        {
            id: 'light:transform',
            kind: 'custom',
            visibleWhen: () => !!state,
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                addCollapsible(c, {
                    title: t('model-detail.dragControl'),
                    icon: 'lucide:move-3d',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        buildTransformCard(inner, {
                            id: state.id,
                            kind: 'light',
                            name: state.name,
                        });
                    },
                });
            },
        },
        // 卡片 9：删除按钮（条件：多灯）
        {
            id: 'light:delete',
            kind: 'custom',
            visibleWhen: () => lights.length > 1 && !!state,
            renderCustom: (c) => {
                if (!state) {
                    return;
                }
                cardContainer(c, (inner) => {
                    addDangerRow(
                        inner,
                        'lucide:trash-2',
                        t('scene.deleteLight', { name: state.name }),
                        async () => {
                            if (
                                !(await showConfirm(
                                    t('scene.confirmDeleteLight', { name: state.name })
                                ))
                            ) {
                                return;
                            }
                            if (!getStageLights().find((l) => l.id === state.id)) {
                                reRenderSceneMenu();
                                return;
                            }
                            removeStageLight(state.id);
                            reRenderSceneMenu();
                            setStatus(t('scene.statusLightDeleted'), true);
                        }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildStageLightLevel(): PopupLevel {
    return {
        label: t('scene.stageLight'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildStageLightSchema(), container);
        },
    };
}
