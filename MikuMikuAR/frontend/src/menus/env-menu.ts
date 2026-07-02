// [doc:architecture] Env Menu — 环境弹窗（天空/地面/粒子/风/云/道具/预设）
// 从 scene-menu.ts 抽离

import {
    envState,
    EnvState,
    PopupLevel,
    PopupRow,
    escapeHtml,
    cardContainer,
    propRegistry,
    dom,
    closeAllOverlays,
} from '../core/config';
import { SlideMenu } from './menu';
import { createIconifyIcon } from '../core/icons';
import {
    slideRow,
    addToggleRow,
    addSliderRow,
    addColorSliderRow,
    addModeSlider,
    addCollapsible,
} from '../core/ui-helpers';
import {
    setEnvState,
    loadProp,
    removeProp,
    setPropTransform,
    getPropList,
    getEnvSunAngle,
    setEnvSunAngle,
    applyEnvPreset,
    applyEnvPresetObject,
    setRenderState,
    transitionRenderState,
} from '../scene/scene';
import {
    getLightState,
    setLightState as setLightingState,
    transitionLighting,
} from '../scene/scene-lighting';
import {
    ENV_PRESETS as ENV_LIGHTING_PRESETS,
    exportEnvPreset,
    importEnvPreset,
    type EnvPreset,
} from '../scene/env-lighting';
import { WATER_PRESETS, applyWaterPresetToCurrent } from '../scene/scene-env-water';
import {
    SelectEnvTextureFile,
    SelectPMXFile,
    SaveEnvPreset,
    LoadEnvPreset,
    ListEnvPresets,
    DeleteEnvPreset,
} from '../../wailsjs/go/main/App';
import { setStatus } from '../core/config';

// ======== User-Saved Env Presets ========

/** 构造当前环境状态的 EnvPreset 快照（用于保存为自定义预设）。 */
function snapshotCurrentEnvPreset(label: string): EnvPreset {
    return {
        label,
        skyColorTop: [...envState.skyColorTop] as [number, number, number],
        skyColorBot: [...envState.skyColorBot] as [number, number, number],
        sunAngle: getEnvSunAngle(),
        azimuth: envState.azimuth ?? -45,
        exposure: getLightState().dirIntensity > 0 ? 1.0 : 0.5,
        toneMapping: 1,
    };
}

/** 渲染「我的预设」分组：列表 + 应用 + 删除 + 保存当前。 */
function renderUserEnvPresets(container: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.style.paddingTop = '4px';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = '我的预设';
    wrapper.appendChild(title);

    const listHost = document.createElement('div');
    listHost.style.paddingBottom = '6px';
    wrapper.appendChild(listHost);

    const renderList = async () => {
        listHost.innerHTML = '';
        let entries: { name: string; label: string; createdAt: number }[] = [];
        try {
            entries = await ListEnvPresets();
        } catch (err) {
            console.warn('[env-menu] ListEnvPresets failed:', err);
        }
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '（暂无自定义预设）';
            empty.style.cssText = 'opacity:0.5;font-size:11px;padding:4px 0;';
            listHost.appendChild(empty);
            return;
        }
        // 按创建时间倒序
        entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        for (const e of entries) {
            const row = document.createElement('div');
            row.className = 'cs-row';
            const labelEl = document.createElement('button');
            labelEl.className = 'preset-chip';
            labelEl.textContent = e.label || e.name;
            labelEl.style.flex = '1';
            labelEl.addEventListener('click', async () => {
                try {
                    const json = await LoadEnvPreset(e.name);
                    const preset = importEnvPreset(json);
                    if (!preset) {
                        setStatus('✗ 预设文件格式错误', false);
                        return;
                    }
                    applyEnvPresetObject(preset);
                    setStatus(`✓ 已应用预设：${preset.label}`, true);
                } catch (err) {
                    console.error('[env-menu] LoadEnvPreset failed:', err);
                    setStatus('✗ 加载预设失败', false);
                }
            });
            row.appendChild(labelEl);

            const delBtn = document.createElement('button');
            delBtn.className = 'preset-chip';
            delBtn.style.cssText = 'flex:0 0 auto;padding:0 8px;color:var(--text-dim);';
            delBtn.textContent = '✕';
            delBtn.title = '删除预设';
            delBtn.addEventListener('click', async () => {
                try {
                    await DeleteEnvPreset(e.name);
                    setStatus(`✓ 已删除预设：${e.label}`, true);
                    renderList();
                } catch (err) {
                    console.error('[env-menu] DeleteEnvPreset failed:', err);
                    setStatus('✗ 删除预设失败', false);
                }
            });
            row.appendChild(delBtn);

            listHost.appendChild(row);
        }
    };

    // 「保存当前」按钮
    const saveRow = document.createElement('div');
    saveRow.className = 'cs-row';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'preset-chip';
    saveBtn.style.flex = '1';
    saveBtn.textContent = '＋ 保存当前为预设';
    saveBtn.addEventListener('click', async () => {
        const name = window.prompt('请输入预设名称（用作文件名，仅限字母数字/_/-/中文）');
        if (!name) return;
        try {
            const preset = snapshotCurrentEnvPreset(name);
            const json = exportEnvPreset(preset);
            await SaveEnvPreset(name, json);
            setStatus(`✓ 已保存预设：${name}`, true);
            renderList();
        } catch (err) {
            console.error('[env-menu] SaveEnvPreset failed:', err);
            setStatus('✗ 保存预设失败', false);
        }
    });
    saveRow.appendChild(saveBtn);
    wrapper.appendChild(saveRow);

    container.appendChild(wrapper);
    renderList();
}

