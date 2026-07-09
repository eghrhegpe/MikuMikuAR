// [doc:architecture] Camera — 相机模式管理系统
// 规范文档: docs/architecture.md §渲染环节
// 职责: 相机模式切换（orbit/freefly/oneshot/concert）、自动构图、自由飞行输入
// Camera mode manager for MikuMikuAR
// Handles Orbit, Freefly, Concert, and One-shot camera modes.

import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import { focusedModelId, modelRegistry, uiState, setStatus } from '@/core/config';
import { t } from '@/core/i18n/t';
import { focusModel, reattachPipeline, setARMode } from '../scene';
import { InvertableArcRotateCameraPointersInput } from './invertablePointersInput';

// ======== Types ========
export type CameraMode = 'orbit' | 'freefly' | 'concert' | 'oneshot' | 'vmd' | 'ar';

/** Orbit camera parameters. */
export interface OrbitParams {
    targetHeight: number;
    distance: number;
    beta: number;
}

/** Freefly camera parameters. */
export interface FreeflyParams {
    speed: number;
    angularSensibility: number;
}

/** Concert camera parameters — continuous orbit around target. */
export interface ConcertParams {
    radius: number;
    height: number;
    speed: number;
}

/** Per-mode parameter bundle, persisted with scene files. */
export interface CameraPreset {
    mode?: CameraMode;
    orbit: OrbitParams;
    freefly: FreeflyParams;
    concert: ConcertParams;
}

export function defaultCameraPreset(): CameraPreset {
    return {
        mode: 'orbit',
        orbit: { targetHeight: 8, distance: 16, beta: Math.PI / 3 },
        freefly: { speed: 0.5, angularSensibility: 2000 },
        concert: { radius: 12, height: 8, speed: 0.3 },
    };
}

// ======== Runtime Preset State ========
let _currentPreset: CameraPreset = defaultCameraPreset();

export function getCameraPreset(): CameraPreset {
    return _currentPreset;
}
export function setCameraPreset(p: CameraPreset): void {
    _currentPreset = p;
}

export function getOrbitParams(): OrbitParams {
    return _currentPreset.orbit;
}
export function getFreeflyParams(): FreeflyParams {
    return _currentPreset.freefly;
}
export function getConcertParams(): ConcertParams {
    return _currentPreset.concert;
}

export function setOrbitParams(p: Partial<OrbitParams>): void {
    Object.assign(_currentPreset.orbit, p);
    // Sync to live camera if orbit mode is active
    if (_cameraMode === 'orbit' && _currentCamera instanceof ArcRotateCamera) {
        if (p.distance !== undefined) {
            _currentCamera.radius = p.distance;
        }
        if (p.beta !== undefined) {
            _currentCamera.beta = p.beta;
        }
        if (p.targetHeight !== undefined) {
            _currentCamera.target.y = p.targetHeight;
        }
    }
}
/** Log current camera alpha for diagnostics. */
export function logCameraAlpha(): void {
    if (_cameraMode === 'orbit' && _currentCamera instanceof ArcRotateCamera) {
        console.info('[camera] current alpha:', _currentCamera.alpha.toFixed(3));
    }
}

export function setFreeflyParams(p: Partial<FreeflyParams>): void {
    Object.assign(_currentPreset.freefly, p);
    if (_cameraMode === 'freefly' && _currentCamera instanceof UniversalCamera) {
        if (p.speed !== undefined) {
            (_currentCamera as UniversalCamera).speed = p.speed;
        }
        if (p.angularSensibility !== undefined) {
            (_currentCamera as UniversalCamera).angularSensibility = p.angularSensibility;
        }
    }
}
export function setConcertParams(p: Partial<ConcertParams>): void {
    Object.assign(_currentPreset.concert, p);
}

// ======== Internal State ========
let _scene: Scene | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _cameraMode: CameraMode = 'orbit';
let _previousMode: CameraMode = 'orbit';
let _currentCamera: Camera | null = null;
let _fov = 0.8; // default FOV, migrated from RenderState in Phase 9

/** Detect touch-capable device for camera parameter tuning. */
export function isTouchDevice(): boolean {
    return (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.matchMedia('(pointer: coarse)').matches
    );
}

function clampFov(v: number): number {
    return Math.max(0.1, Math.min(3, v));
}
let _concertUpdateFn: (() => void) | null = null;
let _concertAngle = 0;
let _concertPaused = false;
// Cached target vector for concert mode (avoids per-frame Vector3 allocation)
const _concertTarget = new Vector3(0, 8, 0);

