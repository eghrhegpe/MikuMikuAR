// [doc:architecture] Env Feature Levels — 环境功能弹窗层级（天空/地面/水面/风/云/实验功能）
// 从 env-menu.ts 拆分

import { envState, cardContainer, setStatus } from '../core/config';
import type { PopupLevel } from '../core/config';
import { escapeHtml } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
    addPresetChip,
} from '../core/ui-helpers';
import { setEnvState, engine } from '../scene/scene';
import { WATER_PRESETS, applyWaterPresetToCurrent } from '../scene/env/env-water';
import { SelectEnvTextureFile, SelectPMXFile } from '../core/wails-bindings';
import { getEnvMenu } from './env-menu';

export function buildSkyLevel(): PopupLevel {
    return {
        label: '天空',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    '天空模式',
                    [
                        { value: 'color', label: '纯色' },
                        { value: 'texture', label: '贴图' },
                        { value: 'procedural', label: '程序化' },
                    ],
                    s.skyMode,
                    (v) => {
                        setEnvState({ skyMode: v });
                        getEnvMenu()?.reRender();
                    },
                    'lucide:sun'
                );

                if (s.skyMode === 'color') {
                    addColorSliderRow(c, '天空色', s.skyColorTop, (v) =>
                        setEnvState({ skyColorTop: v })
                    );
                } else if (s.skyMode === 'procedural') {
                    addColorSliderRow(c, '天顶色', s.skyColorTop, (v) =>
                        setEnvState({ skyColorTop: v })
                    );
                    addColorSliderRow(c, '地平色', s.skyColorBot, (v) =>
                        setEnvState({ skyColorBot: v })
                    );
                    addToggleRow(c, '星空 ✨', s.starsEnabled ?? false, (v) =>
                        setEnvState({ starsEnabled: v })
                    );
                }

                if (s.skyMode === 'texture') {
                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px 0;';
                    hint.textContent = '支持 .hdr / .dds / .exr 格式的环境贴图';
                    c.appendChild(hint);
                    const texRow = document.createElement('div');
                    texRow.className = 'slide-item';
                    const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : '未选择';
                    const ti = document.createElement('span');
                    ti.className = 'slide-icon';
                    const te = createIconifyIcon('lucide:image');
                    if (te) { ti.appendChild(te); }
                    texRow.appendChild(ti);
                    const tl = document.createElement('span');
                    tl.className = 'slide-label';
                    tl.textContent = '环境贴图';
                    texRow.appendChild(tl);
                    const ts = document.createElement('span');
                    ts.className = 'slide-sublabel';
                    ts.textContent = fileName;
                    texRow.appendChild(ts);
                    texRow.addEventListener('click', async () => {
                        const path = await SelectEnvTextureFile().catch(() => '');
                        if (path) { setEnvState({ skyTexture: path }); }
                    });
                    c.appendChild(texRow);
                    addSliderRow(c, '旋 Y', s.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), 'lucide:refresh-cw');
                    addSliderRow(c, '天空照明', s.envIntensity / 3, 0, 1, 0.05, (v) => setEnvState({ envIntensity: v * 3 }), 'lucide:sun');
                }
                if (s.skyMode === 'procedural') {
                    addSliderRow(c, '亮度', s.skyBrightness, 0.1, 5, 0.1, (v) => setEnvState({ skyBrightness: v }), 'lucide:sun');
                }
                addSliderRow(c, '天空旋转速度', s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => setEnvState({ skyRotationSpeed: v }), 'lucide:rotate-cw');
            });
        },
        reRenderCustom: (container) => {
            const s = envState;
            const labels: Record<string, string> = { color: '纯色', texture: '贴图', procedural: '程序化' };
            const modeSlider = container.querySelector('.cs-row:first-child');
            if (!modeSlider) return;
            const valEl = modeSlider.querySelector('.cs-value');
            if (valEl) valEl.textContent = labels[s.skyMode] || s.skyMode;
            const idx = ['color', 'texture', 'procedural'].indexOf(s.skyMode);
            if (idx >= 0) {
                const fill = modeSlider.querySelector('.cs-fill') as HTMLElement | null;
                const thumb = modeSlider.querySelector('.cs-thumb') as HTMLElement | null;
                const pct = idx > 0 ? (idx / 2) * 100 : 0;
                if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
            }
        },
    };
}