// ======== Environment Level ========

let envMenu: SlideMenu | null = null;
export function getEnvMenu(): SlideMenu | null {
    return envMenu;
}

export function buildEnvLightingLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
    return {
        label: '环境光照',
        dir: '',
        items: [{ kind: 'divider' as const, label: '', icon: '', target: '' } as PopupRow],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                const presetRow = document.createElement('div');
                presetRow.className = 'preset-group';
                for (const [key, p] of Object.entries(ENV_LIGHTING_PRESETS)) {
                    const btn = document.createElement('button');
                    btn.textContent = p.label;
                    btn.className = 'preset-chip';
                    btn.addEventListener('click', () => {
                        applyEnvPreset(key);
                        envMenu.reRender();
                    });
                    presetRow.appendChild(btn);
                }
                c.appendChild(presetRow);
                renderUserEnvPresets(c);
                addSliderRow(
                    c,
                    '太阳角度',
                    sunAngle,
                    -15,
                    90,
                    1,
                    (v) => {
                        setEnvSunAngle(v);
                        setEnvState({ sunAngle: v });
                    },
                    'lucide:sun'
                );
            });
        },
    };
}

export function buildEnvUnifiedLevel(): PopupLevel {
    const sunAngle = getEnvSunAngle();
    const s = envState;

    return {
        label: '天空',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                // 天空模式
                addModeSlider(
                    c,
                    '天空模式',
                    [
                        { value: 'procedural', label: '程序化' },
                        { value: 'color', label: '纯色' },
                        { value: 'texture', label: '贴图' },
                    ],
                    s.skyMode,
                    (v) => {
                        setEnvState({ skyMode: v });
                        envMenu.reRender();
                    },
                    'lucide:layers'
                );

                // 快速预设
                const presetRow = document.createElement('div');
                presetRow.className = 'preset-group';
                presetRow.style.paddingBottom = '6px';
                for (const [key, p] of Object.entries(ENV_LIGHTING_PRESETS)) {
                    const btn = document.createElement('button');
                    btn.textContent = p.label;
                    btn.className = 'preset-chip';
                    btn.addEventListener('click', () => {
                        applyEnvPreset(key);
                        envMenu.reRender();
                    });
                    presetRow.appendChild(btn);
                }
                c.appendChild(presetRow);

                // 我的预设（用户保存的 .env 文件）
                renderUserEnvPresets(c);

                // ☀️ 光照控制
                addCollapsible(c, {
                    title: '光照控制',
                    icon: 'lucide:sun',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            '太阳强度',
                            getLightState().dirIntensity,
                            0,
                            1,
                            0.05,
                            (v) => {
                                setLightingState({ dirIntensity: v });
                                setRenderState({ exposure: Math.max(0.3, Math.min(2.0, v + 0.6)) });
                            },
                            'lucide:sun'
                        );
                        addSliderRow(
                            inner,
                            '天空照明',
                            s.envIntensity / 3,
                            0,
                            1,
                            0.05,
                            (v) => {
                                setEnvState({ envIntensity: v * 3 });
                            },
                            'lucide:sun'
                        );
                    },
                });

                // 🎨 天空外观
                addCollapsible(c, {
                    title: '天空外观',
                    icon: 'lucide:palette',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addColorSliderRow(inner, '天顶色', s.skyColorTop, (v) =>
                                setEnvState({ skyColorTop: v })
                            );
                            addColorSliderRow(inner, '地平色', s.skyColorBot, (v) =>
                                setEnvState({ skyColorBot: v })
                            );
                        } else if (s.skyMode === 'color') {
                            addColorSliderRow(inner, '天空色', s.skyColorTop, (v) =>
                                setEnvState({ skyColorTop: v })
                            );
                        } else if (s.skyMode === 'texture') {
                            const texRow = document.createElement('div');
                            texRow.className = 'slide-item';
                            const fileName = s.skyTexture ? s.skyTexture.split(/[/\\]/).pop() : '未选择';
                            texRow.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:image"></iconify-icon></span><span class="slide-label">环境贴图</span><span class="slide-sublabel">${escapeHtml(fileName)}</span>`;
                            texRow.addEventListener('click', async () => {
                                const path = await SelectEnvTextureFile().catch(() => '');
                                if (path) {
                                    setEnvState({ skyTexture: path });
                                }
                            });
                            inner.appendChild(texRow);
                        }
                    },
                });

                // ⚙️ 高级天空设置（折叠）
                addCollapsible(c, {
                    title: '高级天空设置',
                    icon: 'lucide:settings',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        if (s.skyMode === 'procedural') {
                            addToggleRow(inner, '星空', s.starsEnabled ?? false, (v) =>
                                setEnvState({ starsEnabled: v }),
                                'lucide:sparkles'
                            );
                        }
                        addSliderRow(
                            inner,
                            '天空旋转速度',
                            s.skyRotationSpeed ?? 0,
                            0,
                            5,
                            0.1,
                            (v) => setEnvState({ skyRotationSpeed: v }),
                            'lucide:rotate-cw'
                        );
                        addSliderRow(
                            inner,
                            '太阳角度',
                            sunAngle,
                            -15,
                            90,
                            1,
                            (v) => {
                                setEnvSunAngle(v);
                                setEnvState({ sunAngle: v });
                            },
                            'lucide:sun'
                        );
                        if (s.skyMode === 'texture') {
                            addSliderRow(
                                inner,
                                '旋转 Y',
                                s.skyRotationY,
                                0,
                                360,
                                1,
                                (v) => setEnvState({ skyRotationY: v }),
                                'lucide:refresh-cw'
                            );
                        }
                    },
                });

                // ☁️ 阴影设置
                addCollapsible(c, {
                    title: '阴影设置',
                    icon: 'lucide:cloud',
                    defaultOpen: false,
                    headerToggle: {
                        value: getLightState().shadowEnabled,
                        onChange: (v) => setLightingState({ shadowEnabled: v }),
                    },
                    renderContent: (inner) => {
                        addModeSlider(
                            inner,
                            '阴影类型',
                            [
                                { value: 'hard', label: '硬阴影' },
                                { value: 'soft', label: '软阴影' },
                                { value: 'pcf', label: 'PCF' },
                            ],
                            getLightState().shadowType,
                            (v) => setLightingState({ shadowType: v }),
                            'lucide:cloud'
                        );
                        const shadowQualityRow = document.createElement('div');
                        shadowQualityRow.className = 'preset-group';
                        const shadowQualities = [
                            { label: '低', value: 512 },
                            { label: '中', value: 1024 },
                            { label: '高', value: 2048 },
                            { label: '超高', value: 4096 },
                        ];
                        for (const sq of shadowQualities) {
                            const btn = document.createElement('button');
                            btn.textContent = sq.label;
                            btn.className = 'preset-chip';
                            if (getLightState().shadowResolution === sq.value) {
                                btn.classList.add('active');
                            }
                            btn.addEventListener('click', () => {
                                setLightingState({ shadowResolution: sq.value });
                                envMenu.reRender();
                            });
                            shadowQualityRow.appendChild(btn);
                        }
                        inner.appendChild(shadowQualityRow);
                        addSliderRow(
                            inner,
                            '阴影偏移',
                            getLightState().shadowBias,
                            0,
                            0.01,
                            0.0001,
                            (v) => setLightingState({ shadowBias: v }),
                            'lucide:move'
                        );
                        addSliderRow(
                            inner,
                            '阴影级联',
                            getLightState().shadowCascades,
                            1,
                            4,
                            1,
                            (v) => setLightingState({ shadowCascades: v }),
                            'lucide:layers'
                        );
                    },
                });
            });
        },
    };
}

