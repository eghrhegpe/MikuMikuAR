// [doc:architecture] Env Preset Levels — 环境预设弹窗层级
// 从 env-menu.ts 拆分

import { envState, cardContainer, setStatus } from '../core/config';
import type { PopupLevel, PopupRow } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { addSliderRow, addSectionTitle, addPresetChip } from '../core/ui-helpers';
import { showPrompt } from '../core/dialog';
import { tryCatchStatus } from '../core/utils';
import {
    setEnvState,
    getEnvSunAngle,
    setEnvSunAngle,
    applyEnvPresetObject,
    transitionRenderState,
    defaultRenderState,
} from '../scene/scene';
import {
    getLightState,
    transitionLighting,
} from '../scene/render/lighting';
import {
    TIME_OF_DAY_PRESETS,
    exportEnvPreset,
    importEnvPreset,
    type EnvPreset,
} from '../scene/env/env-lighting';
import {
    SaveEnvPreset, LoadEnvPreset, ListEnvPresets, DeleteEnvPreset,
} from '../core/wails-bindings';

import { getEnvMenu } from './env-menu';

// ======== User-Saved Env Presets ========

export function snapshotCurrentEnvPreset(label: string): EnvPreset {
    return {
        label,
        skyColorTop: [...envState.skyColorTop] as [number, number, number],
        skyColorBot: [...envState.skyColorBot] as [number, number, number],
        sunAngle: getEnvSunAngle(),
        azimuth: envState.azimuth ?? -45,
    };
}

export function renderUserEnvPresets(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.paddingTop = '4px';
    addSectionTitle(wrapper, '我的预设');

    const listHost = document.createElement('div');
    listHost.style.paddingBottom = '6px';
    wrapper.appendChild(listHost);

    const renderList = async () => {
        listHost.innerHTML = '';
        let entries: { name: string; label: string; createdAt: number }[] = [];
        try {
            entries = await ListEnvPresets();
        } catch (err) {
            console.warn('[env-menu] ListEnvPresets failed:', err);
        }
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '（暂无自定义预设）';
            empty.style.cssText = 'opacity:0.5;font-size:11px;padding:4px 0;';
            listHost.appendChild(empty);
            return;
        }
        entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        for (const e of entries) {
            const row = document.createElement('div');
            row.className = 'cs-row';
            const labelEl = document.createElement('button');
            labelEl.className = 'preset-chip';
            labelEl.textContent = e.label || e.name;
            labelEl.style.flex = '1';
            labelEl.addEventListener('click', async () => {
                const r = await tryCatchStatus(async () => {
                    const json = await LoadEnvPreset(e.name);
                    const preset = importEnvPreset(json);
                    if (!preset) { setStatus('✗ 预设文件格式错误', false); return; }
                    applyEnvPresetObject(preset);
                    return preset;
                }, '✗ 加载预设失败');
                if (r) setStatus(`✓ 已应用预设：${r.label}`, true);
            });
            row.appendChild(labelEl);

            const delBtn = document.createElement('button');
            delBtn.className = 'preset-chip';
            delBtn.style.cssText = 'flex:0 0 auto;padding:0 8px;color:var(--text-dim);';
            delBtn.textContent = '✕';
            delBtn.title = '删除预设';
            delBtn.addEventListener('click', async () => {
                const r = await tryCatchStatus(async () => {
                    await DeleteEnvPreset(e.name);
                    return true;
                }, '✗ 删除预设失败');
                if (r) {
                    setStatus(`✓ 已删除预设：${e.label}`, true);
                    renderList();
                }
            });
            row.appendChild(delBtn);
            listHost.appendChild(row);
        }
    };

    const saveRow = document.createElement('div');
    saveRow.className = 'cs-row';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'preset-chip';
    saveBtn.style.flex = '1';
    saveBtn.textContent = '＋ 保存当前为预设';
    saveBtn.addEventListener('click', async () => {
        const name = await showPrompt('请输入预设名称（用作文件名，仅限字母数字/_/-/中文）');
        if (!name) return;
        const r = await tryCatchStatus(async () => {
            const preset = snapshotCurrentEnvPreset(name);
            const json = exportEnvPreset(preset);
            await SaveEnvPreset(name, json);
            return true;
        }, '✗ 保存预设失败');
        if (r) {
            setStatus(`✓ 已保存预设：${name}`, true);
            renderList();
        }
    });
    saveRow.appendChild(saveBtn);
    wrapper.appendChild(saveRow);

    container.appendChild(wrapper);
    renderList();
}

// ======== Env Preset Config ========

interface EnvPresetConfig {
    env: Partial<import('../core/config').EnvState>;
    lights?: Partial<import('../scene/scene').LightState>;
    render?: Partial<import('../scene/scene').RenderState>;
}

