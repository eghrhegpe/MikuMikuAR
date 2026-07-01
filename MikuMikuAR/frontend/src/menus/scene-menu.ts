// [doc:architecture] Scene Menu — 场景弹窗（相机/灯光/渲染预设）
// 规范文档: docs/architecture.md §渲染环节
// 职责: MenuStack 场景弹窗、相机/灯光/渲染参数面板、渲染预设
// Scene menu — consolidated camera + lighting controls (MenuStack-based).

import {
    dom,
    closeAllOverlays,
    setStatus,
    PopupRow,
    PopupLevel,
    cardContainer,
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
    switchCameraMode,
    getCameraMode,
    hasCameraVmd,
    clearCameraVmd,
    getOrbitParams,
    setOrbitParams,
    getFreeflyParams,
    setFreeflyParams,
    getConcertParams,
    setConcertParams,
    getConcertPaused,
    setConcertPaused,
    type CameraMode,
} from '../scene/camera';
import {
    triggerAutoSave,
    serializeScene,
    deserializeScene,
    getRenderState,
    setRenderState,
    transitionRenderState,
    getStageLightState,
    setStageLightState,
    loadCameraVmdFromPath,
} from '../scene/scene';
import type { RenderState, StageLightState } from '../scene/scene';
import {
    SelectSceneSaveFile,
    SelectSceneOpenFile,
    SaveSceneFile,
    LoadSceneFile,
    SaveRenderPreset,
    DeleteRenderPreset,
    GetRenderPresets,
    SelectVMDMotion,
    SelectDir,
    SaveScreenshot,
    GetPresetScenes,
    GetPresetScenesDir,
    SaveScenePreset,
    DeletePresetScene,
} from '../../wailsjs/go/main/App';
import {
    focusModel,
    setProcMotionMode,
    setProcMotionIntensity,
    setProcMotionSpeed,
    setProcMotionAutoSwitch,
    getProcMotionState,
    regenerateProcMotion,
    getLipSyncState,
    setLipSyncEnabled,
    setLipSyncSensitivity,
    setLipSyncIntensity,
} from '../scene/scene';
import { modelRegistry, focusedModelId, setFocusedModelId } from '../core/config';
import type { ProcMotionMode } from '../motion/procedural-motion';
import {
    buildEnvLevel,
    buildSkyLevel,
    buildGroundLevel,
    buildParticleLevel,
    buildWindLevel,
    buildCloudLevel,
    buildEnvLightingLevel,
    buildPresetLevel,
} from './env-menu';

/**
 * 统一的 sceneMenu onFolderEnter 路由器
 * 无论 showSceneMenu 还是 showEnvMenu 创建栈，都使用此函数
 */
function sceneOnFolderEnter(row: PopupRow): PopupLevel | null {
    switch (row.target) {
        case 'scene:presets':
            return buildPresetScenesLevel();
        case 'scene:env':
            return buildEnvLevel();
        case 'scene:env:sky':
            return buildSkyLevel();
        case 'scene:env:ground':
            return buildGroundLevel();
        case 'scene:env:particle':
            return buildParticleLevel();
        case 'scene:env:wind':
            return buildWindLevel();
        case 'scene:env:cloud':
            return buildCloudLevel();
        case 'scene:env:lighting':
            return buildEnvLightingLevel();
        case 'scene:env:post':
            return buildPostProcessLevel();
        case 'scene:env:presets':
            return buildPresetLevel();
        case 'scene:camera':
            return buildCameraLevel();
        case 'scene:render':
            return buildRenderLevel();
        case 'scene:procmotion':
            return buildProcMotionLevel();
        case 'procmotion:mode':
            return buildProcMotionModeLevel();
        case 'scene:screenshot':
            return buildScreenshotLevel();
        case 'camera:params:orbit':
            return buildCameraParamsLevel('orbit');
        case 'camera:params:freefly':
            return buildCameraParamsLevel('freefly');
        case 'camera:params:concert':
            return buildCameraParamsLevel('concert');
        case 'scene:render:postprocess':
            return buildPostProcessLevel();
        case 'scene:render:stage':
            return buildStageLevel();
        case 'scene:render:presets':
            return buildPresetsLevel();
        default:
            return null;
    }
}

// ======== Scene Menu (SlideMenu) ========

let sceneMenu: SlideMenu | null = null;
export function getSceneMenu(): SlideMenu | null {
    return sceneMenu;
}

function buildSceneRoot(): PopupLevel {
    return {
        label: '场景',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            container.style.padding = '0';
            // Card 1: 场景管理
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:bookmark', '预设场景', true, () =>
                    sceneMenu.push(buildPresetScenesLevel())
                );
            });
            // Card 2: 渲染与灯光
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:sparkles', '渲染', true, () =>
                    sceneMenu.push(buildRenderLevel())
                );
                slideRow(c, 'lucide:lightbulb', '舞台灯光', true, () =>
                    sceneMenu.push(buildStageLightLevel())
                );
            });
            // Card 3: 工具
            cardContainer(container, (c) => {
                slideRow(c, 'lucide:camera', '截图', true, () =>
                    sceneMenu.push(buildScreenshotLevel())
                );
            });
        },
    };
}

