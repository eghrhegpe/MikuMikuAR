// [doc:architecture] Camera — 相机模式管理系统
// 规范文档: docs/architecture.md §渲染环节
// 职责: 相机模式切换（orbit/freefly/surround/concert/oneshot/vmd/ar）、自动构图、自由飞行输入
// Camera mode manager for MikuMikuAR
// Handles Orbit, Freefly, Surround (turntable), Concert (fan-cam), One-shot, VMD, and AR modes.

import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import { focusedModelId, modelRegistry, triggerAutoSave, uiState, setStatus } from '@/core/config';
import { schedulePersistUI } from '../env/env-bridge';
import { freeflyInput } from '@/core/freefly-state';
import { clamp, debounce, deepClone } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { safeCallAsync } from '@/core/safe-call';
import { t } from '@/core/i18n/t';
import { focusModel, reattachPipeline, setARMode, getProcBeatDetector } from '../scene';
import { InvertableArcRotateCameraPointersInput } from './invertablePointersInput';
import { addDisposableListener, type Disposable } from '@/core/dom';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
// 从 camera-state.ts 导入纯状态函数（仅导入本地未定义的函数）
import {
    defaultCameraPreset, getCameraPreset, setCameraPreset,
    getOrbitParams, getFreeflyParams, getConcertParams, getSurroundParams,
    getCameraMode, setCameraMode,
    getCameraControl, setCameraControl as _setCameraControlState,
    getCameraBehavior, setCameraBehavior as _setCameraBehaviorState,
    getScriptedSubMode, setScriptedSubMode,
    getCurrentCamera, setCurrentCamera,
    getFocusCenterY, setFocusCenterY,
    getConcertPaused, setConcertPaused,
    getSurroundPaused, setSurroundPaused,
    getCameraVmdName, getCameraVmdPath, hasCameraVmd,
    setCameraVmdState, clearCameraVmdState,
    setAutoCameraEnabledFlag,
    isAutoCameraEnabled as isAutoCameraEnabledFlag,
    setAutoCameraBeatCount as _setAutoCameraBeatCount,
    getAutoCameraBeatCount as _getAutoCameraBeatCount,
    setAutoCameraPresetIdx as _setAutoCameraPresetIdx,
    getAutoCameraPresetIdx as _getAutoCameraPresetIdx,
    isTouchDevice,
    getFov as getFovState,
    setFov as setFovState,
} from './camera-state';
import type {
    CameraMode, CameraControl, CameraBehavior, ScriptedSubMode,
    OrbitParams, FreeflyParams, SurroundParams, ConcertParams, CameraPreset,
} from './camera-state';
// 注：setFov/setCameraControl/setCameraBehavior/isAutoCameraEnabled 保留本地定义（含 scene 依赖逻辑）
// setOrbitParams/setFreeflyParams/setConcertParams/setSurroundParams 保留本地定义（需同步 live camera）

// ======== Types (单源定义在 camera-state.ts，此处 re-export) ========
// LEGACY_MODE_MAP / deriveLegacyMode 含场景逻辑，保留本地定义

/** ADR-100 §6.1 — 旧模式 → 双轴映射（迁移 / shim 共用）。 */
export const LEGACY_MODE_MAP: Record<
    CameraMode,
    { control: CameraControl; behavior: CameraBehavior; scripted?: ScriptedSubMode }
> = {
    orbit: { control: 'orbit', behavior: 'none' },
    surround: { control: 'orbit', behavior: 'turntable' },
    concert: { control: 'orbit', behavior: 'concert' },
    vmd: { control: 'orbit', behavior: 'scripted', scripted: 'loop' },
    oneshot: { control: 'orbit', behavior: 'scripted', scripted: 'oneshot' },
    freefly: { control: 'freefly', behavior: 'none' },
    ar: { control: 'ar', behavior: 'none' },
    beatcut: { control: 'orbit', behavior: 'beatcut' },
};

/**
 * ADR-100 §6.2 — 双轴 → 旧模式反查（getCameraState 降级双写 / shim 内部路由）。
 * beatcut 为独立模式，直接返回（不再降级为 orbit）。
 */
export function deriveLegacyMode(
    control: CameraControl,
    behavior: CameraBehavior,
    scripted: ScriptedSubMode = 'loop'
): CameraMode {
    if (control === 'freefly') {
        return 'freefly';
    }
    if (control === 'ar') {
        return 'ar';
    }
    // control === 'orbit'
    switch (behavior) {
        case 'turntable':
            return 'surround';
        case 'concert':
            return 'concert';
        case 'scripted':
            return scripted === 'oneshot' ? 'oneshot' : 'vmd';
        case 'beatcut':
            return 'beatcut';
        case 'none':
        default:
            return 'orbit';
    }
}

// ======== Runtime Preset State ========

// ======== Camera Persist (拖拽结束后自动保存) ========
const _scheduleCameraPersist = debounce((): void => {
    triggerAutoSave();
}, 500);

/**
 * 相机视角变化时延迟触发保存（500ms 防抖）
 * 当用户拖拽结束时，视角变化停止，500ms 后自动保存
 */
function scheduleCameraPersist(): void {
    _scheduleCameraPersist();
}

// ======== Sub-preset Getters 已迁移至 camera-state.ts ========

export function setOrbitParams(p: Partial<OrbitParams>): void {
    Object.assign(getCameraPreset().orbit, p);
    // camera-state.ts 已更新 _currentPreset.orbit，此处仅同步到 live camera
    if (getCameraMode() === 'orbit' && getCurrentCamera() instanceof ArcRotateCamera) {
        const cam = getCurrentCamera() as ArcRotateCamera;
        if (p.distance !== undefined) {
            cam.radius = p.distance;
        }
        if (p.beta !== undefined) {
            cam.beta = p.beta;
        }
        if (p.targetHeight !== undefined) {
            cam.target.y = getFocusCenterY() + p.targetHeight;
        }
    }
}
/** Log current camera alpha for diagnostics. */
export function logCameraAlpha(): void {
    if (getCameraMode() === 'orbit' && getCurrentCamera() instanceof ArcRotateCamera) {
        console.info('[camera] current alpha:', (getCurrentCamera() as ArcRotateCamera).alpha.toFixed(3));
    }
}

export function setFreeflyParams(p: Partial<FreeflyParams>): void {
    Object.assign(getCameraPreset().freefly, p);
    if (getCameraMode() === 'freefly' && getCurrentCamera() instanceof UniversalCamera) {
        const cam = getCurrentCamera() as UniversalCamera;
        if (p.speed !== undefined) {
            cam.speed = p.speed;
        }
        if (p.angularSensibility !== undefined) {
            cam.angularSensibility = p.angularSensibility;
        }
    }
}
export function setConcertParams(p: Partial<ConcertParams>): void {
    Object.assign(getCameraPreset().concert, p);
}
export function setSurroundParams(p: Partial<SurroundParams>): void {
    Object.assign(getCameraPreset().surround, p);
}

