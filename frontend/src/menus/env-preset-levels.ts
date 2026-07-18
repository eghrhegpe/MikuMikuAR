// [doc:architecture] Env Preset Levels — 环境预设弹窗层级（ADR-120 分类预设）
// 从 env-menu.ts 拆分
// 4 类预设：sky/ground/water/atmosphere，各类独立保存/加载，互不覆盖

import { envState, cardContainer, setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import { addSectionTitle, addPresetChip } from '../core/ui-helpers';
import { tryCatchStatus, showErrorToast, logWarn } from '../core/utils';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import {
    setEnvState,
    applyEnvPresetByCategory,
    transitionRenderState,
    defaultRenderState,
} from '../scene/scene';
import { transitionLighting } from '../scene/render/lighting';
import {
    snapshotEnvPresetByCategory,
    exportCategorizedEnvPreset,
    importCategorizedEnvPreset,
    type EnvPresetCategory,
    type CategorizedEnvPreset,
} from '../scene/env/env-lighting';
import {
    SaveEnvPresetAuto,
    LoadEnvPreset,
    ListEnvPresets,
    DeleteEnvPreset,
} from '../core/wails-bindings';

import { getEnvMenu } from './env-menu';
import { presetListContent } from './preset-list-viewer';
import { getLang } from '../core/i18n/locale';

// ======== 分类元数据 ========

const CATEGORIES: { id: EnvPresetCategory; labelKey: string }[] = [
    { id: 'sky', labelKey: 'env-preset.category.sky' },
    { id: 'ground', labelKey: 'env-preset.category.ground' },
    { id: 'water', labelKey: 'env-preset.category.water' },
    { id: 'atmosphere', labelKey: 'env-preset.category.atmosphere' },
];

/** [adr-120] 渲染单个分类的用户预设区域：标题 + 保存按钮 + 预设列表。 */
function renderCategorizedPresets(
    container: HTMLElement,
    category: EnvPresetCategory,
    labelKey: string
): void {
    const wrapper = document.createElement('div');
    wrapper.style.paddingTop = '4px';
    addSectionTitle(wrapper, t(labelKey));

    const listHost = document.createElement('div');
    listHost.style.paddingBottom = '6px';
    wrapper.appendChild(listHost);

    const reRender = async () => {
        listHost.innerHTML = '';
        await presetListContent(
            listHost,
            {
                getLabel: (e) => e.label || e.name,
                getKey: (e) => e.name,
                loadItems: async () => {
                    let entries: { name: string; label: string; category: string; createdAt: number }[] = [];
                    try {
                        entries = await ListEnvPresets();
                    } catch (err) {
                        logWarn('env-preset', 'ListEnvPresets failed:', err);
                    }
                    return entries
                        .filter((e) => (e.category || 'sky') === category)
                        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
                },
                onApply: async (e) => {
                    const json = await LoadEnvPreset(e.name);
                    const preset = importCategorizedEnvPreset(json);
                    if (!preset) {
                        setStatus(t('env-preset.formatError'), false);
                        return;
                    }
                    applyEnvPresetByCategory(preset);
                    getEnvMenu()?.reRender();
                    setStatus(t('env-preset.applied', { label: preset.label }), true);
                },
                onDelete: async (e) => {
                    await DeleteEnvPreset(e.name);
                    setStatus(t('env-preset.deleted', { label: e.label }), true);
                    reRender();
                },
                deleteConfirmText: (e) => t('env-preset.confirmDelete', { label: e.label || e.name }),
                emptyText: t('env-preset.noCustom'),
                noCard: true,
            },
            reRender
        );
    };

    const saveRow = document.createElement('div');
    saveRow.className = 'cs-row';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'preset-chip';
    saveBtn.style.flex = '1';
    saveBtn.textContent = t('env-preset.saveCurrentCategory', { category: t(labelKey) });
    saveBtn.addEventListener('click', async () => {
        const autoLabel =
            t(labelKey) +
            ' ' +
            new Date().toLocaleString(getLang(), {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        const r = await tryCatchStatus(
            async () => {
                const preset = snapshotEnvPresetByCategory(autoLabel, category, envState);
                const json = exportCategorizedEnvPreset(preset);
                const filename = await SaveEnvPresetAuto(json);
                return filename;
            },
            t('env-preset.saveFailed'),
            (err) =>
                showErrorToast(
                    t('env-preset.saveErrorToast'),
                    translateGoError(err)
                )
        );
        if (r) {
            setStatus(t('env-preset.saved', { name: r }), true);
            reRender();
        }
    });
    saveRow.appendChild(saveBtn);
    wrapper.appendChild(saveRow);

    container.appendChild(wrapper);
    reRender();
}

// ======== Env Preset Config（场景氛围快速预设，跨类别） ========

interface EnvPresetConfig {
    env: Partial<import('../core/config').EnvState>;
    lights?: Partial<import('../scene/scene').LightState>;
    render?: Partial<import('../scene/scene').RenderState>;
}

export const SCENE_PRESETS: Record<string, EnvPresetConfig> = {
    '舞台-A': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.05, 0.05, 0.15],
            skyColorBot: [0.1, 0.05, 0.15],
            envIntensity: 0.5,
            particleEnabled: false,
        },
        lights: {
            hemiIntensity: 0.4,
            dirIntensity: 0.6,
            dirColor: [1, 0.85, 0.7],
            shadowEnabled: true,
            shadowType: 'soft',
        },
        render: { vignetteEnabled: true, vignetteDarkness: 0.3, exposure: 1.2 },
    },
    '户外晴天': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.3, 0.6, 1],
            skyColorBot: [0.6, 0.8, 1],
            skyBrightness: 2,
            envIntensity: 1.5,
        },
        lights: {
            hemiIntensity: 1,
            dirIntensity: 1.2,
            dirColor: [1, 0.95, 0.85],
            shadowEnabled: true,
            shadowType: 'pcf',
        },
        render: { exposure: 1.4, toneMapping: 1 },
    },
    '演唱会': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.4, 0.1, 0.6],
            skyColorMid: [0.2, 0.05, 0.4],
            skyColorBot: [0.1, 0.02, 0.2],
            envIntensity: 0.3,
            particleEnabled: true,
            particleType: 'fireworks',
        },
        lights: {
            hemiIntensity: 0.3,
            dirIntensity: 0.5,
            dirColor: [0.6, 0.3, 0.8],
            hemiColor: [0.3, 0.1, 0.5],
            shadowEnabled: false,
        },
        render: { vignetteEnabled: true, vignetteDarkness: 0.5, exposure: 0.9, toneMapping: 1 },
    },
    '摄影棚': {
        env: {
            skyMode: 'color',
            skyColorTop: [0.4, 0.4, 0.45],
            skyColorBot: [0.25, 0.25, 0.3],
            envIntensity: 0.8,
            particleEnabled: false,
        },
        lights: {
            hemiIntensity: 0.6,
            dirIntensity: 0.8,
            dirColor: [1, 0.95, 0.9],
            shadowEnabled: true,
            shadowType: 'soft',
        },
        render: { exposure: 1.0, toneMapping: 1 },
    },
    '黄昏柔光': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.9, 0.45, 0.2],
            skyColorBot: [0.6, 0.2, 0.1],
            skyBrightness: 1.2,
            envIntensity: 0.7,
            particleEnabled: false,
        },
        lights: {
            hemiIntensity: 0.5,
            dirIntensity: 0.6,
            dirColor: [0.9, 0.5, 0.3],
            shadowEnabled: true,
            shadowType: 'soft',
        },
        render: { vignetteEnabled: true, vignetteDarkness: 0.2, exposure: 0.8, toneMapping: 2 },
    },
    '雨天': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.25, 0.28, 0.32],
            skyColorBot: [0.15, 0.18, 0.22],
            skyBrightness: 0.5,
            envIntensity: 0.4,
            particleEnabled: true,
            particleType: 'rain',
        },
        lights: {
            hemiIntensity: 0.5,
            dirIntensity: 0.3,
            dirColor: [0.6, 0.65, 0.7],
            shadowEnabled: false,
        },
        render: { exposure: 0.7, toneMapping: 4 },
    },
    '樱花季': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.95, 0.85, 0.9],
            skyColorBot: [0.7, 0.6, 0.75],
            skyBrightness: 1.5,
            envIntensity: 1.2,
            particleEnabled: true,
            particleType: 'sakura',
        },
        lights: {
            hemiIntensity: 0.8,
            dirIntensity: 0.9,
            dirColor: [0.95, 0.85, 0.8],
            shadowEnabled: true,
            shadowType: 'pcf',
        },
        render: { exposure: 1.1, toneMapping: 2 },
    },
    '赛博都市': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.05, 0.02, 0.1],
            skyColorBot: [0.15, 0.02, 0.2],
            skyBrightness: 0.8,
            envIntensity: 0.3,
            particleEnabled: true,
            particleType: 'fireflies',
        },
        lights: {
            hemiIntensity: 0.2,
            dirIntensity: 0.4,
            dirColor: [0.2, 0.5, 1],
            shadowEnabled: false,
        },
        render: { exposure: 0.9, toneMapping: 4 },
    },
};

