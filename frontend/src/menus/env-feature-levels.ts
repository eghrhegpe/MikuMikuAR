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
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
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
                    'lucide:sun',
                    undefined,
                    {
                        bind: () => envState.skyMode,
                    }
                );

                if (s.skyMode === 'color') {
                    addColorSliderRow(c, '天空色', s.skyColorTop, (v) => {
                        setEnvState({ skyColorTop: v });
                    }, {
                        bind: () => envState.skyColorTop,
                    });
                } else if (s.skyMode === 'procedural') {
                    addColorSliderRow(c, '天顶色', s.skyColorTop, (v) => {
                        setEnvState({ skyColorTop: v });
                    }, {
                        bind: () => envState.skyColorTop,
                    });
                    addColorSliderRow(c, '地平色', s.skyColorBot, (v) => {
                        setEnvState({ skyColorBot: v });
                    }, {
                        bind: () => envState.skyColorBot,
                    });
                    addToggleRow(c, '星空 ✨', s.starsEnabled ?? false, (v) =>
                        setEnvState({ starsEnabled: v })
                    );
                }

                if (s.skyMode === 'texture') {
                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px 0;';
                    hint.textContent = '支持 .hdr / .dds / .exr 格式的环境贴图';
                    c.appendChild(hint);
                    const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : '未选择';
                    slideRow(c, 'lucide:image', '环境贴图', false, async () => {
                        const path = await SelectEnvTextureFile().catch(() => '');
                        if (path) { setEnvState({ skyTexture: path }); }
                    }, fileName);
                    addSliderRow(c, '旋 Y', s.skyRotationY, 0, 360, 1, (v) => setEnvState({ skyRotationY: v }), 'lucide:refresh-cw');
                }
                if (s.skyMode === 'procedural') {
                    addSliderRow(c, '亮度', s.skyBrightness, 0.1, 5, 0.1, (v) => setEnvState({ skyBrightness: v }), 'lucide:sun');
                }
                addSliderRow(c, '天空旋转速度', s.skyRotationSpeed ?? 0, 0, 5, 0.1, (v) => setEnvState({ skyRotationSpeed: v }), 'lucide:rotate-cw');

                // ── 光照控制（从 buildEnvUnifiedLevel 迁入）──
                addCollapsible(c, {
                    title: '光照控制', icon: 'lucide:sun', defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(inner, '太阳强度', getLightState().dirIntensity, 0, 1, 0.05,
                            (v) => { setLightingState({ dirIntensity: v }); },
                            'lucide:sun', undefined, {
                                bind: () => getLightState().dirIntensity,
                            });
                        addSliderRow(inner, '天空照明', s.envIntensity / 3, 0, 1, 0.05,
                            (v) => { setEnvState({ envIntensity: v * 3 }); }, 'lucide:sun', undefined, {
                                bind: () => envState.envIntensity / 3,
                            });
                    },
                });
            });
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
                    { value: 'texture', label: '纹理' },
                ], s.groundMode, (v) => {
                    setEnvState({ groundMode: v });
                    getEnvMenu()?.reRender();
                }, 'lucide:square', undefined, {
                    bind: () => envState.groundMode,
                });
                addColorSliderRow(c, '地面色', s.groundColor, (v) => { setEnvState({ groundColor: v }); }, {
                    bind: () => envState.groundColor,
                });
                if (s.groundMode === 'solid' || s.groundMode === 'checker') {
                    addSliderRow(c, '透明度', s.groundAlpha, 0, 1, 0.05, (v) => setEnvState({ groundAlpha: v }), 'lucide:eye');
                }
                if (s.groundMode === 'texture') {
                    const texturePresets = [
                        { value: '', label: '无' },
                        { value: 'textures/grass.png', label: '草地' },
                        { value: 'textures/stone.png', label: '石板' },
                        { value: 'textures/sand.png', label: '沙滩' },
                    ];
                    const chipRow = document.createElement('div');
                    chipRow.className = 'preset-group';
                    for (const tp of texturePresets) {
                        addPresetChip(chipRow, tp.label, s.groundTexture === tp.value, () => {
                            setEnvState({ groundTexture: tp.value, groundTextureEnabled: !!tp.value });
                        }, {
                            onUpdate: (btn) => {
                                btn.classList.toggle('active', envState.groundTexture === tp.value);
                            }
                        });
                    }
                    c.appendChild(chipRow);
                    addSliderRow(c, '纹理缩放', s.groundTextureScale, 0.1, 5, 0.1, (v) => setEnvState({ groundTextureScale: v }), 'lucide:zoom-in');
                }
            });
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
                    });
                }
                c.appendChild(waterPresetRow);

                addCollapsible(c, {
                    title: '基础参数', icon: 'lucide:sliders', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '高度', s.waterLevel, -10, 10, 0.1, (v) => { setEnvState({ waterLevel: v }); }, 'lucide:arrow-up', undefined, {
                            bind: () => envState.waterLevel,
                        });
                        addColorSliderRow(cc, '水色', s.waterColor, (v) => { setEnvState({ waterColor: v }); }, {
                            bind: () => envState.waterColor,
                        });
                        addSliderRow(cc, '透明度', s.waterTransparency, 0, 1, 0.05, (v) => { setEnvState({ waterTransparency: v }); }, 'lucide:eye', undefined, {
                            bind: () => envState.waterTransparency,
                        });
                    },
                });

                addCollapsible(c, {
                    title: '波浪', icon: 'lucide:waves', defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(cc, '波高', s.waterWaveHeight, 0, 3, 0.1, (v) => { setEnvState({ waterWaveHeight: v }); }, 'lucide:waves', undefined, {
                            bind: () => envState.waterWaveHeight,
                        });
                        addSliderRow(cc, '泡沫阈值', s.foamThreshold, 0, 1, 0.01, (v) => { setEnvState({ foamThreshold: v }); }, undefined, undefined, {
                            bind: () => envState.foamThreshold,
                        });
                        addSliderRow(cc, '泡沫强度', s.foamIntensity, 0, 1, 0.05, (v) => { setEnvState({ foamIntensity: v }); }, 'lucide:sparkles', undefined, {
                            bind: () => envState.foamIntensity,
                        });
                        addSliderRow(cc, '动画速度', s.waterAnimSpeed ?? 1, 0.1, 5, 0.1, (v) => { setEnvState({ waterAnimSpeed: v }); }, 'lucide:fast-forward', undefined, {
                            bind: () => envState.waterAnimSpeed ?? 1,
                        });
                        addSliderRow(cc, '范围', s.waterSize, 10, 200, 5, (v) => { setEnvState({ waterSize: v }); }, 'lucide:maximize', undefined, {
                            bind: () => envState.waterSize,
                        });
                    },
                });

                addCollapsible(c, {
                    title: '水下效果', icon: 'lucide:waves',
                    renderContent: (cc) => {
                        addColorSliderRow(cc, '水下雾色', s.underwaterFogColor, (v) => { setEnvState({ underwaterFogColor: v }); }, {
                            bind: () => envState.underwaterFogColor,
                        });
                        addSliderRow(cc, '雾密度', s.underwaterFogDensity, 0, 0.1, 0.001, (v) => { setEnvState({ underwaterFogDensity: v }); }, undefined, undefined, {
                            bind: () => envState.underwaterFogDensity,
                        });
                        addSliderRow(cc, '色差强度', s.underwaterChromaticAmount, 0, 20, 0.5, (v) => { setEnvState({ underwaterChromaticAmount: v }); }, undefined, undefined, {
                            bind: () => envState.underwaterChromaticAmount,
                        });
                        addSliderRow(cc, '色调强度', s.underwaterToneIntensity, 0, 1, 0.05, (v) => { setEnvState({ underwaterToneIntensity: v }); }, 'lucide:palette', undefined, {
                            bind: () => envState.underwaterToneIntensity,
                        });
                        addSliderRow(cc, '雾倍率', s.underwaterFogMultiplier, 1, 5, 0.1, (v) => { setEnvState({ underwaterFogMultiplier: v }); }, 'lucide:cloud-fog', undefined, {
                            bind: () => envState.underwaterFogMultiplier,
                        });
                    },
                });
            });
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
                    undefined, undefined, undefined, {
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

export function buildFogLevel(): PopupLevel {
    return {
        label: '雾',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, '启用雾', s.fogEnabled, (v) => { setEnvState({ fogEnabled: v }); }, 'lucide:cloud-fog', {
                    bind: () => envState.fogEnabled,
                });
                addModeSlider(
                    c,
                    '雾模式',
                    [
                        { value: 'exp2', label: 'EXP2' },
                        { value: 'exp', label: 'EXP' },
                        { value: 'linear', label: '线性' },
                    ],
                    s.fogMode,
                    (v) => { setEnvState({ fogMode: v as 'exp' | 'exp2' | 'linear' }); },
                    'lucide:layers',
                    undefined,
                    {
                        bind: () => envState.fogMode,
                    }
                );
                addColorSliderRow(c, '雾色', s.fogColor, (v) => { setEnvState({ fogColor: v }); }, {
                    bind: () => envState.fogColor,
                });
                addSliderRow(c, '雾密度', s.fogDensity, 0, 0.1, 0.001, (v) => { setEnvState({ fogDensity: v }); }, 'lucide:droplets', undefined, {
                    bind: () => envState.fogDensity,
                    onUpdate: (el) => {
                        el.style.display = envState.fogMode === 'linear' ? 'none' : '';
                    },
                });
                addSliderRow(c, '雾起始', s.fogStart ?? 10, 0, 200, 1, (v) => { setEnvState({ fogStart: v }); }, undefined, undefined, {
                    bind: () => envState.fogStart,
                    onUpdate: (el) => {
                        el.style.display = envState.fogMode === 'linear' ? '' : 'none';
                    },
                });
                addSliderRow(c, '雾结束', s.fogEnd ?? 100, 0, 200, 1, (v) => { setEnvState({ fogEnd: v }); }, undefined, undefined, {
                    bind: () => envState.fogEnd,
                    onUpdate: (el) => {
                        el.style.display = envState.fogMode === 'linear' ? '' : 'none';
                    },
                });
            });
        },
    };
}

