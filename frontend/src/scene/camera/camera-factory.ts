// [doc:architecture] Camera Factory — 相机创建工厂
// 从 camera.ts 拆出（ADR-148 阶段 3：camera.ts 瘦身）
// 职责: 5 种 ArcRotate/Universal 相机的实例化 + 用户输入设置（灵敏度/反 Y 轴）
// 依赖: camera-state（preset/scene 引用/viewMatrixHandle）+ 用户设置注入回调
//
// 循环依赖处理：相机创建时需要绑定 viewMatrix observer 触发 scheduleCameraPersist，
// 该函数在 camera.ts 内部。通过 setSchedulePersistCallback 注入回调，避免循环依赖。

import { Camera } from '@babylonjs/core/Cameras/camera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

import { uiState } from '@/core/config';
import { observe } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import {
    getCameraPreset,
    getFocusCenterY,
    getCurrentCamera,
    getViewMatrixHandle,
    isTouchDevice,
    setViewMatrixHandle,
} from './camera-state';
import { InvertableArcRotateCameraPointersInput } from './invertablePointersInput';

// ======== 用户相机输入设置（灵敏度 / 反 Y 轴）========
// 基准值取自 Babylon 默认值与本项目既有设定；sens 越大越灵敏（数值越小=反应越快）。
// 移动速度不在此处管理：由 preset.freefly.speed 单源控制（见 camera-behaviors.ts）。
const CAM_BASE = { angular: 2000, wheel: 3, pan: 50 };

/** 跟踪每个 ArcRotate 相机实例对应的可反转指针输入，便于设置变更时实时同步 invertY。 */
const _invertableInputs = new WeakMap<Camera, InvertableArcRotateCameraPointersInput>();

/** viewMatrix 变化时触发持久化的回调（由 camera.ts 注入，避免循环依赖）。 */
let _schedulePersistCallback: (() => void) | null = null;

/** camera.ts 启动时注入 scheduleCameraPersist 回调。 */
export function setSchedulePersistCallback(cb: () => void): void {
    _schedulePersistCallback = cb;
}

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

/** 绑定 viewMatrix 变化 → 触发持久化的 observer，并写入共享句柄。 */
function _bindViewMatrixPersist(cam: Camera): void {
    if (_schedulePersistCallback) {
        const handle = observe(cam.onViewMatrixChangedObservable, _schedulePersistCallback);
        setViewMatrixHandle(handle);
    }
}

// ======== Camera Factory Functions ========

export function createOrbitCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
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
    // 方向键从相机控制让出（给菜单导航/播放 seek）；orbit 键盘环绕由
    // events.ts 的 WSAD 统一接管，避免与 Babylon 内置方向键输入双路。
    cam.keysUp = [];
    cam.keysDown = [];
    cam.keysLeft = [];
    cam.keysRight = [];
    applyCameraUserSettings(cam);
    if (isTouchDevice()) {
        cam.pinchPrecision = 8;
        cam.panningSensibility = 20;
        cam.useNaturalPinchZoom = true;
    } else {
        cam.panningSensibility = 50;
    }
    // 相机视角变化时延迟触发保存（拖拽/缩放结束后）
    _bindViewMatrixPersist(cam);
    return cam;
}

export function createFreeflyCamera(scene: Scene, canvas: HTMLCanvasElement): UniversalCamera {
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
    _bindViewMatrixPersist(cam);
    return cam;
}

export function createSurroundCamera(scene: Scene): ArcRotateCamera {
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
    _bindViewMatrixPersist(cam);
    return cam;
}

/** Concert (fan-cam): limited horizontal sweep + sinusoidal vertical bob around the target. */
export function createConcertCamera(scene: Scene): ArcRotateCamera {
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
    _bindViewMatrixPersist(cam);
    return cam;
}

export function createOneshotCamera(scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera {
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
    _bindViewMatrixPersist(cam);
    return cam;
}

/** 显式 dispose 当前 viewMatrix observer（switchCameraMode 切换相机时调用）。 */
export function disposeViewMatrixHandle(): void {
    const handle = getViewMatrixHandle();
    if (handle) {
        setViewMatrixHandle(safeDispose(handle));
    }
}