export function buildProcMotionLevel(): PopupLevel {
    const st = getProcMotionState();
    const lipSt = getLipSyncState();
    return {
        label: '程序化动作',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addModeSlider(
                    c,
                    '程序化动作',
                    [
                        { value: 'off' as const, label: '关闭' },
                        { value: 'idle' as const, label: '待机呼吸' },
                        { value: 'autodance' as const, label: '自动舞蹈' },
                    ],
                    st.mode,
                    (v) => {
                        setProcMotionMode(v);
                        regenerateProcMotion();
                    },
                    'lucide:wind'
                );
                addToggleRow(c, '自动切换', st.autoSwitch, (v) => {
                    setProcMotionAutoSwitch(v);
                }, 'lucide:repeat');
                addToggleRow(c, 'LipSync', lipSt.enabled, (v) => {
                    setLipSyncEnabled(v);
                    sceneMenu.reRender();
                }, 'lucide:mic');
            });
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    '动作强度',
                    st.intensity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        setProcMotionIntensity(v);
                        regenerateProcMotion();
                    },
                    'lucide:activity'
                );
                addSliderRow(
                    c,
                    '速度',
                    st.speed,
                    0.5,
                    2,
                    0.05,
                    (v) => {
                        setProcMotionSpeed(v);
                        regenerateProcMotion();
                    },
                    'lucide:fast-forward'
                );
            });
        },
    };
}

export function buildProcMotionModeLevel(): PopupLevel {
    const st = getProcMotionState();
    const modes: { mode: ProcMotionMode; label: string; icon: string }[] = [
        { mode: 'off', label: '关闭', icon: st.mode === 'off' ? 'check' : 'circle' },
        { mode: 'idle', label: '待机呼吸', icon: st.mode === 'idle' ? 'check' : 'circle' },
        {
            mode: 'autodance',
            label: '自动舞蹈',
            icon: st.mode === 'autodance' ? 'check' : 'circle',
        },
    ];
    return {
        label: '程序化动作模式',
        dir: '',
        items: modes.map((m) => ({
            kind: 'action' as const,
            label: m.label,
            icon: m.icon,
            target: `procmotion:set-mode:${m.mode}`,
        })),
    };
}

export function buildLipSyncLevel(): PopupLevel {
    const st = getLipSyncState();
    return {
        label: 'LipSync',
        dir: '',
        items: [
            {
                kind: 'action',
                label: '启用',
                icon: st.enabled ? 'check' : 'circle',
                target: 'lipsync:toggle',
                sublabel: st.enabled ? '开' : '关',
            },
        ],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                addSliderRow(
                    c,
                    '灵敏度',
                    1 - st.sensitivity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        setLipSyncSensitivity(1 - v);
                    },
                    'lucide:volume-2'
                );
                addSliderRow(
                    c,
                    '强度',
                    st.intensity,
                    0,
                    1,
                    0.05,
                    (v) => {
                        setLipSyncIntensity(v);
                    },
                    'lucide:activity'
                );
            });
        },
    };
}

let currentPresetIndex = -1;
let _presetScenes: string[] = []; // cached for nav buttons, refreshed on re-render

async function _loadPresetScene(name: string): Promise<boolean> {
    try {
        const dir = await GetPresetScenesDir();
        const json = await LoadSceneFile(dir + '/' + name);
        await deserializeScene(JSON.parse(json));
        return true;
    } catch (err) {
        console.error('Load preset scene failed:', err);
        setStatus('✗ 加载预设场景失败', false);
        return false;
    }
}

function buildPresetScenesLevel(): PopupLevel {
    return {
        label: '预设场景',
        dir: '',
        items: [],
        renderCustom: async (container) => {
            container.classList.remove('render-card');
            const loading = document.createElement('div');
            loading.style.cssText = 'font-size:12px;color:#fff;text-align:center;padding:24px;';
            loading.textContent = '加载中…';
            container.appendChild(loading);
            currentPresetIndex = -1;
            _presetScenes = (await GetPresetScenes()) || [];
            container.innerHTML = '';
            const scenes = _presetScenes;
            if (scenes.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'font-size:12px;color:#fff;text-align:center;padding:24px;';
                empty.textContent = '暂无预设场景，保存场景时自动生成';
                container.appendChild(empty);
                return;
            }

            cardContainer(container, (c) => {
                const navRow = document.createElement('div');
                navRow.className = 'preset-group';
                navRow.style.padding = '8px 14px 10px';
                const prevBtn = document.createElement('button');
                prevBtn.className = 'preset-chip';
                prevBtn.style.flex = '1';
                const prevIcon = createIconifyIcon('lucide:skip-back');
                if (prevIcon) {
                    prevBtn.appendChild(prevIcon);
                }
                prevBtn.appendChild(document.createTextNode(' 上一个'));
                prevBtn.addEventListener('click', async () => {
                    if (scenes.length === 0) {
                        return;
                    }
                    if (currentPresetIndex < 0) {
                        currentPresetIndex = 0;
                    }
                    currentPresetIndex = (currentPresetIndex - 1 + scenes.length) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(
                            `✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`,
                            true
                        );
                    }
                });
                const nextBtn = document.createElement('button');
                nextBtn.className = 'preset-chip';
                nextBtn.style.flex = '1';
                nextBtn.appendChild(document.createTextNode('下一个 '));
                const nextIcon = createIconifyIcon('lucide:skip-forward');
                if (nextIcon) {
                    nextBtn.appendChild(nextIcon);
                }
                nextBtn.addEventListener('click', async () => {
                    if (scenes.length === 0) {
                        return;
                    }
                    if (currentPresetIndex < 0) {
                        currentPresetIndex = 0;
                    }
                    currentPresetIndex = (currentPresetIndex + 1) % scenes.length;
                    if (await _loadPresetScene(scenes[currentPresetIndex])) {
                        setStatus(
                            `✓ 预设场景: ${scenes[currentPresetIndex]} (${currentPresetIndex + 1}/${scenes.length})`,
                            true
                        );
                    }
                });
                navRow.appendChild(prevBtn);
                navRow.appendChild(nextBtn);
                c.appendChild(navRow);

                for (let i = 0; i < scenes.length; i++) {
                    const name = scenes[i];
                    const isActive = i === currentPresetIndex;
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    const is = document.createElement('span');
                    is.className = 'slide-icon';
                    const ie = createIconifyIcon(
                        isActive ? 'lucide:play-circle' : 'lucide:bookmark'
                    );
                    if (ie) {
                        is.appendChild(ie);
                    }
                    row.appendChild(is);
                    const ls = document.createElement('span');
                    ls.className = 'slide-label';
                    ls.textContent = name;
                    row.appendChild(ls);
                    const delBtn = document.createElement('span');
                    delBtn.textContent = '✕';
                    delBtn.title = '删除此预设场景';
                    delBtn.style.cssText =
                        'font-size:10px;color:var(--text-dim);cursor:pointer;padding:2px 4px;';
                    delBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (!confirm(`确定删除「${name}」？`)) {
                            return;
                        }
                        try {
                            await DeletePresetScene(name);
                            if (currentPresetIndex === i) {
                                currentPresetIndex = -1;
                            } else if (currentPresetIndex > i) {
                                currentPresetIndex--;
                            }
                            sceneMenu.reRender();
                            setStatus(`✓ 已删除: ${name}`, true);
                        } catch {
                            setStatus('✗ 删除失败', false);
                        }
                    });
                    row.appendChild(delBtn);
                    row.addEventListener('click', async () => {
                        currentPresetIndex = i;
                        if (await _loadPresetScene(name)) {
                            sceneMenu.reRender();
                            setStatus(`✓ 已加载: ${name}`, true);
                        }
                    });
                    c.appendChild(row);
                }

                slideRow(c, 'lucide:save', '保存场景', false, () => {
                    SelectSceneSaveFile().then((path) => {
                        if (!path) {
                            return;
                        }
                        const json = JSON.stringify(serializeScene(), null, 2);
                        SaveSceneFile(json, path)
                            .then(() => SaveScenePreset(json))
                            .then(() => {
                                setStatus('✓ 场景已保存', true);
                                sceneMenu.reRender();
                            })
                            .catch(() => setStatus('✗ 保存失败', false));
                    });
                });
            });
        },
    };
}

