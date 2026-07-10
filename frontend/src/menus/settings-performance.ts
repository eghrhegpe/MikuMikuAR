// settings-performance.ts — 性能设置子菜单

import { SetPerformanceMode } from '../core/wails-bindings';
import { t } from '../core/i18n/t';
import { setStatus, uiState, setUIState, cardContainer } from '../core/config';
import { slideRow, addSliderRow, addToggleRow, addSectionTitle } from '../core/ui-helpers';
import { getCurrentRenderingMenu } from './menu';
import { setPerformanceMode, getPerformanceMode, resetPerformanceSnapshot } from '../scene/render/performance';
import { getRenderState, setRenderState } from '../scene/render/renderer';
import { getLightState, setLightState } from '../scene/render/lighting';
import { engine, applyFrameControl } from '../scene/scene';
import { refreshCameraUserSettings } from '../scene/camera/camera';
import type { PopupLevel } from '../core/config';
import type { SettingsMenuHandle } from './settings-shared';

const PERFORMANCE_MODES: Array<{
    key: 'auto' | 'quality' | 'balanced' | 'performance' | 'custom';
    label: string;
    desc: string;
}> = [
    { key: 'auto', label: t('settings.perf.auto'), desc: t('settings.perf.autoDesc') },
    { key: 'quality', label: t('settings.perf.quality'), desc: t('settings.perf.qualityDesc') },
    { key: 'balanced', label: t('settings.perf.balanced'), desc: t('settings.perf.balancedDesc') },
    { key: 'performance', label: t('settings.perf.performance'), desc: t('settings.perf.performanceDesc') },
    { key: 'custom', label: t('settings.perf.custom'), desc: t('settings.perf.customDesc') },
];