export function getConcertPaused(): boolean {
    return _concertPaused;
}
export function setConcertPaused(paused: boolean): void {
    _concertPaused = paused;
}

// ======== Camera VMD ========
let _mmdCamera: MmdCamera | null = null;
let _cameraVmdName = '';
let _cameraVmdPath = '';
let _cameraAnimationHandle: number | null = null;

export function getCameraVmdName(): string {
    return _cameraVmdName;
}
export function getCameraVmdPath(): string {
    return _cameraVmdPath;
}
export function hasCameraVmd(): boolean {
    return _mmdCamera !== null && _cameraAnimationHandle !== null;
}

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
    _cameraVmdName = vmdName;
    _cameraVmdPath = vmdPath;
}

export function clearCameraVmd(): void {
    if (_mmdCamera && _scene) {
        if (_cameraMode === 'vmd' && _scene) {
            switchCameraMode('orbit');
        }
        _scene.removeCamera(_mmdCamera);
        _mmdCamera.dispose();
        _mmdCamera = null;
        _cameraAnimationHandle = null;
        _cameraVmdName = '';
        _cameraVmdPath = '';
    }
}

/** Animate the VMD camera to a given 30fps frame time. Called every tick by scene.ts. */
export function animateCameraVmd(frameTime: number): void {
    if (_mmdCamera && _cameraMode === 'vmd') {
        _mmdCamera.animate(frameTime);
    }
}

function createVmdCamera(scene: Scene): MmdCamera {
    if (_mmdCamera) {
        return _mmdCamera;
    }
    const cam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), scene, false);
    _mmdCamera = cam;
    return cam;
}

// Stored observer callback references so we can remove them later
let _freeflyUpdateFn: (() => void) | null = null;
const _concertStartFn: (() => void) | null = null;

// ======== Public Getters ========
export function getCurrentCamera(): Camera | null {
    return _currentCamera;
}
export function getCameraMode(): CameraMode {
    return _cameraMode;
}

export function getFov(): number {
    return _fov;
}

export function setFov(v: number): void {
    _fov = clampFov(v);
    if (_currentCamera) {
        _currentCamera.fov = _fov;
    }
}

// ======== Freefly Input State ========
// Set by main.ts keyboard handlers, consumed by the freefly render observer.
export const freeflyInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    up: false,
    down: false,
};

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
    if (!_currentCamera) {
        return;
    }
    applyCameraUserSettings(_currentCamera);
    // 触屏设备的参数覆写（applyCameraUserSettings 可能重置了它们）
    if (isTouchDevice() && _currentCamera instanceof ArcRotateCamera) {
        _currentCamera.pinchPrecision = 8;
        _currentCamera.useNaturalPinchZoom = true;
        _currentCamera.panningSensibility = 20;
    }
    const inv = _invertableInputs.get(_currentCamera);
    if (inv) {
        inv.invertY = uiState.invertYAxis === true;
    }
}

function createOrbitCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
    const p = _currentPreset.orbit;
    const cam = new ArcRotateCamera(
        'camera',
        -Math.PI / 2,
        p.beta,
        p.distance,
        new Vector3(0, p.targetHeight, 0),
        scene
    );
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
    return cam;
}

function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
    const p = _currentPreset.freefly;
    const cam = new UniversalCamera('freeflyCam', new Vector3(0, 8, 16), scene);
    cam.speed = p.speed;
    cam.angularSensibility = p.angularSensibility;
    cam.attachControl(canvas, true);
    applyCameraUserSettings(cam);
    cam.keysUp = [];
    cam.keysDown = [];
    cam.keysLeft = [];
    cam.keysRight = [];
    return cam;
}

function createConcertCamera(scene: Scene): ArcRotateCamera {
    const cam = new ArcRotateCamera(
        'concertCam',
        -Math.PI / 2,
        Math.PI / 3,
        16,
        new Vector3(0, 8, 0),
        scene
    );
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    // No attachControl — we animate programmatically; mouse would interfere
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
    return cam;
}

// ======== Initialization ========

/** Initialise the camera system and create the default Orbit camera. */
export function initCameraSystem(scene: Scene, canvas: HTMLCanvasElement): Camera {
    _scene = scene;
    _canvas = canvas;
    const cam = createOrbitCamera(scene, canvas);
    _currentCamera = cam;
    _cameraMode = 'orbit';
    scene.activeCamera = cam;
    return cam;
}

// ======== Mode Switch ========