// ======== Internal State ========
let _scene: Scene | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _previousMode: CameraMode = 'orbit';
// ADR-100 双轴状态。_cameraMode 保留为兼容别名，三者由 _syncAxesFromMode 在 switchCameraMode
// 内统一派生，保证单一写入点（避免幽灵路径）。
// 注：模块级 _cameraControl/_cameraBehavior/_scriptedSubMode 已迁移至 camera-state.ts，
// 通过 getCameraControl/setCameraControl 等访问

/**
 * ADR-100 §6.3 — 行为轴派生（含 beatcut 叠加与互斥）。
 * beatcut 是运行时叠加行为：仅当自动运镜开启、且基底行为为 none(orbit) 时生效；
 * 与 concert/turntable/scripted 互斥（这些基底行为存在时 beatcut 被抑制）。
 */
function _resolveBehavior(mode: CameraMode): CameraBehavior {
    const m = LEGACY_MODE_MAP[mode];
    if (isAutoCameraEnabled() && m.control === 'orbit' && m.behavior === 'none') {
        return 'beatcut';
    }
    return m.behavior;
}

/** ADR-100：由旧 mode 派生双轴状态。switchCameraMode 提交 _cameraMode 时同步调用，作为唯一写入点。 */
function _syncAxesFromMode(mode: CameraMode): void {
    const m = LEGACY_MODE_MAP[mode];
    _setCameraControlState(m.control);
    _setCameraBehaviorState(_resolveBehavior(mode));
    if (m.scripted) {
        setScriptedSubMode(m.scripted);
    }
}
// 注：_currentCamera/_fov/_focusCenterY 已迁移至 camera-state.ts 的
// getCurrentCamera/setCurrentCamera/getFov/setFov/getFocusCenterY/setFocusCenterY

function clampFov(v: number): number {
    return clamp(v, 0.1, 3);
}
let _concertUpdateHandle: ObserverHandle | null = null;
let _concertT = 0;
let _surroundUpdateHandle: ObserverHandle | null = null;
let _viewMatrixHandle: ObserverHandle | null = null;
let _surroundAngle = 0;
// 注：_concertPaused 已迁移至 camera-state.ts（getConcertPaused/setConcertPaused/getSurroundPaused/setSurroundPaused）
// Cached target vector for concert/surround modes (avoids per-frame Vector3 allocation)
const _concertTarget = new Vector3(0, 8, 0);

// ======== Camera VMD ========
let _mmdCamera: MmdCamera | null = null;
let _cameraAnimationHandle: number | null = null;
// 注：_cameraVmdName/_cameraVmdPath 已迁移至 camera-state.ts
// （getCameraVmdName/getCameraVmdPath/hasCameraVmd/setCameraVmdState/clearCameraVmdState）

/** Load camera animation from a VMD (MmdAnimation) and create an MmdCamera. */
export function loadCameraVmd(mmdAnimation: MmdAnimation, vmdPath: string, vmdName: string): void {
    if (!_scene) {
        return;
    }

    if (_mmdCamera) {
        _scene.removeCamera(_mmdCamera);
        _mmdCamera.dispose(); // 释放 GPU 资源（渲染目标、贴图等）
        _mmdCamera = null;
        _cameraAnimationHandle = null;
    }

    const mmdCam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), _scene, false);
    const handle = mmdCam.createRuntimeAnimation(mmdAnimation);
    mmdCam.setRuntimeAnimation(handle);

    _mmdCamera = mmdCam;
    _cameraAnimationHandle = handle;
    setCameraVmdState(vmdName, vmdPath);
}

export function clearCameraVmd(): void {
    if (_mmdCamera && _scene) {
        if (getCameraMode() === 'vmd' && _scene) {
            switchCameraMode('orbit');
        }
        _scene.removeCamera(_mmdCamera);
        _mmdCamera = safeDispose(_mmdCamera);
        _cameraAnimationHandle = null;
        clearCameraVmdState();
    }
}

/** Animate the VMD camera to a given 30fps frame time. Called every tick by scene.ts. */
export function animateCameraVmd(frameTime: number): void {
    if (_mmdCamera && getCameraMode() === 'vmd') {
        _mmdCamera.animate(frameTime);
    }
}

function createVmdCamera(): MmdCamera {
    if (_mmdCamera) {
        return _mmdCamera;
    }
    const cam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), _scene, false);
    _mmdCamera = cam;
    return cam;
}

// Stored observer callback references so we can remove them later
let _freeflyUpdateHandle: ObserverHandle | null = null;
let _boneLockUpdateHandle: ObserverHandle | null = null;

// ======== Public Getters 已迁移至 camera-state.ts ========

// ======== Dual-Axis Accessors (ADR-100) ========
// _cameraMode 仍是兼容别名，双轴值由 _syncAxesFromMode() 单点派生。
// getCameraControl/getCameraBehavior/getScriptedSubMode 已迁移至 camera-state.ts

/**
 * ADR-100 P4 — 直接设置控制方案轴（轴 A）。
 * freefly/ar 非 ArcRotate，行为轴强制 none 并关闭自动运镜；
 * orbit 下保留当前行为（含 beatcut 叠加语义，由 _resolveBehavior 派生）。
 */
export function setCameraControl(control: CameraControl): void {
    if (control === getCameraControl()) {
        return; // 已是该控制方案，无需重建相机
    }
    const baseBehavior: CameraBehavior = getCameraBehavior() === 'beatcut' ? 'none' : getCameraBehavior();
    const legacy = deriveLegacyMode(control, baseBehavior, getScriptedSubMode());
    switchCameraMode(legacy);
    // ADR-100 P4：headless 下 switchCameraMode 因缺 _scene/_canvas 早退、不提交 _cameraMode 亦不派生双轴；
    // 此处补提交并直接派生，使双轴出口对 scene 无关（与 setCameraState 一致），production 下为幂等重同步。
    setCameraMode(legacy);
    _syncAxesFromMode(legacy);
    if (control !== 'orbit') {
        setAutoCameraEnabled(false); // 非 orbit：行为轴强制 none，自动运镜无意义
    }
}

/**
 * ADR-100 P4 — 直接设置运动行为轴（轴 B，仅 orbit 有效）。
 * 'beatcut' 开启自动运镜（_resolveBehavior 派生为 beatcut）；其余行为关闭自动运镜。
 * 非 orbit 控制下调用非 none 行为将被忽略（行为轴对 Universal/AR 不适用）。
 */