function buildScreenshotLevel(): PopupLevel {
    return {
        label: '截图',
        dir: '',
        items: [
            {
                kind: 'action',
                label: '截图当前模型',
                icon: 'camera',
                target: 'screenshot:current',
                sublabel: '保存焦点模型截图',
            },
            {
                kind: 'action',
                label: '批量截图',
                icon: 'images',
                target: 'screenshot:batch',
                sublabel: '逐个模型截图到指定目录',
            },
        ],
    };
}

let cameraExpandedMode: CameraMode | null = null;

export function buildCameraLevel(): PopupLevel {
    return {
        label: '相机模式',
        dir: '',
        items: [],
        renderCustom: (container) => {
            // 实时读取状态，不依赖闭包快照
            const currentMode = getCameraMode();
            const vmdLoaded = hasCameraVmd();

            cardContainer(container, (c) => {
                const modeOptions: Array<{ value: string; label: string }> = [
                    { value: 'orbit', label: '轨道' },
                    { value: 'freefly', label: '自由飞行' },
                    { value: 'concert', label: '演唱会' },
                    { value: 'oneshot', label: '单拍' },
                ];
                if (vmdLoaded) {
                    modeOptions.push({ value: 'vmd', label: 'VMD 相机' });
                }

                addModeSlider(
                    c,
                    '相机模式',
                    modeOptions.map((o) => ({ value: o.value, label: o.label })),
                    currentMode,
                    (v) => {
                        if (v === currentMode) {
                            cameraExpandedMode = cameraExpandedMode ? null : currentMode;
                        } else {
                            switchCameraMode(v as CameraMode);
                            cameraExpandedMode = v === 'oneshot' ? null : v as CameraMode;
                        }
                        sceneMenu.reRender();
                    },
                    'lucide:camera'
                );

                // 当前模式参数面板
                const paramsContainer = document.createElement('div');
                paramsContainer.className = 'cs-params';
                const modeToExpand = cameraExpandedMode ?? currentMode;
                if (modeToExpand !== 'oneshot' && modeToExpand !== 'vmd') {
                    if (modeToExpand === 'orbit') renderOrbitParams(paramsContainer);
                    else if (modeToExpand === 'freefly') renderFreeflyParams(paramsContainer);
                    else if (modeToExpand === 'concert') renderConcertParams(paramsContainer);
                    c.appendChild(paramsContainer);
                }

                // VMD 相关按钮
                if (vmdLoaded) {
                    const clearRow = document.createElement('div');
                    clearRow.className = 'slide-item';
                    clearRow.style.marginTop = '6px';
                    const clearIcon = document.createElement('span');
                    clearIcon.className = 'slide-icon';
                    const clearIconEl = createIconifyIcon('lucide:trash-2');
                    if (clearIconEl) {
                        clearIcon.appendChild(clearIconEl);
                    }
                    clearRow.appendChild(clearIcon);
                    const clearLabel = document.createElement('span');
                    clearLabel.className = 'slide-label';
                    clearLabel.textContent = '清除相机 VMD';
                    clearRow.appendChild(clearLabel);
                    clearRow.addEventListener('click', () => {
                        clearCameraVmd();
                        refreshCameraLevel();
                        setStatus('✓ 已清除相机 VMD', true);
                    });
                    c.appendChild(clearRow);
                }

                const loadRow = document.createElement('div');
                loadRow.className = 'slide-item';
                if (!vmdLoaded) {
                    loadRow.style.marginTop = '6px';
                }
                const loadIcon = document.createElement('span');
                loadIcon.className = 'slide-icon';
                const loadIconEl = createIconifyIcon('lucide:upload');
                if (loadIconEl) {
                    loadIcon.appendChild(loadIconEl);
                }
                loadRow.appendChild(loadIcon);
                const loadLabel = document.createElement('span');
                loadLabel.className = 'slide-label';
                loadLabel.textContent = '加载相机 VMD';
                loadRow.appendChild(loadLabel);
                loadRow.addEventListener('click', () => {
                    (async () => {
                        try {
                            const path = await SelectVMDMotion();
                            if (!path) {
                                return;
                            }
                            await loadCameraVmdFromPath(path);
                            refreshCameraLevel();
                        } catch (err) {
                            console.error('Load camera VMD failed:', err);
                            setStatus('✗ 相机 VMD 加载失败', false);
                        }
                    })();
                });
                c.appendChild(loadRow);
            });
        },
    };
}

