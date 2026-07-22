// [doc:architecture] Scene Render Levels — 渲染/后处理/预设场景弹窗层级
// 从 scene-render-levels.ts 拆分
// 子文件: scene-stage-lights.ts, scene-stage-levels.ts, scene-render-presets.ts

import { setStatus, cardContainer } from '../core/config';
import type { PopupLevel } from '../core/config';
import type { RenderState } from '../scene/scene';
import { tryCatchStatus, swallowError, showErrorToast } from '../core/utils';
import { addModeSlider, slideRow, addPresetChip } from '../core/ui-helpers';
import { exportSceneBundle, importSceneBundle } from '../scene/scene-bundle';
import {
    triggerAutoSave,
    deserializeScene,
    getRenderState,
    setRenderState,
    transitionRenderState,
    defaultRenderState,
    serializeScene,
    popUndoSnapshot,
    restoreUndoSnapshot,
} from '../scene/scene';
import {
    GetPresetScenes,
    GetPresetScenesDir,
    DeletePresetScene,
    LoadSceneFile,
    SaveScenePreset,
} from '../core/wails-bindings';
import { presetListContent } from './preset-list-viewer';
import { reRenderSceneMenu } from './scene-menu-state';
import { FILTER_PRESET_LABELS, getFilterPreset } from './scene-render-presets';
import { t } from '../core/i18n/t';
import { translateGoError } from '../core/i18n/goerr';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

// ======== Scene Preset ========

async function _loadPresetScene(name: string): Promise<boolean> {
    const r = await tryCatchStatus(async () => {
        const dir = await GetPresetScenesDir();
        const json = await LoadSceneFile(dir + '/' + name);
        await deserializeScene(JSON.parse(json));
        return true;
    }, t('scene.statusLoadPresetFailed'));
    if (r) {
        return true;
    }
    return false;
}

/** 渲染滤镜预设芯片组 — 供 _renderScenePresetList 和 buildPostProcessLevel 使用 */
function _renderFilterPresetChips(container: HTMLElement): void {
    cardContainer(container, (c) => {
        const chipGroup = document.createElement('div');
        chipGroup.className = 'preset-group';
        chipGroup.style.paddingBottom = '6px';
        for (const [key, label] of Object.entries(FILTER_PRESET_LABELS)) {
            addPresetChip(chipGroup, t(label), false, () => {
                const preset = getFilterPreset(key);
                if (preset) {
                    transitionRenderState({ ...defaultRenderState(), ...preset }, 2000);
                }
                setStatus(t('scene.statusFilter', { label: t(label) }), true);
            });
        }
        c.appendChild(chipGroup);
    });
}

function _renderScenePresetList(container: HTMLElement, scenes: string[]): void {
    // 预设列表（通用组件处理空状态 + 列表渲染）
    presetListContent(
        container,
        {
            getLabel: (s: string) => s,
            onApply: async (name) => {
                if (await _loadPresetScene(name)) {
                    setStatus(t('scene.statusLoaded', { name }), true);
                }
            },
            onDelete: async (name) => {
                const r = await tryCatchStatus(
                    () => DeletePresetScene(name),
                    t('scene.statusDeleteFailed')
                );
                if (r === undefined) {
                    throw Error('delete failed');
                }
                setStatus(t('scene.statusDeleted', { name }), true);
            },
            deleteConfirmText: (name) => t('scene.confirmDeletePreset', { name }),
            emptyText: t('scene.noPresetScenes'),
        },
        reRenderSceneMenu,
        scenes
    );
}