export function buildGroundLevel(): PopupLevel {
    return {
        label: '地面',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, '显示地面', s.groundVisible, (v) => setEnvState({ groundVisible: v }));
                addModeSlider(c, '地面模式', [
                    { value: 'solid', label: '纯色' },
                    { value: 'grid', label: '网格' },
                    { value: 'checker', label: '棋盘格' },
                ], s.groundMode, (v) => {
                    setEnvState({ groundMode: v });
                    getEnvMenu()?.reRender();
                }, 'lucide:square');
                addColorSliderRow(c, '地面色', s.groundColor, (v) => setEnvState({ groundColor: v }));
                if (s.groundMode === 'solid' || s.groundMode === 'checker') {
                    addSliderRow(c, '透明度', s.groundAlpha, 0, 1, 0.05, (v) => setEnvState({ groundAlpha: v }), 'lucide:eye');
                }
            });
        },
        reRenderCustom: (container) => {
            const s = envState;
            const labels: Record<string, string> = { solid: '纯色', grid: '网格', checker: '棋盘格' };
            const rows = container.querySelectorAll('.cs-row');
            for (const row of Array.from(rows) as HTMLElement[]) {
                const label = row.querySelector('.cs-label');
                if (label && label.textContent === '地面模式') {
                    const valEl = row.querySelector('.cs-value');
                    if (valEl) valEl.textContent = labels[s.groundMode] || s.groundMode;
                    const idx = ['solid', 'grid', 'checker'].indexOf(s.groundMode);
                    if (idx >= 0) {
                        const fill = row.querySelector('.cs-fill') as HTMLElement | null;
                        const thumb = row.querySelector('.cs-thumb') as HTMLElement | null;
                        const pct = idx > 0 ? (idx / 2) * 100 : 0;
                        if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                        if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
                    }
                    break;
                }
            }
        },
    };
}

export function buildWaterLevel(): PopupLevel {
    return {
        label: '水面',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                const waterPresetRow = document.createElement('div');
                waterPresetRow.className = 'preset-group';
                for (const [_key, wp] of Object.entries(WATER_PRESETS)) {
                    addPresetChip(waterPresetRow, wp.label, false, () => {
                        setEnvState({
                            waterColor: wp.waterColor, waterTransparency: wp.waterTransparency,
                            waterWaveHeight: wp.waterWaveHeight, waterAnimSpeed: wp.waterAnimSpeed,
                            foamThreshold: wp.foamThreshold, foamIntensity: wp.foamIntensity,
                        });
                        applyWaterPresetToCurrent(wp);
                        getEnvMenu()?.reRender();
                    });
                }
                c.appendChild(waterPresetRow);

                addCollapsible(c, {
                    title: '基础参数', icon: 'lucide:sliders', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '高度', s.waterLevel, -10, 10, 0.1, (v) => setEnvState({ waterLevel: v }), 'lucide:arrow-up');
                        addColorSliderRow(cc, '水色', s.waterColor, (v) => setEnvState({ waterColor: v }));
                        addSliderRow(cc, '透明度', s.waterTransparency, 0, 1, 0.05, (v) => setEnvState({ waterTransparency: v }), 'lucide:eye');
                    },
                });

                addCollapsible(c, {
                    title: '波浪', icon: 'lucide:waves', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '波高', s.waterWaveHeight, 0, 3, 0.1, (v) => setEnvState({ waterWaveHeight: v }), 'lucide:waves');
                        addSliderRow(cc, '泡沫阈值', s.foamThreshold, 0, 1, 0.01, (v) => setEnvState({ foamThreshold: v }));
                        addSliderRow(cc, '泡沫强度', s.foamIntensity, 0, 1, 0.05, (v) => setEnvState({ foamIntensity: v }), 'lucide:sparkles');
                        addSliderRow(cc, '动画速度', s.waterAnimSpeed ?? 1, 0.1, 5, 0.1, (v) => setEnvState({ waterAnimSpeed: v }), 'lucide:fast-forward');
                        addSliderRow(cc, '范围', s.waterSize, 10, 200, 5, (v) => setEnvState({ waterSize: v }), 'lucide:maximize');
                    },
                });

                addCollapsible(c, {
                    title: '水下效果', icon: 'lucide:waves',
                    renderContent: (cc) => {
                        addColorSliderRow(cc, '水下雾色', s.underwaterFogColor, (v) => setEnvState({ underwaterFogColor: v }));
                        addSliderRow(cc, '雾密度', s.underwaterFogDensity, 0, 0.1, 0.001, (v) => setEnvState({ underwaterFogDensity: v }));
                        addSliderRow(cc, '色差强度', s.underwaterChromaticAmount, 0, 20, 0.5, (v) => setEnvState({ underwaterChromaticAmount: v }));
                    },
                });
            });
        },
        // reRender: 更新所有滑块和色值显示，反映 envState 最新值
        reRenderCustom: (container) => {
            const s = envState;
            // 更新常规滑块
            const updateSlider = (label: string, value: number) => {
                const rows = container.querySelectorAll('.cs-row');
                for (const row of Array.from(rows) as HTMLElement[]) {
                    const lbl = row.querySelector('.cs-label');
                    if (lbl && lbl.textContent === label) {
                        const valEl = row.querySelector('.cs-value');
                        const bar = row.querySelector('.cs-bar');
                        if (valEl) valEl.textContent = String(Number(value.toFixed(2)));
                        if (bar) {
                            const min = parseFloat(bar.getAttribute('aria-valuemin') || '0');
                            const max = parseFloat(bar.getAttribute('aria-valuemax') || '1');
                            const range = max - min;
                            const pct = range > 0 ? ((value - min) / range) * 100 : 0;
                            const fill = bar.querySelector('.cs-fill') as HTMLElement | null;
                            const thumb = bar.querySelector('.cs-thumb') as HTMLElement | null;
                            if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
                            if (thumb) thumb.style.left = Math.max(0, Math.min(100, pct)) + '%';
                            bar.setAttribute('aria-valuenow', String(value));
                        }
                        break;
                    }
                }
            };
            // 更新颜色选择器
            const updateColor = (label: string, color: [number, number, number]) => {
                const blocks = container.querySelectorAll('.clr-block');
                for (const block of Array.from(blocks) as HTMLElement[]) {
                    const title = block.querySelector('.clr-title');
                    if (title && title.textContent === label) {
                        const swatch = block.querySelector('.clr-swatch') as HTMLElement | null;
                        if (swatch) swatch.style.background = `rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)})`;
                        const vals = block.querySelectorAll('.clr-value');
                        const bars = block.querySelectorAll('.clr-row .cs-bar');
                        for (let ci = 0; ci < 3; ci++) {
                            if (vals[ci]) vals[ci].textContent = color[ci].toFixed(2);
                            if (bars[ci]) {
                                const fill = bars[ci].querySelector('.cs-fill') as HTMLElement | null;
                                if (fill) fill.style.width = Math.max(0, Math.min(100, color[ci] * 100)) + '%';
                            }
                        }
                        break;
                    }
                }
            };
            // 基础参数
            updateSlider('高度', s.waterLevel);
            updateColor('水色', s.waterColor);
            updateSlider('透明度', s.waterTransparency);
            // 波浪
            updateSlider('波高', s.waterWaveHeight);
            updateSlider('泡沫阈值', s.foamThreshold);
            updateSlider('泡沫强度', s.foamIntensity);
            updateSlider('动画速度', s.waterAnimSpeed ?? 1);
            updateSlider('范围', s.waterSize);
            // 水下效果
            updateColor('水下雾色', s.underwaterFogColor);
            updateSlider('雾密度', s.underwaterFogDensity);
            updateSlider('色差强度', s.underwaterChromaticAmount);
        },
    };
}