export function setCameraBehavior(behavior: CameraBehavior): void {
    if (behavior === getCameraBehavior()) {
        return;
    }
    if (getCameraControl() !== 'orbit' && behavior !== 'none') {
        return; // 行为轴仅对 orbit 生效，非 orbit 强制 none
    }
    if (behavior === 'beatcut') {
        // 确保控制为 orbit，再开启自动运镜（_resolveBehavior 派生 beatcut）
        const legacy = deriveLegacyMode(getCameraControl(), 'none', getScriptedSubMode());
        switchCameraMode(legacy);
        setCameraMode(legacy);
        _syncAxesFromMode(legacy); // 同 setCameraControl：headless 下补派生，production 幂等
        setAutoCameraEnabled(true);
        return;
    }
    setAutoCameraEnabled(false);
    const legacy = deriveLegacyMode(getCameraControl(), behavior, getScriptedSubMode());
    switchCameraMode(legacy);
    setCameraMode(legacy);
    _syncAxesFromMode(legacy); // 同 setCameraControl：headless 下补派生，production 幂等
}

export function setFov(v: number): void {
    setFovState(clampFov(v));
    if (getCurrentCamera()) {
        getCurrentCamera()!.fov = getFovState();
    }
}

// ======== Freefly Input State ========
// [doc:adr-102] `freeflyInput` 定义已迁至 `@/core/freefly-state`（leaf 模块），
// 由 camera（消费）与未来 events.ts（键盘写入）共享，破除 camera↔events 循环依赖。
// 见上方 `import { freeflyInput } from '@/core/freefly-state';`

// ======== Camera Factory Functions ========

// ======== 用户相机输入设置（灵敏度 / 反 Y 轴）========
// 基准值取自 Babylon 默认值与本项目既有设定；sens 越大越灵敏（数值越小=反应越快）
const CAM_BASE = { angular: 2000, wheel: 3, pan: 50, speed: 0.5 };

/** 跟踪每个 ArcRotate 相机实例对应的可反转指针输入，便于设置变更时实时同步 invertY。 */
const _invertableInputs = new WeakMap<Camera, InvertableArcRotateCameraPointersInput>();

/** 将默认 ArcRotate 指针输入替换为可反转 Y 轴的子类实例，并写入当前反 Y 设置。 */
function installInvertablePointers(cam: ArcRotateCamera): void {
    cam.inputs.removeByType('ArcRotateCameraPointersInput');
    const input = new InvertableArcRotateCameraPointersInput();
    input.invertY = uiState.invertYAxis === true;
    cam.inputs.add(input);
    _invertableInputs.set(cam, input);
}

/** 将用户灵敏度设置应用到相机实例（orbit/oneshot: ArcRotate；freefly: Universal） */
export function applyCameraUserSettings(cam: Camera): void {
    const sens = uiState.cameraSensitivity ?? 1;
    if (cam instanceof ArcRotateCamera) {
        cam.angularSensibilityX = CAM_BASE.angular / sens;
        cam.angularSensibilityY = CAM_BASE.angular / sens;
        cam.wheelPrecision = CAM_BASE.wheel / sens;
        cam.panningSensibility = CAM_BASE.pan / sens;
    } else if (cam instanceof UniversalCamera) {
        cam.angularSensibility = CAM_BASE.angular / sens;
        cam.speed = CAM_BASE.speed * sens;
    }
}

/** 设置变更后重新应用到当前活动相机 */
export function refreshCameraUserSettings(): void {
    const cam = getCurrentCamera();
    if (!cam) {
        return;
    }
    applyCameraUserSettings(cam);
    // 触屏设备的参数覆写（applyCameraUserSettings 可能重置了它们）
    if (isTouchDevice() && cam instanceof ArcRotateCamera) {
        cam.pinchPrecision = 8;
        cam.useNaturalPinchZoom = true;
        cam.panningSensibility = 20;
    }
    const inv = _invertableInputs.get(cam);
    if (inv) {
        inv.invertY = uiState.invertYAxis === true;
    }
}

function createOrbitCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
    const p = getCameraPreset().orbit;
    const cam = new ArcRotateCamera(
        'camera',
        -Math.PI / 2,
        p.beta,
        p.distance,
        new Vector3(0, getFocusCenterY() + p.targetHeight, 0),
        scene
    );
    cam.minZ = 0.1;
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    installInvertablePointers(cam);
    cam.attachControl(canvas, true);
    applyCameraUserSettings(cam);
    if (isTouchDevice()) {
        cam.pinchPrecision = 8;
        cam.panningSensibility = 20;
        cam.useNaturalPinchZoom = true;
    } else {
        cam.panningSensibility = 50;
    }
    // 相机视角变化时延迟触发保存（拖拽/缩放结束后）
    _viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);
    return cam;
}

function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
    const p = getCameraPreset().freefly;
    const cam = new UniversalCamera('freeflyCam', new Vector3(0, 8, 16), scene);
    cam.minZ = 0.1;
    cam.speed = p.speed;
    cam.angularSensibility = p.angularSensibility;
    cam.attachControl(canvas, true);
    applyCameraUserSettings(cam);
    cam.keysUp = [];
    cam.keysDown = [];
    cam.keysLeft = [];
    cam.keysRight = [];
    // 相机移动时延迟触发保存
    _viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);
    return cam;
}

function createSurroundCamera(scene: Scene): ArcRotateCamera {
    const p = getCameraPreset().surround;
    const cam = new ArcRotateCamera(
        'surroundCam',
        -Math.PI / 2,
        Math.PI / 3,
        p.radius,
        new Vector3(0, p.height, 0),
        scene
    );
    cam.minZ = 0.1;
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    // No attachControl — we animate programmatically; mouse would interfere
    // 相机视角变化时延迟触发保存
    _viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);
    return cam;
}

/** Concert (fan-cam): limited horizontal sweep + sinusoidal vertical bob around the target. */
function createConcertCamera(scene: Scene): ArcRotateCamera {
    const p = getCameraPreset().concert;
    const cam = new ArcRotateCamera(
        'concertCam',
        -Math.PI / 2,
        p.baseBeta,
        p.radius,
        new Vector3(0, p.height, 0),
        scene
    );
    cam.minZ = 0.1;
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    // No attachControl — we animate programmatically; mouse would interfere
    // 相机视角变化时延迟触发保存
    _viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);
    return cam;
}

function createOneshotCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
    // Placeholder — same as orbit for now; animation data applied later
    const cam = new ArcRotateCamera(
        'oneshotCam',
        -Math.PI / 2,
        Math.PI / 3,
        16,
        new Vector3(0, 8, 0),
        scene
    );
    cam.minZ = 0.1;
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    installInvertablePointers(cam);
    cam.attachControl(canvas, true);
    applyCameraUserSettings(cam);
    if (isTouchDevice()) {
        cam.pinchPrecision = 8;
        cam.panningSensibility = 20;
        cam.useNaturalPinchZoom = true;
    } else {
        cam.panningSensibility = 50;
    }
    // 相机视角变化时延迟触发保存
    _viewMatrixHandle = observe(cam.onViewMatrixChangedObservable, scheduleCameraPersist);
    return cam;
}

