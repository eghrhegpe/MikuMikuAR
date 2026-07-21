// [doc:adr-071] 感知层 — 视线追踪（头部跟随 + 眼部跟随，WASM/JS 双路径调度）
// WASM 路径实现 → perception-gaze-wasm.ts
// JS   路径实现 → perception-gaze-js.ts

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { isARActive } from '../ar/ar-camera';
import type { MeshMetadata, GazeConfig, MmdModelLike } from './perception-shared';
import {
    _v3,
    _q,
    _gazeAlpha,
    _isWasmRuntime,
    getHeadGazeMaxYaw,
    getHeadGazeMaxPitch,
    getEyeGazeMaxYaw,
    getEyeGazeMaxPitch,
    getEyeGazeSmooth,
} from './perception-shared';

// Re-export getter functions for JS/WASM sub-modules (avoid circular dependency)
export { getEyeGazeMaxYaw, getEyeGazeMaxPitch, getEyeGazeSmooth };
import { _applyHeadGazeWasm, _applyEyeGazeWasm } from './perception-gaze-wasm';
import { _applyHeadGazeJS, _applyEyeGazeJS } from './perception-gaze-js';

// ── 眼球追踪平滑系数（默认值，实际从 perception-shared 动态读取） ──
const DEFAULT_EYE_SMOOTH = 0.35;

// ── AR 模式视线距离（米） ──
const AR_GAZE_DISTANCE = 1.5;

// ── 头部/眼球跟随角度限位（默认值，实际从 perception-shared 动态读取） ──
const DEFAULT_HEAD_GAZE_MAX_YAW = (75 * Math.PI) / 180;
const DEFAULT_HEAD_GAZE_MAX_PITCH = (35 * Math.PI) / 180;
const DEFAULT_EYE_GAZE_MAX_YAW = (9 * Math.PI) / 180;
const DEFAULT_EYE_GAZE_MAX_PITCH = (8 * Math.PI) / 180;

/**
 * 将"转向相机的目标世界旋转"钳制在相对父骨骼坐标系的 yaw/pitch 锥形内。
 */
export function _clampGazeTargetInParentFrame(
    oldWorldQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion,
    maxYawRad: number,
    maxPitchRad: number
): Quaternion {
    return _clampImpl(oldWorldQ, targetWorldQ, parentWorldQ, maxYawRad, maxPitchRad);
}

function _clampImpl(
    oldWorldQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion,
    maxYawRad: number,
    maxPitchRad: number
): Quaternion {
    const invParent = _q().copyFrom(parentWorldQ).invert();
    const desiredLocal = _q().copyFrom(invParent).multiplyInPlace(targetWorldQ);
    const e = desiredLocal.toEulerAngles();
    const yaw = Math.max(-maxYawRad, Math.min(maxYawRad, e.y));
    const pitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, e.x));
    const clampedLocal = Quaternion.FromEulerAngles(pitch, yaw, 0);
    return _q().copyFrom(parentWorldQ).multiplyInPlace(clampedLocal);
}

/** 获取视线目标点（AR 模式沿相机朝向投射，普通模式用相机位置） */
export function _getGazeTarget(cam: Camera, out: Vector3): Vector3 {
    if (isARActive()) {
        const forward = cam.getDirection(Vector3.Forward());
        out.copyFrom(cam.position);
        out.addInPlace(forward.scale(AR_GAZE_DISTANCE));
        return out;
    }
    out.copyFrom(cam.position);
    return out;
}

/** 头部专用包装（维持已有回归测试签名不变） */
export function _clampHeadGazeTarget(
    oldHeadRotQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion
): Quaternion {
    return _clampImpl(
        oldHeadRotQ,
        targetWorldQ,
        parentWorldQ,
        getHeadGazeMaxYaw(),
        getHeadGazeMaxPitch()
    );
}

/** 眼球专用包装（相对头部坐标系，用更紧的生理锥形） */
export function _clampEyeGazeTarget(
    oldEyeRotQ: Quaternion,
    targetWorldQ: Quaternion,
    parentWorldQ: Quaternion
): Quaternion {
    return _clampImpl(
        oldEyeRotQ,
        targetWorldQ,
        parentWorldQ,
        getEyeGazeMaxYaw(),
        getEyeGazeMaxPitch()
    );
}

/** 统一调度入口（perception.ts observer 调用） */
export function _applyGaze(
    mmdModel: MmdModelLike,
    cam: Camera,
    config: { headEnabled: boolean; eyeEnabled: boolean },
    dt: number
): void {
    if (!config.headEnabled && !config.eyeEnabled) {
        return;
    }

    const headRuntime = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) =>
        HEAD_BONE_CANDIDATES.includes(b.name)
    );
    const eyeRuntimes: IMmdRuntimeBone[] = mmdModel.runtimeBones.filter((b: IMmdRuntimeBone) =>
        EYE_BONE_CANDIDATES.includes(b.name)
    );

    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) {
        return;
    }

    const isWasm = _isWasmRuntime(headRuntime ?? eyeRuntimes[0]);
    const gazeTarget = _getGazeTarget(cam, _v3());

    if (isWasm) {
        if (needHead && headRuntime) {
            _applyHeadGazeWasm(headRuntime, gazeTarget, dt);
        }
        if (needEye) {
            _applyEyeGazeWasm(eyeRuntimes, gazeTarget, dt);
        }
    } else {
        if (needHead && headRuntime) {
            _applyHeadGazeJS(headRuntime, gazeTarget, dt);
        }
        if (needEye) {
            _applyEyeGazeJS(eyeRuntimes, gazeTarget, dt);
        }
        const skeleton = (mmdModel.mesh.metadata as MeshMetadata)?.skeleton;
        skeleton?._markAsDirty?.();
    }
}

/** 头部骨骼候选名（JS/WASM 路径共用） */
const HEAD_BONE_CANDIDATES = ['頭', '首', 'head', 'Head'];
/** 眼球骨骼候选名（JS/WASM 路径共用） */
const EYE_BONE_CANDIDATES = [
    '右目',
    '左目',
    'Eye_R',
    'Eye_L',
    'eye_r',
    'eye_l',
    'RightEye',
    'LeftEye',
];

/** WASM 模式下的 gaze 应用（供 wasm-layers-blender.ts 调用） */
export function applyGazeWasm(
    bones: readonly IMmdRuntimeBone[],
    cam: Camera,
    config: GazeConfig,
    dt: number
): void {
    if (!config.headEnabled && !config.eyeEnabled) {
        return;
    }

    // 与 _applyGaze 使用相同的骨骼候选列表，避免 WASM 路径漏匹配英文名骨骼
    const headRuntime = bones.find((b) => HEAD_BONE_CANDIDATES.includes(b.name));
    const eyeRuntimes = bones.filter((b) => EYE_BONE_CANDIDATES.includes(b.name));
    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;

    if (!needHead && !needEye) {
        return;
    }

    const gazeTarget = _getGazeTarget(cam, _v3());

    if (needHead && headRuntime) {
        _applyHeadGazeWasm(headRuntime, gazeTarget, dt);
    }

    if (needEye) {
        _applyEyeGazeWasm(eyeRuntimes, gazeTarget, dt);
    }
}