/** Build a parameter editing submenu for the given camera mode. */
function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
    return {
        label:
            mode === 'orbit'
                ? '轨道设置'
                : mode === 'freefly'
                  ? '自由飞行设置'
                  : mode === 'concert'
                    ? '演唱会设置'
                    : '相机设置',
        dir: '',
        items: [],
        renderCustom: (container) => {
            cardContainer(container, (c) => {
                if (mode === 'orbit') {
                    renderOrbitParams(c);
                } else if (mode === 'freefly') {
                    renderFreeflyParams(c);
                } else if (mode === 'concert') {
                    renderConcertParams(c);
                }
            });
        },
    };
}

function renderOrbitParams(container: HTMLElement): void {
    const p = getOrbitParams();
    addSliderRow(
        container,
        '目标高度',
        p.targetHeight,
        0,
        30,
        0.5,
        (v) => {
            setOrbitParams({ targetHeight: v });
            triggerAutoSave();
        },
        'lucide:maximize'
    );
    addSliderRow(
        container,
        '距离',
        p.distance,
        2,
        50,
        0.5,
        (v) => {
            setOrbitParams({ distance: v });
            triggerAutoSave();
        },
        'lucide:zoom-in'
    );
    addSliderRow(
        container,
        '俯仰角',
        p.beta,
        0.1,
        Math.PI - 0.1,
        0.05,
        (v) => {
            setOrbitParams({ beta: v });
            triggerAutoSave();
        },
        'lucide:arrow-up-down'
    );
}

function renderFreeflyParams(container: HTMLElement): void {
    const p = getFreeflyParams();
    addSliderRow(
        container,
        '移动速度',
        p.speed,
        0.1,
        5,
        0.1,
        (v) => {
            setFreeflyParams({ speed: v });
            triggerAutoSave();
        },
        'lucide:move'
    );
    addSliderRow(
        container,
        '鼠标灵敏度',
        p.angularSensibility,
        500,
        5000,
        100,
        (v) => {
            setFreeflyParams({ angularSensibility: v });
            triggerAutoSave();
        },
        'lucide:mouse-pointer'
    );
}

function renderConcertParams(container: HTMLElement): void {
    const p = getConcertParams();
    addSliderRow(
        container,
        '轨道半径',
        p.radius,
        2,
        50,
        0.5,
        (v) => {
            setConcertParams({ radius: v });
            triggerAutoSave();
        },
        'lucide:circle'
    );
    addSliderRow(
        container,
        '目标高度',
        p.height,
        0,
        30,
        0.5,
        (v) => {
            setConcertParams({ height: v });
            triggerAutoSave();
        },
        'lucide:maximize'
    );
    addSliderRow(
        container,
        '旋转速度',
        p.speed,
        0,
        5,
        0.1,
        (v) => {
            setConcertParams({ speed: v });
            triggerAutoSave();
        },
        'lucide:rotate-cw'
    );
    addToggleRow(
        container,
        getConcertPaused() ? '已暂停' : '旋转中',
        !getConcertPaused(),
        (enabled) => {
            setConcertPaused(!enabled);
            triggerAutoSave();
        }
    );
}

// ======== Stage Light ========

function buildStageLightLevel(): PopupLevel {
    return {
        label: '舞台灯光',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const state = getStageLightState();
            cardContainer(container, (c) => {
                addToggleRow(c, '启用', state.enabled, (v) => {
                    setStageLightState({ enabled: v });
                    sceneMenu.reRender();
                }, 'lucide:power');
                addSliderRow(
                    c, '强度', state.intensity, 0, 2, 0.05,
                    () => {}, 'lucide:sun',
                    (v) => setStageLightState({ intensity: v })
                );
                addColorSliderRow(c, '颜色', state.color, (v) =>
                    setStageLightState({ color: v })
                );
                // 锥角范围增大到 2.0（≈115°），默认 ≈45°（0.8 rad）
                addSliderRow(
                    c, '锥角', state.angle, 0.1, 2.0, 0.05,
                    () => {}, 'lucide:circle',
                    (v) => setStageLightState({ angle: v })
                );
                addSliderRow(
                    c, '衰减', state.exponent, 0, 4, 0.1,
                    () => {}, 'lucide:arrow-down',
                    (v) => setStageLightState({ exponent: v })
                );
            });
            // 轨道控制（第三张卡片）
            cardContainer(container, (c) => {
                addSliderRow(
                    c, '水平角度', state.orbitAzimuth, -180, 180, 1,
                    () => {}, 'lucide:refresh-cw',
                    (v) => setStageLightState({ orbitAzimuth: v })
                );
                addSliderRow(
                    c, '仰角', state.orbitElevation, -90, 90, 1,
                    () => {}, 'lucide:arrow-up-down',
                    (v) => setStageLightState({ orbitElevation: v })
                );
                addSliderRow(
                    c, '距离', state.orbitDistance, 15, 50, 0.5,
                    () => {}, 'lucide:move',
                    (v) => setStageLightState({ orbitDistance: v })
                );
            });
        },
    };
}