// ======== Initialization ========

/** Initialise the camera system and create the default Orbit camera. */
export function initCameraSystem(scene: Scene, canvas: HTMLCanvasElement): Camera {
    _scene = scene;
    _canvas = canvas;
    const cam = createOrbitCamera(scene, canvas);
    setCurrentCamera(cam);
    setCameraMode('orbit');
    _syncAxesFromMode('orbit');
    scene.activeCamera = cam;
    return cam;
}

// ======== Mode Switch ========

/** Switch to a different camera mode, preserving position as much as possible. */
export function switchCameraMode(mode: CameraMode): void {
    if (mode === getCameraMode() && getCurrentCamera()) {
        return;
    }
    if (!_scene || !_canvas) {
        return;
    }

    const scene = _scene;
    const canvas = _canvas;

    // 停止当前模式的 side-effect（覆盖所有切换，含进出 AR）。
    // 原实现在 `mode==='ar'` 早退分支跳过了此块，导致 orbit 骨骼锁、
    // freefly/concert/surround 的 onBeforeRender 回调在切到 AR 时残留注册
    // （仅靠各回调内部的 _cameraMode 守卫变 no-op，属轻微泄漏，AR 审查 #5）。
    if (getCameraMode() === 'ar') {
        setARMode(false);
    } else {
        if (getCameraMode() === 'freefly') {
            stopFreefly();
        }
        if (getCameraMode() === 'concert') {
            stopConcert();
        }
        if (getCameraMode() === 'surround') {
            stopSurround();
        }
        if (getCameraMode() === 'orbit') {
            _stopBoneLock();
        }
    }

    if (mode === 'ar') {
        if (getCameraMode() !== 'ar') {
            _previousMode = getCameraMode();
        }
        // 乐观提交 _cameraMode='ar'，保证"进入 AR 期间用户切走"时下方
        // `if (_cameraMode === 'ar')` 离开检测能命中并正确注销摄像头。
        // 真正的视频激活由 setARMode(true) 异步完成；若失败，仅还原模式标记，
        // 不重建相机（进入 AR 时从未切换/重建 Babylon 相机）。
        setCameraMode('ar');
        _syncAxesFromMode('ar');
        getCameraPreset().mode = 'ar';
        safeCallAsync('camera', 'setARMode failed:', () =>
            setARMode(true).then((ok) => {
                if (!ok) {
                    // 失败：若后续切换尚未把模式改走（仍在 ar），才提示并还原标记。
                    if (getCameraMode() === 'ar') {
                        setStatus(t('scene.camera.arFailed'), false);
                    }
                    setCameraMode(_previousMode);
                    _syncAxesFromMode(_previousMode);
                    getCameraPreset().mode = _previousMode;
                }
            })
        );
        return;
    }

    // Save old camera state
    const oldCam = getCurrentCamera();
    let oldPos: Vector3 | null = null;
    let oldTarget: Vector3 | null = null;

    if (oldCam) {
        oldPos = oldCam.position.clone();
        if (oldCam instanceof ArcRotateCamera) {
            oldTarget = oldCam.target.clone();
        } else {
            // Derive a look-at target from the forward direction
            const dir = oldCam.getDirection(new Vector3(0, 0, 1));
            oldTarget = oldPos.add(dir);
        }
        oldCam.detachControl();
        scene.removeCamera(oldCam);
        // 旧相机的视角变化 observer 显式解绑（统一走 ObserverHandle；cam.dispose 亦会清理，双保险）
        _viewMatrixHandle = safeDispose(_viewMatrixHandle);
        oldCam.dispose();
    }

    // Create new camera
    let newCam: Camera;
    switch (mode) {
        case 'orbit':
            newCam = createOrbitCamera(scene, canvas);
            break;
        case 'freefly':
            newCam = createFreeflyCamera(scene, canvas);
            break;
        case 'concert':
            newCam = createConcertCamera(scene);
            break;
        case 'surround':
            newCam = createSurroundCamera(scene);
            break;
        case 'oneshot':
            newCam = createOneshotCamera(scene, canvas);
            break;
        case 'vmd':
            // Pre-check: refuse switch if no camera VMD is loaded
            if (_cameraAnimationHandle === null) {
                logWarn(
                    'camera',
                    'Cannot switch to VMD mode: no camera VMD loaded, falling back to orbit'
                );
                mode = 'orbit';
                newCam = createOrbitCamera(scene, canvas);
                break;
            }
            newCam = createVmdCamera();
            break;
        default:
            newCam = createOrbitCamera(scene, canvas);
            break;
    }

    // Restore position (best-effort)
    if (oldPos) {
        newCam.position = oldPos;
        if (newCam instanceof ArcRotateCamera && oldTarget) {
            newCam.setTarget(oldTarget);
        } else if (newCam instanceof UniversalCamera && oldTarget) {
            newCam.setTarget(oldTarget);
        }
    }

    scene.activeCamera = newCam;
    setCurrentCamera(newCam);
    setCameraMode(mode);
    _syncAxesFromMode(mode);
    // Persist camera mode for scene auto-save (skip oneshot — it's a transient action)
    if (mode !== 'oneshot') {
        getCameraPreset().mode = mode;
    }

    // Start new mode's side-effects
    if (mode === 'freefly') {
        initFreeflyUpdate(scene);
        initFreeflyTouch(canvas);
    }
    if (mode === 'concert') {
        startConcert(scene);
    }
    if (mode === 'surround') {
        startSurround(scene);
    }

    // Auto-frame on focused model when switching to orbit
    if (mode === 'orbit' && focusedModelId) {
        const inst = modelRegistry.get(focusedModelId);
        if (inst) {
            focusModel(focusedModelId);
        }
    }

    // Re-attach post-processing pipeline to the new camera
    reattachPipeline();
    // Apply FOV to the new camera
    newCam.fov = clampFov(getFovState());
}

// ======== Auto Frame ========

/** Auto-frame the camera to centre on a bounding box. */
export function autoFrame(center: Vector3, extent: number): void {
    const cam = getCurrentCamera();
    if (!cam) {
        return;
    }

    // 记录聚焦模型中心 Y，使 targetHeight 表现为相对中心的偏移
    setFocusCenterY(center.y);
    if (cam instanceof ArcRotateCamera) {
        cam.setTarget(center);
        // 叠加用户偏移偏好（相对模型中心的垂直偏移，0 = 正中）
        cam.target.y = center.y + getCameraPreset().orbit.targetHeight;
        cam.radius = extent * 0.75 + 2;
        cam.alpha = -Math.PI / 2;
        cam.beta = Math.PI / 2.2;
    } else if (cam instanceof UniversalCamera) {
        const dist = extent * 0.75 + 2;
        cam.position = new Vector3(center.x - dist, center.y + dist * 0.5, center.z);
        cam.setTarget(center);
    }
}