export function buildEnvLevel(): PopupLevel {
    return {
        label: '环境',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:sun', '天空', true, () =>
                    envMenu.push(buildEnvUnifiedLevel())
                );
                slideRow(c, 'lucide:waves', '水面', true, () => envMenu.push(buildWaterLevel()),
                    undefined, undefined,
                    { value: envState.waterEnabled, onChange: (v) => setEnvState({ waterEnabled: v }) }
                );
                slideRow(c, 'lucide:wind', '粒子', true, () => envMenu.push(buildParticleLevel()),
                    undefined, undefined,
                    { value: envState.particleEnabled, onChange: (v) => setEnvState({ particleEnabled: v }) }
                );
                slideRow(c, 'lucide:wind', '风', true, () => envMenu.push(buildWindLevel()),
                    undefined, undefined,
                    { value: envState.windEnabled, onChange: (v) => setEnvState({ windEnabled: v }) }
                );
                slideRow(c, 'lucide:cloud', '云', true, () => envMenu.push(buildCloudLevel()),
                    undefined, undefined,
                    { value: envState.cloudsEnabled, onChange: (v) => setEnvState({ cloudsEnabled: v }) }
                );
                slideRow(c, 'lucide:box', '道具', true, () => envMenu.push(buildPropLevel()));
            });
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:bookmark', '系统预设', true, () =>
                    envMenu.push(buildPresetLevel())
                );
            });
        },
    };
}

