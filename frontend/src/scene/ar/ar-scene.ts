// [doc:architecture] AR Scene — AR 模式场景级协调
// 职责: 切换 AR 模式时同步调整场景状态（清屏颜色、天空可见性、视线追踪）
// 依赖: ar-camera.ts（摄像头流）+ scene（清屏色）+ env-impl（天空网格）+ proc-motion-bridge（视线追踪）

import { Color4 } from '@babylonjs/core/Maths/math.color';
import { scene } from '../scene';
import { _envSys } from '../env/env-impl';
import {
    startARCamera,
    stopARCamera,
    captureARScreenshot,
    isARActive,
} from './ar-camera';
import type { CameraFacing } from './ar-camera';
import {
    getProcMotionState,
    setProcMotionEyeTrackingEnabled,
    setProcMotionHeadTrackingEnabled,
} from '../motion/proc-motion-bridge';

// ======== Internal State ========

let _originalClearColor: Color4 | null = null;
let _skyHidden = false;
let _prevGazeState: { eye: boolean; head: boolean } | null = null;

// ======== Public API ========

/**
 * 切换 AR 模式（摄像头视频背景 + 透明 canvas）。
 * 由 camera.ts 的 switchCameraMode('ar') 调用。
 */
export async function setARMode(enabled: boolean): Promise<boolean> {
    if (enabled) {
        const isMobile =
            'ontouchstart' in window ||
            navigator.maxTouchPoints > 0 ||
            window.matchMedia('(pointer: coarse)').matches;
        const facing: CameraFacing = isMobile ? 'environment' : 'user';
        const ok = await startARCamera(facing);
        if (!ok) {
            return false;
        }
        if (!_originalClearColor) {
            _originalClearColor = scene.clearColor.clone();
        }
        scene.clearColor = new Color4(0, 0, 0, 0);
        if (_envSys.sky.skyMesh && !_skyHidden) {
            _envSys.sky.skyMesh.setEnabled(false);
            _skyHidden = true;
        }
        _prevGazeState = {
            eye: getProcMotionState().eyeTrackingEnabled,
            head: getProcMotionState().headTrackingEnabled,
        };
        setProcMotionEyeTrackingEnabled(true);
        setProcMotionHeadTrackingEnabled(true);
        return true;
    } else {
        stopARCamera();
        if (_originalClearColor) {
            scene.clearColor = _originalClearColor;
            _originalClearColor = null;
        }
        if (_envSys.sky.skyMesh && _skyHidden) {
            _envSys.sky.skyMesh.setEnabled(true);
            _skyHidden = false;
        }
        if (_prevGazeState) {
            setProcMotionEyeTrackingEnabled(_prevGazeState.eye);
            setProcMotionHeadTrackingEnabled(_prevGazeState.head);
            _prevGazeState = null;
        }
        return true;
    }
}

/** AR 合成截图（视频底 + 3D 层），供截图功能调用。 */
export function takeARScreenshot(fmt: string, quality: number): string {
    return captureARScreenshot(fmt, quality);
}

export function isARModeActive(): boolean {
    return isARActive();
}