// ======== Environment Lighting Panel (Unified) ========

// ======== Render Menu Levels ========

function buildRenderLevel(): PopupLevel {
    return {
        label: '渲染',
        dir: '',
        items: [
            {
                kind: 'folder',
                label: '后处理',
                icon: 'sparkles',
                target: 'scene:render:postprocess',
            },
            { kind: 'folder', label: '舞台', icon: 'monitor', target: 'scene:render:stage' },
            { kind: 'folder', label: '渲染预设', icon: 'palette', target: 'scene:render:presets' },
        ],
    };
}

function buildPostProcessLevel(): PopupLevel {
    return {
        label: '后处理',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
            cardContainer(container, (c) => {
                // 泛光（含多滑块，折叠收纳）
                addCollapsible(c, {
                    title: '泛光',
                    icon: 'lucide:sun',
                    defaultOpen: false,
                    headerToggle: {
                        value: state.bloomEnabled,
                        onChange: (v) => {
                            setRenderState({ bloomEnabled: v });
                            triggerAutoSave();
                        },
                    },
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            '强度',
                            state.bloomWeight,
                            0,
                            1,
                            0.05,
                            () => {},
                            'lucide:sun',
                            (v) => {
                                setRenderState({ bloomWeight: v });
                                triggerAutoSave();
                            }
                        );
                        addSliderRow(
                            inner,
                            '阈值',
                            state.bloomThreshold,
                            0,
                            1,
                            0.05,
                            () => {},
                            'lucide:sliders',
                            (v) => {
                                setRenderState({ bloomThreshold: v });
                                triggerAutoSave();
                            }
                        );
                        addSliderRow(
                            inner,
                            '核大小',
                            state.bloomKernel,
                            0,
                            512,
                            1,
                            () => {},
                            'lucide:circle',
                            (v) => {
                                setRenderState({ bloomKernel: v });
                                triggerAutoSave();
                            }
                        );
                    },
                });

                // 边缘高亮（纯 toggle）
                addToggleRow(c, '边缘高亮', state.outlineEnabled, (v) => {
                    setRenderState({ outlineEnabled: v });
                    triggerAutoSave();
                }, 'lucide:square');

                // 抗锯齿（关闭/FXAA/4x/8x）
                addModeSlider(
                    c,
                    '抗锯齿',
                    [
                        { value: 'off', label: '关闭' },
                        { value: 'fxaa', label: 'FXAA' },
                        { value: '4x', label: '4x' },
                        { value: '8x', label: '8x' },
                    ],
                    state.fxaaEnabled ? 'fxaa' : 'off',
                    (v) => {
                        setRenderState({ fxaaEnabled: v === 'fxaa' || v === '4x' || v === '8x' });
                        triggerAutoSave();
                    },
                    'lucide:scan-line'
                );

                // 景深（光圈=0 即关闭）
                addSliderRow(
                    c,
                    '景深',
                    state.dofAperture,
                    0,
                    10,
                    0.1,
                    () => {},
                    'lucide:camera',
                    (v) => {
                        setRenderState({ dofEnabled: v > 0, dofAperture: v });
                        triggerAutoSave();
                    }
                );

                // 暗角（强度=0 即关闭）
                addSliderRow(
                    c,
                    '暗角',
                    state.vignetteDarkness,
                    0,
                    1,
                    0.05,
                    () => {},
                    'lucide:circle-dot',
                    (v) => {
                        setRenderState({ vignetteEnabled: v > 0, vignetteDarkness: v });
                        triggerAutoSave();
                    }
                );
            });
        },
    };
}

function buildStageLevel(): PopupLevel {
    return {
        label: '舞台',
        dir: '',
        items: [],
        renderCustom: (container) => {
            const state = getRenderState();
            cardContainer(container, (c) => {
                addCollapsible(c, {
                    title: '色调映射',
                    icon: 'lucide:palette',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addModeSlider(
                            inner,
                            '模式',
                            [
                                { value: 0, label: '关闭' },
                                { value: 1, label: 'ACES' },
                                { value: 2, label: 'Reinhard' },
                                { value: 3, label: 'Cineon' },
                                { value: 4, label: 'Neutral' },
                            ],
                            state.toneMapping,
                            (v) => {
                                setRenderState({ toneMapping: v });
                                triggerAutoSave();
                                sceneMenu.reRender();
                            },
                            'lucide:palette'
                        );
                        addSliderRow(
                            inner,
                            '曝光',
                            state.exposure,
                            0,
                            4,
                            0.05,
                            () => {},
                            'lucide:lightbulb',
                            (v) => {
                                setRenderState({ exposure: v });
                                triggerAutoSave();
                            }
                        );
                        addSliderRow(
                            inner,
                            '对比度',
                            state.contrast,
                            0,
                            4,
                            0.05,
                            () => {},
                            'lucide:contrast',
                            (v) => {
                                setRenderState({ contrast: v });
                                triggerAutoSave();
                            }
                        );
                    },
                });

                addCollapsible(c, {
                    title: '视场角',
                    icon: 'lucide:maximize-2',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        addSliderRow(
                            inner,
                            'FOV',
                            state.fov,
                            0.1,
                            3,
                            0.05,
                            () => {},
                            'lucide:maximize-2',
                            (v) => {
                                setRenderState({ fov: v });
                                triggerAutoSave();
                            }
                        );
                    },
                });

                addCollapsible(c, {
                    title: '背景色',
                    icon: 'lucide:droplet',
                    defaultOpen: false,
                    renderContent: (inner) => {
                        const bgFields: Array<{ label: string; key: 0 | 1 | 2; icon: string }> = [
                            { label: 'R', key: 0, icon: 'lucide:droplet' },
                            { label: 'G', key: 1, icon: 'lucide:droplet' },
                            { label: 'B', key: 2, icon: 'lucide:droplet' },
                        ];
                        for (const f of bgFields) {
                            addSliderRow(
                                inner,
                                f.label,
                                state.bgColor[f.key],
                                0,
                                1,
                                0.01,
                                (v) => {
                                    const bg = [...getRenderState().bgColor] as [
                                        number,
                                        number,
                                        number,
                                    ];
                                    bg[f.key] = v;
                                    setRenderState({ bgColor: bg });
                                    triggerAutoSave();
                                },
                                f.icon
                            );
                        }
                    },
                });
            });
        },
    };
}

