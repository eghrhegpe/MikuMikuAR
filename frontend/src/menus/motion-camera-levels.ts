// [doc:architecture] Camera Levels — 相机参数弹窗层级
// 从 scene-menu.ts 迁移到 motion-popup.ts

import { setStatus, cardContainer, stackRegistry } from '../core/config';
import type { PopupLevel } from '../core/config';
import {
    slideRow,
    addSliderRow,
    addToggleRow,
    addModeSlider,
    addModeRow,
} from '../core/ui-helpers';
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
import { triggerAutoSave, pushUndoSnapshot, offerSceneUndoAndRefresh } from '../scene/scene';
import { getRenderState, setRenderState } from '../scene/render/renderer';
import { getMotionMenu } from './motion-popup';
import {
    switchARCameraFacing,
    setARMirror,
    isARMirrored,
    getARFacing,
    isARActive,
} from '../scene/ar/ar-camera';
import {
    probeWebXR,
    probeWebXRFeatures,
    formatProbeReport,
    type WebXRProbeResult,
} from '../scene/ar/ar-webxr-probe';
import { t } from '../core/i18n/t'; // [doc:adr-059]
import { renderMenu } from './render-menu';
import { addDisabledRow } from '../core/ui-helpers';
import { getCachedCapabilities } from '../core/backend';
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
                    ];
                    if (getCachedCapabilities().ar) {
                        controlOptions.push({ value: 'ar', label: t('motion.camAR') });
                    }
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
                        { bind: () => getFov() },
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
                    addDisabledRow(inner, t('motion.cameraBehavior'), t('motion.behaviorNA'));
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
                            const snap = pushUndoSnapshot();
                            clearCameraVmd();
                            triggerAutoSave();
                            refreshCameraLevel();
                            setStatus(t('motion.camVmdCleared'), true);
                            offerSceneUndoAndRefresh(t('motion.camVmdCleared'), snap, () => {
                                refreshCameraLevel();
                            });
                        });
                    }
                    slideRow(
                        inner,
                        'lucide:upload',
                        t('motion.loadCamVmd'),
                        false,
                        () => {
                            // [doc:adr-131] 通过 outcome.mode='bindCameraVmd' 标识相机 VMD 加载入口，
                            // motionOnItemClick 据此分流到 camera-vmd 加载，避免与场景级动作 VMD 加载混淆。
                            const level = stackRegistry.buildLevel!(
                                getBrowseDir('vmd'),
                                t('motion.camVmdLabel'),
                                (m) => m.format === 'vmd',
                                undefined,
                                undefined,
                                { mode: 'bindCameraVmd' }
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
        // 卡片：镜头（景深）—— 方案 C：DOF 编辑入口统一收口到相机面板（置于菜单底部，低频参数）
        {
            id: 'camera:lens',
            kind: 'custom',
            renderCustom: (c) => {
                cardContainer(c, (inner) => {
                    const title = document.createElement('div');
                    title.className = 'card-title';
                    title.textContent = t('motion.cameraLens');
                    inner.appendChild(title);

                    addSliderRow(
                        inner,
                        t('scene.dof'),
                        getRenderState().dofAperture,
                        0,
                        1,
                        0.05,
                        (v) => {
                            setRenderState({
                                dofEnabled: (v as number) > 0,
                                dofAperture: v as number,
                            });
                            triggerAutoSave();
                        },
                        'lucide:camera',
                        undefined,
                        { bind: () => getRenderState().dofAperture }
                    );
                    addSliderRow(
                        inner,
                        t('scene.dofFocus'),
                        getRenderState().dofFocusDistance,
                        1,
                        300,
                        1,
                        (v) => {
                            setRenderState({ dofEnabled: true, dofFocusDistance: v as number });
                            triggerAutoSave();
                        },
                        'lucide:crosshair',
                        undefined,
                        { bind: () => getRenderState().dofFocusDistance }
                    );
                    addSliderRow(
                        inner,
                        t('scene.dofFocal'),
                        getRenderState().dofFocalLength,
                        20,
                        200,
                        1,
                        (v) => {
                            setRenderState({ dofEnabled: true, dofFocalLength: v as number });
                            triggerAutoSave();
                        },
                        'lucide:aperture',
                        undefined,
                        { bind: () => getRenderState().dofFocalLength }
                    );
                });
            },
        },
    ] satisfies MenuNode[];
}

export function buildCameraLevel(): PopupLevel {
    return {
        label: t('motion.cameraMode'),
        dir: '',
        items: [],
        renderCustom: (container) => {
            return renderMenu(buildCameraSchema(), container);
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
        addModeRow(container, t('motion.boneLockSelect'), boneOptions, boneLock.boneName, (bn) => {
            setOrbitBoneLock(true, bn);
            setStatus(t('motion.boneLockApplied', { bone: bn }), true);
            refreshCameraLevel();
        });
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
            try {
                await switchARCameraFacing();
            } catch {
                setStatus(t('motion.arSwitchFailed'), false);
            }
            refreshCameraLevel();
        }
    );
    if (!isARActive()) {
        const tip = document.createElement('div');
        tip.className = 'cs-hint';
        tip.textContent = t('motion.cameraStarting');
        container.appendChild(tip);
    }

    // === WebXR 探针 (ADR-072 P1) ===
    renderWebXRProbeSection(container);
}

// ======== WebXR Probe UI ========

let _probeResult: WebXRProbeResult | null = null;
let _probing = false;

function renderWebXRProbeSection(container: HTMLElement): void {
    // 分隔线
    const sep = document.createElement('div');
    sep.className = 'cs-separator';
    container.appendChild(sep);

    // 探针标题
    const title = document.createElement('div');
    title.className = 'cs-hint';
    title.textContent = `── ${t('scene.ar.webxrProbe')} (ADR-072) ──`;
    container.appendChild(title);

    // 快速探针按钮（非侵入式）
    slideRow(
        container,
        'lucide:radar',
        _probing ? t('scene.ar.webxrProbing') : t('scene.ar.webxrProbe'),
        false,
        async () => {
            if (_probing) {
                return;
            }
            _probing = true;
            refreshCameraLevel();
            try {
                _probeResult = await probeWebXR();
                setStatus(_verdictText(_probeResult.verdict), _probeResult.verdict !== 'none');
            } catch (e) {
                setStatus(t('motion.webxrProbeError', { e: String(e) }), false);
            }
            _probing = false;
            refreshCameraLevel();
        }
    );

    // 深度探针按钮（会触发 AR session + 权限弹窗）
    slideRow(container, 'lucide:scan', t('scene.ar.webxrDeepProbe'), false, async () => {
        if (_probing) {
            return;
        }
        _probing = true;
        refreshCameraLevel();
        try {
            _probeResult = await probeWebXRFeatures();
            setStatus(_verdictText(_probeResult.verdict), _probeResult.verdict !== 'none');
        } catch (e) {
            setStatus(t('motion.webxrDeepProbeError', { e: String(e) }), false);
        }
        _probing = false;
        refreshCameraLevel();
    });

    // 复制报告按钮（仅在有结果时显示）
    if (_probeResult) {
        slideRow(container, 'lucide:copy', t('scene.ar.webxrCopyReport'), false, async () => {
            try {
                await navigator.clipboard.writeText(formatProbeReport(_probeResult!));
                setStatus(t('scene.ar.webxrCopied'), true);
            } catch {
                // clipboard API 可能不可用（需用户手势）
                setStatus(t('motion.clipboardUnavailable'), false);
            }
        });

        // 显示探针结果摘要
        const result = document.createElement('div');
        result.className = 'cs-hint weak-text';
        result.style.whiteSpace = 'pre-wrap';
        result.style.fontSize = '0.75em';
        result.style.lineHeight = '1.4';
        result.style.padding = '4px 8px';
        result.textContent = _formatShortResult(_probeResult);
        container.appendChild(result);
    }

    // === ARCore 共存探针 (ADR-073 P1，仅 Android) ===
    renderARCoreProbeSection(container);

    // === Vuforia 共存探针（国产设备备选） ===
    renderVuforiaProbeSection(container);
}

function _verdictText(verdict: 'full' | 'partial' | 'none'): string {
    switch (verdict) {
        case 'full':
            return t('scene.ar.webxrVerdictFull');
        case 'partial':
            return t('scene.ar.webxrVerdictPartial');
        case 'none':
            return t('scene.ar.webxrVerdictNone');
    }
}

function _formatShortResult(r: WebXRProbeResult): string {
    const lines: string[] = [
        `${_verdictText(r.verdict)}`,
        `platform: ${r.platform}`,
        `navigator.xr: ${r.xrAvailable ? '✓' : '✗'}`,
        `immersive-ar: ${r.immersiveAR ? '✓' : '✗'}`,
    ];
    if (r.immersiveAR) {
        lines.push(`hit-test: ${r.hitTest ? '✓' : '?'}`);
        lines.push(`plane-detection: ${r.planeDetection ? '✓' : '?'}`);
    }
    lines.push(r.summary);
    return lines.join('\n');
}

// ======== ARCore Probe UI (ADR-073 P1) ========

let _arcoreProbeResult: string | null = null;

declare global {
    interface Window {
        __onARCoreProbeResult?: (json: string) => void;
    }
}

function renderARCoreProbeSection(container: HTMLElement): void {
    // 仅在 Android 平台显示
    const w = window.wails;
    if (!w || typeof w.launchARCoreProbe !== 'function') {
        return;
    }

    const sep = document.createElement('div');
    sep.className = 'cs-separator';
    container.appendChild(sep);

    const title = document.createElement('div');
    title.className = 'cs-hint';
    title.textContent = `── ${t('scene.ar.arcoreProbe')} (ADR-073) ──`;
    container.appendChild(title);

    slideRow(container, 'lucide:box', t('scene.ar.arcoreLaunch'), false, () => {
        // 注册回调
        window.__onARCoreProbeResult = (json: string) => {
            window.__onARCoreProbeResult = undefined;
            _arcoreProbeResult = json;
            try {
                const r = JSON.parse(json) as {
                    success: boolean;
                    arcoreSession: boolean;
                    cameraFrame: boolean;
                    webViewOverlay: boolean;
                    frameCount: number;
                    error: string | null;
                };
                if (r.success) {
                    setStatus(t('scene.ar.arcoreSuccess'), true);
                } else {
                    setStatus(`${t('scene.ar.arcoreFailed')}: ${r.error || 'unknown'}`, false);
                }
            } catch {
                setStatus(t('scene.ar.arcoreFailed'), false);
            }
            refreshCameraLevel();
        };
        w.launchARCoreProbe!();
        setStatus(t('scene.ar.arcoreLaunching'), true);
    });

    // 显示上次探针结果
    if (_arcoreProbeResult) {
        const result = document.createElement('div');
        result.className = 'cs-hint weak-text';
        result.style.whiteSpace = 'pre-wrap';
        result.style.fontSize = '0.75em';
        result.style.lineHeight = '1.4';
        result.style.padding = '4px 8px';
        try {
            const r = JSON.parse(_arcoreProbeResult) as Record<string, unknown>;
            result.textContent = Object.entries(r)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
        } catch {
            result.textContent = _arcoreProbeResult;
        }
        container.appendChild(result);
    }
}

// ======== Vuforia Probe UI (国产设备备选) ========

let _vuforiaProbeResult: string | null = null;

declare global {
    interface Window {
        __onVuforiaProbeResult?: (json: string) => void;
    }
}

function renderVuforiaProbeSection(container: HTMLElement): void {
    const w = window.wails;
    if (!w || typeof w.launchVuforiaProbe !== 'function') {
        return;
    }

    const sep = document.createElement('div');
    sep.className = 'cs-separator';
    container.appendChild(sep);

    const title = document.createElement('div');
    title.className = 'cs-hint';
    title.textContent = `── ${t('scene.ar.vuforiaProbe')} ──`;
    container.appendChild(title);

    slideRow(container, 'lucide:scan-eye', t('scene.ar.vuforiaLaunch'), false, () => {
        window.__onVuforiaProbeResult = (json: string) => {
            window.__onVuforiaProbeResult = undefined;
            _vuforiaProbeResult = json;
            try {
                const r = JSON.parse(json) as {
                    success: boolean;
                    vuforiaInitialized: boolean;
                    cameraStarted: boolean;
                    webViewOverlay: boolean;
                    frameCount: number;
                    error: string | null;
                };
                if (r.success) {
                    setStatus(t('scene.ar.vuforiaSuccess'), true);
                } else {
                    setStatus(`${t('scene.ar.vuforiaFailed')}: ${r.error || 'unknown'}`, false);
                }
            } catch {
                setStatus(t('scene.ar.vuforiaFailed'), false);
            }
            refreshCameraLevel();
        };
        w.launchVuforiaProbe!();
        setStatus(t('scene.ar.vuforiaLaunching'), true);
    });

    if (_vuforiaProbeResult) {
        const result = document.createElement('div');
        result.className = 'cs-hint weak-text';
        result.style.whiteSpace = 'pre-wrap';
        result.style.fontSize = '0.75em';
        result.style.lineHeight = '1.4';
        result.style.padding = '4px 8px';
        try {
            const r = JSON.parse(_vuforiaProbeResult) as Record<string, unknown>;
            result.textContent = Object.entries(r)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
        } catch {
            result.textContent = _vuforiaProbeResult;
        }
        container.appendChild(result);
    }
}
