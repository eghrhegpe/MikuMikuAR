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
    { key: 'auto', label: '自动', desc: '监控帧率，自动降低质量' },
    { key: 'quality', label: '质量优先', desc: '最高质量，不自动降级' },
    { key: 'balanced', label: '平衡', desc: '中等质量，适合大多数设备' },
    { key: 'performance', label: '性能优先', desc: '最低质量，确保流畅' },
    { key: 'custom', label: '自定义', desc: '逐项独立控制渲染/光照开关' },
];

export function buildSettingsPerformanceLevel(getSettingsMenu: () => SettingsMenuHandle): PopupLevel {
    return {
        label: '性能',
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
                    c, '帧率上限', currentFps, 0, 144, 1,
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
                hint.textContent = '设为 0 表示不限制。移动端建议 30 以省电。';
                c.appendChild(hint);
            });

            // 垂直同步
            cardContainer(container, (c) => {
        addToggleRow(c, '垂直同步', uiState.vsync !== false,
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
          ? '开启该项后，框架采用 requestAnimationFrame 循环；关闭后帧率不受刷新率限制，但无法设置帧率上限。'
          : '关闭后无法使用"帧率上限"，Engine 总是不限帧（相当于 maxFPS=0）。';
        c.appendChild(hintVsync);
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = '浏览器/WebView 渲染循环由 requestAnimationFrame 驱动，天然与刷新同步；关闭后解除人为限帧（实际仍受刷新率约束）。';
                c.appendChild(hint);
            });

            // 默认物理开关
            cardContainer(container, (c) => {
                addToggleRow(c, '默认启用物理模拟', uiState.defaultPhysicsEnabled !== false,
                    (v) => {
                        setUIState({ defaultPhysicsEnabled: v });
      getSettingsMenu()?.updateControls();
      setStatus(v ? t('settings.physOn') : t('settings.physOff'), true);
                    },
                    'lucide:atom'
                );
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                hint.textContent = '关闭可提升低配设备性能；仅影响后续加载的模型，已加载模型不受影响。';
                c.appendChild(hint);
            });

            // 渲染分辨率缩放
            cardContainer(container, (c) => {
                addSliderRow(c, '渲染分辨率缩放', uiState.renderScale ?? 1, 0.5, 2, 0.05,
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
                hint.textContent = '低于 100% 提升性能，高于 100% 超采样更清晰（更耗 GPU）。';
                c.appendChild(hint);
            });

            // 鼠标/触控灵敏度
            cardContainer(container, (c) => {
                addSliderRow(c, '鼠标/触控灵敏度', uiState.cameraSensitivity ?? 1, 0.2, 3, 0.1,
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
                hint.textContent = '影响旋转/缩放/平移速度，实时作用于当前相机。';
                c.appendChild(hint);
            });

            // 反转 Y 轴
            cardContainer(container, (c) => {
                addToggleRow(c, '反转 Y 轴（垂直拖拽）', uiState.invertYAxis === true,
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
                hint.textContent = '反转上下拖拽方向，立即作用于当前相机（ArcRotate 模式）。';
                c.appendChild(hint);
            });

// 自定义模式：逐项渲染/光照独立开关
if (getPerformanceMode() === 'custom') {
    cardContainer(container, (c) => {
        addSectionTitle(c, '自定义渲染项');
        // 在切入 custom 时若存在自动降级快照，恢复快照=用户原始状态
        resetPerformanceSnapshot();
        const rs = getRenderState();
        const ls = getLightState();
        const renderToggles: Array<{ label: string; value: boolean; apply: (v: boolean) => void }> = [
                        { label: '阴影', value: ls.shadowEnabled, apply: (v) => setLightState({ shadowEnabled: v }) },
                        { label: '泛光 (Bloom)', value: rs.bloomEnabled, apply: (v) => setRenderState({ bloomEnabled: v }) },
                        { label: 'FXAA 抗锯齿', value: rs.fxaaEnabled, apply: (v) => setRenderState({ fxaaEnabled: v }) },
                        { label: '景深 (DOF)', value: rs.dofEnabled, apply: (v) => setRenderState({ dofEnabled: v }) },
                        { label: '暗角', value: rs.vignetteEnabled, apply: (v) => setRenderState({ vignetteEnabled: v }) },
                        { label: '边缘高亮', value: rs.outlineEnabled, apply: (v) => setRenderState({ outlineEnabled: v }) },
                        { label: '辉光 (Glow)', value: rs.glowEnabled, apply: (v) => setRenderState({ glowEnabled: v }) },
                        { label: '色差', value: rs.chromaticAberrationEnabled, apply: (v) => setRenderState({ chromaticAberrationEnabled: v }) },
                        { label: '颗粒', value: rs.grainEnabled, apply: (v) => setRenderState({ grainEnabled: v }) },
                        { label: '屏幕空间反射 (SSR)', value: rs.ssrEnabled, apply: (v) => setRenderState({ ssrEnabled: v }) },
                        { label: '环境反射探针', value: rs.reflectionProbeEnabled, apply: (v) => setRenderState({ reflectionProbeEnabled: v }) },
                        { label: '环境光遮蔽 (SSAO)', value: rs.ssaoEnabled, apply: (v) => setRenderState({ ssaoEnabled: v }) },
                    ];
  for (const toggle of renderToggles) {
                        addToggleRow(c, toggle.label, toggle.value,
                            (v) => { toggle.apply(v); setStatus(t('settings.toggleState', { label: toggle.label, state: v ? t('common.on') : t('common.off') }), true); },
                            'lucide:sliders-horizontal'
                        );
                    }
                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:10px;color:var(--text-muted);padding:2px 14px 4px;';
                    hint.textContent = '自定义模式下这些开关为权威配置，性能监控不会覆盖；MSAA 档位与强度参数请在场景→渲染菜单调整。';
                    c.appendChild(hint);
                });
            }
        },
    };
}