/** Built-in render presets. */
const builtinPresets: Record<string, Partial<RenderState>> = {
    standard: {
        bloomEnabled: false,
        bloomWeight: 0.3,
        bloomThreshold: 0.5,
        bloomKernel: 64,
        fxaaEnabled: false,
        outlineEnabled: false,
        toneMapping: 0,
        exposure: 1,
        contrast: 1,
        fov: 0.8,
        bgColor: [0.12, 0.12, 0.16],
    },
    cartoon: {
        bloomEnabled: true,
        bloomWeight: 0.6,
        bloomThreshold: 0.3,
        bloomKernel: 128,
        fxaaEnabled: true,
        outlineEnabled: true,
        outlineColor: [0, 0, 0],
        toneMapping: 2,
        exposure: 1.2,
        contrast: 1.3,
        fov: 0.8,
        bgColor: [0.15, 0.15, 0.2],
    },
    realistic: {
        bloomEnabled: false,
        bloomWeight: 0.3,
        bloomThreshold: 0.5,
        bloomKernel: 64,
        fxaaEnabled: true,
        outlineEnabled: false,
        toneMapping: 1,
        exposure: 1,
        contrast: 1,
        fov: 0.7,
        bgColor: [0.08, 0.08, 0.12],
    },
    warm: {
        bloomEnabled: true,
        bloomWeight: 0.4,
        bloomThreshold: 0.4,
        bloomKernel: 64,
        fxaaEnabled: false,
        outlineEnabled: false,
        toneMapping: 2,
        exposure: 1.1,
        contrast: 0.9,
        fov: 0.8,
        bgColor: [0.18, 0.14, 0.1],
    },
    cyberpunk: {
        bloomEnabled: true,
        bloomWeight: 0.8,
        bloomThreshold: 0.2,
        bloomKernel: 256,
        fxaaEnabled: true,
        outlineEnabled: true,
        outlineColor: [1, 0, 1],
        toneMapping: 4,
        exposure: 1.3,
        contrast: 1.5,
        fov: 0.9,
        bgColor: [0.02, 0.02, 0.06],
    },
};

/** Chinese labels for built-in presets. */
const PRESET_LABELS: Record<string, string> = {
    standard: '标准',
    cartoon: '卡通',
    realistic: '写实',
    warm: '暖光',
    cyberpunk: '赛博朋克',
};

function getBuiltinPreset(name: string): Partial<RenderState> | undefined {
    return builtinPresets[name];
}

function buildPresetsLevel(): PopupLevel {
    return {
        label: '渲染预设',
        dir: '',
        items: [],
        renderCustom: (container) => {
            container.classList.remove('render-card');
            // Card 1: built-in presets
            cardContainer(container, (c) => {
                for (const [key] of Object.entries(builtinPresets)) {
                    const row = document.createElement('div');
                    row.className = 'slide-item';
                    {
                        const iconSpan = document.createElement('span');
                        iconSpan.className = 'slide-icon';
                        const iconEl = createIconifyIcon('lucide:palette');
                        if (iconEl) {
                            iconSpan.appendChild(iconEl);
                        }
                        row.appendChild(iconSpan);
                        const labelSpan = document.createElement('span');
                        labelSpan.className = 'slide-label';
                        labelSpan.textContent = PRESET_LABELS[key] || key;
                        row.appendChild(labelSpan);
                    }
                    row.addEventListener('click', () => {
                        const preset = getBuiltinPreset(key);
                        if (preset) {
                            transitionRenderState(preset, 2000);
                        }
                        setStatus(`✓ 预设: ${PRESET_LABELS[key]}`, true);
                    });
                    c.appendChild(row);
                }
            });
            // Save
            const saveRow = document.createElement('div');
            saveRow.className = 'slide-item';
            {
                const iconSpan = document.createElement('span');
                iconSpan.className = 'slide-icon';
                const iconEl = createIconifyIcon('lucide:save');
                if (iconEl) {
                    iconSpan.appendChild(iconEl);
                }
                saveRow.appendChild(iconSpan);
                const labelSpan = document.createElement('span');
                labelSpan.className = 'slide-label';
                labelSpan.textContent = '保存当前为预设';
                saveRow.appendChild(labelSpan);
            }
            saveRow.addEventListener('click', showPresetSaveDialog);
            container.appendChild(saveRow);
            // Card 2: user presets
            if (Object.keys(userPresets).length > 0) {
                cardContainer(container, (c) => {
                    for (const [name] of Object.entries(userPresets)) {
                        const row = document.createElement('div');
                        row.className = 'slide-item';
                        {
                            const iconSpan = document.createElement('span');
                            iconSpan.className = 'slide-icon';
                            const iconEl = createIconifyIcon('lucide:palette');
                            if (iconEl) {
                                iconSpan.appendChild(iconEl);
                            }
                            row.appendChild(iconSpan);
                            const labelSpan = document.createElement('span');
                            labelSpan.className = 'slide-label';
                            labelSpan.textContent = name;
                            row.appendChild(labelSpan);
                        }
                        row.addEventListener('click', () => {
                            setRenderState(userPresets[name]);
                            setStatus(`✓ 预设: ${name}`, true);
                        });
                        c.appendChild(row);
                        const delRow = document.createElement('div');
                        delRow.className = 'slide-item';
                        {
                            const iconSpan = document.createElement('span');
                            iconSpan.className = 'slide-icon';
                            const iconEl = createIconifyIcon('lucide:trash-2');
                            if (iconEl) {
                                iconSpan.appendChild(iconEl);
                            }
                            delRow.appendChild(iconSpan);
                            const labelSpan = document.createElement('span');
                            labelSpan.className = 'slide-label';
                            labelSpan.style.color = 'var(--text-dim)';
                            labelSpan.textContent = `删除: ${name}`;
                            delRow.appendChild(labelSpan);
                        }
                        delRow.addEventListener('click', () => {
                            DeleteRenderPreset(name)
                                .then(() => {
                                    delete userPresets[name];
                                    if (sceneMenu) {
                                        sceneMenu.setLevel(
                                            sceneMenu.levelCount - 1,
                                            buildPresetsLevel()
                                        );
                                        sceneMenu.reRender();
                                    }
                                    setStatus(`✓ 预设已删除: ${name}`, true);
                                })
                                .catch(() => setStatus('✗ 删除失败', false));
                        });
                        c.appendChild(delRow);
                    }
                });
            }
        },
    };
}

