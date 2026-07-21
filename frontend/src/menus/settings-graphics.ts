// settings-graphics.ts — 画面设置子菜单（ADR-157：合并原 performance + rendering）
// 页面流：性能预设 → 帧率与画质 → 渲染效果 → 物理与HUD，单页闭环。

import { SetPerformanceMode } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { setStatus, uiState, cardContainer, applyHudVisibility } from '../core/config';
import { slideRow, addSectionTitle, addInlineToggleRow } from '../core/ui-helpers';
import { swallowError } from '../core/utils';
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
            id: 'graphics:modes',
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
                            swallowError(SetPerformanceMode(m.key));
                            if (m.key === 'custom') {
                                getSettingsMenu()?.reRender();
                            } else {
                                getSettingsMenu()?.updateControls();
                            }
                            setStatus(t('settings.perfModeSet', { label: t(m.labelKey) }), true);
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

// ======== 卡片 2：帧率与画质（FPS 上限 / 垂直同步 / 渲染缩放） ========
function buildFrameQualitySchema(): MenuNode[] {
    return [
        {
            id: 'graphics:fps',
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
                    setStatus(
                        limit === 0
                            ? t('settings.perfFpsUnlimited')
                            : t('settings.perfFpsLimit', { limit }),
                        true
                    );
                },
            },
            icon: 'lucide:gauge',
        },
        {
            id: 'graphics:fpsHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.fpsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'graphics:vsync',
            kind: 'toggle',
            label: 'settings.perf.vsync',
            control: {
                bind: 'ui.vsync',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyFrameControl();
                    setStatus(
                        t('settings.perfVsync', {
                            state: v ? t('common.on') : t('common.off'),
                        }),
                        true
                    );
                },
            },
            icon: 'lucide:monitor-check',
        },
        {
            id: 'graphics:vsyncHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hintVsync = document.createElement('div');
                hintVsync.className = 'setting-hint';
                hintVsync.textContent =
                    uiState.vsync !== false
                        ? t('settings.perf.vsyncHintOn')
                        : t('settings.perf.vsyncHintOff');
                c.appendChild(hintVsync);
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.vsyncHintBrowser');
                c.appendChild(hint);
            },
        },
        {
            id: 'graphics:renderScale',
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
                    setStatus(
                        t('settings.renderScale', { pct: Math.round((v as number) * 100) }),
                        true
                    );
                },
            },
            icon: 'lucide:scan',
        },
        {
            id: 'graphics:renderScaleHint',
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
function buildEffectsSchema(): MenuNode[] {
    return [
        {
            id: 'graphics:toggles',
            kind: 'custom',
            renderCustom: (c) => {
                resetPerformanceSnapshot();
                const rs = getRenderState();
                const ls = getLightState();
                const renderToggles: Array<{
                    label: string;
                    value: boolean;
                    apply: (v: boolean) => void;
                }> = [
                    {
                        label: t('settings.perf.shadow'),
                        value: ls.shadowEnabled,
                        apply: (v) => setLightState({ shadowEnabled: v }),
                    },
                    {
                        label: t('settings.perf.bloom'),
                        value: rs.bloomEnabled,
                        apply: (v) => setRenderState({ bloomEnabled: v }),
                    },
                    {
                        label: t('settings.perf.fxaa'),
                        value: rs.fxaaEnabled,
                        apply: (v) => setRenderState({ fxaaEnabled: v }),
                    },
                    {
                        label: t('settings.perf.dof'),
                        value: rs.dofEnabled,
                        apply: (v) => setRenderState({ dofEnabled: v }),
                    },
                    {
                        label: t('settings.perf.vignette'),
                        value: rs.vignetteEnabled,
                        apply: (v) => setRenderState({ vignetteEnabled: v }),
                    },
                    {
                        label: t('settings.perf.outline'),
                        value: rs.outlineEnabled,
                        apply: (v) => setRenderState({ outlineEnabled: v }),
                    },
                    {
                        label: t('settings.perf.glow'),
                        value: rs.glowEnabled,
                        apply: (v) => setRenderState({ glowEnabled: v }),
                    },
                    {
                        label: t('settings.perf.chromaticAberration'),
                        value: rs.chromaticAberrationEnabled,
                        apply: (v) => setRenderState({ chromaticAberrationEnabled: v }),
                    },
                    {
                        label: t('settings.perf.grain'),
                        value: rs.grainEnabled,
                        apply: (v) => setRenderState({ grainEnabled: v }),
                    },
                    {
                        label: t('settings.perf.ssao'),
                        value: rs.ssaoEnabled,
                        apply: (v) => setRenderState({ ssaoEnabled: v }),
                    },
                ];
                for (const toggle of renderToggles) {
                    addInlineToggleRow(c, toggle.label, toggle.value, (v) => {
                        toggle.apply(v);
                        setStatus(
                            t('settings.toggleState', {
                                label: toggle.label,
                                state: v ? t('common.on') : t('common.off'),
                            }),
                            true
                        );
                    });
                }
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.customHint');
                c.appendChild(hint);
            },
        },
    ] satisfies MenuNode[];
}

// ======== 卡片 4：物理与 HUD ========
function buildPhysicsHudSchema(): MenuNode[] {
    return [
        {
            id: 'graphics:defaultPhysics',
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
                    setStatus(enabled ? t('settings.physOn') : t('settings.physOff'), true);
                },
            },
            icon: 'lucide:atom',
        },
        {
            id: 'graphics:defaultPhysicsHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.defaultPhysicsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'graphics:showFpsClock',
            kind: 'toggle',
            label: 'settings.perf.showFpsClock',
            control: {
                bind: 'ui.showFpsClock',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyHudVisibility();
                    setStatus(
                        t('settings.toggleState', {
                            label: t('settings.perf.showFpsClock'),
                            state: v ? t('common.on') : t('common.off'),
                        }),
                        true
                    );
                },
            },
            icon: 'lucide:gauge',
        },
        {
            id: 'graphics:showRuntimeBadge',
            kind: 'toggle',
            label: 'settings.perf.showRuntimeBadge',
            control: {
                bind: 'ui.showRuntimeBadge',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    applyHudVisibility();
                    setStatus(
                        t('settings.toggleState', {
                            label: t('settings.perf.showRuntimeBadge'),
                            state: v ? t('common.on') : t('common.off'),
                        }),
                        true
                    );
                },
            },
            icon: 'lucide:cpu',
        },
    ] satisfies MenuNode[];
}

function buildGraphicsSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        // 卡片 1：性能预设
        {
            id: 'graphics:preset-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.preset'));
                    renderMenu(buildPresetSchema(getSettingsMenu), inner);
                });
            },
        },
        // 卡片 2：帧率与画质
        {
            id: 'graphics:frame-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.frameQuality'));
                    renderMenu(buildFrameQualitySchema(), inner);
                });
            },
        },
        // 卡片 3：渲染效果
        {
            id: 'graphics:effects-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.effects'));
                    renderMenu(buildEffectsSchema(), inner);
                });
            },
        },
        // 卡片 4：物理与 HUD
        {
            id: 'graphics:physics-card',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSectionTitle(inner, t('settings.graphics.physicsHud'));
                    renderMenu(buildPhysicsHudSchema(), inner);
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
            renderMenu(buildGraphicsSchema(getSettingsMenu), container);
        },
    };
}