interface EnvPresetConfig {
    env: Partial<EnvState>;
    lights?: Partial<import('../scene/scene').LightState>;
    render?: Partial<import('../scene/scene').RenderState>;
}

const ENV_PRESETS: Record<string, EnvPresetConfig> = {
    '舞台-A 打光': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.05, 0.05, 0.15],
            skyColorBot: [0.1, 0.05, 0.15],
            envIntensity: 0.5,
            groundMode: 'solid',
            groundColor: [0.05, 0.05, 0.08],
            particleEnabled: false,
        },
        lights: {
            hemiIntensity: 0.4,
            dirIntensity: 0.6,
            dirColor: [1, 0.85, 0.7],
            shadowEnabled: true,
            shadowType: 'soft',
        },
        render: { vignetteEnabled: true, vignetteDarkness: 0.3, exposure: 1.2 },
    },
    '户外晴天': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.3, 0.6, 1],
            skyColorBot: [0.6, 0.8, 1],
            skyBrightness: 2,
            envIntensity: 1.5,
            groundMode: 'grid',
            groundColor: [0.3, 0.35, 0.3],
        },
        lights: {
            hemiIntensity: 1,
            dirIntensity: 1.2,
            dirColor: [1, 0.95, 0.85],
            shadowEnabled: true,
            shadowType: 'pcf',
        },
        render: { exposure: 1.4, toneMapping: 1 },
    },
    '演唱会蓝紫': {
        env: {
            skyMode: 'procedural',
            skyColorTop: [0.4, 0.1, 0.6],
            skyColorMid: [0.2, 0.05, 0.4],
            skyColorBot: [0.1, 0.02, 0.2],
            envIntensity: 0.3,
            groundMode: 'solid',
            groundColor: [0.05, 0.02, 0.1],
            particleEnabled: true,
            particleType: 'fireworks',
        },
        lights: {
            hemiIntensity: 0.3,
            dirIntensity: 0.5,
            dirColor: [0.6, 0.3, 0.8],
            hemiColor: [0.3, 0.1, 0.5],
            shadowEnabled: false,
        },
        render: { vignetteEnabled: true, vignetteDarkness: 0.5, exposure: 0.9, toneMapping: 3 },
    },
};

