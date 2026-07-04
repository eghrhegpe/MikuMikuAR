// [doc:architecture] Scene Render Levels — 渲染/后处理/舞台/灯光/预设弹窗层级
// 从 scene-menu.ts 拆分

import { setStatus, cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import type { RenderState } from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import { showConfirm, showPrompt } from '../core/dialog';
import {
    addSliderRow,
    addToggleRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    sliderRow,
    slideRow,
} from '../core/ui-helpers';
import {
    triggerAutoSave,
    serializeScene,
    deserializeScene,
    getRenderState,
    setRenderState,
    transitionRenderState,
    getStageLightState,
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
import {
    GetRenderPresets,
    SaveRenderPreset,
    SelectSceneSaveFile,
    SaveSceneFile,
    GetPresetScenes,
    GetPresetScenesDir,
    SaveScenePreset,
    DeletePresetScene,
    LoadSceneFile,
} from '../core/wails-bindings';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { loadPMXFile } from '../scene/scene';
import { buildPropLevel } from './scene-prop-levels';
import { modelRegistry } from '../core/config';
import {
    removeModel,
    setModelVisibility,
    setModelPosition,
    setModelScaling,
    setModelRotationY,
    getModelPosition,
    resetModelTransform,
} from '../scene/manager/model-ops';

// ======== Scene Preset ========

let currentPresetIndex = -1;
let _presetScenes: string[] = [];

async function _loadPresetScene(name: string): Promise<boolean> {
    try {
        const dir = await GetPresetScenesDir();
        const json = await LoadSceneFile(dir + '/' + name);
        await deserializeScene(JSON.parse(json));
        return true;
    } catch (err) {
        console.error('Load preset scene failed:', err);
        setStatus('✗ 加载预设场景失败', false);
        return false;
    }
}

export function buildPresetScenesLevel(): PopupLevel {
    return {
        label: '预设场景',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            const loading = document.createElement('div');
            loading.style.cssText = 'font-size:12px;color:#fff;text-align:center;padding:24px;';
            loading.textContent = '加载中…';
            container.appendChild(loading);
            currentPresetIndex = -1;
            _presetScenes = (await GetPresetScenes()) || [];
            container.innerHTML = '';
            const scenes = _presetScenes;

            // 快速渲染滤镜芯片组
            cardContainer(container, (c) => {
                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [key, label] of Object.entries(PRESET_LABELS)) {
                    const btn = document.createElement('button');
                    btn.className = 'preset-chip';
                    btn.textContent = label;
                    btn.addEventListener('click', () => {
                        const preset = getBuiltinPreset(key);
                        if (preset) transitionRenderState(preset, 2000);
                        setStatus(`✓ 滤镜: ${label}`, true);
                    });
                    chipGroup.appendChild(btn);
                }
                c.appendChild(chipGroup);
            });

            if (scenes.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:12px;color:#fff;text-align:center;padding:24px;';
                empty.textContent = '暂无预设场景，保存场景时自动生成';
                container.appendChild(empty);
                return;
            }

            cardContainer(container, (c) => {
                for (let i = 0; i < scenes.length; i++) {
                    const name = scenes[i];
                    const isActive = i === currentPresetIndex;
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const is = document.createElement('span');
                    is.className = 'slide-icon';
                    const ie = createIconifyIcon(isActive ? 'lucide:play-circle' : 'lucide:bookmark');
                    if (ie) is.appendChild(ie);
                    row.appendChild(is);
                    const ls = document.createElement('span');
                    ls.className = 'slide-label';
                    ls.textContent = name;
                    row.appendChild(ls);
                    const delBtn = document.createElement('span');
                    delBtn.textContent = '✕';
                    delBtn.title = '删除此预设场景';
                    delBtn.style.cssText = 'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;';
                    delBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!(await showConfirm(`确定删除「${name}」？`))) return;
                        try {
                            await DeletePresetScene(name);
                            if (currentPresetIndex === i) currentPresetIndex = -1;
                            else if (currentPresetIndex > i) currentPresetIndex--;
                            reRenderSceneMenu();
                            setStatus(`✓ 已删除: ${name}`, true);
                        } catch {
                            setStatus('✗ 删除失败', false);
                        }
                    });
                    row.appendChild(delBtn);
                    row.addEventListener('click', async () => {
                        currentPresetIndex = i;
                        if (await _loadPresetScene(name)) {
                            reRenderSceneMenu();
                            setStatus(`✓ 已加载: ${name}`, true);
                        }
                    });
                    c.appendChild(row);
                }
            });
        },
    };
}

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

            // —— 灯列表 ——
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.className = 'section-title';
                title.textContent = '灯光列表';
                c.appendChild(title);

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
                    reRenderSceneMenu();
                }},
                renderContent: (inner) => {
                    addModeSlider(inner, '类型', [
                        { value: 'spot', label: '聚光灯' },
                        { value: 'point', label: '点光源' },
                        { value: 'directional', label: '平行光' },
                    ], state.type, (v) => {
                        setStageLightState({ type: v as 'spot' | 'point' | 'directional' }, state.id);
                        reRenderSceneMenu();
                    }, 'lucide:lightbulb');
                    addSliderRow(inner, '强度', state.intensity, 0, 2, 0.05, () => {}, 'lucide:sun',
                        (v) => setStageLightState({ intensity: v }, state.id));
                    addColorSliderRow(inner, '颜色', state.color, (v) => setStageLightState({ color: v }, state.id));
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
                            (v) => setStageLightState({ angle: v }, state.id));
                        addSliderRow(inner, '衰减', state.exponent, 0, 4, 0.1, () => {}, 'lucide:arrow-down',
                            (v) => setStageLightState({ exponent: v }, state.id));
                        addCollapsible(inner, {
                            title: '目标点',
                            icon: 'lucide:target',
                            defaultOpen: false,
                            renderContent: (inner2) => {
                                addSliderRow(inner2, '目标 X', state.targetX, -10, 10, 0.1, () => {}, 'lucide:move-horizontal',
                                    (v) => setStageLightState({ targetX: v }, state.id));
                                addSliderRow(inner2, '目标 Y', state.targetY, 0, 15, 0.1, () => {}, 'lucide:move-vertical',
                                    (v) => setStageLightState({ targetY: v }, state.id));
                                addSliderRow(inner2, '目标 Z', state.targetZ, -10, 10, 0.1, () => {}, 'lucide:move',
                                    (v) => setStageLightState({ targetZ: v }, state.id));
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
                            (v) => setStageLightState({ range: v }, state.id));
                    },
                });
            } else if (state.type === 'directional') {
                addCollapsible(container, {
                    title: '方向（目标点）',
                    icon: 'lucide:compass',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '目标 X', state.targetX, -10, 10, 0.1, () => {}, 'lucide:move-horizontal',
                            (v) => setStageLightState({ targetX: v }, state.id));
                        addSliderRow(inner, '目标 Y', state.targetY, 0, 15, 0.1, () => {}, 'lucide:move-vertical',
                            (v) => setStageLightState({ targetY: v }, state.id));
                        addSliderRow(inner, '目标 Z', state.targetZ, -10, 10, 0.1, () => {}, 'lucide:move',
                            (v) => setStageLightState({ targetZ: v }, state.id));
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
                    }},
                    renderContent: (inner) => {
                        if (state.shadowEnabled) {
                            addModeSlider(inner, '阴影类型', [
                                { value: 'hard', label: '硬阴影' },
                                { value: 'soft', label: '软阴影' },
                                { value: 'pcf', label: 'PCF' },
                            ], state.shadowType, (v) => {
                                setStageLightState({ shadowType: v as 'hard' | 'soft' | 'pcf' }, state.id);
                            }, 'lucide:cloud');
                            addSliderRow(inner, '分辨率', state.shadowResolution, 256, 4096, 256, () => {}, 'lucide:grid-3x3',
                                (v) => setStageLightState({ shadowResolution: v }, state.id));
                            addSliderRow(inner, '阴影偏移', state.shadowBias, 0, 0.01, 0.0001, () => {}, 'lucide:move',
                                (v) => setStageLightState({ shadowBias: v }, state.id));
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
                        (v) => setStageLightState({ orbitAzimuth: v }, state.id));
                    addSliderRow(inner, '仰角', state.orbitElevation, -90, 90, 1, () => {}, 'lucide:arrow-up-down',
                        (v) => setStageLightState({ orbitElevation: v }, state.id));
                    addSliderRow(inner, '距离', state.orbitDistance, 1, 100, 0.5, () => {}, 'lucide:move',
                        (v) => setStageLightState({ orbitDistance: v }, state.id));

                    // 拖拽定位按钮
                    const gizmoActive = isGizmoActive();
                    const gizmoBtn = document.createElement('div');
                    gizmoBtn.className = 'slide-item';
                    const gizmoIcon = document.createElement('span');
                    gizmoIcon.className = 'slide-icon';
                    const gizmoIconEl = createIconifyIcon(gizmoActive ? 'lucide:x' : 'lucide:move-3d');
                    if (gizmoIconEl) gizmoIcon.appendChild(gizmoIconEl);
                    gizmoBtn.appendChild(gizmoIcon);
                    const gizmoLabel = document.createElement('span');
                    gizmoLabel.className = 'slide-label';
                    gizmoLabel.textContent = gizmoActive ? '退出拖拽' : '拖拽定位';
                    gizmoBtn.appendChild(gizmoLabel);
                    gizmoBtn.addEventListener('click', () => {
                        if (gizmoActive) {
                            detachLightGizmo();
                            setStatus('✓ 已退出拖拽模式', true);
                        } else {
                            attachLightGizmo(state.id);
                            setStatus('拖拽坐标轴移动位置，拖拽圆环调整方向', false);
                        }
                        reRenderSceneMenu();
                    });
                    inner.appendChild(gizmoBtn);
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

// ======== Render Menu Levels ========

export function buildRenderLevel(): PopupLevel {
    return {
        label: '渲染',
        dir: '',
        items: [
            { kind: 'folder', label: '后处理', icon: 'sparkles', target: 'scene:render:postprocess' },
            { kind: 'folder', label: '舞台', icon: 'monitor', target: 'scene:render:stage' },
            { kind: 'folder', label: '渲染预设', icon: 'palette', target: 'scene:render:presets' },
        ],
    };
}

export function buildPostProcessLevel(): PopupLevel {
    return {
        label: '后处理',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
            cardContainer(container, (c) => {
                addCollapsible(c, {
                    title: '泛光',
                    icon: 'lucide:sun',
                    defaultOpen: false,
                    headerToggle: {
                        value: state.bloomEnabled,
                        onChange: (v) => {
                            setRenderState({ bloomEnabled: v });
                            triggerAutoSave();
                        },
                    },
                    renderContent: (inner) => {
                        sliderRow(inner, '强度', state.bloomWeight, 0, 1, 0.05, 'lucide:sun',
                            (v) => { setRenderState({ bloomWeight: v }); triggerAutoSave(); });
                        sliderRow(inner, '阈值', state.bloomThreshold, 0, 1, 0.05, 'lucide:sliders',
                            (v) => { setRenderState({ bloomThreshold: v }); triggerAutoSave(); });
                        sliderRow(inner, '核大小', state.bloomKernel, 16, 256, 2, 'lucide:circle',
                            (v) => { setRenderState({ bloomKernel: v }); triggerAutoSave(); });
                    },
                });

                addToggleRow(c, '边缘高亮', state.outlineEnabled, (v) => {
                    setRenderState({ outlineEnabled: v });
                    triggerAutoSave();
                }, 'lucide:square');

                addModeSlider(c, '抗锯齿', [
                    { value: 'off', label: '关闭' },
                    { value: 'fxaa', label: 'FXAA' },
                    { value: '2x', label: '2x' },
                    { value: '4x', label: '4x' },
                    { value: '8x', label: '8x' },
                ], state.msaaSamples > 1 ? `${state.msaaSamples}x` : state.fxaaEnabled ? 'fxaa' : 'off',
                (v) => {
                    const updates: Partial<RenderState> = {};
                    if (v === 'off') { updates.fxaaEnabled = false; updates.msaaSamples = 1; }
                    else if (v === 'fxaa') { updates.fxaaEnabled = true; updates.msaaSamples = 1; }
                    else { updates.fxaaEnabled = false; updates.msaaSamples = parseInt(v); }
                    setRenderState(updates);
                    triggerAutoSave();
                }, 'lucide:scan-line');

                sliderRow(c, '景深', state.dofAperture, 0, 1, 0.05, 'lucide:camera',
                    (v) => { setRenderState({ dofEnabled: v > 0, dofAperture: v }); triggerAutoSave(); });
                sliderRow(c, '暗角', state.vignetteDarkness, 0, 1, 0.05, 'lucide:circle-dot',
                    (v) => { setRenderState({ vignetteEnabled: v > 0, vignetteDarkness: v }); triggerAutoSave(); });
                sliderRow(c, '色差', state.chromaticAberrationAmount, 0, 1, 0.05, 'lucide:rainbow',
                    (v) => { setRenderState({ chromaticAberrationEnabled: v > 0, chromaticAberrationAmount: v }); triggerAutoSave(); });
                sliderRow(c, '颗粒', state.grainIntensity, 0, 1, 0.05, 'lucide:grid-3x3',
                    (v) => { setRenderState({ grainEnabled: v > 0, grainIntensity: v }); triggerAutoSave(); });
                sliderRow(c, '运动模糊', state.motionBlurAmount, 0, 1, 0.05, 'lucide:wind',
                    (v) => { setRenderState({ motionBlurEnabled: v > 0, motionBlurAmount: v }); triggerAutoSave(); });
                sliderRow(c, '锐化', state.sharpenAmount, 0, 1, 0.05, 'lucide:focus',
                    (v) => { setRenderState({ sharpenAmount: v }); triggerAutoSave(); });
                sliderRow(c, '辉光', state.glowIntensity, 0, 1, 0.05, 'lucide:sparkles',
                    (v) => { setRenderState({ glowEnabled: v > 0, glowIntensity: v }); triggerAutoSave(); });
            });

            // 色调映射 — 后处理色彩环节，影响整体画面风格
            cardContainer(container, (c) => {
                addCollapsible(c, {
                    title: '色调映射',
                    icon: 'lucide:palette',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addModeSlider(inner, '模式', [
                            { value: 0, label: '关闭' },
                            { value: 1, label: 'ACES' },
                            { value: 2, label: 'Reinhard' },
                            { value: 3, label: 'Cineon' },
                            { value: 4, label: 'Neutral' },
                        ], state.toneMapping, (v) => {
                            setRenderState({ toneMapping: v });
                            triggerAutoSave();
                            reRenderSceneMenu();
                        }, 'lucide:palette');
                        addSliderRow(inner, '曝光', state.exposure, 0, 4, 0.05, () => {}, 'lucide:lightbulb',
                            (v) => { setRenderState({ exposure: v }); triggerAutoSave(); });
                        addSliderRow(inner, '对比度', state.contrast, 0, 4, 0.05, () => {}, 'lucide:contrast',
                            (v) => { setRenderState({ contrast: v }); triggerAutoSave(); });
                    },
                });
            });
        },
        reRenderCustom: (container) => {
            // 色调映射模式改变 → 更新 mode slider 的显示值
            const toneMapping = getRenderState().toneMapping;
            const labels = ['关闭', 'ACES', 'Reinhard', 'Cineon', 'Neutral'];
            // 遍历所有 card 找色调映射 collapsible 内 label="模式" 的 cs-row
            const wrappers = container.querySelectorAll('.collapsible-wrapper');
            for (const wrapper of Array.from(wrappers) as HTMLElement[]) {
                const csRows = wrapper.querySelectorAll('.cs-row');
                for (const row of Array.from(csRows) as HTMLElement[]) {
                    const label = row.querySelector('.cs-label');
                    if (label && label.textContent === '模式') {
                        const valEl = row.querySelector('.cs-value');
                        if (valEl) valEl.textContent = labels[toneMapping] ?? String(toneMapping);
                        const fill = row.querySelector('.cs-fill') as HTMLElement | null;
                        const thumb = row.querySelector('.cs-thumb') as HTMLElement | null;
                        const pct = toneMapping > 0 ? (toneMapping / 4) * 100 : 0;
                        if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                        if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
                        return;
                    }
                }
            }
        },
    };
}