// ======== Freefly ========

function initFreeflyUpdate(scene: Scene): void {
    // 释放之前的 observer
    if (_freeflyUpdateHandle) {
        _freeflyUpdateHandle.dispose();
    }

    _freeflyUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof UniversalCamera)) {
            return;
        }
        const speed = 0.3 * scene.getAnimationRatio();

        // Read input state set by main.ts keydown/keyup
        // Use explicit temp variable for readability (getDirection returns a new Vector3 each call)
        if (freeflyInput.forward) {
            const dir = cam.getDirection(new Vector3(0, 0, 1)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.backward) {
            const dir = cam.getDirection(new Vector3(0, 0, -1)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.left) {
            const dir = cam.getDirection(new Vector3(-1, 0, 0)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.right) {
            const dir = cam.getDirection(new Vector3(1, 0, 0)).scaleInPlace(speed);
            cam.position.addInPlace(dir);
        }
        if (freeflyInput.up) {
            cam.position.y += speed;
        }
        if (freeflyInput.down) {
            cam.position.y -= speed;
        }
    });
}

// ======== Freefly Touch Controls ========
// 双指滑动：上下 = 前后移动，左右 = 平移
// 双指捏合：前进/后退
let _freeflyTouchHandler: ((e: TouchEvent) => void) | null = null;
let _freeflyTouchEndHandler: (() => void) | null = null;
let _touchPrevDist = 0;
let _touchPrevMidX = 0;
let _touchPrevMidY = 0;
// [doc:adr-102] 持有 touch 监听器的 Disposable，便于在 stopFreeflyTouch 中统一释放
let _touchDisposables: Disposable[] = [];

function initFreeflyTouch(canvas: HTMLCanvasElement): void {
    if (!isTouchDevice()) {
        return;
    }

    _freeflyTouchHandler = (e: TouchEvent) => {
        if (getCameraMode() !== 'freefly') {
            return;
        }
        if (e.touches.length < 2) {
            return;
        }
        e.preventDefault();

        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const dx = t1.clientX - t0.clientX;
        const dy = t1.clientY - t0.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (_touchPrevDist > 0) {
            const dDist = dist - _touchPrevDist;
            const dMidX = midX - _touchPrevMidX;
            const dMidY = midY - _touchPrevMidY;

            // 捏合 → 前进/后退（dist 增大 = 后退，减小 = 前进）
            freeflyInput.forward = dDist < -3;
            freeflyInput.backward = dDist > 3;

            // 双指水平滑动 → 左右平移
            freeflyInput.left = dMidX > 4;
            freeflyInput.right = dMidX < -4;

            // 双指垂直滑动 → 上下移动
            freeflyInput.up = dMidY > 4;
            freeflyInput.down = dMidY < -4;
        }

        _touchPrevDist = dist;
        _touchPrevMidX = midX;
        _touchPrevMidY = midY;
    };

    _freeflyTouchEndHandler = () => {
        freeflyInput.forward = false;
        freeflyInput.backward = false;
        freeflyInput.left = false;
        freeflyInput.right = false;
        freeflyInput.up = false;
        freeflyInput.down = false;
        _touchPrevDist = 0;
    };

    _touchDisposables.push(
        addDisposableListener(canvas, 'touchmove', _freeflyTouchHandler, { passive: false })
    );
    _touchDisposables.push(addDisposableListener(canvas, 'touchend', _freeflyTouchEndHandler));
    _touchDisposables.push(addDisposableListener(canvas, 'touchcancel', _freeflyTouchEndHandler));
}

function stopFreeflyTouch(): void {
    for (const d of _touchDisposables) {
        d.dispose();
    }
    _touchDisposables = [];
    _freeflyTouchHandler = null;
    _freeflyTouchEndHandler = null;
    _touchPrevDist = 0;
}

function stopFreefly(): void {
    // Reset input state
    freeflyInput.forward = false;
    freeflyInput.backward = false;
    freeflyInput.left = false;
    freeflyInput.right = false;
    freeflyInput.up = false;
    freeflyInput.down = false;

    stopFreeflyTouch();

    if (_freeflyUpdateHandle) {
        _freeflyUpdateHandle = safeDispose(_freeflyUpdateHandle);
    }
}

// ======== Surround (turntable) — 整圈匀速自转 =====

function startSurround(scene: Scene): void {
    _surroundAngle = 0;
    if (_surroundUpdateHandle) {
        _surroundUpdateHandle.dispose();
    }
    _surroundUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        const p = getCameraPreset().surround;
        if (!getConcertPaused()) {
            const delta = scene.getAnimationRatio() * p.speed * (scene.deltaTime / 1000);
            _surroundAngle += delta;
        }
        cam.alpha = -Math.PI / 2 + _surroundAngle;
        cam.radius = p.radius;
        cam.beta = Math.PI / 3;
        const focusedId = focusedModelId;
        if (focusedId) {
            const inst = modelRegistry.get(focusedId);
            if (inst && inst.meshes.length > 0) {
                const root = inst.rootMesh;
                _concertTarget.set(root.position.x, p.height, root.position.z);
            } else {
                _concertTarget.set(0, p.height, 0);
            }
        } else {
            _concertTarget.set(0, p.height, 0);
        }
        cam.setTarget(_concertTarget);
    });
}

function stopSurround(): void {
    if (_surroundUpdateHandle) {
        _surroundUpdateHandle = safeDispose(_surroundUpdateHandle);
    }
}

// ======== Concert (fan-cam) — 限定水平扫掠 + 正弦上下摆动 =====

function startConcert(scene: Scene): void {
    _concertT = 0;
    if (_concertUpdateHandle) {
        _concertUpdateHandle.dispose();
    }
    _concertUpdateHandle = observe(scene.onBeforeRenderObservable, () => {
        const cam = getCurrentCamera();
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        const p = getCameraPreset().concert;
        if (!getConcertPaused()) {
            _concertT += scene.getAnimationRatio() * (scene.deltaTime / 1000);
        }
        const sweepRad = (p.sweepAngle * Math.PI) / 180;
        const bobRad = (p.bobAmplitude * Math.PI) / 180;
        // 水平：在 ±sweepAngle/2 区间内做正弦扫掠（两端自然减速，模拟粉丝机位左右摇摄）
        cam.alpha = -Math.PI / 2 + (sweepRad / 2) * Math.sin(_concertT * p.sweepSpeed);
        // 垂直：以 baseBeta 为中心做正弦上下摆动（模拟手持设备的上下晃动/跟拍升降台）
        cam.beta = p.baseBeta + bobRad * Math.sin(_concertT * p.bobSpeed);
        cam.radius = p.radius;
        const focusedId = focusedModelId;
        if (focusedId) {
            const inst = modelRegistry.get(focusedId);
            if (inst && inst.meshes.length > 0) {
                const root = inst.rootMesh;
                _concertTarget.set(root.position.x, p.height, root.position.z);
            } else {
                _concertTarget.set(0, p.height, 0);
            }
        } else {
            _concertTarget.set(0, p.height, 0);
        }
        cam.setTarget(_concertTarget);
    });
}