export function buildPresetLevel(): PopupLevel {
    const entries = Object.entries(ENV_PRESETS);
    return {
        label: '系统预设',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            cardContainer(container, (c) => {
                for (const [name, preset] of entries) {
                    slideRow(c, 'lucide:bookmark', name, false, () => {
                        setEnvState({ ...preset.env });
                        if (preset.lights) {
                            transitionLighting(preset.lights, 2000);
                        }
                        if (preset.render) {
                            transitionRenderState(preset.render, 2000);
                        }
                        envMenu.reRender();
                    });
                }
            });
        },
    };
}

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
                        envMenu.reRender();
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
                    if (te) {
                        ti.appendChild(te);
                    }
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
                        if (path) {
                            setEnvState({ skyTexture: path });
                        }
                    });
                    c.appendChild(texRow);
                    addSliderRow(
                        c,
                        '旋 Y',
                        s.skyRotationY,
                        0,
                        360,
                        1,
                        (v) => setEnvState({ skyRotationY: v }),
                        'lucide:refresh-cw'
                    );
                    addSliderRow(
                        c,
                        '天空照明',
                        s.envIntensity / 3,
                        0,
                        1,
                        0.05,
                        (v) => setEnvState({ envIntensity: v * 3 }),
                        'lucide:sun'
                    );
                }
                if (s.skyMode === 'procedural') {
                    addSliderRow(
                        c,
                        '亮度',
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
                    '天空旋转速度',
                    s.skyRotationSpeed ?? 0,
                    0,
                    5,
                    0.1,
                    (v) => setEnvState({ skyRotationSpeed: v }),
                    'lucide:rotate-cw'
                );
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
                addToggleRow(c, '显示地面', s.groundVisible, (v) =>
                    setEnvState({ groundVisible: v })
                );
                addModeSlider(
                    c,
                    '地面模式',
                    [
                        { value: 'solid', label: '纯色' },
                        { value: 'grid', label: '网格' },
                        { value: 'checker', label: '棋盘格' },
                    ],
                    s.groundMode,
                    (v) => {
                        setEnvState({ groundMode: v });
                        envMenu.reRender();
                    },
                    'lucide:square'
                );
                addColorSliderRow(c, '地面色', s.groundColor, (v) =>
                    setEnvState({ groundColor: v })
                );
                if (s.groundMode === 'solid' || s.groundMode === 'checker') {
                    addSliderRow(
                        c,
                        '透明度',
                        s.groundAlpha,
                        0,
                        1,
                        0.05,
                        (v) => setEnvState({ groundAlpha: v }),
                        'lucide:eye'
                    );
                }
            });
        },
    };
}

