// [doc:architecture] Env Feature Levels — 环境功能弹窗层级（天空/地面/水面/风/云/实验功能）
// 从 env-menu.ts 拆分

import { envState, cardContainer, setStatus, getBrowseDir } from '../core/config';
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
import { t } from '../core/i18n/t';
import { getLightState, setLightState as setLightingState } from '../scene/render/lighting';
import {
    WATER_PRESETS,
    applyWaterPresetToCurrent,
    buildWaterPresetEnvState,
    disposeWater,
    createWater,
} from '../scene/env/env-water';
import { SelectEnvTextureFile, SelectPMXFile } from '../core/wails-bindings';
import { getEnvMenu, setEnvTextureBindingTarget } from './env-menu';
import { stackRegistry } from '../core/config';
import { closeAllOverlays } from '../core/utils';

export function buildSkyLevel(): PopupLevel {
    return {
        label: t('env.sky'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    t('env.skyMode'),
                    [
                        { value: 'color', label: t('env.solid') },
                        { value: 'texture', label: t('env.texture') },
                        { value: 'procedural', label: t('env.procedural') },
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
                    addColorSliderRow(
                        c,
                        t('env.skyColorTop'),
                        s.skyColorTop,
                        (v) => {
                            setEnvState({ skyColorTop: v });
                        },
                        {
                            bind: () => envState.skyColorTop,
                        }
                    );
                } else if (s.skyMode === 'procedural') {
                    addColorSliderRow(
                        c,
                        t('env.zenithColor'),
                        s.skyColorTop,
                        (v) => {
                            setEnvState({ skyColorTop: v });
                        },
                        {
                            bind: () => envState.skyColorTop,
                        }
                    );
                    addColorSliderRow(
                        c,
                        t('env.horizonColor'),
                        s.skyColorBot,
                        (v) => {
                            setEnvState({ skyColorBot: v });
                        },
                        {
                            bind: () => envState.skyColorBot,
                        }
                    );
                    addToggleRow(c, t('env.stars'), s.starsEnabled ?? false, (v) =>
                        setEnvState({ starsEnabled: v })
                    );
                }

                if (s.skyMode === 'texture') {
                    const hint = document.createElement('div');
                    hint.style.cssText = 'font-size:11px;color:var(--text-dim);padding:4px 14px 0;';
                    hint.textContent = t('env.skyTextureHint');
                    c.appendChild(hint);
                    const fileName = s.skyTexture
                        ? s.skyTexture.split(/[/\\]/).pop()
                        : t('env.notSelected');
                    slideRow(
                        c,
                        'lucide:image',
                        t('env.skyTexture'),
                        false,
                        async () => {
                            setEnvTextureBindingTarget('sky');
                            closeAllOverlays();
                            const level = stackRegistry.buildLevel!(
                                getBrowseDir('environment'),
                                t('env.skyTexture'),
                                (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format),
                                getEnvMenu()!
                            );
                            getEnvMenu()!.push(level);
                        },
                        fileName
                    );
                    addSliderRow(
                        c,
                        t('env.rotateY'),
                        s.skyRotationY,
                        0,
                        360,
                        1,
                        (v) => setEnvState({ skyRotationY: v }),
                        'lucide:refresh-cw'
                    );
                }
                if (s.skyMode === 'procedural') {
                    addSliderRow(
                        c,
                        t('env.brightness'),
                        s.skyBrightness,
                        0.1,
                        5,
                        0.1,
                        (v) => setEnvState({ skyBrightness: v }),
                        'lucide:sun'
                    );
                }
                addSliderRow(
                    c,
                    t('env.skyRotationSpeed'),
                    s.skyRotationSpeed ?? 0,
                    0,
                    5,
                    0.1,
                    (v) => setEnvState({ skyRotationSpeed: v }),
                    'lucide:rotate-cw'
                );

                // ── 光照控制（从 buildEnvUnifiedLevel 迁入）──
                addCollapsible(c, {
                    title: t('env.lightControl'),
                    icon: 'lucide:sun',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            t('env.sunIntensity'),
                            getLightState().dirIntensity,
                            0,
                            1,
                            0.05,
                            (v) => {
                                setLightingState({ dirIntensity: v });
                            },
                            'lucide:sun',
                            undefined,
                            {
                                bind: () => getLightState().dirIntensity,
                            }
                        );
                        addSliderRow(
                            inner,
                            t('env.skyLighting'),
                            s.envIntensity / 3,
                            0,
                            1,
                            0.05,
                            (v) => {
                                setEnvState({ envIntensity: v * 3 });
                            },
                            'lucide:sun',
                            undefined,
                            {
                                bind: () => envState.envIntensity / 3,
                            }
                        );
                    },
                });
            });
        },
    };
}

