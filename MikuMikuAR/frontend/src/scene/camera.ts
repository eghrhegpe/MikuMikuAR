// [doc:architecture] Camera — 相机模式管理系统
// 规范文档: docs/architecture.md §渲染环节
// 职责: 相机模式切换（orbit/freefly/oneshot/concert）、自动构图、自由飞行输入
// Camera mode manager for MikuMikuAR
// Handles Orbit, Freefly, Concert, and One-shot camera modes.

import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Animation } from '@babylonjs/core/Animations/animation';
import { Scene } from '@babylonjs/core/scene';
import { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import { focusedModelId, modelRegistry } from '../core/config';
import { focusModel, reattachPipeline, getRenderState } from './scene';

// ======== Types ========
export type CameraMode = 'orbit' | 'freefly' | 'concert' | 'oneshot' | 'vmd';

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
let _currentCamera: Camera | null = null;
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
export function loadCameraVmd(mmdAnimation: any, vmdPath: string, vmdName: string): void {
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
        _mmdCamera.dispose(); // 释放 GPU 资源，避免反复加载/清除相机 VMD 时内存泄漏
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
    cam.panningSensibility = 50;
    cam.attachControl(canvas, true);
    return cam;
}

function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
    const p = _currentPreset.freefly;
    const cam = new UniversalCamera('freeflyCam', new Vector3(0, 8, 16), scene);
    cam.speed = p.speed;
    cam.angularSensibility = p.angularSensibility;
    cam.attachControl(canvas, true);
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
    cam.panningSensibility = 50;
    cam.attachControl(canvas, true);
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

    // Stop current mode's side-effects
    if (_cameraMode === 'freefly') {
        stopFreefly();
    }
    if (_cameraMode === 'concert') {
        stopConcert();
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
    // Apply current FOV from render state to the new camera
    const rs = getRenderState();
    if (rs.fov) {
        (newCam as any).fov = rs.fov;
    }
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

function stopFreefly(): void {
    // Reset input state
    freeflyInput.forward = false;
    freeflyInput.backward = false;
    freeflyInput.left = false;
    freeflyInput.right = false;
    freeflyInput.up = false;
    freeflyInput.down = false;

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

// ======== Camera State Serialization ========

export interface CameraState {
    mode: CameraMode;
    preset: CameraPreset;
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
    return {
        mode: _cameraMode,
        preset: JSON.parse(JSON.stringify(_currentPreset)),
        alpha,
        beta,
        radius,
        targetX: (cam as any).target?.x ?? 0,
        targetY: (cam as any).target?.y ?? 8,
        targetZ: (cam as any).target?.z ?? 0,
        positionX: cam.position.x,
        positionY: cam.position.y,
        positionZ: cam.position.z,
    };
}

export function setCameraState(s: CameraState): void {
    // Switch to the saved mode first (creates the right camera type),
    // then restore the preset over the live state.
    const mode = s.mode || s.preset.mode;
    if (mode) {
        switchCameraMode(mode);
    }
    if (s.preset) {
        _currentPreset = JSON.parse(JSON.stringify(s.preset));
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