function getPresetName(name: string): string {
    return PRESET_LABELS[name] || name;
}

/** Show a prompt to save the current render state as a named preset. */
function showPresetSaveDialog(): void {
    const name = prompt('输入预设名称：');
    if (!name.trim()) {
        return;
    }
    const trimmed = name.trim();
    // Persist via Go backend first, then update in-memory on success
    const state = getRenderState();
    SaveRenderPreset(trimmed, JSON.stringify(state))
        .then(() => {
            userPresets[trimmed] = state;
            setStatus(`✓ 预设已保存: ${trimmed}`, true);
            if (sceneMenu) {
                sceneMenu.setLevel(sceneMenu.levelCount - 1, buildPresetsLevel());
                sceneMenu.reRender();
            }
        })
        .catch((err: unknown) => {
            console.warn('SaveRenderPreset failed:', err);
            setStatus('✗ 保存预设失败', false);
        });
}

/** In-memory user-defined render presets (loaded from backend on show). */
const userPresets: Record<string, Partial<RenderState>> = {};

let _presetsLoaded = false;

/** Load user presets from the Go backend and merge into userPresets. */
async function loadUserPresets(): Promise<void> {
    if (_presetsLoaded) {
        return;
    }
    _presetsLoaded = true;
    try {
        const presets = await GetRenderPresets();
        if (presets) {
            for (const p of presets) {
                userPresets[p.name] = p.params as unknown as Partial<RenderState>;
            }
        }
    } catch (err) {
        console.warn('loadUserPresets:', err);
    }
}

function refreshCameraLevel(): void {
    if (sceneMenu) {
        sceneMenu.reRender();
    }
}