export function buildSettingsPerformanceLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: t('settings.performance.title'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
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
                            SetPerformanceMode(m.key).catch(() => {});
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
            });

            // 帧率限制
            cardContainer(container, (c) => {
                const currentFps = uiState.fpsLimit ?? 0;
                addSliderRow(
                    c, t('settings.perf.fpsCap'), currentFps, 0, 144, 1,
                    (v) => {
                        const limit = Math.round(v);
                        setUIState({ fpsLimit: limit === 0 ? 0 : limit });
                        applyFrameControl();
      getSettingsMenu()?.updateControls();
      setStatus(limit === 0 ? t('settings.perfFpsUnlimited') : t('settings.perfFpsLimit', {limit}), true);
                    },
                    'lucide:gauge', undefined,
                    { bind: () => uiState.fpsLimit ?? 0 }
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.fpsHint');
                c.appendChild(hint);
            });

            // 垂直同步
            cardContainer(container, (c) => {
        addToggleRow(c, t('settings.perf.vsync'), uiState.vsync !== false,
          (v) => {
            setUIState({ vsync: v });
            applyFrameControl();
      getSettingsMenu()?.updateControls();
      setStatus(t('settings.perfVsync', {state: v ? t('common.on') : t('common.off')}), true);
          },
          'lucide:monitor-check'
        );
        const hintVsync = document.createElement('div');
        hintVsync.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
        hintVsync.textContent = uiState.vsync !== false
          ? t('settings.perf.vsyncHintOn')
          : t('settings.perf.vsyncHintOff');
        c.appendChild(hintVsync);
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.vsyncHintBrowser');
                c.appendChild(hint);
            });

            // 默认物理开关
            cardContainer(container, (c) => {
                addToggleRow(c, t('settings.perf.defaultPhysics'), uiState.defaultPhysicsEnabled !== false,
                    (v) => {
                        setUIState({ defaultPhysicsEnabled: v });
      getSettingsMenu()?.updateControls();
      setStatus(v ? t('settings.physOn') : t('settings.physOff'), true);
                    },
                    'lucide:atom'
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.defaultPhysicsHint');
                c.appendChild(hint);
            });

            // 默认模型自动居中（相机自动对准新加载模型）
            cardContainer(container, (c) => {
                addToggleRow(c, t('settings.perf.autoCenter'), uiState.autoCenterModel !== false,
                    (v) => {
                        setUIState({ autoCenterModel: v });
      getSettingsMenu()?.updateControls();
      setStatus(t('settings.perf.autoCenterState', { state: v ? t('common.on') : t('common.off') }), true);
                    },
                    'lucide:crosshair'
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.autoCenterHint');
                c.appendChild(hint);
            });

            // 渲染分辨率缩放
            cardContainer(container, (c) => {
                addSliderRow(c, t('settings.perf.renderScale'), uiState.renderScale ?? 1, 0.5, 2, 0.05,
                    (v) => {
                        const s = Math.round(v * 100) / 100;
                        engine.setHardwareScalingLevel(1 / s);
                        setUIState({ renderScale: s });
      getSettingsMenu()?.updateControls();
      setStatus(t('settings.renderScale', {pct: Math.round(s * 100)}), true);
                    },
                    'lucide:scan', undefined,
                    { bind: () => uiState.renderScale ?? 1 }
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.renderScaleHint');
                c.appendChild(hint);
            });

            // 鼠标/触控灵敏度
            cardContainer(container, (c) => {
                addSliderRow(c, t('settings.perf.camSens'), uiState.cameraSensitivity ?? 1, 0.2, 3, 0.1,
                    (v) => {
                        const s = Math.round(v * 10) / 10;
                        setUIState({ cameraSensitivity: s });
                        refreshCameraUserSettings();
      getSettingsMenu()?.updateControls();
      setStatus(t('settings.camSens', {x: s}), true);
                    },
                    'lucide:move', undefined,
                    { bind: () => uiState.cameraSensitivity ?? 1 }
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.camSensHint');
                c.appendChild(hint);
            });

            // 反转 Y 轴
            cardContainer(container, (c) => {
                addToggleRow(c, t('settings.perf.invertY'), uiState.invertYAxis === true,
                    (v) => {
                        setUIState({ invertYAxis: v });
                        refreshCameraUserSettings();
      getSettingsMenu()?.updateControls();
      setStatus(t('settings.invertY', {state: v ? t('common.on') : t('common.off')}), true);
                    },
                    'lucide:flip-vertical'
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = t('settings.perf.invertYHint');
                c.appendChild(hint);
            });

// 自定义模式：逐项渲染/光照独立开关
if (getPerformanceMode() === 'custom') {
    cardContainer(container, (c) => {
        addSectionTitle(c, t('settings.perf.customRender'));
        // 在切入 custom 时若存在自动降级快照，恢复快照=用户原始状态
        resetPerformanceSnapshot();
        const rs = getRenderState();
        const ls = getLightState();
        const renderToggles: Array<{ label: string; value: boolean; apply: (v: boolean) => void }> = [
                        { label: t('settings.perf.shadow'), value: ls.shadowEnabled, apply: (v) => setLightState({ shadowEnabled: v }) },
                        { label: t('settings.perf.bloom'), value: rs.bloomEnabled, apply: (v) => setRenderState({ bloomEnabled: v }) },
                        { label: t('settings.perf.fxaa'), value: rs.fxaaEnabled, apply: (v) => setRenderState({ fxaaEnabled: v }) },
                        { label: t('settings.perf.dof'), value: rs.dofEnabled, apply: (v) => setRenderState({ dofEnabled: v }) },
                        { label: t('settings.perf.vignette'), value: rs.vignetteEnabled, apply: (v) => setRenderState({ vignetteEnabled: v }) },
                        { label: t('settings.perf.outline'), value: rs.outlineEnabled, apply: (v) => setRenderState({ outlineEnabled: v }) },
                        { label: t('settings.perf.glow'), value: rs.glowEnabled, apply: (v) => setRenderState({ glowEnabled: v }) },
                        { label: t('settings.perf.chromaticAberration'), value: rs.chromaticAberrationEnabled, apply: (v) => setRenderState({ chromaticAberrationEnabled: v }) },
                        { label: t('settings.perf.grain'), value: rs.grainEnabled, apply: (v) => setRenderState({ grainEnabled: v }) },
                        { label: t('settings.perf.ssr'), value: rs.ssrEnabled, apply: (v) => setRenderState({ ssrEnabled: v }) },
                        { label: t('settings.perf.reflectionProbe'), value: rs.reflectionProbeEnabled, apply: (v) => setRenderState({ reflectionProbeEnabled: v }) },
                        { label: t('settings.perf.ssao'), value: rs.ssaoEnabled, apply: (v) => setRenderState({ ssaoEnabled: v }) },
                    ];
  for (const toggle of renderToggles) {
                        addToggleRow(c, toggle.label, toggle.value,
                            (v) => { toggle.apply(v); setStatus(t('settings.toggleState', { label: toggle.label, state: v ? t('common.on') : t('common.off') }), true); },
                            'lucide:sliders-horizontal'
                        );
                    }
                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                    hint.textContent = t('settings.perf.customHint');
                    c.appendChild(hint);
                });
            }
        },
    };
}