export const SCENE_PRESETS: Record<string, EnvPresetConfig> = {
    '舞台-A': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.05, 0.05, 0.15], skyColorBot: [0.1, 0.05, 0.15],
            envIntensity: 0.5, groundMode: 'solid', groundColor: [0.05, 0.05, 0.08], particleEnabled: false,
        },
        lights: { hemiIntensity: 0.4, dirIntensity: 0.6, dirColor: [1, 0.85, 0.7], shadowEnabled: true, shadowType: 'soft' },
        render: { vignetteEnabled: true, vignetteDarkness: 0.3, exposure: 1.2 },
    },
    '户外晴天': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.3, 0.6, 1], skyColorBot: [0.6, 0.8, 1],
            skyBrightness: 2, envIntensity: 1.5, groundMode: 'grid', groundColor: [0.3, 0.35, 0.3],
        },
        lights: { hemiIntensity: 1, dirIntensity: 1.2, dirColor: [1, 0.95, 0.85], shadowEnabled: true, shadowType: 'pcf' },
        render: { exposure: 1.4, toneMapping: 1 },
    },
    '演唱会': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.4, 0.1, 0.6], skyColorMid: [0.2, 0.05, 0.4],
            skyColorBot: [0.1, 0.02, 0.2], envIntensity: 0.3, groundMode: 'solid',
            groundColor: [0.05, 0.02, 0.1], particleEnabled: true, particleType: 'fireworks',
        },
        lights: { hemiIntensity: 0.3, dirIntensity: 0.5, dirColor: [0.6, 0.3, 0.8], hemiColor: [0.3, 0.1, 0.5], shadowEnabled: false },
        render: { vignetteEnabled: true, vignetteDarkness: 0.5, exposure: 0.9, toneMapping: 1 },
    },
    '摄影棚': {
        env: {
            skyMode: 'color', skyColorTop: [0.4, 0.4, 0.45], skyColorBot: [0.25, 0.25, 0.3],
            envIntensity: 0.8, groundMode: 'solid', groundColor: [0.1, 0.1, 0.12], particleEnabled: false,
        },
        lights: { hemiIntensity: 0.6, dirIntensity: 0.8, dirColor: [1, 0.95, 0.9], shadowEnabled: true, shadowType: 'soft' },
        render: { exposure: 1.0, toneMapping: 1 },
    },
    '黄昏柔光': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.9, 0.45, 0.2], skyColorBot: [0.6, 0.2, 0.1],
            skyBrightness: 1.2, envIntensity: 0.7, groundMode: 'solid', groundColor: [0.3, 0.15, 0.08], particleEnabled: false,
        },
        lights: { hemiIntensity: 0.5, dirIntensity: 0.6, dirColor: [0.9, 0.5, 0.3], shadowEnabled: true, shadowType: 'soft' },
        render: { vignetteEnabled: true, vignetteDarkness: 0.2, exposure: 0.8, toneMapping: 2 },
    },
    '雨天': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.25, 0.28, 0.32], skyColorBot: [0.15, 0.18, 0.22],
            skyBrightness: 0.5, envIntensity: 0.4, groundMode: 'solid', groundColor: [0.12, 0.14, 0.16], particleEnabled: true, particleType: 'rain',
        },
        lights: { hemiIntensity: 0.5, dirIntensity: 0.3, dirColor: [0.6, 0.65, 0.7], shadowEnabled: false },
        render: { exposure: 0.7, toneMapping: 4 },
    },
    '樱花季': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.95, 0.85, 0.9], skyColorBot: [0.7, 0.6, 0.75],
            skyBrightness: 1.5, envIntensity: 1.2, groundMode: 'solid', groundColor: [0.5, 0.4, 0.45], particleEnabled: true, particleType: 'sakura',
        },
        lights: { hemiIntensity: 0.8, dirIntensity: 0.9, dirColor: [0.95, 0.85, 0.8], shadowEnabled: true, shadowType: 'pcf' },
        render: { exposure: 1.1, toneMapping: 2 },
    },
    '赛博都市': {
        env: {
            skyMode: 'procedural', skyColorTop: [0.05, 0.02, 0.1], skyColorBot: [0.15, 0.02, 0.2],
            skyBrightness: 0.8, envIntensity: 0.3, groundMode: 'solid', groundColor: [0.08, 0.02, 0.12], particleEnabled: true, particleType: 'fireflies',
        },
        lights: { hemiIntensity: 0.2, dirIntensity: 0.4, dirColor: [0.2, 0.5, 1], shadowEnabled: false },
        render: { exposure: 0.9, toneMapping: 4 },
    },
};

export function buildPresetLevel(): PopupLevel {
    const entries = Object.entries(SCENE_PRESETS);
    return {
        label: '环境预设',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [name, preset] of entries) {
                    addPresetChip(chipGroup, name, false, () => {
                        setEnvState({ ...preset.env });
                        if (preset.lights) {
                            transitionLighting(preset.lights, 2000);
                        }
                        if (preset.render) {
                            transitionRenderState({ ...defaultRenderState(), ...preset.render }, 2000);
                        }
                        getEnvMenu()?.reRender();
                    });
                }
                c.appendChild(chipGroup);
                renderUserEnvPresets(c);
            });
        },
    };
}
