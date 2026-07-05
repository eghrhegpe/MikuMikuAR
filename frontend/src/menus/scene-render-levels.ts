// [doc:architecture] Scene Render Levels — 渲染/后处理/预设场景弹窗层级
// 从 scene-render-levels.ts 拆分
// 子文件: scene-stage-lights.ts, scene-stage-levels.ts, scene-render-presets.ts

import { setStatus, cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import type { RenderState } from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import { showConfirm } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import {
    addSliderRow,
    addToggleRow,
    addModeSlider,
    addCollapsible,
    sliderRow,
    addPresetChip,
} from '../core/ui-helpers';
import {
    triggerAutoSave,
    deserializeScene,
    getRenderState,
    setRenderState,
    transitionRenderState,
} from '../scene/scene';
import {
    GetPresetScenes,
    GetPresetScenesDir,
    DeletePresetScene,
    LoadSceneFile,
} from '../core/wails-bindings';
import { reRenderSceneMenu } from './scene-menu';
import { PRESET_LABELS, getBuiltinPreset } from './scene-render-presets';

// ======== Scene Preset ========

let currentPresetIndex = -1;
let _presetScenes: string[] = [];

async function _loadPresetScene(name: string): Promise<boolean> {
    const r = await tryCatchStatus(async () => {
        const dir = await GetPresetScenesDir();
        const json = await LoadSceneFile(dir + '/' + name);
        await deserializeScene(JSON.parse(json));
        return true;
    }, '✗ 加载预设场景失败');
    if (r) return true;
    return false;
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
                    addPresetChip(chipGroup, label, false, () => {
                        const preset = getBuiltinPreset(key);
                        if (preset) transitionRenderState(preset, 2000);
                        setStatus(`✓ 滤镜: ${label}`, true);
                    });
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
                        const r = await tryCatchStatus(async () => {
                            await DeletePresetScene(name);
                            return true;
                        }, '✗ 删除失败');
                        if (r) {
                            if (currentPresetIndex === i) currentPresetIndex = -1;
                            else if (currentPresetIndex > i) currentPresetIndex--;
                            reRenderSceneMenu();
                            setStatus(`✓ 已删除: ${name}`, true);
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
                        bind: () => getRenderState().bloomEnabled,
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
                }, 'lucide:square', {
                    bind: () => getRenderState().outlineEnabled,
                });

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
                }, 'lucide:scan-line', undefined, {
                    bind: () => {
                        const s = getRenderState();
                        return s.msaaSamples > 1 ? `${s.msaaSamples}x` : s.fxaaEnabled ? 'fxaa' : 'off';
                    },
                });

                sliderRow(c, '景深', state.dofAperture, 0, 1, 0.05, 'lucide:camera',
                    (v) => { setRenderState({ dofEnabled: v > 0, dofAperture: v }); triggerAutoSave(); });
                sliderRow(c, '暗角', state.vignetteDarkness, 0, 1, 0.05, 'lucide:circle-dot',
                    (v) => { setRenderState({ vignetteEnabled: v > 0, vignetteDarkness: v }); triggerAutoSave(); });
                sliderRow(c, '色差', state.chromaticAberrationAmount, 0, 1, 0.05, 'lucide:rainbow',
                    (v) => { setRenderState({ chromaticAberrationEnabled: v > 0, chromaticAberrationAmount: v }); triggerAutoSave(); });
                sliderRow(c, '颗粒', state.grainIntensity, 0, 1, 0.05, 'lucide:grid-3x3',
                    (v) => { setRenderState({ grainEnabled: v > 0, grainIntensity: v }); triggerAutoSave(); });
                sliderRow(c, '锐化', state.sharpenAmount, 0, 1, 0.05, 'lucide:focus',
                    (v) => { setRenderState({ sharpenAmount: v }); triggerAutoSave(); });
                sliderRow(c, '辉光', state.glowIntensity, 0, 1, 0.05, 'lucide:sparkles',
                    (v) => { setRenderState({ glowEnabled: v > 0, glowIntensity: v }); triggerAutoSave(); });
                // SSR — 屏幕空间反射
                addToggleRow(c, '屏幕空间反射', state.ssrEnabled,
                    (v) => { setRenderState({ ssrEnabled: v }); triggerAutoSave(); reRenderSceneMenu(); }, 'lucide:reflect', {
                    bind: () => getRenderState().ssrEnabled,
                });
                if (state.ssrEnabled) {
                    sliderRow(c, '反射强度', state.ssrStrength, 0, 1, 0.05, 'lucide:opacity',
                        (v) => { setRenderState({ ssrStrength: v }); triggerAutoSave(); });
                    sliderRow(c, '边缘衰减', state.ssrFalloff, 0, 1, 0.05, 'lucide:border',
                        (v) => { setRenderState({ ssrFalloff: v }); triggerAutoSave(); });
                    sliderRow(c, '步长', state.ssrStep, 1, 32, 1, 'lucide:ruler',
                        (v) => { setRenderState({ ssrStep: v }); triggerAutoSave(); });
                    sliderRow(c, '厚度容差', state.ssrThickness, 0, 2, 0.1, 'lucide:layers',
                        (v) => { setRenderState({ ssrThickness: v }); triggerAutoSave(); });
                }
                // Reflection Probe — 环境反射探针
                addToggleRow(c, '环境反射', state.reflectionProbeEnabled,
                    (v) => { setRenderState({ reflectionProbeEnabled: v, reflectionIntensity: v ? 1 : 0 }); triggerAutoSave(); }, 'lucide:scan', {
                    bind: () => getRenderState().reflectionProbeEnabled,
                });
                // SSAO — 屏幕空间环境遮蔽
                addToggleRow(c, '环境遮蔽 (SSAO)', state.ssaoEnabled,
                    (v) => { setRenderState({ ssaoEnabled: v }); triggerAutoSave(); reRenderSceneMenu(); }, 'lucide:shadow', {
                    bind: () => getRenderState().ssaoEnabled,
                });
                if (state.ssaoEnabled) {
                    sliderRow(c, '遮蔽强度', state.ssaoStrength, 0, 1, 0.05, 'lucide:circle-half',
                        (v) => { setRenderState({ ssaoStrength: v }); triggerAutoSave(); });
                    sliderRow(c, '遮蔽半径', state.ssaoRadius, 0, 1, 0.05, 'lucide:circle-dot',
                        (v) => { setRenderState({ ssaoRadius: v }); triggerAutoSave(); });
                    sliderRow(c, '采样数', state.ssaoSamples, 4, 32, 1, 'lucide:grid-3x3',
                        (v) => { setRenderState({ ssaoSamples: v }); triggerAutoSave(); });
                }
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
                        }, 'lucide:palette', undefined, {
                            bind: () => getRenderState().toneMapping,
                        });
                        addSliderRow(inner, '曝光', state.exposure, 0, 4, 0.05, () => {}, 'lucide:lightbulb',
                            (v) => { setRenderState({ exposure: v }); triggerAutoSave(); }, {
                            bind: () => getRenderState().exposure,
                        });
                        addSliderRow(inner, '对比度', state.contrast, 0, 4, 0.05, () => {}, 'lucide:contrast',
                            (v) => { setRenderState({ contrast: v }); triggerAutoSave(); }, {
                            bind: () => getRenderState().contrast,
                        });
                    },
                });
            });
        },
    };
}