export function buildPropLevel(): PopupLevel {
    return {
        label: '道具',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:plus', '添加道具文件', false, () => {
                    SelectPMXFile().then((path) => {
                        if (path) {
                            loadProp(path)
                                .then(() => envMenu.reRender())
                                .catch(() => {});
                        }
                    });
                });
            });
            const props = getPropList();
            if (props.length > 0) {
                cardContainer(container, (c) => {
                    for (const p of props) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        row.innerHTML = `<span class="slide-icon"><iconify-icon icon="lucide:box"></iconify-icon></span><span class="slide-label">${escapeHtml(p.name)}</span><span class="slide-arrow">&gt;</span>`;
                        row.addEventListener('click', () =>
                            envMenu.push(buildPropDetailLevel(p.id))
                        );
                        const delBtn = document.createElement('span');
                        delBtn.className = 'slide-del-btn';
                        delBtn.textContent = '×';
                        delBtn.title = '删除道具';
                        delBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            removeProp(p.id);
                            envMenu.reRender();
                        });
                        row.appendChild(delBtn);
                        c.appendChild(row);
                    }
                });
            } else {
                cardContainer(container, (c) => {
                    const empty = document.createElement('div');
                    empty.style.cssText =
                        'font-size:11px;color:var(--text-dim);padding:8px 4px;text-align:center;';
                    empty.textContent = '暂无道具，点击上方添加';
                    c.appendChild(empty);
                });
            }
        },
    };
}

export function buildPropDetailLevel(propId: string): PopupLevel {
    /** 道具滑块配置数组 */
    const PROP_SLIDER_PARAMS: {
        label: string;
        getValue: (p: import('../core/config').PropInstance) => number;
        min: number;
        max: number;
        step: number;
        icon: string;
        setValue: (p: import('../core/config').PropInstance, v: number) => void;
    }[] = [
        {
            label: '位置 X',
            getValue: (p) => p.position[0],
            min: -50,
            max: 50,
            step: 0.5,
            icon: 'lucide:move-horizontal',
            setValue: (p, v) => {
                p.position[0] = v;
                setPropTransform(propId, { position: [v, p.position[1], p.position[2]] });
            },
        },
        {
            label: '位置 Y',
            getValue: (p) => p.position[1],
            min: -50,
            max: 50,
            step: 0.5,
            icon: 'lucide:move-vertical',
            setValue: (p, v) => {
                p.position[1] = v;
                setPropTransform(propId, { position: [p.position[0], v, p.position[2]] });
            },
        },
        {
            label: '位置 Z',
            getValue: (p) => p.position[2],
            min: -50,
            max: 50,
            step: 0.5,
            icon: 'lucide:move',
            setValue: (p, v) => {
                p.position[2] = v;
                setPropTransform(propId, { position: [p.position[0], p.position[1], v] });
            },
        },
        {
            label: '旋转 Y',
            getValue: (p) => p.rotationY,
            min: -Math.PI,
            max: Math.PI,
            step: 0.1,
            icon: 'lucide:rotate-cw',
            setValue: (p, v) => {
                p.rotationY = v;
                setPropTransform(propId, { rotationY: v });
            },
        },
        {
            label: '缩放',
            getValue: (p) => p.scaling,
            min: 0.1,
            max: 10,
            step: 0.1,
            icon: 'lucide:maximize',
            setValue: (p, v) => {
                p.scaling = v;
                setPropTransform(propId, { scaling: v });
            },
        },
    ];

    return {
        label: '道具变换',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const p = propRegistry.get(propId);
            if (!p) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:11px;color:var(--text-dim);padding:8px 4px;';
                empty.textContent = '道具不存在（可能已被删除）';
                container.appendChild(empty);
                return;
            }
            cardContainer(container, (c) => {
                const title = document.createElement('div');
                title.style.cssText =
                    'font-size:12px;color:var(--text);padding:8px 14px 4px;font-weight:600;';
                title.textContent = p.name;
                c.appendChild(title);
                PROP_SLIDER_PARAMS.forEach((param) => {
                    addSliderRow(
                        c,
                        param.label,
                        param.getValue(p),
                        param.min,
                        param.max,
                        param.step,
                        (v) => {
                            param.setValue(p, v);
                        },
                        param.icon
                    );
                });
                addToggleRow(c, '可见', p.visible, (v) => {
                    setPropTransform(propId, { visible: v });
                    p.visible = v;
                });
                const delBtn = document.createElement('button');
                delBtn.textContent = '删除道具';
                delBtn.className = 'btn btn-sm btn-danger';
                delBtn.style.cssText = 'width:calc(100% - 28px);margin:10px 14px 6px;';
                delBtn.addEventListener('click', () => {
                    removeProp(propId);
                    envMenu.pop();
                    envMenu.reRender();
                });
                c.appendChild(delBtn);
            });
        },
    };
}

