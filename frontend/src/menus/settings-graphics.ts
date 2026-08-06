// settings-graphics.ts — 画面设置子菜单（ADR-157：合并原 performance + rendering）
// 页面流：性能预设 → 帧率与画质 → 渲染效果 → 物理与显示，单页闭环。

import { SetPerformanceMode } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { uiState, cardContainer, applyHudVisibility } from '../core/config';
import { feedbackInfo } from '../core/feedback';
import { showInfoToast } from '../core/toast';
import { slideRow, addSectionTitle, addInlineToggleRow, addModeSlider } from '../core/ui-helpers';
import { swallowError } from '../core/async';
import { getCurrentRenderingMenu } from './menu';
import {
    setPerformanceMode,
    getPerformanceMode,
    resetPerformanceSnapshot,
} from '../scene/render/performance';
import { engine, applyFrameControl, modelManager, setModelPhysics } from '../scene/scene';
import { calcHardwareScaling } from '../core/render-loop';
import { getRenderState, setRenderState } from '../scene/render/renderer';
import { getLightState, setLightState } from '../scene/render/lighting';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

const PERFORMANCE_MODES: Array<{
    key: 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';
    labelKey: string;
    descKey: string;
}> = [
    { key: 'auto', labelKey: 'settings.perf.auto', descKey: 'settings.perf.autoDesc' },
    { key: 'quality', labelKey: 'settings.perf.quality', descKey: 'settings.perf.qualityDesc' },
    { key: 'balanced', labelKey: 'settings.perf.balanced', descKey: 'settings.perf.balancedDesc' },
    {
        key: 'performance',
        labelKey: 'settings.perf.performance',
        descKey: 'settings.perf.performanceDesc',
    },
    { key: 'custom', labelKey: 'settings.perf.custom', descKey: 'settings.perf.customDesc' },
];

// ======== 卡片 1：性能预设 ========
function buildPresetSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'settings:graphics:modes',
            kind: 'custom',
            renderCustom: (c) => {
                const current = getPerformanceMode();
                const perfRows: HTMLElement[] = [];
                for (const m of PERFORMANCE_MODES) {
                    const isActive = current === m.key;
                    const row = slideRow(
                        c,
                        `lucide:${isActive ? 'check-circle' : 'circle'}`,
                        t(m.labelKey),
                        false,
                        () => {
                            setPerformanceMode(m.key);
                            // [fix P2] 持久化失败用户可见：swallowError 仅 logWarn，
                            // 刷新后回退旧档无感知。显式 catch + toast 提示。
                            SetPerformanceMode(m.key).catch((err) => {
                                console.warn('[settings-graphics] SetPerformanceMode failed:', err);
                                showInfoToast(t('settings.perfModePersistFailed'));
                            });
                            if (m.key === 'custom') {
                                getSettingsMenu()?.reRender();
                            } else {
                                getSettingsMenu()?.updateControls();
                            }
                            showInfoToast(t('settings.perfModeSet', { label: t(m.labelKey) }));
                        },
                        t(m.descKey),
                        undefined,
                        isActive
                    );
                    row.dataset.perfKey = m.key;
                    perfRows.push(row);
                }
                getCurrentRenderingMenu()?.registerControl(() => {
                    const currentMode = getPerformanceMode();
                    for (const row of perfRows) {
                        const key = row.dataset.perfKey!;
                        const isActive = currentMode === key;
                        row.className = 'slide-item' + (isActive ? ' slide-focused' : '');
                        const icon = row.querySelector(
                            '.slide-icon iconify-icon'
                        ) as HTMLElement | null;
                        if (icon) {
                            icon.setAttribute(
                                'icon',
                                `lucide:${isActive ? 'check-circle' : 'circle'}`
                            );
                        }
                    }
                });
            },
        },
    ];
}