// ======== 舞台根面板：舞台加载、灯光、道具 ========

export function buildStageLevel(): PopupLevel {
    return {
        label: '舞台',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');

            // —— 卡片 1：功能入口 ——
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:upload', '加载舞台', true, () => {
                    (async () => {
                        try {
                            const { libraryRoot } = await import('../core/config');
                            if (!libraryRoot) {
                                setStatus('✗ 请先在设置中配置模型库目录', false);
                                return;
                            }
                            const { buildLevel } = await import('./library-core');
                            const level = buildLevel(
                                libraryRoot,
                                '舞台',
                                (m) => m.type === 'stage' || m.type === 'scene'
                            );
                            const sm = getSceneMenu();
                            if (sm) sm.push(level);
                        } catch (err) {
                            setStatus('✗ 打开舞台库失败', false);
                            console.error('Stage library error:', err);
                        }
                    })();
                });
                slideRow(c, 'lucide:lightbulb', '舞台灯光', true, () => {
                    const sm = getSceneMenu();
                    if (sm) sm.push(buildStageLightLevel());
                });
                slideRow(c, 'lucide:box', '舞台道具', true, () => {
                    const sm = getSceneMenu();
                    if (sm) sm.push(buildPropLevel());
                });
            });

            // —— 卡片 2：已加载舞台列表 ——
            const stageModels = Array.from(modelRegistry.entries())
                .filter(([, inst]) => inst.kind === 'stage');

            if (stageModels.length > 0) {
                cardContainer(container, (c) => {
                    const title = document.createElement('div');
                    title.className = 'section-title';
                    title.textContent = '已加载舞台';
                    c.appendChild(title);

                    for (const [id, inst] of stageModels) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.style.cursor = 'pointer';

                        // 眼睛 toggle
                        const eyeSpan = document.createElement('span');
                        eyeSpan.className = 'slide-icon';
                        const eyeIcon = createIconifyIcon(
                            inst.visible ? 'lucide:eye' : 'lucide:eye-off'
                        );
                        if (eyeIcon) eyeSpan.appendChild(eyeIcon);
                        eyeSpan.style.cursor = 'pointer';
                        eyeSpan.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const newVis = !inst.visible;
                            setModelVisibility(id, newVis);
                            reRenderSceneMenu();
                            setStatus(newVis ? '✓ 舞台已显示' : '✓ 舞台已隐藏', true);
                        });
                        row.appendChild(eyeSpan);

                        // 名称
                        const label = document.createElement('span');
                        label.className = 'slide-label';
                        label.textContent = inst.name;
                        row.appendChild(label);

                        // 箭头
                        const arrow = document.createElement('span');
                        arrow.className = 'slide-arrow';
                        arrow.textContent = '>';
                        row.appendChild(arrow);

                        // 删除按钮
                        const del = document.createElement('span');
                        del.textContent = '✕';
                        del.style.cssText = 'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;margin-left:4px;';
                        del.title = '卸载此舞台';
                        del.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            if (!(await showConfirm(`确定卸载舞台「${inst.name}」？`))) return;
                            removeModel(id);
                            reRenderSceneMenu();
                            setStatus(`✓ 已卸载: ${inst.name}`, true);
                        });
                        row.appendChild(del);

                        // 点击进入变换面板
                        row.addEventListener('click', () => {
                            const sm = getSceneMenu();
                            if (sm) sm.push(buildStageTransformLevel(id));
                        });

                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement('div');
                    empty.style.cssText = 'font-size:11px;color:var(--text-dim);text-align:center;padding:8px 0;';
                    empty.textContent = '暂无已加载舞台，点击上方加载';
                    c.appendChild(empty);
                });
            }
        },
    };
}

