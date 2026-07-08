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
    slideRow,
    addSectionTitle,
    addPresetChip,
    addDangerRow,
} from '../core/ui-helpers';
import {
    setStageLightState,
    getStageLights,
    addStageLight,
    removeStageLight,
    getActiveStageLightId,
    setActiveStageLightId,
    attachLightGizmo,
    detachLightGizmo,
    isGizmoActive,
} from '../scene/scene';
import { LIGHTING_PRESETS, PRESET_NAMES } from '../scene/render/lighting-presets';
import { setEnvState } from '../scene/env/env-bridge';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { t } from '../core/i18n/t';

// 灯光预设 key 映射（热切换安全：仅存 i18n key，不含中文）
const LIGHTING_PRESET_KEYS: Record<string, string> = {
    'character-portrait': 'scene.lightPreset.characterPortrait',
    'prop-product': 'scene.lightPreset.propProduct',
    'stage-drama': 'scene.lightPreset.stageDrama',
    'dance-performance': 'scene.lightPreset.dancePerformance',
    'natural-daylight': 'scene.lightPreset.naturalDaylight',
    'night-scene': 'scene.lightPreset.nightScene',
};

// ======== Stage Light ========

export function buildStageLightLevel(): PopupLevel {
    return {
        label: t('scene.stageLight'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const lights = getStageLights();
            const activeId = getActiveStageLightId();
            const state = lights.find((l) => l.id === activeId) ?? lights[0];

            // —— 预设芯片组 ——
            cardContainer(container, (c) => {
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
                // 自定义按钮（清除预设）
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
                c.appendChild(chipGroup);
            });

            // —— 灯列表 ——
            cardContainer(container, (c) => {
                addSectionTitle(c, t('scene.lightList'));

                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '4px';

                for (const light of lights) {
                    const btn = document.createElement('button');
                    btn.className = 'preset-chip';
                    btn.textContent = light.name;
                    if (light.id === activeId) {
                        btn.style.background = 'var(--accent)';
                        btn.style.color = '#fff';
                    }
                    btn.style.opacity = light.enabled ? '1' : '0.5';
                    btn.addEventListener('click', () => {
                        setActiveStageLightId(light.id);
                        reRenderSceneMenu();
                    });
                    chipGroup.appendChild(btn);
                }

                const addBtn = document.createElement('button');
                addBtn.className = 'preset-chip';
                addBtn.textContent = '＋';
                addBtn.title = t('scene.addLight');
                addBtn.addEventListener('click', () => {
                    addStageLight('spot');
                    reRenderSceneMenu();
                });
                chipGroup.appendChild(addBtn);

                c.appendChild(chipGroup);
            });

            if (!state) {
                return;
            }

            // —— 基础卡片（精简）——
            addCollapsible(container, {
                title: state.name,
                icon: 'lucide:lightbulb',
                defaultOpen: false,
                headerToggle: {
                    value: state.enabled,
                    onChange: (v) => {
                        setStageLightState({ enabled: v }, state.id);
                        getSceneMenu()?.updateControls();
                    },
                    bind: () => {
                        const lights = getStageLights();
                        const activeId = getActiveStageLightId();
                        const s = lights.find((l) => l.id === activeId) ?? lights[0];
                        return s?.enabled ?? true;
                    },
                },
                renderContent: (inner) => {
                    addModeSlider(
                        inner,
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
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.type ?? 'spot';
                            },
                        }
                    );
                    addSliderRow(
                        inner,
                        t('scene.intensity'),
                        state.intensity,
                        0,
                        2,
                        0.05,
                        () => {},
                        'lucide:sun',
                        (v) => setStageLightState({ intensity: v }, state.id),
                        {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.intensity ?? 1;
                            },
                        }
                    );
                    addColorSliderRow(
                        inner,
                        t('scene.color'),
                        state.color,
                        (v) => {
                            setStageLightState({ color: v }, state.id);
                            getSceneMenu()?.updateControls();
                        },
                        {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.color ?? [1, 1, 1];
                            },
                        }
                    );
                },
            });

            // —— 参数卡片（按类型动态）——
            if (state.type === 'spot') {
                addCollapsible(container, {
                    title: t('scene.params'),
                    icon: 'lucide:sliders',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            t('scene.coneAngle'),
                            state.angle,
                            0.1,
                            2.0,
                            0.05,
                            () => {},
                            'lucide:circle',
                            (v) => setStageLightState({ angle: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.angle ?? 1.0;
                                },
                            }
                        );
                        addSliderRow(
                            inner,
                            t('scene.falloff'),
                            state.exponent,
                            0,
                            4,
                            0.1,
                            () => {},
                            'lucide:arrow-down',
                            (v) => setStageLightState({ exponent: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.exponent ?? 1;
                                },
                            }
                        );
                        addCollapsible(inner, {
                            title: t('scene.targetPoint'),
                            icon: 'lucide:target',
                            defaultOpen: false,
                            renderContent: (inner2) => {
                                addSliderRow(
                                    inner2,
                                    t('scene.targetX'),
                                    state.targetX,
                                    -10,
                                    10,
                                    0.1,
                                    () => {},
                                    'lucide:move-horizontal',
                                    (v) => setStageLightState({ targetX: v }, state.id),
                                    {
                                        bind: () => {
                                            const lights = getStageLights();
                                            const activeId = getActiveStageLightId();
                                            const s =
                                                lights.find((l) => l.id === activeId) ?? lights[0];
                                            return s?.targetX ?? 0;
                                        },
                                    }
                                );
                                addSliderRow(
                                    inner2,
                                    t('scene.targetY'),
                                    state.targetY,
                                    0,
                                    15,
                                    0.1,
                                    () => {},
                                    'lucide:move-vertical',
                                    (v) => setStageLightState({ targetY: v }, state.id),
                                    {
                                        bind: () => {
                                            const lights = getStageLights();
                                            const activeId = getActiveStageLightId();
                                            const s =
                                                lights.find((l) => l.id === activeId) ?? lights[0];
                                            return s?.targetY ?? 5;
                                        },
                                    }
                                );
                                addSliderRow(
                                    inner2,
                                    t('scene.targetZ'),
                                    state.targetZ,
                                    -10,
                                    10,
                                    0.1,
                                    () => {},
                                    'lucide:move',
                                    (v) => setStageLightState({ targetZ: v }, state.id),
                                    {
                                        bind: () => {
                                            const lights = getStageLights();
                                            const activeId = getActiveStageLightId();
                                            const s =
                                                lights.find((l) => l.id === activeId) ?? lights[0];
                                            return s?.targetZ ?? 0;
                                        },
                                    }
                                );
                            },
                        });
                    },
                });
            } else if (state.type === 'point') {
                addCollapsible(container, {
                    title: t('scene.params'),
                    icon: 'lucide:sliders',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            t('scene.attenuationDist'),
                            state.range,
                            1,
                            100,
                            0.5,
                            () => {},
                            'lucide:ruler',
                            (v) => setStageLightState({ range: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.range ?? 10;
                                },
                            }
                        );
                    },
                });
            } else if (state.type === 'directional') {
                addCollapsible(container, {
                    title: t('scene.directionTarget'),
                    icon: 'lucide:compass',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            t('scene.targetX'),
                            state.targetX,
                            -10,
                            10,
                            0.1,
                            () => {},
                            'lucide:move-horizontal',
                            (v) => setStageLightState({ targetX: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.targetX ?? 0;
                                },
                            }
                        );
                        addSliderRow(
                            inner,
                            t('scene.targetY'),
                            state.targetY,
                            0,
                            15,
                            0.1,
                            () => {},
                            'lucide:move-vertical',
                            (v) => setStageLightState({ targetY: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.targetY ?? 5;
                                },
                            }
                        );
                        addSliderRow(
                            inner,
                            t('scene.targetZ'),
                            state.targetZ,
                            -10,
                            10,
                            0.1,
                            () => {},
                            'lucide:move',
                            (v) => setStageLightState({ targetZ: v }, state.id),
                            {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                    return s?.targetZ ?? 0;
                                },
                            }
                        );
                    },
                });
            }

            // —— 阴影卡片 ——
            if (state.type !== 'point') {
                addCollapsible(container, {
                    title: t('scene.shadow'),
                    icon: 'lucide:cloud',
                    defaultOpen: false,
                    headerToggle: {
                        value: state.shadowEnabled,
                        onChange: (v) => {
                            setStageLightState({ shadowEnabled: v }, state.id);
                            reRenderSceneMenu();
                        },
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find((l) => l.id === activeId) ?? lights[0];
                            return s?.shadowEnabled ?? false;
                        },
                    },
                    renderContent: (inner) => {
                        if (state.shadowEnabled) {
                            addModeSlider(
                                inner,
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
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s =
                                            lights.find((l) => l.id === activeId) ?? lights[0];
                                        return s?.shadowType ?? 'hard';
                                    },
                                }
                            );
                            addSliderRow(
                                inner,
                                t('scene.resolution'),
                                state.shadowResolution,
                                256,
                                4096,
                                256,
                                () => {},
                                'lucide:grid-3x3',
                                (v) => setStageLightState({ shadowResolution: v }, state.id),
                                {
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s =
                                            lights.find((l) => l.id === activeId) ?? lights[0];
                                        return s?.shadowResolution ?? 1024;
                                    },
                                }
                            );
                            addSliderRow(
                                inner,
                                t('scene.shadowBias'),
                                state.shadowBias,
                                0,
                                0.01,
                                0.0001,
                                () => {},
                                'lucide:move',
                                (v) => setStageLightState({ shadowBias: v }, state.id),
                                {
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s =
                                            lights.find((l) => l.id === activeId) ?? lights[0];
                                        return s?.shadowBias ?? 0.001;
                                    },
                                }
                            );
                        }
                    },
                });
            }

            // —— 轨道卡片 ——
            addCollapsible(container, {
                title: t('scene.positionOrbit'),
                icon: 'lucide:orbit',
                defaultOpen: true,
                renderContent: (inner) => {
                    addSliderRow(
                        inner,
                        t('scene.horizontalAngle'),
                        state.orbitAzimuth,
                        -180,
                        180,
                        1,
                        () => {},
                        'lucide:refresh-cw',
                        (v) => setStageLightState({ orbitAzimuth: v }, state.id),
                        {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.orbitAzimuth ?? 0;
                            },
                        }
                    );
                    addSliderRow(
                        inner,
                        t('scene.elevationAngle'),
                        state.orbitElevation,
                        -90,
                        90,
                        1,
                        () => {},
                        'lucide:arrow-up-down',
                        (v) => setStageLightState({ orbitElevation: v }, state.id),
                        {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.orbitElevation ?? 30;
                            },
                        }
                    );
                    addSliderRow(
                        inner,
                        t('scene.distance'),
                        state.orbitDistance,
                        1,
                        100,
                        0.5,
                        () => {},
                        'lucide:move',
                        (v) => setStageLightState({ orbitDistance: v }, state.id),
                        {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find((l) => l.id === activeId) ?? lights[0];
                                return s?.orbitDistance ?? 10;
                            },
                        }
                    );

                    // 拖拽定位按钮
                    const gizmoActive = isGizmoActive();
                    slideRow(
                        inner,
                        gizmoActive ? 'lucide:x' : 'lucide:move-3d',
                        t(gizmoActive ? 'scene.exitDrag' : 'scene.dragPosition'),
                        false,
                        () => {
                            if (gizmoActive) {
                                detachLightGizmo();
                                setStatus(t('scene.statusExitDrag'), true);
                            } else {
                                attachLightGizmo(state.id);
                                setStatus(t('scene.statusDragHint'), false);
                            }
                            reRenderSceneMenu();
                        }
                    );
                },
            });

            // —— 删除按钮 ——
            if (lights.length > 1) {
                cardContainer(container, (c) => {
                    addDangerRow(c, 'lucide:trash-2', t('scene.deleteLight', { name: state.name }), async () => {
                        if (!(await showConfirm(t('scene.confirmDeleteLight', { name: state.name })))) {
                            return;
                        }
                        // 确认期间灯光可能已被其他路径删除
                        if (!getStageLights().find((l) => l.id === state.id)) {
                            reRenderSceneMenu();
                            return;
                        }
                        removeStageLight(state.id);
                        reRenderSceneMenu();
                        setStatus(t('scene.statusLightDeleted'), true);
                    });
                });
            }
        },
    };
}