export function buildParticleLevel(): PopupLevel {
    return {
        label: '粒子',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    '粒子类型',
                    [
                        { value: 'none', label: '无' },
                        { value: 'sakura', label: '🌸 樱花' },
                        { value: 'rain', label: '🌧 雨' },
                        { value: 'snow', label: '❄ 雪' },
                        { value: 'fireworks', label: '🎆 烟花' },
                        { value: 'fireflies', label: '✨ 萤火虫' },
                        { value: 'leaves', label: '🍂 落叶' },
                    ],
                    s.particleType,
                    (v) => {
                        setEnvState({ particleType: v });
                        envMenu.reRender();
                    },
                    'lucide:sparkles'
                );
                addSliderRow(
                    c,
                    '密度',
                    s.particleEmitRate,
                    0,
                    3,
                    0.1,
                    (v) => setEnvState({ particleEmitRate: v }),
                    'lucide:layers'
                );
                addSliderRow(
                    c,
                    '大小',
                    s.particleSize,
                    0.1,
                    3,
                    0.1,
                    (v) => setEnvState({ particleSize: v }),
                    'lucide:maximize'
                );
                addSliderRow(
                    c,
                    '速度',
                    s.particleSpeed,
                    0.1,
                    5,
                    0.1,
                    (v) => setEnvState({ particleSpeed: v }),
                    'lucide:gauge'
                );
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
                // 预设芯片
                const waterPresetRow = document.createElement('div');
                waterPresetRow.className = 'preset-group';
                for (const [_key, wp] of Object.entries(WATER_PRESETS)) {
                    const btn = document.createElement('button');
                    btn.textContent = wp.label;
                    btn.className = 'preset-chip';
                    btn.addEventListener('click', () => {
                        setEnvState({
                            waterColor: wp.waterColor,
                            waterTransparency: wp.waterTransparency,
                            waterWaveHeight: wp.waterWaveHeight,
                            waterAnimSpeed: wp.waterAnimSpeed,
                            foamThreshold: wp.foamThreshold,
                            foamIntensity: wp.foamIntensity,
                        });
                        applyWaterPresetToCurrent(wp);
                        envMenu.reRender();
                    });
                    waterPresetRow.appendChild(btn);
                }
                c.appendChild(waterPresetRow);

                // 基础参数
                addCollapsible(c, {
                    title: '基础参数',
                    icon: 'lucide:sliders',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            '高度',
                            s.waterLevel,
                            -10,
                            10,
                            0.1,
                            (v) => setEnvState({ waterLevel: v }),
                            'lucide:arrow-up'
                        );
                        addColorSliderRow(cc, '水色', s.waterColor, (v) =>
                            setEnvState({ waterColor: v })
                        );
                        addSliderRow(
                            cc,
                            '透明度',
                            s.waterTransparency,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ waterTransparency: v }),
                            'lucide:eye'
                        );
                    },
                });

                // 波浪参数
                addCollapsible(c, {
                    title: '波浪',
                    icon: 'lucide:waves',
                    defaultOpen: false,
                    renderContent: (cc) => {
                        addSliderRow(
                            cc,
                            '波高',
                            s.waterWaveHeight,
                            0,
                            3,
                            0.1,
                            (v) => setEnvState({ waterWaveHeight: v }),
                            'lucide:waves'
                        );
                        addSliderRow(cc, '泡沫阈值', s.foamThreshold, 0, 1, 0.01, (v) =>
                            setEnvState({ foamThreshold: v })
                        );
                        addSliderRow(
                            cc,
                            '泡沫强度',
                            s.foamIntensity,
                            0,
                            1,
                            0.05,
                            (v) => setEnvState({ foamIntensity: v }),
                            'lucide:sparkles'
                        );
                        addSliderRow(
                            cc,
                            '动画速度',
                            s.waterAnimSpeed ?? 1,
                            0.1,
                            5,
                            0.1,
                            (v) => setEnvState({ waterAnimSpeed: v }),
                            'lucide:fast-forward'
                        );
                        addSliderRow(
                            cc,
                            '范围',
                            s.waterSize,
                            10,
                            200,
                            5,
                            (v) => setEnvState({ waterSize: v }),
                            'lucide:maximize'
                        );
                    },
                });

                // 水下效果
                addCollapsible(c, {
                    title: '水下效果',
                    icon: 'lucide:waves',
                    renderContent: (cc) => {
                        addColorSliderRow(cc, '水下雾色', s.underwaterFogColor, (v) =>
                            setEnvState({ underwaterFogColor: v })
                        );
                        addSliderRow(cc, '雾密度', s.underwaterFogDensity, 0, 0.1, 0.001, (v) =>
                            setEnvState({ underwaterFogDensity: v })
                        );
                        addSliderRow(cc, '色差强度', s.underwaterChromaticAmount, 0, 20, 0.5, (v) =>
                            setEnvState({ underwaterChromaticAmount: v })
                        );
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
                addSliderRow(
                    c,
                    '风向角度',
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
                    '风速',
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
        label: '云',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const s = envState;
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    '云量',
                    s.cloudCover,
                    0,
                    1,
                    0.01,
                    (v) => setEnvState({ cloudCover: v }),
                    'lucide:cloud'
                );
                addSliderRow(
                    c,
                    '云隙',
                    s.cloudGap ?? 0.5,
                    0,
                    1,
                    0.01,
                    (v) => setEnvState({ cloudGap: v }),
                    'lucide:columns'
                );
                addSliderRow(
                    c,
                    '高度',
                    s.cloudHeight,
                    50,
                    800,
                    5,
                    (v) => setEnvState({ cloudHeight: v }),
                    'lucide:arrow-up'
                );
                addSliderRow(
                    c,
                    '缩放',
                    s.cloudScale,
                    0.1,
                    1,
                    0.05,
                    (v) => setEnvState({ cloudScale: v }),
                    'lucide:maximize'
                );
                addSliderRow(
                    c,
                    '厚度',
                    s.cloudThickness ?? 15,
                    10,
                    50,
                    1,
                    (v) => setEnvState({ cloudThickness: v }),
                    'lucide:move-vertical'
                );
                addSliderRow(
                    c,
                    '可见距离',
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

// ======== Env Stack onFolderEnter ========

function envOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'env:unified':
            return buildEnvUnifiedLevel();
        case 'env:lighting':
            return buildEnvLightingLevel();
        case 'env:sky':
            return buildSkyLevel();
        case 'env:ground':
            return buildGroundLevel();
        case 'env:water':
            return buildWaterLevel();
        case 'env:particle':
            return buildParticleLevel();
        case 'env:wind':
            return buildWindLevel();
        case 'env:cloud':
            return buildCloudLevel();
        case 'env:prop':
            return buildPropLevel();
        case 'env:presets':
            return buildPresetLevel();
        default:
            return null;
    }
}

// ======== Show Env Menu ========

export function showEnvMenu(): void {
    dom.sceneOverlay.innerHTML = '';
    dom.sceneOverlay.classList.remove(
        'sceneOverlay-model',
        'sceneOverlay-motion',
        'sceneOverlay-settings'
    );
    dom.sceneOverlay.dataset.popupType = 'env';

    // 释放旧实例（清除 keydown/setTimeout），避免累积泄漏
    envMenu?.dispose();
    envMenu = new SlideMenu({
        container: dom.sceneOverlay,
        onClose: () => closeAllOverlays(),
        onItemClick: () => {},
        onFolderEnter: envOnFolderEnter,
        onAfterRender: () => {},
    });

    envMenu.reset(buildEnvLevel());
}