export function buildGroundLevel(): PopupLevel {
    return {
        label: t('env.ground'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(c, t('env.showGround'), s.groundVisible, (v) =>
                    setEnvState({ groundVisible: v })
                );
                addSliderRow(
                    c,
                    t('env.groundHeight'),
                    s.groundLevel,
                    -5,
                    5,
                    0.1,
                    (v) => setEnvState({ groundLevel: v }),
                    'lucide:move-vertical'
                );
                addSliderRow(
                    c,
                    t('env.range'),
                    s.groundSize,
                    10,
                    200,
                    5,
                    (v) => setEnvState({ groundSize: v }),
                    'lucide:maximize',
                    undefined,
                    { bind: () => envState.groundSize }
                );
                addSliderRow(
                    c,
                    t('env.edgeFade'),
                    s.groundEdgeFade,
                    0,
                    1,
                    0.01,
                    (v) => setEnvState({ groundEdgeFade: v }),
                    'lucide:droplet',
                    undefined,
                    { bind: () => envState.groundEdgeFade }
                );
                addModeSlider(
                    c,
                    t('env.groundMode'),
                    [
                        { value: 'solid', label: t('env.solid') },
                        { value: 'grid', label: t('env.grid') },
                        { value: 'checker', label: t('env.checker') },
                        { value: 'texture', label: t('env.textureMode') },
                        { value: 'heightmap', label: t('env.heightmap') },
                    ],
                    s.groundMode,
                    (v) => {
                        setEnvState({ groundMode: v });
                        getEnvMenu()?.reRender();
                    },
                    'lucide:square',
                    undefined,
                    {
                        bind: () => envState.groundMode,
                    }
                );
                addColorSliderRow(
                    c,
                    t('env.groundColor'),
                    s.groundColor,
                    (v) => {
                        setEnvState({ groundColor: v });
                    },
                    {
                        bind: () => envState.groundColor,
                    }
                );
                if (s.groundMode === 'solid' || s.groundMode === 'checker') {
                    addSliderRow(
                        c,
                        t('env.opacity'),
                        s.groundAlpha,
                        0,
                        1,
                        0.05,
                        (v) => setEnvState({ groundAlpha: v }),
                        'lucide:eye'
                    );
                }
                // Grid/Checker 模式下的网格/棋盘格大小和第二颜色
                if (s.groundMode === 'grid') {
                    addSliderRow(
                        c,
                        t('env.gridSize'),
                        s.groundGridSize,
                        0.5,
                        5,
                        0.1,
                        (v) => setEnvState({ groundGridSize: v }),
                        'lucide:grid-3x3'
                    );
                    addColorSliderRow(
                        c,
                        t('env.gridLineColor'),
                        s.groundLineColor,
                        (v) => {
                            setEnvState({ groundLineColor: v });
                        },
                        {
                            bind: () => envState.groundLineColor,
                        }
                    );
                }
                if (s.groundMode === 'checker') {
                    addSliderRow(
                        c,
                        t('env.checkerSize'),
                        s.groundGridSize,
                        0.5,
                        5,
                        0.1,
                        (v) => setEnvState({ groundGridSize: v }),
                        'lucide:grid-3x3'
                    );
                    addColorSliderRow(
                        c,
                        t('env.secondColor'),
                        s.groundLineColor,
                        (v) => {
                            setEnvState({ groundLineColor: v });
                        },
                        {
                            bind: () => envState.groundLineColor,
                        }
                    );
                }
                if (s.groundMode === 'texture') {
                    const texturePresets = [
                        { value: '', label: t('env.none') },
                        { value: 'textures/grass.png', label: t('env.grass') },
                        { value: 'textures/stone.png', label: t('env.stone') },
                        { value: 'textures/sand.png', label: t('env.sand') },
                    ];
                    const chipRow = document.createElement('div');
                    chipRow.className = 'preset-group';
                    for (const tp of texturePresets) {
                        addPresetChip(
                            chipRow,
                            tp.label,
                            s.groundTexture === tp.value,
                            () => {
                                setEnvState({
                                    groundTexture: tp.value,
                                    groundTextureEnabled: !!tp.value,
                                });
                            },
                            {
                                onUpdate: (btn) => {
                                    btn.classList.toggle(
                                        'active',
                                        envState.groundTexture === tp.value
                                    );
                                },
                            }
                        );
                    }
                    c.appendChild(chipRow);
                    // 自定义纹理：slideRow + 库浏览
                    const groundFileName =
                        s.groundTexture && !s.groundTexture.startsWith('textures/')
                            ? (s.groundTexture.split(/[/\\]/).pop() ?? t('env.notSelected'))
                            : t('env.notSelected');
                    slideRow(
                        c,
                        'lucide:image',
                        t('env.customTexture'),
                        false,
                        () => {
                            setEnvTextureBindingTarget('ground');
                            const level = stackRegistry.buildLevel!(
                                'environment',
                                t('env.customTexture'),
                                (m) => ['png', 'jpg', 'jpeg', 'hdr', 'dds'].includes(m.format),
                                getEnvMenu()!
                            );
                            getEnvMenu()!.push(level);
                        },
                        groundFileName
                    );
                    if (s.groundTexture && !s.groundTexture.startsWith('textures/')) {
                        const clearRow = document.createElement('div');
                        clearRow.style.cssText =
                            'display:flex;justify-content:flex-end;padding:0 14px 4px;';
                        const clearBtn = document.createElement('button');
                        clearBtn.className = 'cs-btn cs-btn-sm';
                        clearBtn.textContent = t('env.clear');
                        clearBtn.onclick = () => {
                            setEnvState({ groundTexture: '', groundTextureEnabled: false });
                        };
                        clearRow.appendChild(clearBtn);
                        c.appendChild(clearRow);
                    }
                    addSliderRow(
                        c,
                        t('env.textureScale'),
                        s.groundTextureScale,
                        0.1,
                        5,
                        0.1,
                        (v) => setEnvState({ groundTextureScale: v }),
                        'lucide:zoom-in'
                    );
                    addSliderRow(
                        c,
                        t('env.textureRotation'),
                        s.groundTextureRotation,
                        0,
                        360,
                        1,
                        (v) => setEnvState({ groundTextureRotation: v }),
                        'lucide:rotate-cw'
                    );
                }
                if (s.groundMode === 'heightmap') {
                    addSliderRow(
                        c,
                        t('env.terrainHeight'),
                        s.groundTerrainHeight,
                        0,
                        15,
                        0.1,
                        (v) => setEnvState({ groundTerrainHeight: v }),
                        'lucide:mountain'
                    );
                    addSliderRow(
                        c,
                        t('env.terrainScale'),
                        s.groundTerrainScale,
                        0.01,
                        0.2,
                        0.005,
                        (v) => setEnvState({ groundTerrainScale: v }),
                        'lucide:ruler'
                    );
                    addSliderRow(
                        c,
                        t('env.terrainSeed'),
                        s.groundTerrainSeed,
                        0,
                        9999,
                        1,
                        (v) => setEnvState({ groundTerrainSeed: v }),
                        'lucide:dice-5'
                    );
                    addSliderRow(
                        c,
                        t('env.terrainOctaves'),
                        s.groundTerrainOctaves,
                        1,
                        8,
                        1,
                        (v) => setEnvState({ groundTerrainOctaves: v }),
                        'lucide:layers'
                    );
                }
            });
        },
    };
}

