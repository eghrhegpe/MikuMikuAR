// [doc:architecture] Scene Stage Lights — 舞台灯光弹窗层级
// 从 scene-render-levels.ts 拆分

import { setStatus, cardContainer, envState } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { showConfirm } from '../core/dialog';
import {
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    slideRow,
    addSectionTitle,
    addPresetChip,
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

// ======== Stage Light ========

export function buildStageLightLevel(): PopupLevel {
    return {
        label: '舞台灯光',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const lights = getStageLights();
            const activeId = getActiveStageLightId();
            const state = lights.find(l => l.id === activeId) ?? lights[0];

            // —— 预设芯片组 ——
            cardContainer(container, (c) => {
                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '4px';
                const currentPreset = envState.lightingPresetName;
                for (const name of PRESET_NAMES) {
                    const p = LIGHTING_PRESETS[name];
                    addPresetChip(chipGroup, p.label, currentPreset === name, () => {
                        setEnvState({ lightingPresetName: name });
                    }, {
                        onUpdate: (btn) => {
                            btn.classList.toggle('active', envState.lightingPresetName === name);
                        }
                    });
                }
                // 自定义按钮（清除预设）
                addPresetChip(chipGroup, '自定义', false, () => {
                    setEnvState({ lightingPresetName: undefined });
                }, {
                    onUpdate: (btn) => {
                        btn.style.display = envState.lightingPresetName ? '' : 'none';
                        btn.classList.toggle('active', !envState.lightingPresetName);
                    }
                });
                c.appendChild(chipGroup);
            });

            // —— 灯列表 ——
            cardContainer(container, (c) => {
                addSectionTitle(c, '灯光列表');

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
                addBtn.title = '添加灯光';
                addBtn.addEventListener('click', () => {
                    addStageLight('spot');
                    reRenderSceneMenu();
                });
                chipGroup.appendChild(addBtn);

                c.appendChild(chipGroup);
            });

            if (!state) return;

            // —— 基础卡片（精简）——
            addCollapsible(container, {
                title: state.name,
                icon: 'lucide:lightbulb',
                defaultOpen: false,
                headerToggle: { value: state.enabled, onChange: (v) => {
                    setStageLightState({ enabled: v }, state.id);
                    getSceneMenu()?.updateControls();
                }, bind: () => {
                    const lights = getStageLights();
                    const activeId = getActiveStageLightId();
                    const s = lights.find(l => l.id === activeId) ?? lights[0];
                    return s?.enabled ?? true;
                }},
                renderContent: (inner) => {
                    addModeSlider(inner, '类型', [
                        { value: 'spot', label: '聚光灯' },
                        { value: 'point', label: '点光源' },
                        { value: 'directional', label: '平行光' },
                    ], state.type, (v) => {
                        setStageLightState({ type: v as 'spot' | 'point' | 'directional' }, state.id);
                        reRenderSceneMenu();
                    }, 'lucide:lightbulb', undefined, {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.type ?? 'spot';
                        },
                    });
                    addSliderRow(inner, '强度', state.intensity, 0, 2, 0.05, () => {}, 'lucide:sun',
                        (v) => setStageLightState({ intensity: v }, state.id), {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.intensity ?? 1;
                        },
                    });
                    addColorSliderRow(inner, '颜色', state.color, (v) => { setStageLightState({ color: v }, state.id); getSceneMenu()?.updateControls(); }, {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.color ?? [1, 1, 1];
                        },
                    });
                },
            });

            // —— 参数卡片（按类型动态）——
            if (state.type === 'spot') {
                addCollapsible(container, {
                    title: '参数',
                    icon: 'lucide:sliders',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '锥角', state.angle, 0.1, 2.0, 0.05, () => {}, 'lucide:circle',
                            (v) => setStageLightState({ angle: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.angle ?? 1.0;
                            },
                        });
                        addSliderRow(inner, '衰减', state.exponent, 0, 4, 0.1, () => {}, 'lucide:arrow-down',
                            (v) => setStageLightState({ exponent: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.exponent ?? 1;
                            },
                        });
                        addCollapsible(inner, {
                            title: '目标点',
                            icon: 'lucide:target',
                            defaultOpen: false,
                            renderContent: (inner2) => {
                                addSliderRow(inner2, '目标 X', state.targetX, -10, 10, 0.1, () => {}, 'lucide:move-horizontal',
                                    (v) => setStageLightState({ targetX: v }, state.id), {
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s = lights.find(l => l.id === activeId) ?? lights[0];
                                        return s?.targetX ?? 0;
                                    },
                                });
                                addSliderRow(inner2, '目标 Y', state.targetY, 0, 15, 0.1, () => {}, 'lucide:move-vertical',
                                    (v) => setStageLightState({ targetY: v }, state.id), {
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s = lights.find(l => l.id === activeId) ?? lights[0];
                                        return s?.targetY ?? 5;
                                    },
                                });
                                addSliderRow(inner2, '目标 Z', state.targetZ, -10, 10, 0.1, () => {}, 'lucide:move',
                                    (v) => setStageLightState({ targetZ: v }, state.id), {
                                    bind: () => {
                                        const lights = getStageLights();
                                        const activeId = getActiveStageLightId();
                                        const s = lights.find(l => l.id === activeId) ?? lights[0];
                                        return s?.targetZ ?? 0;
                                    },
                                });
                            },
                        });
                    },
                });
            } else if (state.type === 'point') {
                addCollapsible(container, {
                    title: '参数',
                    icon: 'lucide:sliders',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '衰减距离', state.range, 1, 100, 0.5, () => {}, 'lucide:ruler',
                            (v) => setStageLightState({ range: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.range ?? 10;
                            },
                        });
                    },
                });
            } else if (state.type === 'directional') {
                addCollapsible(container, {
                    title: '方向（目标点）',
                    icon: 'lucide:compass',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '目标 X', state.targetX, -10, 10, 0.1, () => {}, 'lucide:move-horizontal',
                            (v) => setStageLightState({ targetX: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.targetX ?? 0;
                            },
                        });
                        addSliderRow(inner, '目标 Y', state.targetY, 0, 15, 0.1, () => {}, 'lucide:move-vertical',
                            (v) => setStageLightState({ targetY: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.targetY ?? 5;
                            },
                        });
                        addSliderRow(inner, '目标 Z', state.targetZ, -10, 10, 0.1, () => {}, 'lucide:move',
                            (v) => setStageLightState({ targetZ: v }, state.id), {
                            bind: () => {
                                const lights = getStageLights();
                                const activeId = getActiveStageLightId();
                                const s = lights.find(l => l.id === activeId) ?? lights[0];
                                return s?.targetZ ?? 0;
                            },
                        });
                    },
                });
            }

            // —— 阴影卡片 ——
            if (state.type !== 'point') {
                addCollapsible(container, {
                    title: '阴影',
                    icon: 'lucide:cloud',
                    defaultOpen: false,
                    headerToggle: { value: state.shadowEnabled, onChange: (v) => {
                        setStageLightState({ shadowEnabled: v }, state.id);
                        reRenderSceneMenu();
                    }, bind: () => {
                        const lights = getStageLights();
                        const activeId = getActiveStageLightId();
                        const s = lights.find(l => l.id === activeId) ?? lights[0];
                        return s?.shadowEnabled ?? false;
                    }},
                    renderContent: (inner) => {
                        if (state.shadowEnabled) {
                            addModeSlider(inner, '阴影类型', [
                                { value: 'hard', label: '硬阴影' },
                                { value: 'soft', label: '软阴影' },
                                { value: 'pcf', label: 'PCF' },
                            ], state.shadowType, (v) => {
                                setStageLightState({ shadowType: v as 'hard' | 'soft' | 'pcf' }, state.id);
                            }, 'lucide:cloud', undefined, {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find(l => l.id === activeId) ?? lights[0];
                                    return s?.shadowType ?? 'hard';
                                },
                            });
                            addSliderRow(inner, '分辨率', state.shadowResolution, 256, 4096, 256, () => {}, 'lucide:grid-3x3',
                                (v) => setStageLightState({ shadowResolution: v }, state.id), {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find(l => l.id === activeId) ?? lights[0];
                                    return s?.shadowResolution ?? 1024;
                                },
                            });
                            addSliderRow(inner, '阴影偏移', state.shadowBias, 0, 0.01, 0.0001, () => {}, 'lucide:move',
                                (v) => setStageLightState({ shadowBias: v }, state.id), {
                                bind: () => {
                                    const lights = getStageLights();
                                    const activeId = getActiveStageLightId();
                                    const s = lights.find(l => l.id === activeId) ?? lights[0];
                                    return s?.shadowBias ?? 0.001;
                                },
                            });
                        }
                    },
                });
            }

            // —— 轨道卡片 ——
            addCollapsible(container, {
                title: '位置（轨道）',
                icon: 'lucide:orbit',
                defaultOpen: true,
                renderContent: (inner) => {
                    addSliderRow(inner, '水平角度', state.orbitAzimuth, -180, 180, 1, () => {}, 'lucide:refresh-cw',
                        (v) => setStageLightState({ orbitAzimuth: v }, state.id), {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.orbitAzimuth ?? 0;
                        },
                    });
                    addSliderRow(inner, '仰角', state.orbitElevation, -90, 90, 1, () => {}, 'lucide:arrow-up-down',
                        (v) => setStageLightState({ orbitElevation: v }, state.id), {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.orbitElevation ?? 30;
                        },
                    });
                    addSliderRow(inner, '距离', state.orbitDistance, 1, 100, 0.5, () => {}, 'lucide:move',
                        (v) => setStageLightState({ orbitDistance: v }, state.id), {
                        bind: () => {
                            const lights = getStageLights();
                            const activeId = getActiveStageLightId();
                            const s = lights.find(l => l.id === activeId) ?? lights[0];
                            return s?.orbitDistance ?? 10;
                        },
                    });

                    // 拖拽定位按钮
                    const gizmoActive = isGizmoActive();
                    slideRow(inner, gizmoActive ? 'lucide:x' : 'lucide:move-3d', gizmoActive ? '退出拖拽' : '拖拽定位', false, () => {
                        if (gizmoActive) {
                            detachLightGizmo();
                            setStatus('✓ 已退出拖拽模式', true);
                        } else {
                            attachLightGizmo(state.id);
                            setStatus('拖拽坐标轴移动位置，拖拽圆环调整方向', false);
                        }
                        reRenderSceneMenu();
                    });
                },
            });

            // —— 删除按钮 ——
            if (lights.length > 1) {
                cardContainer(container, (c) => {
                    const delRow = document.createElement('div');
                    delRow.className = 'slide-item';
                    delRow.style.color = '#ff6b6b';
                    delRow.style.cursor = 'pointer';
                    const iconSpan = document.createElement('span');
                    iconSpan.className = 'slide-icon';
                    const icon = createIconifyIcon('lucide:trash-2');
                    if (icon) iconSpan.appendChild(icon);
                    delRow.appendChild(iconSpan);
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'slide-label';
                    labelSpan.textContent = `删除「${state.name}」`;
                    delRow.appendChild(labelSpan);
                    delRow.addEventListener('click', async () => {
                        if (!(await showConfirm(`确定删除「${state.name}」？`))) return;
                        removeStageLight(state.id);
                        reRenderSceneMenu();
                        setStatus('✓ 已删除灯光', true);
                    });
                    c.appendChild(delRow);
                });
            }
        },
    };
}