// ======== 卡片 2：帧率与画质（帧率限制器 / 帧率上限 / 渲染缩放） ========
export function buildFrameQualitySchema(): MenuNode[] {
    return [
        {
            id: 'settings:graphics:frame-cap',
            kind: 'toggle',
            label: 'settings.perf.frameCap',
            control: {
                bind: 'ui.frameCapEnabled',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyFrameControl();
                    showInfoToast(
                        t('settings.perfVsync', {
                            state: v ? t('common.on') : t('common.off'),
                        })
                    );
                },
            },
            icon: 'lucide:monitor-check',
        },
        {
            id: 'settings:graphics:frame-cap-hint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent =
                    uiState.frameCapEnabled !== false
                        ? t('settings.perf.frameCapHintOn')
                        : t('settings.perf.frameCapHintOff');
                c.appendChild(hint);
            },
        },
        {
            id: 'settings:graphics:fps',
            kind: 'slider',
            label: 'settings.perf.fpsCap',
            control: {
                bind: 'ui.fpsLimit',
                min: 0,
                max: 144,
                step: 1,
                get: (v) => (v as number) ?? 0,
                onChange: (v) => {
                    const limit = Math.round(v as number);
                    applyFrameControl();
                    showInfoToast(
                        limit === 0
                            ? t('settings.perfFpsUnlimited')
                            : t('settings.perfFpsLimit', { limit })
                    );
                },
            },
            icon: 'lucide:gauge',
        },
        {
            id: 'settings:graphics:fps-hint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.fpsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'settings:graphics:render-scale',
            kind: 'slider',
            label: 'settings.perf.renderScale',
            control: {
                bind: 'ui.renderScale',
                min: 0.5,
                max: 2,
                step: 0.05,
                get: (v) => (v as number) ?? 1,
                set: (v) => Math.round((v as number) * 100) / 100,
                onChange: (v) => {
                    engine.setHardwareScalingLevel(
                        calcHardwareScaling(window.devicePixelRatio || 1, v as number)
                    );
                    showInfoToast(
                        t('settings.renderScale', { pct: Math.round((v as number) * 100) })
                    );
                },
            },
            icon: 'lucide:scan',
        },
        {
            id: 'settings:graphics:render-scale-hint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.renderScaleHint');
                c.appendChild(hint);
            },
        },
    ] satisfies MenuNode[];
}

// ======== 卡片 3：渲染效果（10 开关，原 settings-rendering） ========
export function buildEffectsSchema(): MenuNode[] {
    return [
        {
            id: 'settings:graphics:toggles',
            kind: 'custom',
            renderCustom: (c) => {
                resetPerformanceSnapshot();
                const rs = getRenderState();
                const ls = getLightState();
                const toggle = (label: string, value: boolean, apply: (v: boolean) => void) => {
                    addInlineToggleRow(c, label, value, (v) => {
                        apply(v);
                        showInfoToast(
                            t('settings.toggleState', {
                                label,
                                state: v ? t('common.on') : t('common.off'),
                            })
                        );
                    });
                };
                addSectionTitle(c, t('settings.effects.lighting'));
                toggle(t('settings.perf.shadow'), ls.shadowEnabled, (v) =>
                    setLightState({ shadowEnabled: v })
                );
                toggle(t('settings.perf.bloom'), rs.bloomEnabled, (v) =>
                    setRenderState({ bloomEnabled: v })
                );
                toggle(t('settings.perf.glow'), rs.glowEnabled, (v) =>
                    setRenderState({ glowEnabled: v })
                );
                toggle(t('settings.perf.ssao'), rs.ssaoEnabled, (v) =>
                    setRenderState({ ssaoEnabled: v })
                );
                addSectionTitle(c, t('settings.effects.antialiasing'));
                // AA 唯一入口（ADR-111 后处理页移除 AA）：完整档位 off/FXAA/2x/4x/8x
                addModeSlider(
                    c,
                    t('scene.antialiasing'),
                    [
                        { value: 'off', label: t('scene.off') },
                        { value: 'fxaa', label: 'FXAA' },
                        { value: '2x', label: '2x' },
                        { value: '4x', label: '4x' },
                        { value: '8x', label: '8x' },
                    ],
                    rs.msaaSamples > 1
                        ? `${rs.msaaSamples}x`
                        : rs.fxaaEnabled
                          ? 'fxaa'
                          : 'off',
                    (v) => {
                        if (v === 'off') {
                            setRenderState({ fxaaEnabled: false, msaaSamples: 1 });
                        } else if (v === 'fxaa') {
                            setRenderState({ fxaaEnabled: true, msaaSamples: 1 });
                        } else {
                            setRenderState({ fxaaEnabled: false, msaaSamples: parseInt(v, 10) });
                        }
                        showInfoToast(
                            t('settings.toggleState', {
                                label: t('scene.antialiasing'),
                                state: v,
                            })
                        );
                    },
                    'lucide:scan-line',
                    undefined,
                    {
                        bind: () => {
                            const s = getRenderState();
                            return s.msaaSamples > 1
                                ? `${s.msaaSamples}x`
                                : s.fxaaEnabled
                                  ? 'fxaa'
                                  : 'off';
                        },
                    },
                    'settings:graphics:aa'
                );
                addSectionTitle(c, t('settings.effects.postprocess'));
                toggle(t('settings.perf.dof'), rs.dofEnabled, (v) =>
                    setRenderState({ dofEnabled: v })
                );
                toggle(t('settings.perf.vignette'), rs.vignetteEnabled, (v) =>
                    setRenderState({ vignetteEnabled: v })
                );
                toggle(t('settings.perf.outline'), rs.outlineEnabled, (v) =>
                    setRenderState({ outlineEnabled: v })
                );
                toggle(t('settings.perf.chromaticAberration'), rs.chromaticAberrationEnabled, (v) =>
                    setRenderState({ chromaticAberrationEnabled: v })
                );
                toggle(t('settings.perf.grain'), rs.grainEnabled, (v) =>
                    setRenderState({ grainEnabled: v })
                );
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.customHint');
                c.appendChild(hint);
            },
        },
    ] satisfies MenuNode[];
}