export function buildWaterLevel(): PopupLevel {
    return {
        label: t('env.water'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                const waterPresetRow = document.createElement('div');
                waterPresetRow.className = 'preset-group';
                for (const [_key, wp] of Object.entries(WATER_PRESETS)) {
                    addPresetChip(waterPresetRow, wp.label, false, () => {
                        // 基础 + 扩展参数一并写入 envState，由 _syncWaterUniforms 统一应用并持久化
                        setEnvState(buildWaterPresetEnvState(wp));
                        applyWaterPresetToCurrent(wp);
                    });
                }
                c.appendChild(waterPresetRow);

                addCollapsible(c, {
                    title: t('env.color'),
                    icon: 'lucide:palette',
                    defaultOpen: true,
                    renderContent: (cc) => {
                        addColorSliderRow(
                            cc,
                            t('env.waterColor'),
                            s.waterColor,
                            (v) => setEnvState({ waterColor: v }),
                            { bind: () => envState.waterColor }
                        );
                        addSliderRow(
                            cc,
                            t('env.opacity'),
                            s.waterTransparency,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ waterTransparency: v }),
                            'lucide:eye',
                            undefined,
                            { bind: () => envState.waterTransparency }
                        );
                        addColorSliderRow(
                            cc,
                            t('env.waterFogColor'),
                            s.waterFogColor,
                            (v) => setEnvState({ waterFogColor: v }),
                            { bind: () => envState.waterFogColor }
                        );
                        addSliderRow(
                            cc,
                            t('env.waterFogDensity'),
                            s.waterFogDensity,
                            0,
                            0.05,
                            0.001,
                            (v) => setEnvState({ waterFogDensity: v }),
                            'lucide:cloud-fog',
                            undefined,
                            { bind: () => envState.waterFogDensity }
                        );
                    },
                });

                addCollapsible(c, {
                    title: t('env.basicParams'),
                    icon: 'lucide:sliders',
                    defaultOpen: true,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            t('env.height'),
                            s.waterLevel,
                            -10,
                            30,
                            0.1,
                            (v) => setEnvState({ waterLevel: v }),
                            'lucide:arrow-up',
                            undefined,
                            { bind: () => envState.waterLevel }
                        );
                        addSliderRow(
                            cc,
                            t('env.range'),
                            s.waterSize,
                            10,
                            200,
                            5,
                            (v) => setEnvState({ waterSize: v }),
                            'lucide:maximize',
                            undefined,
                            { bind: () => envState.waterSize }
                        );
                        addSliderRow(
                            cc,
                            t('env.waveHeight'),
                            s.waterWaveHeight,
                            0,
                            3,
                            0.1,
                            (v) => setEnvState({ waterWaveHeight: v }),
                            'lucide:waves',
                            undefined,
                            { bind: () => envState.waterWaveHeight }
                        );
                        addSliderRow(
                            cc,
                            t('env.animSpeed'),
                            s.waterAnimSpeed ?? 1,
                            0.1,
                            5,
                            0.1,
                            (v) => setEnvState({ waterAnimSpeed: v }),
                            'lucide:fast-forward',
                            undefined,
                            { bind: () => envState.waterAnimSpeed ?? 1 }
                        );
                    },
                });

                addCollapsible(c, {
                    title: t('env.underwaterEffects'),
                    icon: 'lucide:waves',
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            t('env.fogDensity'),
                            s.underwaterFogDensity,
                            0,
                            0.15,
                            0.005,
                            (v) => {
                                setEnvState({ underwaterFogDensity: v });
                            },
                            undefined,
                            undefined,
                            {
                                bind: () => envState.underwaterFogDensity,
                            }
                        );
                        addSliderRow(
                            cc,
                            t('env.toneIntensity'),
                            s.underwaterToneIntensity,
                            0,
                            1,
                            0.05,
                            (v) => {
                                setEnvState({ underwaterToneIntensity: v });
                            },
                            'lucide:palette',
                            undefined,
                            {
                                bind: () => envState.underwaterToneIntensity,
                            }
                        );
                        addSliderRow(
                            cc,
                            t('env.underwaterTintStrength'),
                            s.underwaterTintStrength,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ underwaterTintStrength: v }),
                            'lucide:palette',
                            undefined,
                            { bind: () => envState.underwaterTintStrength }
                        );
                    },
                });

                addCollapsible(c, {
                    title: t('env.waterAdvanced'),
                    icon: 'lucide:settings-2',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            t('env.fresnelAlpha'),
                            s.fresnelAlphaInfluence,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ fresnelAlphaInfluence: v }),
                            undefined,
                            undefined,
                            { bind: () => envState.fresnelAlphaInfluence }
                        );
                        addSliderRow(
                            cc,
                            t('env.foamThreshold'),
                            s.foamThreshold,
                            0,
                            1,
                            0.01,
                            (v) => setEnvState({ foamThreshold: v }),
                            undefined,
                            undefined,
                            { bind: () => envState.foamThreshold }
                        );
                        addSliderRow(
                            cc,
                            t('env.foamIntensity'),
                            s.foamIntensity,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ foamIntensity: v }),
                            'lucide:sparkles',
                            undefined,
                            { bind: () => envState.foamIntensity }
                        );
                        addSliderRow(
                            cc,
                            t('env.foamOpacity'),
                            s.foamOpacity,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ foamOpacity: v }),
                            undefined,
                            undefined,
                            { bind: () => envState.foamOpacity }
                        );
                    },
                });
            });
            // —— 反射（ADR-062 P1）——
            cardContainer(container, (rc) => {
                addCollapsible(rc, {
                    title: t('env.reflection'),
                    icon: 'lucide:mirror',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            t('env.reflectionIntensity'),
                            s.planarReflectBlend,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ planarReflectBlend: v }),
                            'lucide:sliders-horizontal',
                            undefined,
                            { bind: () => envState.planarReflectBlend }
                        );
                        addModeSlider(
                            inner,
                            t('env.reflectionQuality'),
                            [
                                { value: 'high', label: t('env.reflectionQualityHigh') },
                                { value: 'medium', label: t('env.reflectionQualityMedium') },
                                { value: 'low', label: t('env.reflectionQualityLow') },
                                { value: 'off', label: t('env.reflectionQualityOff') },
                            ],
                            s.reflectionQuality,
                            (v) => {
                                setEnvState({ reflectionQuality: v });
                                disposeWater();
                                createWater(envState);
                            },
                            'lucide:gauge',
                            undefined,
                            { bind: () => envState.reflectionQuality }
                        );
                    },
                });
            });
        },
    };
}

