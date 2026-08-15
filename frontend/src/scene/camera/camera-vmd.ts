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
import type { MmdRuntimeAnimationHandle } from 'babylon-mmd/esm/Runtime/mmdRuntimeAnimationHandle';

import {
    getCameraMode,
    getCameraScene,
    setCameraVmdState,
    clearCameraVmdState,
} from './camera-state';

let _mmdCamera: MmdCamera | null = null;
let _cameraAnimationHandle: MmdRuntimeAnimationHandle | null = null;
// 保留 VMD 动画源引用：MmdCamera 被销毁（如 vmd→orbit→vmd 切换）后重建相机时，
// 可用它重新 createRuntimeAnimation，避免「已 dispose 相机被复用」缺陷。
let _mmdAnimation: MmdAnimation | null = null;

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
        // 注意：vmd→orbit→vmd 切换时 switchCameraMode 已 dispose 旧 MmdCamera，
        // 但本模块级引用会保留到下次 createVmdCamera 重建；重载不得二次 remove/dispose。
        if (!_mmdCamera.isDisposed()) {
            scene.removeCamera(_mmdCamera);
            _mmdCamera.dispose();
        }
        _mmdCamera = null;
        _cameraAnimationHandle = null;
    }

    const mmdCam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), scene, false);
    const handle = mmdCam.createRuntimeAnimation(mmdAnimation);
    mmdCam.setRuntimeAnimation(handle);

    _mmdCamera = mmdCam;
    _cameraAnimationHandle = handle;
    _mmdAnimation = mmdAnimation;
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
            // switchCameraMode('orbit') 已对当前相机（即 MmdCamera）执行
            // detachControl + removeCamera + dispose，此处不能再释放第二次。
            _switchModeCallback('orbit');
        } else {
            // 非 vmd 模式（如 orbit 下预载 VMD 后清除）回调不会处理，手动释放 GPU 资源。
            // 若 _mmdCamera 已在 vmd→orbit 切换中被 switchCameraMode dispose，则跳过二次释放。
            if (!_mmdCamera.isDisposed()) {
                scene.removeCamera(_mmdCamera);
                _mmdCamera.dispose();
            }
        }
        _mmdCamera = null;
        _cameraAnimationHandle = null;
        _mmdAnimation = null;
        clearCameraVmdState();
    }
}

/** Animate the VMD camera to a given 30fps frame time. Called every tick by scene.ts. */
export function animateCameraVmd(frameTime: number): void {
    if (_mmdCamera && getCameraMode() === 'vmd') {
        _mmdCamera.animate(frameTime);
    }
}

/** 创建 VMD 相机（若已存在且未销毁则复用）。供 camera.ts switchCameraMode 在 vmd 分支使用。 */
export function createVmdCamera(): MmdCamera {
    const scene = getCameraScene();
    if (_mmdCamera && !_mmdCamera.isDisposed()) {
        return _mmdCamera;
    }
    // 旧 MmdCamera 已被销毁（如 vmd→orbit→vmd 切换时 switchCameraMode 对 oldCam 执行了 dispose，
    // 但本模块级引用未置空）：重建相机，并用保留的动画源恢复动画句柄。
    const cam = new MmdCamera('mmdCam', new Vector3(0, 10, 0), scene, false);
    if (_mmdAnimation) {
        _cameraAnimationHandle = cam.createRuntimeAnimation(_mmdAnimation);
        cam.setRuntimeAnimation(_cameraAnimationHandle);
    } else {
        _cameraAnimationHandle = null;
    }
    _mmdCamera = cam;
    return cam;
}

/** VMD 相机动画句柄是否就绪（switchCameraMode 在 vmd 分支前置检查）。 */
export function hasCameraAnimationHandle(): boolean {
    return _cameraAnimationHandle !== null;
}
