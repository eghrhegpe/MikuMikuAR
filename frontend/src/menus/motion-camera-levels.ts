// [doc:architecture] Camera Levels — 相机参数弹窗层级
// 从 scene-menu.ts 迁移到 motion-popup.ts

import { setStatus, cardContainer, libraryRoot, stackRegistry, motionBindingTargetId, setMotionBindingTargetId } from '../core/config';
import type { PopupLevel } from '../core/config';
import { createIconifyIcon } from '../core/icons';
import { slideRow, addSliderRow, addToggleRow, addModeSlider } from '../core/ui-helpers';
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
    getFov,
    setFov,
    setAutoCameraEnabled,
    isAutoCameraEnabled,
    setAutoCameraBeatsPerSwitch,
    getAutoCameraBeatsPerSwitch,
    type CameraMode,
} from '../scene/camera/camera';
import { triggerAutoSave } from '../scene/scene';
import { loadCameraVmdFromPath, getProcBeatDetector } from '../scene/scene';
import { getMotionMenu } from './motion-popup';

let cameraExpandedMode: CameraMode | null = null;

function refreshCameraLevel(): void {
    const menu = getMotionMenu();
    if (menu) {
        menu.reRender();
    }
}

export function buildCameraLevel(): PopupLevel {
    return {
        label: '相机模式',
        dir: '',
        items: [],
        renderCustom: (container) => {
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
                        refreshCameraLevel();
                    },
                    'lucide:camera',
                    undefined,
                    {
                        bind: () => getCameraMode(),
                    }
                );

                addSliderRow(
                    c,
                    '视场角',
                    getFov(),
                    0.3,
                    2,
                    0.05,
                    () => {},
                    'lucide:maximize-2',
                    (v) => {
                        setFov(v);
                        triggerAutoSave();
                    }
                );
            });

            // Auto Camera
            cardContainer(container, (c) => {
                addToggleRow(c, '自动运镜', isAutoCameraEnabled(), (v) => {
                    const bd = getProcBeatDetector();
                    setAutoCameraEnabled(v, bd ?? undefined);
                    refreshCameraLevel();
                }, 'lucide:video', {
                    bind: () => isAutoCameraEnabled(),
                });
                if (isAutoCameraEnabled()) {
                    addSliderRow(
                        c,
                        '切换间隔（拍）',
                        getAutoCameraBeatsPerSwitch(),
                        1,
                        8,
                        1,
                        (v) => { setAutoCameraBeatsPerSwitch(Math.round(v)); },
                        'lucide:timer',
                        undefined,
                        { bind: () => getAutoCameraBeatsPerSwitch() }
                    );
                }
            });

            // Camera params + VMD
            cardContainer(container, (c) => {
                const paramsContainer = document.createElement('div');
                paramsContainer.className = 'cs-params';
                const modeToExpand = cameraExpandedMode ?? currentMode;
                if (modeToExpand !== 'oneshot' && modeToExpand !== 'vmd') {
                    if (modeToExpand === 'orbit') renderOrbitParams(paramsContainer);
                    else if (modeToExpand === 'freefly') renderFreeflyParams(paramsContainer);
                    else if (modeToExpand === 'concert') renderConcertParams(paramsContainer);
                    c.appendChild(paramsContainer);
                }

                if (vmdLoaded) {
                    slideRow(c, 'lucide:trash-2', '清除相机 VMD', false, () => {
                        clearCameraVmd();
                        refreshCameraLevel();
                        setStatus('✓ 已清除相机 VMD', true);
                    });
                }

                slideRow(c, 'lucide:upload', '加载相机 VMD', false, () => {
                    setMotionBindingTargetId(null);
                    const level = stackRegistry.buildLevel!(libraryRoot, '相机 VMD', (m) => m.format === 'vmd');
                    const menu = getMotionMenu();
                    if (menu) menu.push(level);
                });
            });
        },
    };
}

/** Build a parameter editing submenu for the given camera mode. */
export function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
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