export function buildWindLevel(): PopupLevel {
    return {
        label: t('env.wind'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            const dirAngle = (Math.atan2(s.windDirection[0], s.windDirection[2]) * 180) / Math.PI;
            const dirAngleNorm = (dirAngle + 360) % 360;
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    t('env.windAngle'),
                    dirAngleNorm,
                    0,
                    360,
                    1,
                    (v) => {
                        const rad = (v * Math.PI) / 180;
                        setEnvState({
                            windDirection: [Math.sin(rad), s.windDirection[1], Math.cos(rad)],
                        });
                    },
                    'lucide:compass'
                );
                addSliderRow(
                    c,
                    t('env.windSpeed'),
                    s.windSpeed,
                    0,
                    10,
                    0.1,
                    (v) => setEnvState({ windSpeed: v }),
                    'lucide:gauge'
                );
            });
        },
    };
}

export function buildCloudLevel(): PopupLevel {
    return {
        label: t('env.cloud'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    t('env.cloudCover'),
                    s.cloudCover,
                    0,
                    1,
                    0.01,
                    (v) => setEnvState({ cloudCover: v }),
                    'lucide:cloud'
                );
                addSliderRow(
                    c,
                    t('env.cloudGap'),
                    s.cloudGap ?? 0.5,
                    0,
                    1,
                    0.01,
                    (v) => setEnvState({ cloudGap: v }),
                    'lucide:columns'
                );
                addSliderRow(
                    c,
                    t('env.height'),
                    s.cloudHeight,
                    50,
                    800,
                    5,
                    (v) => setEnvState({ cloudHeight: v }),
                    'lucide:arrow-up'
                );
                addSliderRow(
                    c,
                    t('env.scale'),
                    s.cloudScale,
                    0.1,
                    1,
                    0.05,
                    (v) => setEnvState({ cloudScale: v }),
                    'lucide:maximize'
                );
                addSliderRow(
                    c,
                    t('env.thickness'),
                    s.cloudThickness ?? 15,
                    10,
                    50,
                    1,
                    (v) => setEnvState({ cloudThickness: v }),
                    'lucide:move-vertical'
                );
                addSliderRow(
                    c,
                    t('env.visibility'),
                    s.cloudVisibility ?? 2000,
                    500,
                    8000,
                    100,
                    (v) => setEnvState({ cloudVisibility: v }),
                    'lucide:eye'
                );
            });
        },
    };
}