function stopConcert(): void {
    if (_concertUpdateHandle) {
        _concertUpdateHandle = safeDispose(_concertUpdateHandle);
    }
}

// ======== Bone Lock — 轨道相机锁定到骨骼 ========
// 启用时：每帧将相机 target 设为目标骨骼的世界位置，同时禁用平移。
// 用户仍可围绕骨骼旋转（alpha/beta）和缩放（radius），但无法将相机拖走。

let _boneLockEnabled = false;
let _boneLockBoneName: string | null = null;
let _boneLockModelId: string | null = null;
// 可复用临时向量，避免每帧 new Vector3
const _boneLockTempVec = new Vector3(0, 0, 0);
// 锁定前保存原始平移灵敏度用于恢复
let _savedPanningSensibility = 50;

/** 启用/禁用轨道相机骨骼锁定。启用后相机 target 每帧锁定到指定骨骼的世界位置。 */
export function setOrbitBoneLock(enabled: boolean, boneName?: string): void {
    if (enabled && boneName && focusedModelId) {
        _boneLockEnabled = true;
        _boneLockBoneName = boneName;
        _boneLockModelId = focusedModelId;
        _startBoneLock();
    } else {
        _boneLockEnabled = false;
        _boneLockBoneName = null;
        _boneLockModelId = null;
        _stopBoneLock();
    }
}

/** 获取当前骨骼锁定状态。 */
export function getOrbitBoneLock(): { enabled: boolean; boneName: string | null } {
    return { enabled: _boneLockEnabled, boneName: _boneLockBoneName };
}

/** 获取当前焦点模型的所有骨骼名称列表。 */
export function getFocusedModelBoneNames(): string[] {
    const id = focusedModelId;
    if (!id) {
        return [];
    }
    const inst = modelRegistry.get(id);
    return inst?.mmdModel?.runtimeBones.map((b) => b.name) ?? [];
}

function _startBoneLock(): void {
    if (!_scene) {
        return;
    }
    _stopBoneLock();

    // 保存并禁用平移
    const boneLockCam = getCurrentCamera();
    if (boneLockCam instanceof ArcRotateCamera) {
        _savedPanningSensibility = boneLockCam.panningSensibility;
        boneLockCam.panningSensibility = 0; // 0 = 完全禁用平移
    }

    _boneLockUpdateHandle = observe(_scene.onBeforeRenderObservable, () => {
        if (!_boneLockEnabled || !_boneLockBoneName || !_boneLockModelId) {
            return;
        }
        // 仅 orbit 模式生效
        if (getCameraMode() !== 'orbit') {
            return;
        }
        const cam = getCurrentCamera();
        if (!(cam instanceof ArcRotateCamera)) {
            return;
        }

        const inst = modelRegistry.get(_boneLockModelId);
        if (!inst?.mmdModel) {
            return;
        }

        const bone = inst.mmdModel.runtimeBones.find(
            (b: { name: string; worldMatrix: Float32Array }) => b.name === _boneLockBoneName
        );
        if (!bone) {
            return;
        }

        // 从 worldMatrix（列主序 Float32Array[16]）提取世界位置
        if (bone.worldMatrix) {
            _boneLockTempVec.set(bone.worldMatrix[12], bone.worldMatrix[13], bone.worldMatrix[14]);
            cam.setTarget(_boneLockTempVec);
        }
    });
}

function _stopBoneLock(): void {
    if (_boneLockUpdateHandle) {
        _boneLockUpdateHandle = safeDispose(_boneLockUpdateHandle);
    }
    // 恢复平移灵敏度
    const boneLockCam = getCurrentCamera();
    if (boneLockCam instanceof ArcRotateCamera) {
        boneLockCam.panningSensibility = _savedPanningSensibility;
    }
}

// ======== Camera State Serialization ========

export interface CameraState {
    mode: CameraMode; // 保留兼容别名（旧存档 / 旧版本识别）；新存档仍写入等价值供降级
    control?: CameraControl; // ADR-100 轴 A（新）
    behavior?: CameraBehavior; // ADR-100 轴 B（新）
    scriptedSubMode?: ScriptedSubMode; // ADR-100 §6.4（新，仅 scripted 行为有意义）
    preset: CameraPreset;
    fov?: number; // FOV in radians, default 0.8 (migrated from RenderState in Phase 9)
    alpha: number;
    beta: number;
    radius: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    positionX?: number;
    positionY?: number;
    positionZ?: number;
    /** 保存时的聚焦模型中心 Y。用于 setCameraState 正确反算 targetHeight，
     *  防止因模型加载顺序导致 _focusCenterY 与实际聚焦模型不匹配。 */
    focusCenterY?: number;
}

export function getCameraState(): CameraState {
    const cam = getCurrentCamera();
    const isArc = cam instanceof ArcRotateCamera;
    const alpha = isArc ? cam.alpha : 0;
    const beta = isArc ? cam.beta : 0;
    const radius = isArc ? cam.radius : 16;
    const target = isArc ? cam.target : null;
    return {
        // ADR-100 P3：双写——新双轴字段 + 反查 mode（供旧版本降级读取）
        mode: deriveLegacyMode(getCameraControl(), getCameraBehavior(), getScriptedSubMode()),
        control: getCameraControl(),
        behavior: getCameraBehavior(),
        scriptedSubMode: getScriptedSubMode(),
        preset: deepClone(getCameraPreset()),
        fov: getFovState(),
        alpha,
        beta,
        radius,
        targetX: target?.x ?? 0,
        targetY: target?.y ?? 8,
        targetZ: target?.z ?? 0,
        // 无头环境（未 initCameraSystem）下 _currentCamera 为 null，做 null 安全避免崩溃
        positionX: cam ? cam.position.x : 0,
        positionY: cam ? cam.position.y : 0,
        positionZ: cam ? cam.position.z : 0,
        // 记录当前聚焦模型中心 Y，供 setCameraState 正确反算 targetHeight
        focusCenterY: getFocusCenterY(),
    };
}