export function buildPresetLevel(): PopupLevel {
    const entries = Object.entries(SCENE_PRESETS);
    return {
        label: t('env-preset.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                // 场景氛围（跨类别内置快速预设）
                addSectionTitle(c, t('env-preset.sceneMood'));
                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [name, preset] of entries) {
                    addPresetChip(chipGroup, name, false, () => {
                        const envUpdate = { ...preset.env };
                        // 自动推算中间色，与天空预设双色逻辑看齐
                        if (
                            envUpdate.skyColorTop &&
                            envUpdate.skyColorBot &&
                            !envUpdate.skyColorMid
                        ) {
                            envUpdate.skyColorMid = [
                                (envUpdate.skyColorTop[0] + envUpdate.skyColorBot[0]) / 2,
                                (envUpdate.skyColorTop[1] + envUpdate.skyColorBot[1]) / 2,
                                (envUpdate.skyColorTop[2] + envUpdate.skyColorBot[2]) / 2,
                            ] as [number, number, number];
                        }
                        // [adr-111][adr-120] 跨类别整体切换，仅包含 sky+lights+render 字段，不覆盖 ground/water（已移除）
                        setEnvState(envUpdate);
                        if (preset.lights) {
                            transitionLighting(preset.lights, 2000);
                        }
                        if (preset.render) {
                            transitionRenderState(
                                { ...defaultRenderState(), ...preset.render },
                                2000
                            );
                        }
                        getEnvMenu()?.reRender();
                    });
                }
                c.appendChild(chipGroup);

                // 4 个分类预设区域
                for (const cat of CATEGORIES) {
                    renderCategorizedPresets(c, cat.id, cat.labelKey);
                }
            });
        },
    };
}
