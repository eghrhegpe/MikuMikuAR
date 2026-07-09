// [doc:architecture] Camera Levels — 相机参数弹窗层级
// 从 scene-menu.ts 迁移到 motion-popup.ts

import {
    setStatus,
    cardContainer,
    libraryRoot,
    stackRegistry,
    motionBindingTargetId,
    setMotionBindingTargetId,
} from '../core/config';
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
    getSurroundParams,
    setSurroundParams,
    getSurroundPaused,
    setSurroundPaused,
    getFov,
    setFov,
    setAutoCameraEnabled,
    isAutoCameraEnabled,
    setAutoCameraBeatsPerSwitch,
    getAutoCameraBeatsPerSwitch,
    setOrbitBoneLock,
    getOrbitBoneLock,
    getFocusedModelBoneNames,
    type CameraMode,
} from '../scene/camera/camera';
import { triggerAutoSave } from '../scene/scene';
import { getProcBeatDetector } from '../scene/scene';
import { getMotionMenu } from './motion-popup';
import {
    switchARCameraFacing,
    setARMirror,
    isARMirrored,
    getARFacing,
    isARActive,
} from '../scene/ar/ar-camera';
import { t } from '../core/i18n/t'; // [doc:adr-059]

let cameraExpandedMode: CameraMode | null = null;

function refreshCameraLevel(): void {
    const menu = getMotionMenu();
    if (menu) {
        menu.reRender();
    }
}

export function buildCameraLevel(): PopupLevel {
    return {
        label: t('motion.cameraMode'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            const currentMode = getCameraMode();
            const vmdLoaded = hasCameraVmd();

            cardContainer(container, (c) => {
                const modeOptions: Array<{ value: string; label: string }> = [
                    { value: 'orbit', label: t('motion.camOrbit') },
                    { value: 'freefly', label: t('motion.camFreefly') },
                    { value: 'concert', label: t('motion.camConcert') },
                    { value: 'surround', label: t('motion.camSurround') },
                    { value: 'oneshot', label: t('motion.camOneshot') },
                    { value: 'ar', label: t('motion.camAR') },
                ];
                if (vmdLoaded) {
                    modeOptions.push({ value: 'vmd', label: t('motion.camVmd') });
                }

                addModeSlider(
                    c,
                    t('motion.cameraMode'),
                    modeOptions.map((o) => ({ value: o.value, label: o.label })),
                    currentMode,
                    (v) => {
                        if (v === currentMode) {
                            cameraExpandedMode = cameraExpandedMode ? null : currentMode;
                        } else {
                            switchCameraMode(v as CameraMode);
                            cameraExpandedMode = v === 'oneshot' ? null : (v as CameraMode);
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
                    }
                );
            });

            // Auto Camera
            cardContainer(container, (c) => {
                addToggleRow(
                    c,
                    t('motion.autoCamera'),
                    isAutoCameraEnabled(),
                    (v) => {
                        const bd = getProcBeatDetector();
                        setAutoCameraEnabled(v, bd ?? undefined);
                        refreshCameraLevel();
                    },
                    'lucide:video',
                    {
                        bind: () => isAutoCameraEnabled(),
                    }
                );
                if (isAutoCameraEnabled()) {
                    addSliderRow(
                        c,
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
                }
            });

            // Camera params + VMD
            cardContainer(container, (c) => {
                const paramsContainer = document.createElement('div');
                paramsContainer.className = 'cs-params';
                const modeToExpand = cameraExpandedMode ?? currentMode;
                if (modeToExpand !== 'oneshot' && modeToExpand !== 'vmd') {
                    if (modeToExpand === 'orbit') {
                        renderOrbitParams(paramsContainer);
                    } else if (modeToExpand === 'freefly') {
                        renderFreeflyParams(paramsContainer);
                    } else if (modeToExpand === 'concert') {
                        renderConcertParams(paramsContainer);
                    } else if (modeToExpand === 'surround') {
                        renderSurroundParams(paramsContainer);
                    } else if (modeToExpand === 'ar') {
                        renderARParams(paramsContainer);
                    }
                    c.appendChild(paramsContainer);
                }

                if (vmdLoaded) {
                    slideRow(c, 'lucide:trash-2', t('motion.clearCamVmd'), false, () => {
                        clearCameraVmd();
                        refreshCameraLevel();
                        setStatus(t('motion.camVmdCleared'), true);
                    });
                }

                slideRow(c, 'lucide:upload', t('motion.loadCamVmd'), false, () => {
                    setMotionBindingTargetId(null);
                    const level = stackRegistry.buildLevel!(
                        libraryRoot,
                        t('motion.camVmdLabel'),
                        (m) => m.format === 'vmd'
                    );
                    const menu = getMotionMenu();
                    if (menu) {
                        menu.push(level);
                    }
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
                ? t('motion.camOrbitSettings')
                : mode === 'freefly'
                  ? t('motion.camFreeflySettings')
                  :             mode === 'concert'
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
        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;';

        const label = document.createElement('label');
        label.className = 'cs-label';
        label.style.cssText = 'flex-shrink:0;font-size:11px;opacity:0.7;min-width:60px;';
        label.textContent = t('motion.boneLockSelect');

        const select = document.createElement('select');
        select.className = 'cs-select';
        select.style.cssText = 'flex:1;padding:4px 8px;border-radius:6px;font-size:12px;';

        for (const bn of boneNames) {
            const opt = document.createElement('option');
            opt.value = bn;
            opt.textContent = bn;
            if (bn === boneLock.boneName) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }

        select.addEventListener('change', () => {
            const bn = select.value;
            if (bn) {
                setOrbitBoneLock(true, bn);
                setStatus(t('motion.boneLockApplied', { bone: bn }), true);
            }
        });

        selectContainer.appendChild(label);
        selectContainer.appendChild(select);
        container.appendChild(selectContainer);
    } else if (boneLock.enabled && boneNames.length === 0) {
        // 有锁定但无骨骼（例如模型未加载）——显示提示
        const hint = document.createElement('div');
        hint.className = 'cs-hint';
        hint.style.cssText = 'font-size:11px;opacity:0.5;padding:4px 0;';
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