// ======== Stage Transform Panel ========

export function buildStageTransformLevel(id: string): PopupLevel {
    const inst = modelRegistry.get(id);
    const name = inst?.name ?? id;
    const pos = inst ? getModelPosition(id) : [0, 0, 0];
    const scaling = inst?.scaling ?? 1;
    const rotationY = inst?.rotationY ?? 0;

    return {
        label: `舞台: ${name}`,
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // 可见性
                addToggleRow(c, '可见', inst?.visible ?? true, (v) => {
                    setModelVisibility(id, v);
                }, 'lucide:eye');

                // 位置
                const posFields: Array<{ label: string; key: 0 | 1 | 2; icon: string }> = [
                    { label: 'X', key: 0, icon: 'lucide:move-horizontal' },
                    { label: 'Y', key: 1, icon: 'lucide:move-vertical' },
                    { label: 'Z', key: 2, icon: 'lucide:move' },
                ];
                for (const f of posFields) {
                    addSliderRow(c, f.label, pos[f.key], -50, 50, 0.5, () => {}, f.icon,
                        (v) => {
                            const p = getModelPosition(id);
                            p[f.key] = v;
                            setModelPosition(id, p[0], p[1], p[2]);
                        });
                }

                // 缩放
                addSliderRow(c, '缩放', scaling, 0.1, 10, 0.1, () => {}, 'lucide:maximize',
                    (v) => setModelScaling(id, v));

                // 旋转 Y
                addSliderRow(c, '旋转 Y', rotationY, -Math.PI, Math.PI, 0.05, () => {}, 'lucide:rotate-cw',
                    (v) => setModelRotationY(id, v));
            });

            // —— 重置 + 删除 ——
            cardContainer(container, (c) => {
                const resetRow = document.createElement('div');
                resetRow.className = 'slide-item';
                const resetIcon = document.createElement('span');
                resetIcon.className = 'slide-icon';
                const resetIconEl = createIconifyIcon('lucide:rotate-ccw');
                if (resetIconEl) resetIcon.appendChild(resetIconEl);
                resetRow.appendChild(resetIcon);
                const resetLabel = document.createElement('span');
                resetLabel.className = 'slide-label';
                resetLabel.textContent = '重置变换';
                resetRow.appendChild(resetLabel);
                resetRow.addEventListener('click', () => {
                    resetModelTransform(id);
                    reRenderSceneMenu();
                    setStatus('✓ 舞台变换已重置', true);
                });
                c.appendChild(resetRow);

                const delRow = document.createElement('div');
                delRow.className = 'slide-item';
                delRow.style.color = '#ff6b6b';
                const delIcon = document.createElement('span');
                delIcon.className = 'slide-icon';
                const delIconEl = createIconifyIcon('lucide:trash-2');
                if (delIconEl) delIcon.appendChild(delIconEl);
                delRow.appendChild(delIcon);
                const delLabel = document.createElement('span');
                delLabel.className = 'slide-label';
                delLabel.textContent = '卸载此舞台';
                delRow.appendChild(delLabel);
                delRow.addEventListener('click', async () => {
                    if (!(await showConfirm(`确定卸载舞台「${name}」？`))) return;
                    removeModel(id);
                    const sm = getSceneMenu();
                    if (sm) sm.pop();
                    reRenderSceneMenu();
                    setStatus(`✓ 已卸载: ${name}`, true);
                });
                c.appendChild(delRow);
            });
        },
    };
}

