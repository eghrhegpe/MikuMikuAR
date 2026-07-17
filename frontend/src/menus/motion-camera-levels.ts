// [doc:architecture] Camera Levels — 相机参数弹窗层级
// 从 scene-menu.ts 迁移到 motion-popup.ts

import { setStatus, cardContainer, stackRegistry, setMotionBindingTargetId } from '../core/config';
import type { PopupLevel } from '../core/config';
import { slideRow, addSliderRow, addToggleRow, addModeSlider, addModeRow } from '../core/ui-helpers';
import { getBrowseDir } from '../core/utils';
import {
    hasCameraVmd,
    clearCameraVmd,
    getCameraControl,
    getCameraBehavior,
    getScriptedSubMode,
    deriveLegacyMode,
    setCameraControl,
    setCameraBehavior,
    getOrbitParams,
    setOrbitParams,
    getFreeflyParams,
    setFreeflyParams,
    getConcertParams,
    setConcertParams,
    getConcertPaused,
    setConcertPaused,
    getSurroundParams,
    setSurroundParams,
    getSurroundPaused,
    setSurroundPaused,
    getFov,
    setFov,
    setAutoCameraBeatsPerSwitch,
    getAutoCameraBeatsPerSwitch,
    setOrbitBoneLock,
    getOrbitBoneLock,
    getFocusedModelBoneNames,
    type CameraMode,
    type CameraControl,
    type CameraBehavior,
} from '../scene/camera/camera';
import { triggerAutoSave } from '../scene/scene';
import { getMotionMenu } from './motion-popup';
import {
    switchARCameraFacing,
    setARMirror,
    isARMirrored,
    getARFacing,
    isARActive,
} from '../scene/ar/ar-camera';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import type { MenuNode } from './menu-schema';

function refreshCameraLevel(): void {
    const menu = getMotionMenu();
    if (menu) {
        menu.reRender();
    }
}