export function setCameraState(s: CameraState): void {
    // Switch to the saved mode first (creates the right camera type),
    // then restore the preset over the live state.
    let mode = s.mode || s.preset.mode;
    // 存档恢复时跳过 AR：进入 AR 需要用户手势授权摄像头，启动时无手势调 getUserMedia
    // 多数浏览器会直接拒绝；用户可在加载后手动进入 AR。
    if (s.preset) {
        const def = defaultCameraPreset();
        const loaded = deepClone(s.preset) as CameraPreset;
        // 旧存档迁移：concert 曾是「整圈自转」形态（带 speed 字段、无 sweepAngle），
        // 现重定向为 surround（环绕/转台），concert 归位为「粉丝机位」。
        const oldConcert = loaded.concert as Record<string, any> | undefined;
        if (oldConcert && 'speed' in oldConcert && !('sweepAngle' in oldConcert)) {
            loaded.surround = {
                radius: (oldConcert.radius ?? def.surround.radius) as number,
                height: (oldConcert.height ?? def.surround.height) as number,
                speed: (oldConcert.speed ?? def.surround.speed) as number,
            };
            if (mode === 'concert') {
                mode = 'surround';
            }
            delete (loaded as Partial<CameraPreset>).concert;
        }
        // 深合并到默认预设，补齐新增/缺失字段，防止旧存档缺字段导致 NaN。
        setCameraPreset({
            mode: loaded.mode ?? def.mode,
            orbit: { ...def.orbit, ...(loaded.orbit || {}) },
            freefly: { ...def.freefly, ...(loaded.freefly || {}) },
            surround: { ...def.surround, ...(loaded.surround || {}) },
            concert: { ...def.concert, ...(loaded.concert || {}) },
        });
    }

    // ── ADR-100 P3：双轴解析（新字段优先，旧 mode 兜底）──
    let control: CameraControl;
    let behavior: CameraBehavior;
    let sub: ScriptedSubMode = 'loop';
    if (s.control && s.behavior) {
        control = s.control;
        behavior = s.behavior;
        sub = s.scriptedSubMode ?? 'loop';
    } else {
        const m = LEGACY_MODE_MAP[mode];
        // ADR-100 P3 边界加固：部分新字段存档（仅 control 或仅 behavior 其一）逐字段兜底，
        // 避免齐全判定缺失时整段回退 LEGACY_MODE_MAP 导致已提供的字段静默丢失。
        control = s.control ?? m.control;
        behavior = s.behavior ?? m.behavior;
        sub = s.scriptedSubMode ?? m.scripted ?? 'loop';
    }
    // 旧存档仅以 UIState.autoCameraEnabled 标记自动运镜 → 叠加为 beatcut（§6.2 step3）。
    // ADR-100 P3 收紧：仅当 control/behavior 双轴均缺失（纯旧格式）才叠加，
    // 避免部分新字段存档（已显式声明 behavior）被陈旧 autoCameraEnabled 覆盖（P2 权威原则）。
    if (
        !s.control &&
        !s.behavior &&
        uiState.autoCameraEnabled &&
        control === 'orbit' &&
        behavior === 'none'
    ) {
        behavior = 'beatcut';
    }
    if (behavior === 'beatcut') {
        setAutoCameraEnabledFlag(true);
        uiState.autoCameraEnabled = true;
        setAutoCameraBeatsPerSwitch(uiState.autoCameraBeatsPerSwitch || 4);
    } else {
        // ADR-100 P3 边界修复：显式非 beatcut 行为须清除自动运镜标志，
        // 否则陈旧 uiState.autoCameraEnabled（启动期 restoreAutoCameraState 先于 setCameraState 执行）
        // 会覆盖已加载的显式行为（如 none），导致自动运镜意外开启。
        setAutoCameraEnabledFlag(false);
        uiState.autoCameraEnabled = false;
    }
    const finalMode = deriveLegacyMode(control, behavior, sub);

    // 直接派生双轴状态：不依赖 scene，保证无头/测试环境亦可恢复（switchCameraMode 在无 scene 时为 no-op）。
    _syncAxesFromMode(finalMode);

    // 相机生命周期（需 scene；无头环境为 no-op，但状态已就绪）
    if (finalMode && finalMode !== 'ar') {
        switchCameraMode(finalMode);
    }

    // Restore FOV (from new scene files; old scenes store it in render.fov)
    if (s.fov !== undefined) {
        setFov(s.fov);
    }
    const cam = getCurrentCamera();
    if (!cam) {
        // 无实时相机时仍恢复自动运镜订阅（beatcut 行为需要），随后返回。
        if (isAutoCameraEnabled()) {
            restoreAutoCameraState();
        }
        return;
    }
    if (cam instanceof ArcRotateCamera) {
        cam.alpha = s.alpha ?? cam.alpha;
        cam.beta = s.beta ?? cam.beta;
        cam.radius = s.radius ?? cam.radius;
        cam.setTarget(new Vector3(s.targetX, s.targetY, s.targetZ));
    } else if (cam instanceof UniversalCamera) {
        if (s.positionX !== undefined) {
            cam.position = new Vector3(s.positionX, s.positionY ?? 8, s.positionZ ?? 16);
        }
        cam.setTarget(new Vector3(s.targetX, s.targetY, s.targetZ));
    }
    // 反算用户偏移偏好：优先使用存档中的 focusCenterY（保存时的聚焦模型中心 Y），
    // 避免因模型加载顺序导致当前 _focusCenterY 与实际聚焦模型不匹配。
    // 旧存档缺 focusCenterY 时回退到当前 _focusCenterY（可能不准确）。
    if (cam instanceof ArcRotateCamera) {
        const refCenterY = s.focusCenterY ?? getFocusCenterY();
        getCameraPreset().orbit.targetHeight = (s.targetY ?? 8) - refCenterY;
    }
    // ADR-100 P3：订阅 beat（beatcut 行为需要）；restoreAutoCameraState 内部幂等，重复调用安全。
    if (isAutoCameraEnabled()) {
        restoreAutoCameraState();
    }
}

// ======== Auto Camera（节拍驱动运镜） ========

interface AutoCameraPreset {
    alpha: number; // 水平角度 (rad)
    beta: number; // 垂直角度 (rad)
    radius: number; // 距离
}

const AUTO_CAMERA_PRESETS: AutoCameraPreset[] = [
    { alpha: -Math.PI / 2, beta: Math.PI / 3, radius: 16 }, // 正面标准
    { alpha: -Math.PI / 4, beta: Math.PI / 3.5, radius: 14 }, // 右前 45°
    { alpha: (-Math.PI * 3) / 4, beta: Math.PI / 3.5, radius: 14 }, // 左前 45°
    { alpha: -Math.PI / 2, beta: Math.PI / 6, radius: 18 }, // 高角度俯拍
    { alpha: -Math.PI / 2, beta: Math.PI / 2.5, radius: 10 }, // 近距离正面
    { alpha: 0, beta: Math.PI / 3, radius: 16 }, // 右侧 90°
    { alpha: -Math.PI, beta: Math.PI / 3, radius: 16 }, // 左侧 90°
    { alpha: -Math.PI / 2, beta: Math.PI / 4, radius: 22 }, // 远景
];