// ======== Render Presets ========

//
// 内置渲染预设 — 6 套，各有独立色调映射模式 + 匹配曝光/后处理
//
// 设计原则：
//   - 曝光 ≥1.5 将亮度推入 HDR 域，使不同 tone mapping 曲线的高光压缩差异可见
//   - 开启 Bloom → 产生 HDR 高亮像素 → tone mapping 的高光滚降特性充分展示
//   - 每套预设锁定一个色调映射模式，配合互补后处理形成鲜明视觉风格
//
const builtinPresets: Record<string, Partial<RenderState>> = {
    // --- reference：Standard 色调映射，保守曝光作为基准 ---
    standard: {
        bloomEnabled: true, bloomWeight: 0.3, bloomThreshold: 0.6, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false,
        toneMapping: 0, exposure: 1.0, contrast: 1.0,
    },
    // --- ACES 电影曲线 — 自然高光滚降，暗角增加电影感 ---
    cinematic: {
        bloomEnabled: true, bloomWeight: 0.4, bloomThreshold: 0.5, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false,
        toneMapping: 1, exposure: 2.0, contrast: 1.2,
        vignetteEnabled: true, vignetteDarkness: 0.35,
        motionBlurEnabled: true, motionBlurAmount: 0.3,
    },
    // --- Reinhard — 高饱和·高对比·边缘线框 = 卡通风格 ---
    cartoon: {
        bloomEnabled: true, bloomWeight: 0.5, bloomThreshold: 0.3, bloomKernel: 128,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [0, 0, 0],
        toneMapping: 2, exposure: 2.0, contrast: 1.5,
    },
    // --- ACES + 景深/暗角 — 浅景深电影写实 ---
    realistic: {
        bloomEnabled: true, bloomWeight: 0.25, bloomThreshold: 0.7, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false,
        toneMapping: 1, exposure: 1.5, contrast: 1.15,
        vignetteEnabled: true, vignetteDarkness: 0.5,
        dofEnabled: true, dofAperture: 0.15,
        motionBlurEnabled: true, motionBlurAmount: 0.2,
    },
    // --- Cineon 胶片曲线 + 暖色调背景 ---
    warm: {
        bloomEnabled: true, bloomWeight: 0.45, bloomThreshold: 0.4, bloomKernel: 96,
        fxaaEnabled: true, outlineEnabled: false,
        toneMapping: 3, exposure: 2.2, contrast: 1.3,
    },
    // --- Neutral + 极端后处理 — 赛博朋克风格 ---
    cyberpunk: {
        bloomEnabled: true, bloomWeight: 0.7, bloomThreshold: 0.2, bloomKernel: 192,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [1, 0, 1],
        toneMapping: 4, exposure: 3.0, contrast: 1.6,
        vignetteEnabled: true, vignetteDarkness: 0.6,
        chromaticAberrationEnabled: true, chromaticAberrationAmount: 0.3,
        grainEnabled: true, grainIntensity: 0.4,
    },
};

