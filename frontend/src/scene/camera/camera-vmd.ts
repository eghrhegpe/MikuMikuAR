// [doc:architecture] Camera VMD — VMD 相机动画
// 从 camera.ts 拆出（ADR-148 阶段 3：camera.ts 瘦身）
// 职责: MmdCamera 创建/销毁、VMD 动画播放、每帧 animate
// 依赖: camera-state（scene 引用 + VMD 状态）+ camera.ts（switchCameraMode 回调）
//
// 循环依赖处理：clearCameraVmd 需要调用 switchCameraMode（在 vmd 模式下切回 orbit），
// 但 camera.ts 又会调用 loadCameraVmd/clearCameraVmd。通过 setSwitchCameraModeCallback
// 注入回调，避免静态循环依赖。

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';

import {
    getCameraMode,
    getCameraScene,
    setCameraVmdState,
    clearCameraVmdState,
} from './camera-state';

let _mmdCamera: MmdCamera | null = null;
let _cameraAnimationHandle: number | null = null;

/** 切换相机模式的回调（由 camera.ts 注入，避免循环依赖）。 */
let _switchModeCallback: ((mode: 'orbit') => void) | null = null;

/** camera.ts 启动时注入 switchCameraMode 回调。 */
export function setSwitchCameraModeCallback(cb: (mode: 'orbit') => void): void {
    _switchModeCallback = cb;
}

/** Load camera animation from a VMD (MmdAnimation) and create an MmdCamera. */
export function loadCameraVmd(mmdAnimation: MmdAnimation, vmdPath: string, vmdName: string): void {
    const scene = getCameraScene();
    if (!scene) {
        return;
    }

    // 重新加载 VMD 时，记录旧 MmdCamera 是否为 activeCamera。
    // 若是，dispose 后需将 activeCamera 指向新 MmdCamera，否则渲染崩溃
    // （scene.activeCamera 仍指向已 dispose 的旧相机实例）。
    const wasActive = _mmdCamera !== null && scene.activeCamera === _mmdCamera;

    if (_mmdCamera) {
        // 顺序：先 removeCamera（从 scene.cameras 数组移除 + 清除 activeCamera 引用），
        // 再 dispose（释放 GPU 资源）。反之 dispose 后 removeCamera 仍能工作但语义不清。
        scene.removeCamera(_mmdCamera);
        _mmdCamera.dispose(); // 释放 GPU 资源（渲染目标、贴图等）
        _mmdCamera = null;
        _cameraAnimationHandle = null;
    }

    const mmdCam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), scene, false);
    const handle = mmdCam.createRuntimeAnimation(mmdAnimation);
    mmdCam.setRuntimeAnimation(handle);

    _mmdCamera = mmdCam;
    _cameraAnimationHandle = handle;
    setCameraVmdState(vmdName, vmdPath);

    // 若旧 MmdCamera 是 activeCamera（vmd 模式下重新加载场景），切换到新 MmdCamera。
    // 非激活场景（orbit 模式下预载 VMD）不影响 activeCamera。
    if (wasActive) {
        scene.activeCamera = mmdCam;
    }
}

export function clearCameraVmd(): void {
    const scene = getCameraScene();
    if (_mmdCamera && scene) {
        if (getCameraMode() === 'vmd' && _switchModeCallback) {
            _switchModeCallback('orbit');
        }
        scene.removeCamera(_mmdCamera);
        _mmdCamera = null;
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

/** 创建 VMD 相机（若已存在则复用）。供 camera.ts switchCameraMode 在 vmd 分支使用。 */
export function createVmdCamera(): MmdCamera {
    const scene = getCameraScene();
    if (_mmdCamera) {
        return _mmdCamera;
    }
    const cam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), scene, false);
    _mmdCamera = cam;
    return cam;
}

/** VMD 相机动画句柄是否就绪（switchCameraMode 在 vmd 分支前置检查）。 */
export function hasCameraAnimationHandle(): boolean {
    return _cameraAnimationHandle !== null;
}