export function buildPresetScenesLevel(): PopupLevel {
    return {
        label: t('scene.presetScenes'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            // 卡片 1：预设场景列表（异步加载）
            cardContainer(container, (c) => {
                const loadingPlaceholder = document.createElement('div');
                loadingPlaceholder.textContent = t('common.loading');
                loadingPlaceholder.style.cssText =
                    'padding:14px;color:var(--text-dim);font-size:var(--font-ui-sm);';
                c.appendChild(loadingPlaceholder);
                swallowError(
                    GetPresetScenes().then((scenes: string[] | null) => {
                        c.removeChild(loadingPlaceholder);
                        _renderScenePresetList(c, scenes || []);
                    })
                );
            });
            // 卡片 2：撤销 / 保存场景
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:undo-2', t('scene.undo'), false, () => {
                    const snap = popUndoSnapshot();
                    if (!snap) {
                        setStatus(t('scene.statusNoUndo'), false);
                        return;
                    }
                    void restoreUndoSnapshot(snap).then((ok) => {
                        if (ok) {
                            setStatus(t('scene.undoApplied'), true);
                        }
                    });
                });
                slideRow(c, 'lucide:save', t('scene.saveScene'), false, async () => {
                    const json = JSON.stringify(serializeScene(), null, 2);
                    try {
                        const filename = await SaveScenePreset(json);
                        try {
                            await navigator.clipboard.writeText(json);
                            setStatus(t('scene.statusSceneSavedClipboard', { filename }), true);
                        } catch {
                            setStatus(t('scene.statusSceneSaved', { filename }), true);
                        }
                        reRenderSceneMenu();
                    } catch (err) {
                        const msg = translateGoError(err);
                        setStatus(t('scene.statusSaveFailed'), false);
                        showErrorToast(t('scene.toastSaveSceneFailed'), msg);
                    }
                });
            });
            // 卡片 3：导入 / 导出场景包（低频操作置底）
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:file-up', t('scene.exportSceneBundle'), false, () => {
                    void exportSceneBundle();
                });
                slideRow(c, 'lucide:file-down', t('scene.importSceneBundle'), false, () => {
                    void importSceneBundle();
                });
            });
        },
    };
}

// ======== Post Process Schema (ADR-093) ========
// 后处理面板迁移为 schema 驱动：Bloom/DoF/Vignette/Sharpen/光学/环境/色调映射
// 复合状态（dofAperture+dofEnabled 等）由 bind 写主字段、onChange 写附加字段；
// 抗锯齿/色调映射因复合状态或 number 类型 modeSlider，用 custom 节点保留原 addModeSlider 调用。

/** 抗锯齿控件 — 复合状态（fxaaEnabled + msaaSamples），用 custom 节点保留原 addModeSlider 调用 */
function _renderAntiAliasingControl(container: HTMLElement): void {
    const state = getRenderState();
    addModeSlider(
        container,
        t('scene.antialiasing'),
        [
            { value: 'off', label: t('scene.off') },
            { value: 'fxaa', label: 'FXAA' },
            { value: '2x', label: '2x' },
            { value: '4x', label: '4x' },
            { value: '8x', label: '8x' },
        ],
        state.msaaSamples > 1 ? `${state.msaaSamples}x` : state.fxaaEnabled ? 'fxaa' : 'off',
        (v) => {
            const updates: Partial<RenderState> = {};
            if (v === 'off') {
                updates.fxaaEnabled = false;
                updates.msaaSamples = 1;
            } else if (v === 'fxaa') {
                updates.fxaaEnabled = true;
                updates.msaaSamples = 1;
            } else {
                updates.fxaaEnabled = false;
                updates.msaaSamples = parseInt(v);
            }
            setRenderState(updates);
            triggerAutoSave();
        },
        'lucide:scan-line',
        undefined,
        {
            bind: () => {
                const s = getRenderState();
                return s.msaaSamples > 1 ? `${s.msaaSamples}x` : s.fxaaEnabled ? 'fxaa' : 'off';
            },
        },
        'postprocess:optical:aa'
    );
}

/** 色调映射模式控件 — value 是 number，schema modeSlider 仅支持 string，用 custom 节点 */
function _renderToneMappingControl(container: HTMLElement): void {
    const state = getRenderState();
    addModeSlider(
        container,
        t('scene.mode'),
        [
            { value: 0, label: t('scene.off') },
            { value: 1, label: 'ACES' },
            { value: 2, label: 'Reinhard' },
            { value: 3, label: 'Cineon' },
            { value: 4, label: 'Neutral' },
        ],
        state.toneMapping,
        (v) => {
            setRenderState({ toneMapping: v as number });
            triggerAutoSave();
        },
        'lucide:palette',
        undefined,
        { bind: () => getRenderState().toneMapping }
    );
}

