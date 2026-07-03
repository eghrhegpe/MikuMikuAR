// [doc:architecture] Scene Render Levels — 渲染/后处理/舞台/灯光/预设弹窗层级
// 从 scene-menu.ts 拆分

import { setStatus, cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import type { RenderState } from '../scene/scene';
import { createIconifyIcon } from '../core/icons';
import {
    addSliderRow,
    addToggleRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
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
} from '../scene/scene';
import {
    GetRenderPresets,
    SaveRenderPreset,
    DeleteRenderPreset,
    SelectSceneSaveFile,
    SaveSceneFile,
    GetPresetScenes,
    GetPresetScenesDir,
    SaveScenePreset,
    DeletePresetScene,
    LoadSceneFile,
} from '../core/wails-bindings';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';

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
            if (scenes.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:12px;color:#fff;text-align:center;padding:24px;';
                empty.textContent = '暂无预设场景，保存场景时自动生成';
                container.appendChild(empty);
                return;
            }

            cardContainer(container, (c) => {
                const navRow = document.createElement('div');
                navRow.className = 'preset-group';
                navRow.style.padding = '8px 14px 10px';
                const prevBtn = document.createElement('button');
                prevBtn.className = 'preset-chip';
                prevBtn.style.flex = '1';
                const prevIcon = createIconifyIcon('lucide:skip-back');
                if (prevIcon) {
                    prevBtn.appendChild(prevIcon);
                }
                prevBtn.appendChild(document.createTextNode(' 上一个'));
                prevBtn.addEventListener('click', async () => {
                    if (scenes.length === 0) return;
                    if (currentPresetIndex < 0) currentPresetIndex = 0;
                    currentPresetIndex = (currentPresetIndex - 1 + scenes.length) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(`✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`, true);
                    }
                });
                const nextBtn = document.createElement('button');
                nextBtn.className = 'preset-chip';
                nextBtn.style.flex = '1';
                nextBtn.appendChild(document.createTextNode('下一个 '));
                const nextIcon = createIconifyIcon('lucide:skip-forward');
                if (nextIcon) {
                    nextBtn.appendChild(nextIcon);
                }
                nextBtn.addEventListener('click', async () => {
                    if (scenes.length === 0) return;
                    if (currentPresetIndex < 0) currentPresetIndex = 0;
                    currentPresetIndex = (currentPresetIndex + 1) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(`✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`, true);
                    }
                });
                navRow.appendChild(prevBtn);
                navRow.appendChild(nextBtn);
                c.appendChild(navRow);

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
                        if (!confirm(`确定删除「${name}」？`)) return;
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

                // 保存场景按钮
                const saveRow = document.createElement('div');
                saveRow.className = 'slide-item';
                const saveIcon = document.createElement('span');
                saveIcon.className = 'slide-icon';
                const saveIconEl = createIconifyIcon('lucide:save');
                if (saveIconEl) saveIcon.appendChild(saveIconEl);
                saveRow.appendChild(saveIcon);
                const saveLabel = document.createElement('span');
                saveLabel.className = 'slide-label';
                saveLabel.textContent = '保存场景';
                saveRow.appendChild(saveLabel);
                saveRow.addEventListener('click', () => {
                    SelectSceneSaveFile().then((path) => {
                        if (!path) return;
                        const json = JSON.stringify(serializeScene(), null, 2);
                        SaveSceneFile(json, path)
                            .then(() => SaveScenePreset(json))
                            .then(() => {
                                setStatus('✓ 场景已保存', true);
                                reRenderSceneMenu();
                            })
                            .catch(() => setStatus('✗ 保存失败', false));
                    });
                });
                c.appendChild(saveRow);
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
            const state = getStageLightState();
            cardContainer(container, (c) => {
                addToggleRow(c, '启用', state.enabled, (v) => {
                    setStageLightState({ enabled: v });
                    reRenderSceneMenu();
                }, 'lucide:power');
                addSliderRow(c, '强度', state.intensity, 0, 2, 0.05, () => {}, 'lucide:sun',
                    (v) => setStageLightState({ intensity: v }));
                addColorSliderRow(c, '颜色', state.color, (v) => setStageLightState({ color: v }));
                addSliderRow(c, '锥角', state.angle, 0.1, 2.0, 0.05, () => {}, 'lucide:circle',
                    (v) => setStageLightState({ angle: v }));
                addSliderRow(c, '衰减', state.exponent, 0, 4, 0.1, () => {}, 'lucide:arrow-down',
                    (v) => setStageLightState({ exponent: v }));
            });
            cardContainer(container, (c) => {
                addSliderRow(c, '水平角度', state.orbitAzimuth, -180, 180, 1, () => {}, 'lucide:refresh-cw',
                    (v) => setStageLightState({ orbitAzimuth: v }));
                addSliderRow(c, '仰角', state.orbitElevation, -90, 90, 1, () => {}, 'lucide:arrow-up-down',
                    (v) => setStageLightState({ orbitElevation: v }));
                addSliderRow(c, '距离', state.orbitDistance, 5, 50, 0.5, () => {}, 'lucide:move',
                    (v) => setStageLightState({ orbitDistance: v }));
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
                    },
                    renderContent: (inner) => {
                        addSliderRow(inner, '强度', state.bloomWeight, 0, 1, 0.05, () => {}, 'lucide:sun',
                            (v) => { setRenderState({ bloomWeight: v }); triggerAutoSave(); });
                        addSliderRow(inner, '阈值', state.bloomThreshold, 0, 1, 0.05, () => {}, 'lucide:sliders',
                            (v) => { setRenderState({ bloomThreshold: v }); triggerAutoSave(); });
                        addSliderRow(inner, '核大小', state.bloomKernel, 16, 256, 2, () => {}, 'lucide:circle',
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

                addSliderRow(c, '景深', state.dofAperture, 0, 1, 0.05, () => {}, 'lucide:camera',
                    (v) => { setRenderState({ dofEnabled: v > 0, dofAperture: v }); triggerAutoSave(); });
                addSliderRow(c, '暗角', state.vignetteDarkness, 0, 1, 0.05, () => {}, 'lucide:circle-dot',
                    (v) => { setRenderState({ vignetteEnabled: v > 0, vignetteDarkness: v }); triggerAutoSave(); });
                addSliderRow(c, '色差', state.chromaticAberrationAmount, 0, 1, 0.05, () => {}, 'lucide:rainbow',
                    (v) => { setRenderState({ chromaticAberrationEnabled: v > 0, chromaticAberrationAmount: v }); triggerAutoSave(); });
                addSliderRow(c, '颗粒', state.grainIntensity, 0, 1, 0.05, () => {}, 'lucide:grid-3x3',
                    (v) => { setRenderState({ grainEnabled: v > 0, grainIntensity: v }); triggerAutoSave(); });
            });
        },
    };
}

