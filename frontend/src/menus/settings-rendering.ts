// settings-rendering.ts — 渲染设置子菜单（从 settings-performance 拆出）
// 管理自定义渲染开关：阴影/bloom/fxaa/dof/vignette/outline/glow/色差/颗粒/ssr/反射探针/ssao

import { t } from '../core/i18n/t';
import { setStatus, cardContainer } from '../core/config';
import { addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { getRenderState, setRenderState } from '../scene/render/renderer';
import { getLightState, setLightState } from '../scene/render/lighting';
import { resetPerformanceSnapshot } from '../scene/render/performance';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';
import { renderMenu } from './render-menu';
import { addInlineToggleRow } from '../core/ui-helpers';
import type { MenuNode } from './menu-schema';

function buildRenderingSchema(): MenuNode[] {
    return [
        {
            id: 'rendering:toggles',
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
                        label: t('settings.perf.ssr'),
                        value: rs.ssrEnabled,
                        apply: (v) => setRenderState({ ssrEnabled: v }),
                    },
                    {
                        label: t('settings.perf.reflectionProbe'),
                        value: rs.reflectionProbeEnabled,
                        apply: (v) => setRenderState({ reflectionProbeEnabled: v }),
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

export function buildSettingsRenderingLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.rendering'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSectionTitle(c, t('settings.rendering'));
                renderMenu(buildRenderingSchema(), c);
            });
        },
    };
}