export function buildShadowLevel(): PopupLevel {
    return {
        label: '阴影',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const ls = getLightState();
            cardContainer(container, (c) => {
                // ── 环境阴影（主场景方向光阴影）──
                addCollapsible(c, {
                    title: '环境阴影', icon: 'lucide:cloud', defaultOpen: true,
                    headerToggle: { value: ls.shadowEnabled, onChange: (v) => { setLightingState({ shadowEnabled: v }); }, bind: () => getLightState().shadowEnabled },
                    renderContent: (inner) => {
                        addModeSlider(inner, '阴影类型', [
                            { value: 'hard', label: '硬阴影' }, { value: 'soft', label: '软阴影' }, { value: 'pcf', label: 'PCF' },
                        ], ls.shadowType, (v) => { setLightingState({ shadowType: v }); }, 'lucide:cloud', undefined, {
                            bind: () => getLightState().shadowType,
                        });
                        const shadowQualityRow = document.createElement('div');
                        shadowQualityRow.className = 'preset-group';
                        for (const sq of [{ label: '低', value: 512 }, { label: '中', value: 1024 }, { label: '高', value: 2048 }, { label: '超高', value: 4096 }]) {
                            addPresetChip(shadowQualityRow, sq.label, ls.shadowResolution === sq.value, () => {
                                setLightingState({ shadowResolution: sq.value });
                            }, {
                                onUpdate: (btn) => {
                                    btn.classList.toggle('active', getLightState().shadowResolution === sq.value);
                                }
                            });
                        }
                        inner.appendChild(shadowQualityRow);
                        addSliderRow(inner, '阴影偏移', ls.shadowBias, 0, 0.01, 0.0001, (v) => { setLightingState({ shadowBias: v }); }, 'lucide:move', undefined, {
                            bind: () => getLightState().shadowBias,
                        });
                        addSliderRow(inner, '阴影级联', ls.shadowCascades, 2, 4, 1, (v) => { setLightingState({ shadowCascades: v }); }, 'lucide:layers', undefined, {
                            bind: () => getLightState().shadowCascades,
                        });
                    },
                });

                // ── 角色阴影 ──
                const charRow = document.createElement('div');
                charRow.className = 'slide-item';
                charRow.style.opacity = '0.6';
                charRow.style.cursor = 'default';
                const ci = document.createElement('span');
                ci.className = 'slide-icon';
                const ce = createIconifyIcon('lucide:user');
                if (ce) ci.appendChild(ce);
                charRow.appendChild(ci);
                const cl = document.createElement('span');
                cl.className = 'slide-label';
                cl.textContent = '角色阴影';
                charRow.appendChild(cl);
                const cs = document.createElement('span');
                cs.className = 'slide-sublabel';
                cs.textContent = 'MMD 模型自动接收阴影';
                charRow.appendChild(cs);
                c.appendChild(charRow);

                // ── 光照阴影（舞台灯光）──
                slideRow(c, 'lucide:lightbulb', '舞台灯光阴影', false, () => {
                    setStatus('在「场景」→「舞台灯光」中可逐个调节灯光阴影参数', true);
                }, '→ 场景菜单');
            });
        },
    };
}