let _autoCameraEnabled = false;
let _autoCameraBeatCount = 0;
let _autoCameraPresetIdx = 0;
let _autoCameraBeatsPerSwitch = 4; // 每 4 拍切换一次
let _autoCameraUnsub: (() => void) | null = null;

/**
 * ADR-100 P2 — 集中订阅 beat 回调。
 * 优先用调用方传入的 detector（兼容旧签名），否则回退到内部全局 procBeatDetector。
 * 覆盖开关路径与 restore 路径，消除 restore 后不订阅导致的「饥饿」（beat 永不触发）。
 */
function _subscribeAutoCameraBeat(
    detector?: { onBeat: (cb: () => void) => () => void } | null
): void {
    _unsubscribeAutoCameraBeat();
    const bd = detector ?? getProcBeatDetector();
    if (bd) {
        _autoCameraUnsub = bd.onBeat(_onAutoCameraBeat);
    }
}

function _unsubscribeAutoCameraBeat(): void {
    if (_autoCameraUnsub) {
        _autoCameraUnsub();
        _autoCameraUnsub = null;
    }
}

/** 从 UIState 恢复自动机位状态。ADR-100 P2：恢复时集中订阅并派生 beatcut 行为，修复饥饿。 */
export function restoreAutoCameraState(): void {
    const s = uiState;
    if (s.autoCameraEnabled) {
        setAutoCameraEnabledFlag(true);
        setAutoCameraBeatsPerSwitch(s.autoCameraBeatsPerSwitch || 4);
        _subscribeAutoCameraBeat();
        _syncAxesFromMode(getCameraMode());
    }
}

/**
 * 设置 Auto Camera（beatcut）开关。ADR-100 P2：启用时集中订阅 beat、派生 beatcut 行为；
 * 禁用时移除订阅并回落基底行为。beatDetector 参数保留兼容旧调用方，缺省时内部回退。
 */
export function setAutoCameraEnabled(
    v: boolean,
    beatDetector?: { onBeat: (cb: () => void) => () => void } | null
): void {
    if (v === isAutoCameraEnabled()) {
        return;
    }
    setAutoCameraEnabledFlag(v);
    uiState.autoCameraEnabled = v;
    schedulePersistUI();
    if (v) {
        _setAutoCameraBeatCount(0);
        _setAutoCameraPresetIdx(0);
        _subscribeAutoCameraBeat(beatDetector);
    } else {
        _unsubscribeAutoCameraBeat();
    }
    // 重新派生行为轴：beatcut 叠加/移除（互斥由 _resolveBehavior 保证）。
    _syncAxesFromMode(getCameraMode());
}

export function isAutoCameraEnabled(): boolean {
    return isAutoCameraEnabledFlag();
}

/** 设置每多少拍切换一次镜头。 */
export function setAutoCameraBeatsPerSwitch(n: number): void {
    _autoCameraBeatsPerSwitch = Math.max(1, Math.min(16, Math.round(n)));
    uiState.autoCameraBeatsPerSwitch = _autoCameraBeatsPerSwitch;
    schedulePersistUI();
}

export function getAutoCameraBeatsPerSwitch(): number {
    return _autoCameraBeatsPerSwitch;
}

function _onAutoCameraBeat(): void {
    // ADR-100 P2：门控改判行为轴。beatcut 与 concert/turntable/scripted 互斥，
    // 后者激活时 _resolveBehavior 不会派生 beatcut，这里直接早退（互斥的运行时体现）。
    // 抑制期不消耗 beat 计数，恢复 orbit 后从当前计数继续。
    if (getCameraBehavior() !== 'beatcut') {
        return;
    }
    _setAutoCameraBeatCount(_getAutoCameraBeatCount() + 1);
    if (_getAutoCameraBeatCount() < getAutoCameraBeatsPerSwitch()) {
        return;
    }
    _setAutoCameraBeatCount(0);

    const cam = getCurrentCamera();
    if (!cam || !(cam instanceof ArcRotateCamera)) {
        return;
    }

    // 切到下一个预设（避免连续重复）
    let nextIdx =
        (_getAutoCameraPresetIdx() + 1 + Math.floor(Math.random() * (AUTO_CAMERA_PRESETS.length - 1))) %
        AUTO_CAMERA_PRESETS.length;
    if (nextIdx === _getAutoCameraPresetIdx()) {
        nextIdx = (nextIdx + 1) % AUTO_CAMERA_PRESETS.length;
    }
    _setAutoCameraPresetIdx(nextIdx);

    const preset = AUTO_CAMERA_PRESETS[nextIdx];

    // 平滑过渡到新预设（逐帧插值，~0.5s 完成）
    const startAlpha = cam.alpha;
    const startBeta = cam.beta;
    const startRadius = cam.radius;
    let t = 0;
    const duration = 500;
    const startTime = performance.now();

    const handle = observe(_scene.onBeforeRenderObservable, () => {
        const elapsed = performance.now() - startTime;
        t = Math.min(1, elapsed / duration);
        const ease = t * t * (3 - 2 * t); // smoothstep
        cam.alpha = startAlpha + (preset.alpha - startAlpha) * ease;
        cam.beta = startBeta + (preset.beta - startBeta) * ease;
        cam.radius = startRadius + (preset.radius - startRadius) * ease;
        if (t >= 1) {
            handle.dispose();
        }
    });
    if (!_scene) {
        // fallback: no scene reference, complete instantly
        cam.alpha = preset.alpha;
        cam.beta = preset.beta;
        cam.radius = preset.radius;
    }
}

// ======== Re-exports from camera-state.ts (backward compat) ========
export type {
    CameraMode, CameraControl, CameraBehavior, ScriptedSubMode,
    OrbitParams, FreeflyParams, SurroundParams, ConcertParams, CameraPreset,
} from './camera-state';
export {
    defaultCameraPreset,
    getCameraMode, getCameraControl, getCameraBehavior, getScriptedSubMode,
    getOrbitParams, getFreeflyParams, getConcertParams, getSurroundParams,
    getConcertPaused, setConcertPaused, getSurroundPaused, setSurroundPaused,
    getCameraVmdName, getCameraVmdPath, hasCameraVmd,
    getFov, isTouchDevice,
    getCameraPreset, setCameraPreset,
    getCurrentCamera, setCurrentCamera,
    getFocusCenterY, setFocusCenterY,
} from './camera-state';
