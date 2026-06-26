// [doc:architecture] Camera — 相机模式管理系统
// 规范文档: docs/architecture.md §渲染环节
// 职责: 相机模式切换（orbit/freefly/oneshot/concert）、自动构图、自由飞行输入
// Camera mode manager for MikuMikuAR
// Handles Orbit, Freefly, Concert, and One-shot camera modes.

import { Camera } from "@babylonjs/core/Cameras/camera";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Animation } from "@babylonjs/core/Animations/animation";
import { Scene } from "@babylonjs/core/scene";
import { MmdCamera } from "babylon-mmd/esm/Runtime/mmdCamera";
import { focusedModelId } from "./config";

// ======== Types ========
export type CameraMode = "orbit" | "freefly" | "oneshot" | "concert" | "vmd";

interface CameraPreset {
    label: string;
    position: Vector3;
    target: Vector3;
    duration: number; // seconds
}

const concertPresets: CameraPreset[] = [
    { label: "正面", position: new Vector3(0, 1.5, 12), target: new Vector3(0, 8, 0), duration: 4 },
    { label: "左侧", position: new Vector3(-10, 1.5, 2), target: new Vector3(0, 8, 0), duration: 3 },
    { label: "右侧", position: new Vector3(10, 1.5, 2), target: new Vector3(0, 8, 0), duration: 3 },
    { label: "俯视", position: new Vector3(0, 14, 2), target: new Vector3(0, 8, 0), duration: 2 },
    { label: "仰视", position: new Vector3(0, 0.3, 6), target: new Vector3(0, 8, 0), duration: 2 },
    { label: "特写", position: new Vector3(0, 8, 4), target: new Vector3(0, 8, 0), duration: 2 },
];

// ======== Internal State ========
let _scene: Scene | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _cameraMode: CameraMode = "orbit";
let _currentCamera: Camera | null = null;
let _concertTimer: ReturnType<typeof setTimeout> | null = null;
let _concertIndex = 0;

// ======== Camera VMD ========
let _mmdCamera: MmdCamera | null = null;
let _cameraVmdName = "";
let _cameraVmdPath = "";
let _cameraAnimationHandle: number | null = null;

export function getCameraVmdName(): string { return _cameraVmdName; }
export function getCameraVmdPath(): string { return _cameraVmdPath; }
export function hasCameraVmd(): boolean { return _mmdCamera !== null && _cameraAnimationHandle !== null; }

/** Load camera animation from a VMD (MmdAnimation) and create an MmdCamera. */
export function loadCameraVmd(mmdAnimation: any, vmdPath: string, vmdName: string): void {
    if (!_scene) return;

    if (_mmdCamera) {
        _scene.removeCamera(_mmdCamera);
        _mmdCamera = null;
        _cameraAnimationHandle = null;
    }

    const mmdCam = new MmdCamera("mmdCam", new Vector3(0, 10, 0), _scene, false);
    const handle = mmdCam.createRuntimeAnimation(mmdAnimation);
    mmdCam.setRuntimeAnimation(handle);

    _mmdCamera = mmdCam;
    _cameraAnimationHandle = handle;
    _cameraVmdName = vmdName;
    _cameraVmdPath = vmdPath;
}

export function clearCameraVmd(): void {
    if (_mmdCamera && _scene) {
        if (_cameraMode === "vmd") {
            switchCameraMode("orbit");
        }
        _scene.removeCamera(_mmdCamera);
        _mmdCamera = null;
        _cameraAnimationHandle = null;
        _cameraVmdName = "";
        _cameraVmdPath = "";
    }
}

/** Animate the VMD camera to a given 30fps frame time. Called every tick by scene.ts. */
export function animateCameraVmd(frameTime: number): void {
    if (_mmdCamera && _cameraMode === "vmd") {
        _mmdCamera.animate(frameTime);
    }
}

function createVmdCamera(scene: Scene): MmdCamera {
    if (_mmdCamera) return _mmdCamera;
    const cam = new MmdCamera("mmdCam", new Vector3(0, 10, 0), scene, false);
    _mmdCamera = cam;
    return cam;
}

// Stored observer callback references so we can remove them later
let _freeflyUpdateFn: (() => void) | null = null;
let _concertStartFn: (() => void) | null = null;

// ======== Public Getters ========
export function getCurrentCamera(): Camera | null { return _currentCamera; }
export function getCameraMode(): CameraMode { return _cameraMode; }

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
    const cam = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, new Vector3(0, 8, 0), scene);
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    cam.attachControl(canvas, true);
    return cam;
}

function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
    const cam = new UniversalCamera("freeflyCam", new Vector3(0, 8, 16), scene);
    cam.speed = 0.5;
    cam.angularSensibility = 2000;
    cam.attachControl(canvas, true);
    // Clear default key bindings — we handle WASD manually in main.ts
    cam.keysUp = [];
    cam.keysDown = [];
    cam.keysLeft = [];
    cam.keysRight = [];
    return cam;
}

function createConcertCamera(scene: Scene): ArcRotateCamera {
    const cam = new ArcRotateCamera("concertCam", -Math.PI / 2, Math.PI / 3, 16, new Vector3(0, 8, 0), scene);
    cam.lowerRadiusLimit = 2;
    cam.upperRadiusLimit = 50;
    cam.panningSensibility = 50;
    // No attachControl — we animate programmatically; mouse would interfere
    return cam;
}

function createOneshotCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
    // Placeholder — same as orbit for now; animation data applied later
    const cam = new ArcRotateCamera("oneshotCam", -Math.PI / 2, Math.PI / 3, 16, new Vector3(0, 8, 0), scene);
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
    _cameraMode = "orbit";
    scene.activeCamera = cam;
    return cam;
}

// ======== Mode Switch ========

/** Switch to a different camera mode, preserving position as much as possible. */
export function switchCameraMode(mode: CameraMode): void {
    if (mode === _cameraMode && _currentCamera) return;
    if (!_scene || !_canvas) return;

    const scene = _scene;
    const canvas = _canvas;

    // Stop current mode's side-effects
    if (_cameraMode === "freefly") stopFreefly();
    if (_cameraMode === "concert") stopConcert();

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
        case "orbit":
            newCam = createOrbitCamera(scene, canvas);
            break;
        case "freefly":
            newCam = createFreeflyCamera(scene, canvas);
            break;
        case "concert":
            newCam = createConcertCamera(scene);
            break;
        case "oneshot":
            newCam = createOneshotCamera(scene, canvas);
            break;
        case "vmd":
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

    // Start new mode's side-effects
    if (mode === "freefly") initFreeflyUpdate(scene);
    if (mode === "concert") startConcert(scene);

    // Re-attach post-processing pipeline to the new camera
    import("./scene").then(({ reattachPipeline, getRenderState }) => {
        reattachPipeline();
        // Apply current FOV from render state to the new camera
        const rs = getRenderState();
        if (rs.fov) (newCam as any).fov = rs.fov;
    });
}

// ======== Auto Frame ========

/** Auto-frame the camera to centre on a bounding box. */
export function autoFrame(center: Vector3, extent: number): void {
    const cam = _currentCamera;
    if (!cam) return;

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
        if (!cam || !(cam instanceof UniversalCamera)) return;
        const speed = 0.3 * scene.getAnimationRatio();

        // Read input state set by main.ts keydown/keyup
        if (freeflyInput.forward) {
            cam.position.addInPlace(cam.getDirection(new Vector3(0, 0, 1)).scaleInPlace(speed));
        }
        if (freeflyInput.backward) {
            cam.position.addInPlace(cam.getDirection(new Vector3(0, 0, -1)).scaleInPlace(speed));
        }
        if (freeflyInput.left) {
            cam.position.addInPlace(cam.getDirection(new Vector3(-1, 0, 0)).scaleInPlace(speed));
        }
        if (freeflyInput.right) {
            cam.position.addInPlace(cam.getDirection(new Vector3(1, 0, 0)).scaleInPlace(speed));
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
    _concertIndex = 0;
    scheduleNextConcert(scene);
}

function scheduleNextConcert(scene: Scene): void {
    if (_concertTimer !== null) {
        clearTimeout(_concertTimer);
        _concertTimer = null;
    }

    const presets = concertPresets;
    const idx = _concertIndex % presets.length;
    const preset = presets[idx];
    _concertIndex++;

    animateCameraTo(preset, scene);
    _concertTimer = setTimeout(() => scheduleNextConcert(scene), preset.duration * 1000);
}

function stopConcert(): void {
    if (_concertTimer !== null) {
        clearTimeout(_concertTimer);
        _concertTimer = null;
    }
}

function animateCameraTo(preset: CameraPreset, scene: Scene): void {
    const cam = _currentCamera;
    if (!cam) return;

    const frameRate = 60;
    const animDuration = frameRate; // 1-second transition

    const posAnim = new Animation(
        "concertPos", "position", frameRate,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    posAnim.setKeys([
        { frame: 0, value: cam.position.clone() },
        { frame: animDuration, value: preset.position },
    ]);

    if (cam instanceof ArcRotateCamera) {
        const targetAnim = new Animation(
            "concertTarget", "target", frameRate,
            Animation.ANIMATIONTYPE_VECTOR3,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        targetAnim.setKeys([
            { frame: 0, value: cam.target.clone() },
            { frame: animDuration, value: preset.target },
        ]);
        cam.animations = [posAnim, targetAnim];
    } else {
        cam.animations = [posAnim];
    }

    scene.beginAnimation(cam, 0, animDuration, false);
}

// ======== Camera State Serialization ========

export interface CameraState {
    mode: CameraMode;
    alpha: number;
    beta: number;
    radius: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    /** Freefly/UniversalCamera position — only used when mode=freefly */
    positionX?: number;
    positionY?: number;
    positionZ?: number;
    focusedModelId: string | null;
}

export function getCameraState(): CameraState {
    const cam = _currentCamera;
    const isArc = cam instanceof ArcRotateCamera;
    const alpha = isArc ? cam.alpha : 0;
    const beta = isArc ? cam.beta : 0;
    const radius = isArc ? cam.radius : 16;
    return {
        mode: _cameraMode,
        alpha, beta, radius,
        targetX: (cam as any).target?.x ?? 0,
        targetY: (cam as any).target?.y ?? 8,
        targetZ: (cam as any).target?.z ?? 0,
        positionX: cam?.position.x,
        positionY: cam?.position.y,
        positionZ: cam?.position.z,
        focusedModelId,
    };
}

export function setCameraState(s: CameraState): void {
    if (s.mode) switchCameraMode(s.mode);
    const cam = _currentCamera;
    if (!cam) return;
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