function buildCameraSchema(): MenuNode[] {
    const control = getCameraControl();
    const behavior = getCameraBehavior();
    const vmdLoaded = hasCameraVmd();
    const normBehavior: CameraBehavior = behavior === 'beatcut' ? 'none' : behavior;
    const modeToExpand = deriveLegacyMode(control, normBehavior, getScriptedSubMode());

    return [
        // 卡片 1：控制方案 + FOV
        {
            id: 'camera:main',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const controlOptions: Array<{ value: string; label: string }> = [
                        { value: 'orbit', label: t('motion.camOrbit') },
                        { value: 'freefly', label: t('motion.camFreefly') },
                        { value: 'ar', label: t('motion.camAR') },
                    ];
                    addModeSlider(
                        inner,
                        t('motion.cameraControl'),
                        controlOptions,
                        control,
                        (v) => {
                            setCameraControl(v as CameraControl);
                            refreshCameraLevel();
                        },
                        'lucide:camera',
                        undefined,
                        { bind: () => getCameraControl() }
                    );

                    addSliderRow(
                        inner,
                        t('motion.fov'),
                        getFov(),
                        0.3,
                        2,
                        0.05,
                        () => {},
                        'lucide:maximize-2',
                        (v) => {
                            setFov(v);
                            triggerAutoSave();
                        },
                        undefined,
                        'camera:main:fov'
                    );
                });
            },
        },
        // 卡片 2：运动行为（仅 orbit 可用）
        {
            id: 'camera:behavior',
            kind: 'custom',
            visibleWhen: () => getCameraControl() === 'orbit',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const behaviorOptions: Array<{ value: string; label: string }> = [
                        { value: 'none', label: t('motion.behaviorNone') },
                        { value: 'turntable', label: t('motion.camSurround') },
                        { value: 'concert', label: t('motion.camConcert') },
                        { value: 'beatcut', label: t('motion.autoCamera') },
                        { value: 'scripted', label: t('motion.camVmd') },
                    ];
                    addModeSlider(
                        inner,
                        t('motion.cameraBehavior'),
                        behaviorOptions,
                        behavior === 'beatcut' ? 'beatcut' : normBehavior,
                        (v) => {
                            setCameraBehavior(v as CameraBehavior);
                            refreshCameraLevel();
                        },
                        'lucide:activity',
                        undefined,
                        { bind: () => getCameraBehavior() }
                    );
                });
            },
        },
        // 卡片 2b：行为轴不可用提示（非 orbit 置灰）
        {
            id: 'camera:behaviorNA',
            kind: 'custom',
            visibleWhen: () => getCameraControl() !== 'orbit',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const row = document.createElement('div');
                    row.className = 'cs-row';
                    row.style.opacity = '0.4';
                    row.style.pointerEvents = 'none';
                    const lbl = document.createElement('span');
                    lbl.className = 'cs-label';
                    lbl.textContent = t('motion.cameraBehavior');
                    const val = document.createElement('span');
                    val.className = 'cs-value';
                    val.textContent = t('motion.behaviorNA');
                    row.appendChild(lbl);
                    row.appendChild(val);
                    inner.appendChild(row);
                });
            },
        },
        {
            id: 'camera:autoInterval',
            kind: 'custom',
            visibleWhen: () => getCameraBehavior() === 'beatcut',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    addSliderRow(
                        inner,
                        t('motion.switchInterval'),
                        getAutoCameraBeatsPerSwitch(),
                        1,
                        8,
                        1,
                        (v) => {
                            setAutoCameraBeatsPerSwitch(Math.round(v));
                        },
                        'lucide:timer',
                        undefined,
                        { bind: () => getAutoCameraBeatsPerSwitch() }
                    );
                });
            },
        },
        // 卡片 3：各模式参数（条件渲染）
        {
            id: 'camera:params',
            kind: 'custom',
            visibleWhen: () => modeToExpand !== 'oneshot' && modeToExpand !== 'vmd',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (modeToExpand === 'orbit') {
                        renderOrbitParams(inner);
                    } else if (modeToExpand === 'freefly') {
                        renderFreeflyParams(inner);
                    } else if (modeToExpand === 'concert') {
                        renderConcertParams(inner);
                    } else if (modeToExpand === 'surround') {
                        renderSurroundParams(inner);
                    } else if (modeToExpand === 'ar') {
                        renderARParams(inner);
                    }
                });
            },
        },
        // 卡片 4：VMD 操作
        {
            id: 'camera:vmd',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    if (vmdLoaded) {
                        slideRow(inner, 'lucide:trash-2', t('motion.clearCamVmd'), false, () => {
                            clearCameraVmd();
                            refreshCameraLevel();
                            setStatus(t('motion.camVmdCleared'), true);
                        });
                    }
                    slideRow(
                        inner,
                        'lucide:upload',
                        t('motion.loadCamVmd'),
                        false,
                        () => {
                            setMotionBindingTargetId(null);
                            const level = stackRegistry.buildLevel!(
                                getBrowseDir('vmd'),
                                t('motion.camVmdLabel'),
                                (m) => m.format === 'vmd'
                            );
                            const menu = getMotionMenu();
                            if (menu) {
                                menu.push(level);
                            }
                        },
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        { testId: 'menu.motion.loadCamVmd' }
                    );
                });
            },
        },
    ];
}

export function buildCameraLevel(): PopupLevel {
    return {
        label: t('motion.cameraMode'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            renderMenu(buildCameraSchema(), container);
        },
    };
}

/** Build a parameter editing submenu for the given camera mode. */
export function buildCameraParamsLevel(mode: CameraMode): PopupLevel {
    return {
        label:
            mode === 'orbit'
                ? t('motion.camOrbitSettings')
                : mode === 'freefly'
                  ? t('motion.camFreeflySettings')
                  : mode === 'concert'
                    ? t('motion.camConcertSettings')
                    : mode === 'surround'
                      ? t('motion.camSurroundSettings')
                      : t('motion.cameraSettings'),
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
                } else if (mode === 'surround') {
                    renderSurroundParams(c);
                }
            });
        },
    };
}