export function buildExperimentalLevel(): PopupLevel {
    return {
        label: t('env.experimental'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const warning = document.createElement('div');
                warning.className = 'experimental-warning';
                warning.innerHTML =
                    '<iconify-icon icon="lucide:alert-triangle" style="margin-right:6px;"></iconify-icon><span>' +
                    t('env.experimentalWarn') +
                    '</span>';
                c.appendChild(warning);

                const isWebGL2 = engine.webGLVersion >= 2;
                slideRow(
                    c,
                    'lucide:cloud',
                    t('env.volumetricCloud'),
                    true,
                    () => getEnvMenu()?.push(buildCloudLevel()),
                    undefined,
                    undefined,
                    undefined,
                    {
                        value: envState.cloudsEnabled,
                        onChange: (v) => setEnvState({ cloudsEnabled: v }),
                        disabled: !isWebGL2,
                        disabledHint: t('env.volumetricCloudNeedWebGL'),
                        onDisabledClick: () => {
                            setStatus(
                                t('env.volumetricCloudNeedWebGL') +
                                    '，当前引擎版本：' +
                                    engine.webGLVersion.toFixed(1),
                                false
                            );
                        },
                    }
                );

                if (!isWebGL2) {
                    const hint = document.createElement('div');
                    hint.className = 'experimental-hint';
                    hint.textContent = t('env.volumetricCloudUnsupported');
                    c.appendChild(hint);
                }
            });
        },
    };
}

