// settings-performance.ts — 性能设置子菜单（ADR-093 schema 驱动）

import { SetPerformanceMode } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { setStatus, uiState, cardContainer, applyHudVisibility } from '../core/config';
import { slideRow, addSectionTitle } from '../core/ui-helpers';
import { swallowError } from '../core/utils';
import { getCurrentRenderingMenu } from './menu';
import { setPerformanceMode, getPerformanceMode } from '../scene/render/performance';
import { engine, applyFrameControl, modelManager, setModelPhysics } from '../scene/scene';
import { calcHardwareScaling } from '../core/render-loop';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

const PERFORMANCE_MODES: Array<{
    key: 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';
    label: string;
    desc: string;
}> = [
    { key: 'auto', label: t('settings.perf.auto'), desc: t('settings.perf.autoDesc') },
    { key: 'quality', label: t('settings.perf.quality'), desc: t('settings.perf.qualityDesc') },
    { key: 'balanced', label: t('settings.perf.balanced'), desc: t('settings.perf.balancedDesc') },
    {
        key: 'performance',
        label: t('settings.perf.performance'),
        desc: t('settings.perf.performanceDesc'),
    },
    { key: 'custom', label: t('settings.perf.custom'), desc: t('settings.perf.customDesc') },
];

function buildPerfSchema(getSettingsMenu: () => SettingsMenuHandle): MenuNode[] {
    return [
        {
            id: 'perf:modes',
            kind: 'custom',
            renderCustom: (c) => {
                const current = getPerformanceMode();
                const perfRows: HTMLElement[] = [];
                for (const m of PERFORMANCE_MODES) {
                    const isActive = current === m.key;
                    const row = slideRow(
                        c,
                        `lucide:${isActive ? 'check-circle' : 'circle'}`,
                        m.label,
                        false,
                        () => {
                            setPerformanceMode(m.key);
                            swallowError(SetPerformanceMode(m.key));
                            if (m.key === 'custom') {
                                getSettingsMenu()?.reRender();
                            } else {
                                getSettingsMenu()?.updateControls();
                            }
                            setStatus(t('settings.perfModeSet', { label: m.label }), true);
                        },
                        m.desc,
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
        {
            id: 'perf:fps',
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
            id: 'perf:fpsHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.fpsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'perf:showFpsClock',
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
            id: 'perf:showRuntimeBadge',
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
        {
            id: 'perf:vsync',
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
            id: 'perf:vsyncHint',
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
            id: 'perf:defaultPhysics',
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
            id: 'perf:defaultPhysicsHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.defaultPhysicsHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'perf:autoCenter',
            kind: 'toggle',
            label: 'settings.perf.autoCenter',
            control: {
                bind: 'ui.autoCenterModel',
                get: (v) => v !== false,
                set: (v) => v,
                onChange: (v) => {
                    setStatus(
                        t('settings.perf.autoCenterState', {
                            state: v ? t('common.on') : t('common.off'),
                        }),
                        true
                    );
                },
            },
            icon: 'lucide:crosshair',
        },
        {
            id: 'perf:autoCenterHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.autoCenterHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'perf:renderScale',
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
                    engine.setHardwareScalingLevel(calcHardwareScaling(window.devicePixelRatio || 1, v as number));
                    setStatus(
                        t('settings.renderScale', { pct: Math.round((v as number) * 100) }),
                        true
                    );
                },
            },
            icon: 'lucide:scan',
        },
        {
            id: 'perf:renderScaleHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.renderScaleHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'perf:camSens',
            kind: 'slider',
            label: 'settings.perf.camSens',
            control: {
                bind: 'ui.cameraSensitivity',
                min: 0.2,
                max: 3,
                step: 0.1,
                get: (v) => (v as number) ?? 1,
                set: (v) => Math.round((v as number) * 10) / 10,
                onChange: (v) => {
                    refreshCameraUserSettings();
                    setStatus(t('settings.camSens', { x: v as number }), true);
                },
            },
            icon: 'lucide:move',
        },
        {
            id: 'perf:camSensHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.camSensHint');
                c.appendChild(hint);
            },
        },
        {
            id: 'perf:invertY',
            kind: 'toggle',
            label: 'settings.perf.invertY',
            control: {
                bind: 'ui.invertYAxis',
                get: (v) => v === true,
                set: (v) => v,
                onChange: (v) => {
                    refreshCameraUserSettings();
                    setStatus(
                        t('settings.invertY', { state: v ? t('common.on') : t('common.off') }),
                        true
                    );
                },
            },
            icon: 'lucide:flip-vertical',
        },
        {
            id: 'perf:invertYHint',
            kind: 'custom',
            renderCustom: (c) => {
                const hint = document.createElement('div');
                hint.className = 'setting-hint';
                hint.textContent = t('settings.perf.invertYHint');
                c.appendChild(hint);
            },
        },
    ];
}

export function buildSettingsPerformanceLevel(
    getSettingsMenu: () => SettingsMenuHandle
): PopupLevel {
    return {
        label: t('settings.performance.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSectionTitle(c, t('settings.performance.title'));
                renderMenu(buildPerfSchema(getSettingsMenu), c);
            });
        },
    };
}