function renderOrbitParams(container: HTMLElement): void {
    const p = getOrbitParams();
    addSliderRow(
        container,
        t('motion.targetHeight'),
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
        t('motion.distance'),
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
        t('motion.pitch'),
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

    // === Bone Lock ===
    const boneLock = getOrbitBoneLock();
    const boneNames = getFocusedModelBoneNames();
    addToggleRow(
        container,
        t('motion.boneLock'),
        boneLock.enabled,
        (v) => {
            if (v && boneNames.length > 0) {
                // 启用时默认选择第一个骨骼
                setOrbitBoneLock(true, boneNames[0]);
            } else {
                setOrbitBoneLock(false);
            }
            refreshCameraLevel();
        },
        'lucide:target',
        { bind: () => getOrbitBoneLock().enabled }
    );

    // 骨骼选择器（仅锁定启用且有骨骼时显示）
    if (boneLock.enabled && boneNames.length > 0) {
        const boneOptions = boneNames.map((bn) => ({ value: bn, label: bn }));
        addModeRow(
            container,
            t('motion.boneLockSelect'),
            boneOptions,
            boneLock.boneName,
            (bn) => {
                setOrbitBoneLock(true, bn);
                setStatus(t('motion.boneLockApplied', { bone: bn }), true);
                refreshCameraLevel();
            }
        );
    } else if (boneLock.enabled && boneNames.length === 0) {
        // 有锁定但无骨骼（例如模型未加载）——显示提示
        const hint = document.createElement('div');
        hint.className = 'cs-hint weak-text';
        hint.textContent = t('motion.boneOverride.noModel');
        container.appendChild(hint);
    }
}

function renderFreeflyParams(container: HTMLElement): void {
    const p = getFreeflyParams();
    addSliderRow(
        container,
        t('motion.moveSpeed'),
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
        t('motion.mouseSens'),
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

function renderSurroundParams(container: HTMLElement): void {
    const p = getSurroundParams();
    addSliderRow(
        container,
        t('motion.orbitRadius'),
        p.radius,
        2,
        50,
        0.5,
        (v) => {
            setSurroundParams({ radius: v });
            triggerAutoSave();
        },
        'lucide:circle'
    );
    addSliderRow(
        container,
        t('motion.targetHeight'),
        p.height,
        0,
        30,
        0.5,
        (v) => {
            setSurroundParams({ height: v });
            triggerAutoSave();
        },
        'lucide:maximize'
    );
    addSliderRow(
        container,
        t('motion.rotateSpeed'),
        p.speed,
        0,
        5,
        0.1,
        (v) => {
            setSurroundParams({ speed: v });
            triggerAutoSave();
        },
        'lucide:rotate-cw'
    );
    addToggleRow(
        container,
        getSurroundPaused() ? t('motion.paused') : t('motion.rotating'),
        !getSurroundPaused(),
        (enabled) => {
            setSurroundPaused(!enabled);
            triggerAutoSave();
        }
    );
}

function renderConcertParams(container: HTMLElement): void {
    const p = getConcertParams();
    addSliderRow(
        container,
        t('motion.orbitRadius'),
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
        t('motion.targetHeight'),
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
        t('motion.sweepAngle'),
        p.sweepAngle,
        0,
        360,
        5,
        (v) => {
            setConcertParams({ sweepAngle: v });
            triggerAutoSave();
        },
        'lucide:move-horizontal'
    );
    addSliderRow(
        container,
        t('motion.sweepSpeed'),
        p.sweepSpeed,
        0.1,
        3,
        0.1,
        (v) => {
            setConcertParams({ sweepSpeed: v });
            triggerAutoSave();
        },
        'lucide:gauge'
    );
    addSliderRow(
        container,
        t('motion.basePitch'),
        p.baseBeta,
        0.1,
        Math.PI - 0.1,
        0.05,
        (v) => {
            setConcertParams({ baseBeta: v });
            triggerAutoSave();
        },
        'lucide:arrow-up-down'
    );
    addSliderRow(
        container,
        t('motion.bobAmplitude'),
        p.bobAmplitude,
        0,
        45,
        1,
        (v) => {
            setConcertParams({ bobAmplitude: v });
            triggerAutoSave();
        },
        'lucide:arrow-up'
    );
    addSliderRow(
        container,
        t('motion.bobSpeed'),
        p.bobSpeed,
        0.1,
        3,
        0.1,
        (v) => {
            setConcertParams({ bobSpeed: v });
            triggerAutoSave();
        },
        'lucide:activity'
    );
    addToggleRow(
        container,
        getConcertPaused() ? t('motion.paused') : t('motion.rotating'),
        !getConcertPaused(),
        (enabled) => {
            setConcertPaused(!enabled);
            triggerAutoSave();
        }
    );
}

function renderARParams(container: HTMLElement): void {
    addToggleRow(
        container,
        isARMirrored() ? t('motion.mirrored') : t('motion.mirror'),
        isARMirrored(),
        (enabled) => {
            setARMirror(enabled);
            triggerAutoSave();
        }
    );
    slideRow(
        container,
        'lucide:switch-camera',
        getARFacing() === 'user' ? t('motion.toBack') : t('motion.toFront'),
        false,
        async () => {
            await switchARCameraFacing();
            refreshCameraLevel();
        }
    );
    if (!isARActive()) {
        const tip = document.createElement('div');
        tip.className = 'cs-hint';
        tip.textContent = t('motion.cameraStarting');
        container.appendChild(tip);
    }
}