// ======== 卡片 4：物理与显示 ========
export function buildPhysicsHudSchema(): MenuNode[] {
    return [
        {
            id: 'settings:graphics:default-physics',
            kind: 'toggle',
            label: 'settings.perf.defaultPhysics',
            control: {
                bind: 'ui.defaultPhysicsEnabled',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    const enabled = v !== false;
                    const allModels = modelManager?.getAll() ?? [];
                    for (const inst of allModels) {
                        setModelPhysics(inst.id, enabled);
                    }
                    feedbackInfo(enabled ? 'settings.physOn' : 'settings.physOff', undefined);
                },
            },
            icon: 'lucide:atom',
        },
        {
            id: 'settings:graphics:default-physics-hint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.defaultPhysicsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'settings:graphics:show-fps-clock',
            kind: 'toggle',
            label: 'settings.perf.showFpsClock',
            control: {
                bind: 'ui.showFpsClock',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyHudVisibility();
                    showInfoToast(
                        t('settings.toggleState', {
                            label: t('settings.perf.showFpsClock'),
                            state: v ? t('common.on') : t('common.off'),
                        })
                    );
                },
            },
            icon: 'lucide:gauge',
        },
        {
            id: 'settings:graphics:show-runtime-badge',
            kind: 'toggle',
            label: 'settings.perf.showRuntimeBadge',
            control: {
                bind: 'ui.showRuntimeBadge',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyHudVisibility();
                    showInfoToast(
                        t('settings.toggleState', {
                            label: t('settings.perf.showRuntimeBadge'),
                            state: v ? t('common.on') : t('common.off'),
                        })
                    );
                },
            },
            icon: 'lucide:cpu',
        },
    ] satisfies MenuNode[];
}

function buildGraphicsSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：物理与 HUD（与性能模式无关，优先展示）
        {
            id: 'settings:graphics:physics-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.physicsHud'));
                    return renderMenu(buildPhysicsHudSchema(), inner);
                });
            },
        },
        // 卡片 2：性能预设
        {
            id: 'settings:graphics:preset-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.preset'));
                    return renderMenu(buildPresetSchema(getSettingsMenu), inner);
                });
            },
        },
        // 卡片 3：帧率与画质
        {
            id: 'settings:graphics:frame-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.frameQuality'));
                    return renderMenu(buildFrameQualitySchema(), inner);
                });
            },
        },
        // 卡片 4：渲染效果（受性能预设影响最大，放最后方便调优）
        {
            id: 'settings:graphics:effects-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.effects'));
                    return renderMenu(buildEffectsSchema(), inner);
                });
            },
        },
    ];
}

export function buildSettingsGraphicsLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.graphics'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildGraphicsSchema(getSettingsMenu), container);
        },
    };
}