export function buildWindLevel(): PopupLevel {
    return {
        label: '风',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            const dirAngle = (Math.atan2(s.windDirection[0], s.windDirection[2]) * 180) / Math.PI;
            const dirAngleNorm = (dirAngle + 360) % 360;
            cardContainer(container, (c) => {
                addSliderRow(c, '风向角度', dirAngleNorm, 0, 360, 1, (v) => {
                    const rad = (v * Math.PI) / 180;
                    setEnvState({ windDirection: [Math.sin(rad), s.windDirection[1], Math.cos(rad)] });
                }, 'lucide:compass');
                addSliderRow(c, '风速', s.windSpeed, 0, 10, 0.1, (v) => setEnvState({ windSpeed: v }), 'lucide:gauge');
            });
        },
    };
}

export function buildCloudLevel(): PopupLevel {
    return {
        label: '云',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addSliderRow(c, '云量', s.cloudCover, 0, 1, 0.01, (v) => setEnvState({ cloudCover: v }), 'lucide:cloud');
                addSliderRow(c, '云隙', s.cloudGap ?? 0.5, 0, 1, 0.01, (v) => setEnvState({ cloudGap: v }), 'lucide:columns');
                addSliderRow(c, '高度', s.cloudHeight, 50, 800, 5, (v) => setEnvState({ cloudHeight: v }), 'lucide:arrow-up');
                addSliderRow(c, '缩放', s.cloudScale, 0.1, 1, 0.05, (v) => setEnvState({ cloudScale: v }), 'lucide:maximize');
                addSliderRow(c, '厚度', s.cloudThickness ?? 15, 10, 50, 1, (v) => setEnvState({ cloudThickness: v }), 'lucide:move-vertical');
                addSliderRow(c, '可见距离', s.cloudVisibility ?? 2000, 500, 8000, 100, (v) => setEnvState({ cloudVisibility: v }), 'lucide:eye');
            });
        },
    };
}

export function buildExperimentalLevel(): PopupLevel {
    return {
        label: '实验功能',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const warning = document.createElement('div');
                warning.className = 'experimental-warning';
                warning.innerHTML = `<iconify-icon icon="lucide:alert-triangle" style="margin-right:6px;"></iconify-icon><span>以下功能性能开销较大，可能影响帧率，请谨慎开启。</span>`;
                c.appendChild(warning);

                const isWebGL2 = engine.webGLVersion >= 2;
                slideRow(c, 'lucide:cloud', '体积云', true, () => getEnvMenu()?.push(buildCloudLevel()),
                    undefined, undefined, {
                        value: envState.cloudsEnabled,
                        onChange: (v) => setEnvState({ cloudsEnabled: v }),
                        disabled: !isWebGL2,
                        disabledHint: '体积云需要 WebGL 2.0',
                        onDisabledClick: () => {
                            setStatus('⚠ 体积云需要 WebGL 2.0，当前引擎版本：' + engine.webGLVersion.toFixed(1), false);
                        },
                    });

                if (!isWebGL2) {
                    const hint = document.createElement('div');
                    hint.className = 'experimental-hint';
                    hint.textContent = '（当前设备不支持 WebGL 2.0，体积云不可用）';
                    c.appendChild(hint);
                }
            });
        },
    };
}