export function buildStageLevel(): PopupLevel {
    return {
        label: '舞台',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
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

                addCollapsible(c, {
                    title: '视场角',
                    icon: 'lucide:maximize-2',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, 'FOV', state.fov, 0.3, 2, 0.05, () => {}, 'lucide:maximize-2',
                            (v) => { setRenderState({ fov: v }); triggerAutoSave(); });
                    },
                });

                addCollapsible(c, {
                    title: '背景色',
                    icon: 'lucide:droplet',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        const bgFields: Array<{ label: string; key: 0 | 1 | 2; icon: string }> = [
                            { label: 'R', key: 0, icon: 'lucide:droplet' },
                            { label: 'G', key: 1, icon: 'lucide:droplet' },
                            { label: 'B', key: 2, icon: 'lucide:droplet' },
                        ];
                        for (const f of bgFields) {
                            addSliderRow(inner, f.label, state.bgColor[f.key], 0, 1, 0.01, (v) => {
                                const bg = [...getRenderState().bgColor] as [number, number, number];
                                bg[f.key] = v;
                                setRenderState({ bgColor: bg });
                                triggerAutoSave();
                            }, f.icon);
                        }
                    },
                });
            });
        },
    };
}

// ======== Render Presets ========

const builtinPresets: Record<string, Partial<RenderState>> = {
    standard: {
        bloomEnabled: true, bloomWeight: 0.3, bloomThreshold: 0.6, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false, toneMapping: 1, exposure: 1, contrast: 1.1,
        fov: 0.8, bgColor: [0.12, 0.12, 0.16],
    },
    cartoon: {
        bloomEnabled: true, bloomWeight: 0.5, bloomThreshold: 0.3, bloomKernel: 128,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [0, 0, 0],
        toneMapping: 2, exposure: 1.1, contrast: 1.4, fov: 0.8, bgColor: [0.18, 0.18, 0.22],
    },
    realistic: {
        bloomEnabled: true, bloomWeight: 0.25, bloomThreshold: 0.7, bloomKernel: 64,
        fxaaEnabled: true, outlineEnabled: false, toneMapping: 1, exposure: 1.1, contrast: 1.2,
        fov: 0.7, vignetteEnabled: true, vignetteDarkness: 0.4, dofEnabled: true, dofAperture: 0.15,
        bgColor: [0.08, 0.08, 0.12],
    },
    warm: {
        bloomEnabled: true, bloomWeight: 0.45, bloomThreshold: 0.4, bloomKernel: 96,
        fxaaEnabled: true, outlineEnabled: false, toneMapping: 2, exposure: 1.2, contrast: 1.1,
        fov: 0.8, bgColor: [0.2, 0.15, 0.1],
    },
    cyberpunk: {
        bloomEnabled: true, bloomWeight: 0.7, bloomThreshold: 0.2, bloomKernel: 192,
        fxaaEnabled: true, outlineEnabled: true, outlineColor: [1, 0, 1],
        toneMapping: 4, exposure: 1.4, contrast: 1.6, fov: 0.85,
        vignetteEnabled: true, vignetteDarkness: 0.6,
        chromaticAberrationEnabled: true, chromaticAberrationAmount: 0.25,
        grainEnabled: true, grainIntensity: 0.3,
        bgColor: [0.02, 0.02, 0.06],
    },
};

const PRESET_LABELS: Record<string, string> = {
    standard: '标准', cartoon: '卡通', realistic: '写实', warm: '暖光', cyberpunk: '赛博朋克',
};

export function getBuiltinPreset(name: string): Partial<RenderState> | undefined {
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
                const btn = document.createElement('button');
                btn.className = 'preset-chip';
                btn.textContent = PRESET_LABELS[key] || key;
                btn.addEventListener('click', () => {
                    const preset = getBuiltinPreset(key);
                    if (preset) transitionRenderState(preset, 2000);
                    setStatus(`✓ 预设: ${PRESET_LABELS[key]}`, true);
                });
                chipGroup.appendChild(btn);
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

export function showPresetSaveDialog(): void {
    const name = prompt('输入预设名称：');
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