function handleSceneAction(row: PopupRow): void {
    // Camera VMD actions
    if (row.target === 'camera:load-vmd') {
        (async () => {
            try {
                const path = await SelectVMDMotion();
                if (!path) {
                    return;
                }
                await loadCameraVmdFromPath(path);
                refreshCameraLevel();
            } catch (err) {
                console.error('Load camera VMD failed:', err);
                setStatus('✗ 相机 VMD 加载失败', false);
            }
        })();
        return;
    }
    if (row.target === 'camera:clear-vmd') {
        clearCameraVmd();
        refreshCameraLevel();
        setStatus('✓ 已清除相机 VMD', true);
        return;
    }
    if (row.target === 'camera:concert:toggle') {
        const current = getConcertPaused();
        setConcertPaused(!current);
        refreshCameraLevel();
        setStatus(current ? '▶ 演唱会旋转已恢复' : '⏸ 演唱会旋转已暂停', true);
        return;
    }
    // Camera mode switching
    if (
        row.target &&
        row.target.startsWith('camera:') &&
        !row.target.includes(':params:') &&
        !row.target.includes(':concert:')
    ) {
        const mode = row.target.replace('camera:', '') as CameraMode;
        if (mode === 'vmd' && !hasCameraVmd()) {
            setStatus('✗ 请先加载相机 VMD', false);
            return;
        }
        switchCameraMode(mode);
        refreshCameraLevel();
        if (mode !== 'oneshot') {
            triggerAutoSave();
        }
        const labels: Record<string, string> = {
            orbit: '轨道',
            freefly: '自由飞行',
            concert: '演唱会',
            oneshot: '单拍',
            vmd: 'VMD 相机',
        };
        setStatus(`✓ 相机: ${labels[mode] || mode}`, true);
        return;
    }
    // Screenshot current focused model
    if (row.target === 'screenshot:current') {
        (async () => {
            const id = focusedModelId;
            if (!id) {
                setStatus('✗ 无焦点模型', false);
                return;
            }
            const inst = modelRegistry.get(id);
            if (!inst) {
                setStatus('✗ 模型不存在', false);
                return;
            }
            try {
                const dir = await SelectDir();
                if (!dir) {
                    return;
                }
                // Wait for render
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));
                const base64 = dom.canvas
                    .toDataURL('image/png', 0.9)
                    .replace(/^data:image\/png;base64,/, '');
                const ts = Date.now();
                const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.png`;
                await SaveScreenshot(dir, filename, base64);
                setStatus(`✓ 截图已保存: ${filename}`, true);
            } catch (err) {
                setStatus('✗ 截图失败', false);
                console.error('Screenshot error:', err);
            }
        })();
        return;
    }
    // Batch screenshot all loaded models
    if (row.target === 'screenshot:batch') {
        if (modelRegistry.size === 0) {
            setStatus('✗ 场景中无模型', false);
            return;
        }
        (async () => {
            const dir = await SelectDir();
            if (!dir) {
                return;
            }
            let saved = 0;
            const prevFocused = focusedModelId;
            try {
                for (const [id, inst] of modelRegistry) {
                    setFocusedModelId(id);
                    focusModel(id);
                    // Wait for camera to settle (3 frames)
                    await new Promise((r) => requestAnimationFrame(r));
                    await new Promise((r) => requestAnimationFrame(r));
                    await new Promise((r) => requestAnimationFrame(r));
                    const base64 = dom.canvas
                        .toDataURL('image/png', 0.9)
                        .replace(/^data:image\/png;base64,/, '');
                    const ts = Date.now();
                    const filename = `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}_${ts}.png`;
                    await SaveScreenshot(dir, filename, base64);
                    saved++;
                    setStatus(`截图中… ${saved}/${modelRegistry.size}`, true);
                }
                if (prevFocused) {
                    setFocusedModelId(prevFocused);
                    focusModel(prevFocused);
                }
                setStatus(`✓ 批量截图完成: ${saved} 张`, true);
            } catch (err) {
                setStatus('✗ 批量截图失败', false);
                console.error('Batch screenshot error:', err);
            }
        })();
        return;
    }
    // Save scene
    if (row.target === 'scene:save') {
        (async () => {
            try {
                const path = await SelectSceneSaveFile();
                if (!path) {
                    return;
                }
                const json = JSON.stringify(serializeScene(), null, 2);
                await SaveSceneFile(json, path);
                await SaveScenePreset(json);
                setStatus('✓ 场景已保存', true);
            } catch (err) {
                setStatus('✗ 保存失败', false);
                console.error('Save scene error:', err);
            }
        })();
        return;
    }
    // Load scene
    if (row.target === 'scene:load') {
        (async () => {
            try {
                const path = await SelectSceneOpenFile();
                if (!path) {
                    return;
                }
                const json = await LoadSceneFile(path);
                await deserializeScene(JSON.parse(json));
                setStatus('✓ 场景已加载', true);
            } catch (err) {
                setStatus('✗ 加载失败', false);
                console.error('Load scene error:', err);
            }
        })();
        return;
    }
    // Render preset handling
    if (row.target && row.target.startsWith('scene:preset:')) {
        const action = row.target.replace('scene:preset:', '');

        if (action === 'save') {
            showPresetSaveDialog();
            return;
        }

        // Delete user preset
        if (action.startsWith('delete:')) {
            const name = action.replace('delete:', '');
            (async () => {
                try {
                    await DeleteRenderPreset(name);
                    delete userPresets[name];
                    if (sceneMenu) {
                        sceneMenu.setLevel(sceneMenu.levelCount - 1, buildPresetsLevel());
                        sceneMenu.reRender();
                    }
                    setStatus(`✓ 预设已删除: ${name}`, true);
                } catch (err) {
                    console.warn('DeleteRenderPreset failed:', err);
                    setStatus('✗ 删除预设失败', false);
                }
            })();
            return;
        }

        // Apply preset
        let preset: Partial<RenderState> | undefined;
        if (action.startsWith('user:')) {
            const userName = action.substring(5);
            preset = userPresets[userName];
        } else {
            preset = getBuiltinPreset(action);
        }
        if (preset) {
            transitionRenderState(preset, 2000);
            triggerAutoSave();
            setStatus(`✓ 预设: ${getPresetName(action)}`, true);
        }
        return;
    }
    // Procedural Motion actions
    if (row.target && row.target.startsWith('procmotion:set-mode:')) {
        const mode = row.target.replace('procmotion:set-mode:', '') as ProcMotionMode;
        setProcMotionMode(mode);
        regenerateProcMotion();
        sceneMenu.pop();
        sceneMenu.reRender();
        return;
    }
    if (row.target === 'procmotion:autoswitch') {
        const cur = getProcMotionState();
        setProcMotionAutoSwitch(!cur.autoSwitch);
        sceneMenu.reRender();
        return;
    }
    if (row.target === 'procmotion:mode') {
        sceneMenu.push(buildProcMotionModeLevel());
        return;
    }
    // LipSync actions
    if (row.target === 'lipsync:menu') {
        sceneMenu.push(buildLipSyncLevel());
        return;
    }
    if (row.target === 'lipsync:toggle') {
        const cur = getLipSyncState();
        setLipSyncEnabled(!cur.enabled);
        sceneMenu.reRender();
        return;
    }
}

export async function showSceneMenu(): Promise<void> {
    // 释放旧 SlideMenu（清除其未决定时器，防止泄漏）
    sceneMenu?.dispose();
    dom.sceneOverlay.innerHTML = '';
    dom.sceneOverlay.classList.remove(
        'sceneOverlay-model',
        'sceneOverlay-motion',
        'sceneOverlay-settings'
    );
    dom.sceneOverlay.dataset.popupType = 'scene';

    // Load user presets from backend
    await loadUserPresets();

    // 每次都重建 SlideMenu，避免 innerHTML 清空后旧实例持有已销毁的 DOM 引用
    sceneMenu = new SlideMenu({
        container: dom.sceneOverlay,
        onClose: () => closeAllOverlays(),
        onItemClick: (row) => handleSceneAction(row),
        onFolderEnter: sceneOnFolderEnter,
        onAfterRender: () => {},
    });

    sceneMenu.reset(buildSceneRoot());
}

// Wire up events — handlers are registered in main.ts (dynamic import + toggleOverlay) to avoid double-handler race.
// Do NOT re-register here; see main.ts:243-244.