/** 后处理 schema — 核心层（高频效果）+ 高级层（光学/环境效果） */
function buildPostProcessCoreSchema(): MenuNode[] {
    return [
        // ===== Bloom 折叠头（强度/阈值/核大小 + 边缘高亮） =====
        {
            id: 'postprocess:bloom',
            kind: 'folder',
            label: 'scene.bloom',
            icon: 'lucide:sun',
            defaultOpen: false,
            headerToggle: { bind: 'render.bloomEnabled' },
            children: [
                {
                    id: 'postprocess:bloom:weight',
                    kind: 'slider',
                    label: 'scene.intensity',
                    icon: 'lucide:sun',
                    control: {
                        bind: 'render.bloomWeight',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:bloom:threshold',
                    kind: 'slider',
                    label: 'scene.threshold',
                    icon: 'lucide:sliders',
                    control: {
                        bind: 'render.bloomThreshold',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:bloom:kernel',
                    kind: 'slider',
                    label: 'scene.kernelSize',
                    icon: 'lucide:circle',
                    control: {
                        bind: 'render.bloomKernel',
                        min: 16,
                        max: 256,
                        step: 2,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:bloom:outline',
                    kind: 'toggle',
                    label: 'scene.outline',
                    icon: 'lucide:square',
                    control: {
                        bind: 'render.outlineEnabled',
                        onChange: () => triggerAutoSave(),
                    },
                },
            ],
        },
        // ===== 暗角（slider 控制复合状态：vignetteDarkness + vignetteEnabled） =====
        {
            id: 'postprocess:vignette',
            kind: 'slider',
            label: 'scene.vignette',
            icon: 'lucide:circle-dot',
            control: {
                bind: 'render.vignetteDarkness',
                min: 0,
                max: 1,
                step: 0.05,
                onChange: (v) => {
                    setRenderState({ vignetteEnabled: (v as number) > 0 });
                    triggerAutoSave();
                },
            },
        },
        // ===== 锐化 =====
        {
            id: 'postprocess:sharpen',
            kind: 'slider',
            label: 'scene.sharpen',
            icon: 'lucide:focus',
            control: {
                bind: 'render.sharpenAmount',
                min: 0,
                max: 1,
                step: 0.05,
                onChange: () => triggerAutoSave(),
            },
        },
        // ===== 视觉效果折叠头（抗锯齿/颗粒/色差/辉光） =====
        {
            id: 'postprocess:optical',
            kind: 'folder',
            label: 'scene.opticalEffects',
            icon: 'lucide:sparkles',
            defaultOpen: false,
            children: [
                {
                    id: 'postprocess:optical:aa',
                    kind: 'custom',
                    renderCustom: (c) => _renderAntiAliasingControl(c),
                },
                {
                    id: 'postprocess:optical:grain',
                    kind: 'slider',
                    label: 'scene.grain',
                    icon: 'lucide:grid-3x3',
                    control: {
                        bind: 'render.grainIntensity',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            setRenderState({ grainEnabled: (v as number) > 0 });
                            triggerAutoSave();
                        },
                    },
                },
                {
                    id: 'postprocess:optical:chromatic',
                    kind: 'slider',
                    label: 'scene.chromatic',
                    icon: 'lucide:rainbow',
                    control: {
                        bind: 'render.chromaticAberrationAmount',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            setRenderState({ chromaticAberrationEnabled: (v as number) > 0 });
                            triggerAutoSave();
                        },
                    },
                },
                {
                    id: 'postprocess:optical:glow',
                    kind: 'slider',
                    label: 'scene.glow',
                    icon: 'lucide:sparkles',
                    control: {
                        bind: 'render.glowIntensity',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: (v) => {
                            setRenderState({ glowEnabled: (v as number) > 0 });
                            triggerAutoSave();
                        },
                    },
                },
            ],
        },
        // ===== 环境效果折叠头（SSAO） =====
        // ADR-151 收口：SSR/反射探针已迁移至场景根目录「反射模式 + 反射质量」统一控制
        {
            id: 'postprocess:env',
            kind: 'folder',
            label: 'scene.environmentEffects',
            icon: 'lucide:box',
            defaultOpen: false,
            children: [
                {
                    id: 'postprocess:env:ssao',
                    kind: 'toggle',
                    label: 'scene.ssao',
                    icon: 'lucide:box',
                    control: {
                        bind: 'render.ssaoEnabled',
                        onChange: () => {
                            triggerAutoSave();
                            reRenderSceneMenu();
                        },
                    },
                },
                {
                    id: 'postprocess:env:ssao:strength',
                    kind: 'slider',
                    label: 'scene.ssaoStrength',
                    icon: 'lucide:contrast',
                    visibleWhen: () => getRenderState().ssaoEnabled,
                    control: {
                        bind: 'render.ssaoStrength',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:env:ssao:radius',
                    kind: 'slider',
                    label: 'scene.ssaoRadius',
                    icon: 'lucide:circle-dot',
                    visibleWhen: () => getRenderState().ssaoEnabled,
                    control: {
                        bind: 'render.ssaoRadius',
                        min: 0,
                        max: 1,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:env:ssao:samples',
                    kind: 'slider',
                    label: 'scene.ssaoSamples',
                    icon: 'lucide:grid-3x3',
                    visibleWhen: () => getRenderState().ssaoEnabled,
                    control: {
                        bind: 'render.ssaoSamples',
                        min: 4,
                        max: 32,
                        step: 1,
                        onChange: () => triggerAutoSave(),
                    },
                },
            ],
        },
    ] satisfies MenuNode[];
}

/** 后处理 schema — 色彩层（色调映射） */
function buildPostProcessColorSchema(): MenuNode[] {
    return [
        {
            id: 'postprocess:tonemapping',
            kind: 'folder',
            label: 'scene.toneMapping',
            icon: 'lucide:palette',
            defaultOpen: false,
            children: [
                {
                    id: 'postprocess:tonemapping:mode',
                    kind: 'custom',
                    renderCustom: (c) => _renderToneMappingControl(c),
                },
                {
                    id: 'postprocess:tonemapping:exposure',
                    kind: 'slider',
                    label: 'scene.exposure',
                    icon: 'lucide:lightbulb',
                    control: {
                        bind: 'render.exposure',
                        min: 0,
                        max: 4,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:tonemapping:contrast',
                    kind: 'slider',
                    label: 'scene.contrast',
                    icon: 'lucide:contrast',
                    control: {
                        bind: 'render.contrast',
                        min: 0,
                        max: 4,
                        step: 0.05,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:tonemapping:cel',
                    kind: 'toggle',
                    label: 'scene.celShading',
                    icon: 'lucide:droplet',
                    control: {
                        bind: 'render.celShadingMode',
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:tonemapping:celLevels',
                    kind: 'slider',
                    label: 'scene.celColorLevels',
                    icon: 'lucide:layers',
                    visibleWhen: () => getRenderState().celShadingMode,
                    control: {
                        bind: 'render.celColorLevels',
                        min: 2,
                        max: 8,
                        step: 1,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:tonemapping:celEdgeThreshold',
                    kind: 'slider',
                    label: 'scene.celEdgeThreshold',
                    icon: 'lucide:scan-line',
                    visibleWhen: () => getRenderState().celShadingMode,
                    control: {
                        bind: 'render.celEdgeThreshold',
                        min: 0,
                        max: 1,
                        step: 0.01,
                        onChange: () => triggerAutoSave(),
                    },
                },
                {
                    id: 'postprocess:tonemapping:celEdgeStrength',
                    kind: 'slider',
                    label: 'scene.celEdgeStrength',
                    icon: 'lucide:pen-line',
                    visibleWhen: () => getRenderState().celShadingMode,
                    control: {
                        bind: 'render.celEdgeStrength',
                        min: 0,
                        max: 1,
                        step: 0.01,
                        onChange: () => triggerAutoSave(),
                    },
                },
            ],
        },
    ] satisfies MenuNode[];
}

export function buildPostProcessLevel(): PopupLevel {
    return {
        label: t('scene.postProcess'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const disposes: (() => void)[] = [];
            // 核心层（高频效果 + 高级层折叠头）—— 单卡片视觉分组
            const d1 = cardContainer(container, (c) => {
                return renderMenu(buildPostProcessCoreSchema(), c);
            });
            if (typeof d1 === 'function') {
                disposes.push(d1);
            }
            // 色彩层（色调映射）—— 独立卡片
            const d2 = cardContainer(container, (c) => {
                return renderMenu(buildPostProcessColorSchema(), c);
            });
            if (typeof d2 === 'function') {
                disposes.push(d2);
            }
            // 滤镜预设芯片组
            _renderFilterPresetChips(container);
            if (disposes.length > 0) {
                return () => {
                    for (const d of disposes) {
                        d();
                    }
                };
            }
        },
    };
}
