// [doc:architecture] Scene Render Presets — 渲染预设弹窗层级
// 从 scene-render-levels.ts 拆分

import { setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import type { RenderState } from '../scene/scene';
import { showPrompt } from '../core/dialog';
import { tryCatchStatus, showErrorToast, logWarn } from '../core/utils';
import { slideRow } from '../core/ui-helpers';
import {
    getRenderState,
    setRenderState,
    transitionRenderState,
    defaultRenderState,
} from '../scene/scene';
import { GetRenderPresets, SaveRenderPreset } from '../core/wails-bindings';
import { reRenderSceneMenu, getSceneMenu } from './scene-menu';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';
import { presetListContent } from './preset-list-viewer';

// ======== Render Presets ========

//
// 内置渲染预设 — 6 套，各有独立色调映射模式 + 匹配曝光/后处理
//
// 设计原则：
//   - 曝光 ≥1.5 将亮度推入 HDR 域，使不同 tone mapping 曲线的高光压缩差异可见
//   - 开启 Bloom → 产生 HDR 高亮像素 → tone mapping 的高光滚降特性充分展示
//   - 每套预设锁定一个色调映射模式，配合互补后处理形成鲜明视觉风格
//
const FILTER_PRESETS: Record<string, Partial<RenderState>> = {
    // --- reference：Standard 色调映射，保守曝光作为基准 ---
    standard: {
        bloomEnabled: true,
        bloomWeight: 0.3,
        bloomThreshold: 0.6,
        bloomKernel: 64,
        fxaaEnabled: true,
        outlineEnabled: false,
        toneMapping: 0,
        exposure: 1.0,
        contrast: 1.0,
    },
    // --- ACES 电影曲线 — 自然高光滚降，暗角增加电影感 ---
    cinematic: {
        bloomEnabled: true,
        bloomWeight: 0.4,
        bloomThreshold: 0.5,
        bloomKernel: 64,
        fxaaEnabled: true,
        outlineEnabled: false,
        toneMapping: 1,
        exposure: 2.0,
        contrast: 1.2,
        vignetteEnabled: true,
        vignetteDarkness: 0.35,
        ssrEnabled: true,
        ssrStrength: 0.5,
        ssrFalloff: 0.3,
        reflectionProbeEnabled: true,
        reflectionIntensity: 0.8,
        ssaoEnabled: true,
        ssaoStrength: 0.6,
        ssaoRadius: 0.5,
    },
    // --- Reinhard — 高饱和·高对比·边缘线框 = 卡通风格 ---
    cartoon: {
        bloomEnabled: true,
        bloomWeight: 0.5,
        bloomThreshold: 0.3,
        bloomKernel: 128,
        fxaaEnabled: true,
        outlineEnabled: true,
        outlineColor: [0, 0, 0],
        toneMapping: 2,
        exposure: 2.0,
        contrast: 1.5,
    },
    // --- ACES + 景深/暗角 — 浅景深电影写实 ---
    realistic: {
        bloomEnabled: true,
        bloomWeight: 0.25,
        bloomThreshold: 0.7,
        bloomKernel: 64,
        fxaaEnabled: true,
        outlineEnabled: false,
        toneMapping: 1,
        exposure: 1.5,
        contrast: 1.15,
        vignetteEnabled: true,
        vignetteDarkness: 0.5,
        dofEnabled: true,
        dofAperture: 0.15,
        ssrEnabled: true,
        ssrStrength: 0.3,
        ssrFalloff: 0.2,
        reflectionProbeEnabled: true,
        reflectionIntensity: 0.6,
        ssaoEnabled: true,
        ssaoStrength: 0.5,
        ssaoRadius: 0.4,
    },
    // --- Cineon 胶片曲线 + 暖色调背景 ---
    warm: {
        bloomEnabled: true,
        bloomWeight: 0.45,
        bloomThreshold: 0.4,
        bloomKernel: 96,
        fxaaEnabled: true,
        outlineEnabled: false,
        toneMapping: 3,
        exposure: 2.2,
        contrast: 1.3,
        reflectionProbeEnabled: true,
        reflectionIntensity: 0.5,
    },
    // --- Neutral + 极端后处理 — 赛博朋克风格 ---
    cyberpunk: {
        bloomEnabled: true,
        bloomWeight: 0.7,
        bloomThreshold: 0.2,
        bloomKernel: 192,
        fxaaEnabled: true,
        outlineEnabled: true,
        outlineColor: [1, 0, 1],
        toneMapping: 4,
        exposure: 3.0,
        contrast: 1.6,
        vignetteEnabled: true,
        vignetteDarkness: 0.6,
        chromaticAberrationEnabled: true,
        chromaticAberrationAmount: 0.3,
        grainEnabled: true,
        grainIntensity: 0.4,
        ssrEnabled: true,
        ssrStrength: 0.4,
        ssrFalloff: 0.15,
        reflectionProbeEnabled: true,
        reflectionIntensity: 0.9,
        ssaoEnabled: true,
        ssaoStrength: 0.7,
        ssaoRadius: 0.6,
    },
};

// 预设名/描述 → i18n key 映射（热切换安全：仅存 key，不含中文）
export const FILTER_PRESET_LABELS: Record<string, string> = {
    standard: 'scene.preset.standard',
    cinematic: 'scene.preset.cinematic',
    cartoon: 'scene.preset.cartoon',
    realistic: 'scene.preset.realistic',
    warm: 'scene.preset.warm',
    cyberpunk: 'scene.preset.cyberpunk',
};

const FILTER_PRESET_DESCS: Record<string, string> = {
    standard: 'scene.presetDesc.standard',
    cinematic: 'scene.presetDesc.cinematic',
    cartoon: 'scene.presetDesc.cartoon',
    realistic: 'scene.presetDesc.realistic',
    warm: 'scene.presetDesc.warm',
    cyberpunk: 'scene.presetDesc.cyberpunk',
};

export function getFilterPreset(name: string): Partial<RenderState> | undefined {
    return FILTER_PRESETS[name];
}

export function getFilterPresetName(name: string): string {
    return t(FILTER_PRESET_LABELS[name] || name);
}

function buildPresetsSchema(): MenuNode[] {
    return [
        // 内置预设芯片组
        {
            id: 'presets:builtin',
            kind: 'custom',
            renderCustom: (c) => {
                const chipGroup = document.createElement('div');
                chipGroup.className = 'preset-group';
                chipGroup.style.paddingBottom = '6px';
                for (const [key] of Object.entries(FILTER_PRESETS)) {
                    const wrapper = document.createElement('div');
                    wrapper.style.cssText =
                        'display:flex;flex-direction:column;align-items:center;gap:2px;';

                    const btn = document.createElement('button');
                    btn.className = 'preset-chip';
                    btn.textContent = t(FILTER_PRESET_LABELS[key] || key);
                    btn.addEventListener('click', () => {
                        const preset = getFilterPreset(key);
                        if (preset) {
                            transitionRenderState({ ...defaultRenderState(), ...preset }, 2000);
                        }
                        setStatus(
                            t('scene.statusPresetApplied', { name: t(FILTER_PRESET_LABELS[key]) }),
                            true
                        );
                    });
                    wrapper.appendChild(btn);

                    const desc = document.createElement('span');
                    desc.textContent = t(FILTER_PRESET_DESCS[key] || '');
                    desc.style.cssText =
                        'font-size:9px;color:var(--text-dim);opacity:0.7;white-space:nowrap;line-height:1.2;';
                    wrapper.appendChild(desc);

                    chipGroup.appendChild(wrapper);
                }
                c.appendChild(chipGroup);
            },
        },
        // 保存当前为预设
        {
            id: 'presets:save',
            kind: 'custom',
            renderCustom: (c) => {
                slideRow(
                    c,
                    'lucide:save',
                    t('scene.saveCurrentAsPreset'),
                    false,
                    showPresetSaveDialog
                );
            },
        },
        // 用户预设列表（slide-item 行，与 preset-list-viewer 视觉一致）
        {
            id: 'presets:user',
            kind: 'custom',
            visibleWhen: () => Object.keys(USER_FILTER_PRESETS).length > 0,
            renderCustom: (c) => {
                const listHost = document.createElement('div');
                listHost.style.paddingBottom = '6px';
                c.appendChild(listHost);
                const reRender = async () => {
                    listHost.innerHTML = '';
                    await presetListContent(
                        listHost,
                        {
                            getLabel: ([name]) => name,
                            getIcon: () => 'lucide:bookmark',
                            loadItems: async () => Object.entries(USER_FILTER_PRESETS),
                            onApply: async ([name, state]) => {
                                setRenderState(state);
                                setStatus(t('scene.statusPresetApplied', { name }), true);
                            },
                            emptyText: t('scene.noPresets'),
                        },
                        reRender
                    );
                };
                reRender();
            },
        },
    ];
}

export function buildPresetsLevel(): PopupLevel {
    return {
        label: t('scene.renderPresets'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            renderMenu(buildPresetsSchema(), container);
        },
    };
}

export async function showPresetSaveDialog(): Promise<void> {
    const name = await showPrompt(t('scene.promptPresetName'));
    if (!name || !name.trim()) {
        return;
    }
    const trimmed = name.trim();
    const state = getRenderState();
    const r = await tryCatchStatus(
        async () => {
            await SaveRenderPreset(trimmed, JSON.stringify(state));
            return true;
        },
        t('scene.statusSavePresetFailed'),
        (err) => showErrorToast(t('scene.toastSavePresetFailed'), translateGoError(err))
    );
    if (r) {
        USER_FILTER_PRESETS[trimmed] = state;
        setStatus(t('scene.statusPresetSaved', { trimmed }), true);
        const menu = getSceneMenu();
        if (menu) {
            menu.setLevel(menu.levelCount - 1, buildPresetsLevel());
            reRenderSceneMenu();
        }
    }
}

export const USER_FILTER_PRESETS: Record<string, Partial<RenderState>> = {};

let _presetsLoaded = false;

export async function loadUserPresets(): Promise<void> {
    if (_presetsLoaded) {
        return;
    }
    _presetsLoaded = true;
    try {
        const presets = await GetRenderPresets();
        if (presets) {
            for (const p of presets) {
                USER_FILTER_PRESETS[p.name] = p.params as unknown as Partial<RenderState>;
            }
        }
    } catch (err) {
        logWarn('scene-render-presets', 'loadUserPresets:', err);
    }
}