export function buildFogLevel(): PopupLevel {
    return {
        label: t('env.fog'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('env.enableFog'),
                    s.fogEnabled,
                    (v) => {
                        setEnvState({ fogEnabled: v });
                    },
                    'lucide:cloud-fog',
                    {
                        bind: () => envState.fogEnabled,
                    }
                );
                addModeSlider(
                    c,
                    t('env.fogMode'),
                    [
                        { value: 'exp2', label: 'EXP2' },
                        { value: 'exp', label: 'EXP' },
                        { value: 'linear', label: t('env.linear') },
                    ],
                    s.fogMode,
                    (v) => {
                        setEnvState({ fogMode: v as 'exp' | 'exp2' | 'linear' });
                    },
                    'lucide:layers',
                    undefined,
                    {
                        bind: () => envState.fogMode,
                    }
                );
                addColorSliderRow(
                    c,
                    t('env.fogColor'),
                    s.fogColor,
                    (v) => {
                        setEnvState({ fogColor: v });
                    },
                    {
                        bind: () => envState.fogColor,
                    }
                );
                addSliderRow(
                    c,
                    t('env.fogDensity'),
                    s.fogDensity,
                    0,
                    0.1,
                    0.001,
                    (v) => {
                        setEnvState({ fogDensity: v });
                    },
                    'lucide:droplets',
                    undefined,
                    {
                        bind: () => envState.fogDensity,
                        onUpdate: (el) => {
                            el.style.display = envState.fogMode === 'linear' ? 'none' : '';
                        },
                    }
                );
                addSliderRow(
                    c,
                    t('env.fogStart'),
                    s.fogStart ?? 10,
                    0,
                    200,
                    1,
                    (v) => {
                        setEnvState({ fogStart: v });
                    },
                    undefined,
                    undefined,
                    {
                        bind: () => envState.fogStart,
                        onUpdate: (el) => {
                            el.style.display = envState.fogMode === 'linear' ? '' : 'none';
                        },
                    }
                );
                addSliderRow(
                    c,
                    t('env.fogEnd'),
                    s.fogEnd ?? 100,
                    0,
                    200,
                    1,
                    (v) => {
                        setEnvState({ fogEnd: v });
                    },
                    undefined,
                    undefined,
                    {
                        bind: () => envState.fogEnd,
                        onUpdate: (el) => {
                            el.style.display = envState.fogMode === 'linear' ? '' : 'none';
                        },
                    }
                );
            });
        },
    };
}