/** Switch to a different camera mode, preserving position as much as possible. */
export function switchCameraMode(mode: CameraMode): void {
    if (mode === _cameraMode && _currentCamera) {
        return;
    }
    if (!_scene || !_canvas) {
        return;
    }

    const scene = _scene;
    const canvas = _canvas;

    if (mode === 'ar') {
        if (_cameraMode !== 'ar') {
            _previousMode = _cameraMode;
        }
        // 乐观提交 _cameraMode='ar'，保证"进入 AR 期间用户切走"时下方
        // `if (_cameraMode === 'ar')` 离开检测能命中并正确注销摄像头。
        // 真正的视频激活由 setARMode(true) 异步完成；若失败，仅还原模式标记，
        // 不重建相机（进入 AR 时从未切换/重建 Babylon 相机）。
        _cameraMode = 'ar';
        _currentPreset.mode = 'ar';
        setARMode(true).then((ok) => {
            if (!ok) {
                // 失败：若后续切换尚未把模式改走（仍在 ar），才提示并还原标记。
                if (_cameraMode === 'ar') {
                    setStatus(t('scene.camera.arFailed'), false);
                }
                _cameraMode = _previousMode;
                _currentPreset.mode = _previousMode;
            }
        });
        return;
    }

    if (_cameraMode === 'ar') {
        setARMode(false);
    }

    // Stop current mode's side-effects
    if (_cameraMode === 'freefly') {
        stopFreefly();
    }
    if (_cameraMode === 'concert') {
        stopConcert();
    }
    if (_cameraMode === 'orbit') {
        _stopBoneLock();
    }

    // Save old camera state
    const oldCam = _currentCamera;
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
        case 'oneshot':
            newCam = createOneshotCamera(scene, canvas);
            break;
        case 'vmd':
            // Pre-check: refuse switch if no camera VMD is loaded
            if (_cameraAnimationHandle === null) {
                console.warn(
                    '[camera] Cannot switch to VMD mode: no camera VMD loaded, falling back to orbit'
                );
                mode = 'orbit';
                newCam = createOrbitCamera(scene, canvas);
                break;
            }
            newCam = createVmdCamera(scene);
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
    _currentCamera = newCam;
    _cameraMode = mode;
    // Persist camera mode for scene auto-save (skip oneshot — it's a transient action)
    if (mode !== 'oneshot') {
        _currentPreset.mode = mode;
    }

    // Start new mode's side-effects
    if (mode === 'freefly') {
        initFreeflyUpdate(scene);
        initFreeflyTouch(canvas);
    }
    if (mode === 'concert') {
        startConcert(scene);
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
    newCam.fov = clampFov(_fov);
}

// ======== Auto Frame ========

/** Auto-frame the camera to centre on a bounding box. */
export function autoFrame(center: Vector3, extent: number): void {
    const cam = _currentCamera;
    if (!cam) {
        return;
    }

    if (cam instanceof ArcRotateCamera) {
        cam.setTarget(center);
        cam.radius = extent * 0.75 + 2;
        cam.beta = Math.PI / 2.2;
    } else if (cam instanceof UniversalCamera) {
        const dist = extent * 0.75 + 2;
        cam.position = new Vector3(center.x, center.y + dist * 0.5, center.z + dist);
        cam.setTarget(center);
    }
}

// ======== Freefly ========

function initFreeflyUpdate(scene: Scene): void {
    // Remove any previous freefly observer
    if (_freeflyUpdateFn) {
        scene.onBeforeRenderObservable.removeCallback(_freeflyUpdateFn);
    }

    _freeflyUpdateFn = () => {
        const cam = _currentCamera;
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
    };

    scene.onBeforeRenderObservable.add(_freeflyUpdateFn);
}

// ======== Freefly Touch Controls ========
// 双指滑动：上下 = 前后移动，左右 = 平移
// 双指捏合：前进/后退
let _freeflyTouchHandler: ((e: TouchEvent) => void) | null = null;
let _freeflyTouchEndHandler: (() => void) | null = null;
let _touchPrevDist = 0;
let _touchPrevMidX = 0;
let _touchPrevMidY = 0;

function initFreeflyTouch(canvas: HTMLCanvasElement): void {
    if (!isTouchDevice()) {
        return;
    }

    _freeflyTouchHandler = (e: TouchEvent) => {
        if (_cameraMode !== 'freefly') {
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

    canvas.addEventListener('touchmove', _freeflyTouchHandler, { passive: false });
    canvas.addEventListener('touchend', _freeflyTouchEndHandler);
    canvas.addEventListener('touchcancel', _freeflyTouchEndHandler);
}

function stopFreeflyTouch(): void {
    if (_canvas && _freeflyTouchHandler) {
        _canvas.removeEventListener('touchmove', _freeflyTouchHandler);
        _canvas.removeEventListener('touchend', _freeflyTouchEndHandler!);
        _canvas.removeEventListener('touchcancel', _freeflyTouchEndHandler!);
        _freeflyTouchHandler = null;
        _freeflyTouchEndHandler = null;
    }
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

    if (_freeflyUpdateFn && _scene) {
        _scene.onBeforeRenderObservable.removeCallback(_freeflyUpdateFn);
        _freeflyUpdateFn = null;
    }
}

// ======== Concert ========

function startConcert(scene: Scene): void {
    _concertAngle = 0;
    if (_concertUpdateFn) {
        scene.onBeforeRenderObservable.removeCallback(_concertUpdateFn);
    }
    _concertUpdateFn = () => {
        const cam = _currentCamera;
        if (!cam || !(cam instanceof ArcRotateCamera)) {
            return;
        }
        const p = _currentPreset.concert;
        if (!_concertPaused) {
            const delta = scene.getAnimationRatio() * p.speed * (scene.deltaTime / 1000);
            _concertAngle += delta;
        }
        cam.alpha = -Math.PI / 2 + _concertAngle;
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
    };
    scene.onBeforeRenderObservable.add(_concertUpdateFn);
}

function stopConcert(): void {
    if (_concertUpdateFn && _scene) {
        _scene.onBeforeRenderObservable.removeCallback(_concertUpdateFn);
        _concertUpdateFn = null;
    }
}

// ======== Bone Lock — 轨道相机锁定到骨骼 ========
// 启用时：每帧将相机 target 设为目标骨骼的世界位置，同时禁用平移。
// 用户仍可围绕骨骼旋转（alpha/beta）和缩放（radius），但无法将相机拖走。

let _boneLockEnabled = false;
let _boneLockBoneName: string | null = null;
let _boneLockModelId: string | null = null;
let _boneLockUpdateFn: (() => void) | null = null;
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
    if (!id) return [];
    const inst = modelRegistry.get(id);
    return inst?.mmdModel?.runtimeBones.map((b) => b.name) ?? [];
}

function _startBoneLock(): void {
    if (!_scene) return;
    _stopBoneLock();

    // 保存并禁用平移
    if (_currentCamera instanceof ArcRotateCamera) {
        _savedPanningSensibility = _currentCamera.panningSensibility;
        _currentCamera.panningSensibility = 0; // 0 = 完全禁用平移
    }

    _boneLockUpdateFn = () => {
        if (!_boneLockEnabled || !_boneLockBoneName || !_boneLockModelId) return;
        // 仅 orbit 模式生效
        if (_cameraMode !== 'orbit') return;
        const cam = _currentCamera;
        if (!(cam instanceof ArcRotateCamera)) return;

        const inst = modelRegistry.get(_boneLockModelId);
        if (!inst?.mmdModel) return;

        const bone = inst.mmdModel.runtimeBones.find(
            (b: { name: string; worldMatrix: Float32Array }) => b.name === _boneLockBoneName
        );
        if (!bone) return;

        // 从 worldMatrix（列主序 Float32Array[16]）提取世界位置
        if (bone.worldMatrix) {
            _boneLockTempVec.set(
                bone.worldMatrix[12],
                bone.worldMatrix[13],
                bone.worldMatrix[14]
            );
            cam.setTarget(_boneLockTempVec);
        }
    };

    _scene.onBeforeRenderObservable.add(_boneLockUpdateFn);
}

function _stopBoneLock(): void {
    if (_boneLockUpdateFn && _scene) {
        _scene.onBeforeRenderObservable.removeCallback(_boneLockUpdateFn);
        _boneLockUpdateFn = null;
    }
    // 恢复平移灵敏度
    if (_currentCamera instanceof ArcRotateCamera) {
        _currentCamera.panningSensibility = _savedPanningSensibility;
    }
}

// ======== Camera State Serialization ========

export interface CameraState {
    mode: CameraMode;
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
}

export function getCameraState(): CameraState {
    const cam = _currentCamera;
    const isArc = cam instanceof ArcRotateCamera;
    const alpha = isArc ? cam.alpha : 0;
    const beta = isArc ? cam.beta : 0;
    const radius = isArc ? cam.radius : 16;
    const target = isArc ? cam.target : null;
    return {
        mode: _cameraMode,
        preset: JSON.parse(JSON.stringify(_currentPreset)),
        fov: _fov,
        alpha,
        beta,
        radius,
        targetX: target?.x ?? 0,
        targetY: target?.y ?? 8,
        targetZ: target?.z ?? 0,
        positionX: cam!.position.x,
        positionY: cam!.position.y,
        positionZ: cam!.position.z,
    };
}

export function setCameraState(s: CameraState): void {
    // Switch to the saved mode first (creates the right camera type),
    // then restore the preset over the live state.
    const mode = s.mode || s.preset.mode;
    // 存档恢复时跳过 AR：进入 AR 需要用户手势授权摄像头，启动时无手势调 getUserMedia
    // 多数浏览器会直接拒绝；用户可在加载后手动进入 AR。
    if (s.preset) {
        _currentPreset = JSON.parse(JSON.stringify(s.preset));
    }
    if (mode && mode !== 'ar') {
        switchCameraMode(mode);
    }
    // Restore FOV (from new scene files; old scenes store it in render.fov)
    if (s.fov !== undefined) {
        setFov(s.fov);
    }
    const cam = _currentCamera;
    if (!cam) {
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

/** 从 UIState 恢复自动机位状态 */
export function restoreAutoCameraState(): void {
    const s = uiState;
    if (s.autoCameraEnabled) {
        _autoCameraEnabled = true;
        _autoCameraBeatsPerSwitch = s.autoCameraBeatsPerSwitch || 4;
    }
}

/** 设置 Auto Camera 开关。启用时注册 beat 回调，禁用时移除。 */
export function setAutoCameraEnabled(
    v: boolean,
    beatDetector?: { onBeat: (cb: () => void) => () => void } | null
): void {
    if (v === _autoCameraEnabled) {
        return;
    }
    _autoCameraEnabled = v;
    uiState.autoCameraEnabled = v;
    if (v) {
        _autoCameraBeatCount = 0;
        _autoCameraPresetIdx = 0;
        if (beatDetector) {
            _autoCameraUnsub = beatDetector.onBeat(_onAutoCameraBeat);
        }
    } else {
        if (_autoCameraUnsub) {
            _autoCameraUnsub();
            _autoCameraUnsub = null;
        }
    }
}

export function isAutoCameraEnabled(): boolean {
    return _autoCameraEnabled;
}

/** 设置每多少拍切换一次镜头。 */
export function setAutoCameraBeatsPerSwitch(n: number): void {
    _autoCameraBeatsPerSwitch = Math.max(1, Math.min(16, Math.round(n)));
    uiState.autoCameraBeatsPerSwitch = _autoCameraBeatsPerSwitch;
}

export function getAutoCameraBeatsPerSwitch(): number {
    return _autoCameraBeatsPerSwitch;
}

function _onAutoCameraBeat(): void {
    if (!_autoCameraEnabled) {
        return;
    }
    _autoCameraBeatCount++;
    if (_autoCameraBeatCount < _autoCameraBeatsPerSwitch) {
        return;
    }
    _autoCameraBeatCount = 0;

    const cam = _currentCamera;
    if (!cam || !(cam instanceof ArcRotateCamera)) {
        return;
    }
    if (_cameraMode !== 'orbit' && _cameraMode !== 'concert') {
        return;
    }

    // 切到下一个预设（避免连续重复）
    let nextIdx =
        (_autoCameraPresetIdx + 1 + Math.floor(Math.random() * (AUTO_CAMERA_PRESETS.length - 1))) %
        AUTO_CAMERA_PRESETS.length;
    if (nextIdx === _autoCameraPresetIdx) {
        nextIdx = (nextIdx + 1) % AUTO_CAMERA_PRESETS.length;
    }
    _autoCameraPresetIdx = nextIdx;

    const preset = AUTO_CAMERA_PRESETS[nextIdx];

    // 平滑过渡到新预设（逐帧插值，~0.5s 完成）
    const startAlpha = cam.alpha;
    const startBeta = cam.beta;
    const startRadius = cam.radius;
    let t = 0;
    const duration = 500;
    const startTime = performance.now();

    const cleanup = _scene.onBeforeRenderObservable.add(() => {
        const elapsed = performance.now() - startTime;
        t = Math.min(1, elapsed / duration);
        const ease = t * t * (3 - 2 * t); // smoothstep
        cam.alpha = startAlpha + (preset.alpha - startAlpha) * ease;
        cam.beta = startBeta + (preset.beta - startBeta) * ease;
        cam.radius = startRadius + (preset.radius - startRadius) * ease;
        if (t >= 1) {
            _scene.onBeforeRenderObservable.remove(cleanup);
        }
    });
    if (!_scene) {
        // fallback: no scene reference, complete instantly
        cam.alpha = preset.alpha;
        cam.beta = preset.beta;
        cam.radius = preset.radius;
    }
}