const PRESET_LABELS: Record<string, string> = {
    standard: '标准', cinematic: '电影', cartoon: '卡通',
    realistic: '写实', warm: '暖光', cyberpunk: '赛博朋克',
};

const PRESET_DESCS: Record<string, string> = {
    standard: 'Standard 色调映射 · 基准参考',
    cinematic: 'ACES 色调映射 · 电影胶片曲线 · 自然高光滚降',
    cartoon: 'Reinhard 色调映射 · 高饱和高对比 · 黑色线框',
    realistic: 'ACES 色调映射 · 浅景深 · 电影暗角',
    warm: 'Cineon 色调映射 · 暖色背景 · 胶片感',
    cyberpunk: 'Neutral 色调映射 · 高光溢出 · 极端后处理',
};

function getBuiltinPreset(name: string): Partial<RenderState> | undefined {
    return builtinPresets[name];
}

export function getPresetName(name: string): string {
    return PRESET_LABELS[name] || name;
}

export function buildPresetsLevel(): PopupLevel {
    return {
        label: '渲染预设',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            const chipGroup = document.createElement('div');
            chipGroup.className = 'preset-group';
            chipGroup.style.paddingBottom = '6px';
            for (const [key] of Object.entries(builtinPresets)) {
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';

                const btn = document.createElement('button');
                btn.className = 'preset-chip';
                btn.textContent = PRESET_LABELS[key] || key;
                btn.addEventListener('click', () => {
                    const preset = getBuiltinPreset(key);
                    if (preset) transitionRenderState(preset, 2000);
                    setStatus(`✓ 预设: ${PRESET_LABELS[key]}`, true);
                });
                wrapper.appendChild(btn);

                const desc = document.createElement('span');
                desc.textContent = PRESET_DESCS[key] || '';
                desc.style.cssText = 'font-size:9px;color:var(--text-dim);opacity:0.7;white-space:nowrap;line-height:1.2;';
                wrapper.appendChild(desc);

                chipGroup.appendChild(wrapper);
            }
            container.appendChild(chipGroup);
            const saveRow = document.createElement('div');
            saveRow.className = 'slide-item';
            {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'slide-icon';
                const iconEl = createIconifyIcon('lucide:save');
                if (iconEl) iconSpan.appendChild(iconEl);
                saveRow.appendChild(iconSpan);
                const labelSpan = document.createElement('span');
                labelSpan.className = 'slide-label';
                labelSpan.textContent = '保存当前为预设';
                saveRow.appendChild(labelSpan);
            }
            saveRow.addEventListener('click', showPresetSaveDialog);
            container.appendChild(saveRow);
            if (Object.keys(userPresets).length > 0) {
                const userChipGroup = document.createElement('div');
                userChipGroup.className = 'preset-group';
                userChipGroup.style.paddingBottom = '6px';
                for (const [name] of Object.entries(userPresets)) {
                    const btn = document.createElement('button');
                    btn.className = 'preset-chip';
                    btn.textContent = name;
                    btn.addEventListener('click', () => {
                        setRenderState(userPresets[name]);
                        setStatus(`✓ 预设: ${name}`, true);
                    });
                    userChipGroup.appendChild(btn);
                }
                container.appendChild(userChipGroup);
            }
        },
    };
}

export async function showPresetSaveDialog(): Promise<void> {
    const name = await showPrompt('输入预设名称：');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const state = getRenderState();
    SaveRenderPreset(trimmed, JSON.stringify(state))
        .then(() => {
            userPresets[trimmed] = state;
            setStatus(`✓ 预设已保存: ${trimmed}`, true);
            const menu = getSceneMenu();
            if (menu) {
                menu.setLevel(menu.levelCount - 1, buildPresetsLevel());
                reRenderSceneMenu();
            }
        })
        .catch((err: unknown) => {
            console.warn('SaveRenderPreset failed:', err);
            setStatus('✗ 保存预设失败', false);
        });
}

export const userPresets: Record<string, Partial<RenderState>> = {};

let _presetsLoaded = false;

export async function loadUserPresets(): Promise<void> {
    if (_presetsLoaded) return;
    _presetsLoaded = true;
    try {
        const presets = await GetRenderPresets();
        if (presets) {
            for (const p of presets) {
                userPresets[p.name] = p.params as unknown as Partial<RenderState>;
            }
        }
    } catch (err) {
        console.warn('loadUserPresets:', err);
    }
}