export function buildShadowLevel(): PopupLevel {
    return {
        label: t('env.shadow'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const ls = getLightState();
            cardContainer(container, (c) => {
                // ── 环境阴影（主场景方向光阴影）──
                addCollapsible(c, {
                    title: t('env.envShadow'),
                    icon: 'lucide:cloud',
                    defaultOpen: true,
                    headerToggle: {
                        value: ls.shadowEnabled,
                        onChange: (v) => {
                            setLightingState({ shadowEnabled: v });
                        },
                        bind: () => getLightState().shadowEnabled,
                    },
                    renderContent: (inner) => {
                        addModeSlider(
                            inner,
                            t('env.shadowType'),
                            [
                                { value: 'hard', label: t('env.hardShadow') },
                                { value: 'soft', label: t('env.softShadow') },
                                { value: 'pcf', label: 'PCF' },
                            ],
                            ls.shadowType,
                            (v) => {
                                setLightingState({ shadowType: v });
                            },
                            'lucide:cloud',
                            undefined,
                            {
                                bind: () => getLightState().shadowType,
                            }
                        );
                        const shadowQualityRow = document.createElement('div');
                        shadowQualityRow.className = 'preset-group';
                        for (const sq of [
                            { label: t('env.low'), value: 512 },
                            { label: t('env.medium'), value: 1024 },
                            { label: t('env.high'), value: 2048 },
                            { label: t('env.ultra'), value: 4096 },
                        ]) {
                            addPresetChip(
                                shadowQualityRow,
                                sq.label,
                                ls.shadowResolution === sq.value,
                                () => {
                                    setLightingState({ shadowResolution: sq.value });
                                },
                                {
                                    onUpdate: (btn) => {
                                        btn.classList.toggle(
                                            'active',
                                            getLightState().shadowResolution === sq.value
                                        );
                                    },
                                }
                            );
                        }
                        inner.appendChild(shadowQualityRow);
                        addSliderRow(
                            inner,
                            t('env.shadowBias'),
                            ls.shadowBias,
                            0,
                            0.01,
                            0.0001,
                            (v) => {
                                setLightingState({ shadowBias: v });
                            },
                            'lucide:move',
                            undefined,
                            {
                                bind: () => getLightState().shadowBias,
                            }
                        );
                        addSliderRow(
                            inner,
                            t('env.shadowCascades'),
                            ls.shadowCascades,
                            2,
                            4,
                            1,
                            (v) => {
                                setLightingState({ shadowCascades: v });
                            },
                            'lucide:layers',
                            undefined,
                            {
                                bind: () => getLightState().shadowCascades,
                            }
                        );
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
                if (ce) {
                    ci.appendChild(ce);
                }
                charRow.appendChild(ci);
                const cl = document.createElement('span');
                cl.className = 'slide-label';
                cl.textContent = t('env.characterShadow');
                charRow.appendChild(cl);
                const cs = document.createElement('span');
                cs.className = 'slide-sublabel';
                cs.textContent = t('env.characterShadowHint');
                charRow.appendChild(cs);
                c.appendChild(charRow);

                // ── 光照阴影（舞台灯光）──
                slideRow(
                    c,
                    'lucide:lightbulb',
                    t('env.stageLightShadow'),
                    false,
                    () => {
                        setStatus(t('env.shadowHint'), true);
                    },
                    '→ ' + t('env.sceneMenu')
                );
            });
        },
    };
}
