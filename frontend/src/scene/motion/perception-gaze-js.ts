// [doc:adr-071] 感知层 — 视线追踪 JS 路径（改 linkedBone + updateWorldMatrix）

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _v3, _m, _q, _gazeAlpha, _gazeLog, _qAngleDeg, type GazeCache } from './perception-shared';
import { _updateBoneChain } from './perception-breathing';
import {
    _clampHeadGazeTarget,
    _clampGazeTargetInParentFrame,
    getEyeGazeMaxYaw,
    getEyeGazeMaxPitch,
    getEyeGazeSmooth,
} from './perception-gaze';

/** JS 模式：头部跟随 */
export function _applyHeadGazeJS(
    headRuntime: IMmdRuntimeBone,
    gazeTarget: Vector3,
    dt: number,
    cache?: GazeCache
): void {
    const headPos = _v3();
    headRuntime.getWorldTranslationToRef(headPos);

    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
    const oldHeadRotQ = cache?.headWorldQ ?? _q().copyFrom(
        Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix())
    );

    // ── 方向说明 ──
    // Babylon.js FromLookDirectionRH 对齐 -Z 到 lookDir。
    // MMD 骨骼 +Z = 朝前。要让骨骼 +Z 朝向相机，需 -Z 背对相机 → lookDir = 骨→相机（away from camera）。
    // 即 bonePos - cameraPos。注意：此方向与直觉相反，已踩坑 3 次。
    const lookDir = headPos.subtractToRef(gazeTarget, _v3()).normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    const parentBone = headRuntime.parentBone;
    const parentWorldInv = _m();
    if (parentBone) {
        const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
        parentMat.invertToRef(parentWorldInv);
    } else {
        Matrix.IdentityToRef(parentWorldInv);
    }

    const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
    const parentWorldQ = _q().copyFrom(parentInvQ).invert();
    const clampedTarget = _clampHeadGazeTarget(oldHeadRotQ, targetWorldQ, parentWorldQ);
    const alpha = _gazeAlpha(0.7, dt);
    const finalQ = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, clampedTarget, alpha));
    _gazeLog('HEAD', headRuntime.linkedBone?.name, 'dt', dt.toFixed(4), 'α', alpha.toFixed(4), 'err→', _qAngleDeg(oldHeadRotQ, targetWorldQ).toFixed(1), 'clamp', _qAngleDeg(clampedTarget, targetWorldQ).toFixed(1), 'err←', _qAngleDeg(finalQ, targetWorldQ).toFixed(1));
    const localQ = _q();
    parentInvQ.multiplyToRef(finalQ, localQ);

    if (cache) {
        if (!cache.headWorldQ) cache.headWorldQ = new Quaternion();
        cache.headWorldQ.copyFrom(finalQ);
    }

    // 写入既有实例，不外泄池引用
    const headQ = headRuntime.linkedBone.rotationQuaternion;
    if (headQ) {
        headQ.copyFrom(localQ);
    }

    _updateBoneChain(headRuntime);
}

/** JS 模式：眼部跟随 */
export function _applyEyeGazeJS(
    eyeRuntimes: IMmdRuntimeBone[],
    gazeTarget: Vector3,
    dt: number,
    cache?: GazeCache
): void {
    const eyeCenter = _v3();
    for (const eyeRb of eyeRuntimes) {
        const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        eyeCenter.x += eb[12];
        eyeCenter.y += eb[13];
        eyeCenter.z += eb[14];
    }
    eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

    // ── 方向说明：bonePos - cameraPos（理由同上 head 注释） ──
    const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
    if (lookDir.lengthSquared() < 0.0001) {
        return;
    }

    lookDir.normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    for (const eyeRb of eyeRuntimes) {
        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeRb.worldMatrix));
        const boneName = eyeRb.linkedBone?.name ?? '';

        const parentBone = eyeRb.parentBone;
        const parentWorldInv = _m();
        if (parentBone) {
            const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
            parentMat.invertToRef(parentWorldInv);
        } else {
            Matrix.IdentityToRef(parentWorldInv);
        }

        const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
        const parentWorldQ = _q().copyFrom(parentInvQ).invert();

        const cachedLocal = cache?.eyeLocalQ.get(boneName);
        const curWorldQ = cachedLocal
            ? _q().copyFrom(parentWorldQ).multiplyInPlace(cachedLocal)
            : _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));

        const clampedTarget = _clampGazeTargetInParentFrame(curWorldQ, targetWorldQ, parentWorldQ, getEyeGazeMaxYaw(), getEyeGazeMaxPitch());
        const alpha = _gazeAlpha(getEyeGazeSmooth(), dt);
        const finalEyeQ = _q().copyFrom(Quaternion.Slerp(curWorldQ, clampedTarget, alpha));
        _gazeLog('EYE', boneName, 'dt', dt.toFixed(4), 'α', alpha.toFixed(4), 'err→', _qAngleDeg(curWorldQ, targetWorldQ).toFixed(1), 'clamp', _qAngleDeg(clampedTarget, targetWorldQ).toFixed(1), 'err←', _qAngleDeg(finalEyeQ, targetWorldQ).toFixed(1));

        const localQ = _q();
        parentInvQ.multiplyToRef(finalEyeQ, localQ);

        if (cache) {
            let cached = cache.eyeLocalQ.get(boneName);
            if (!cached) {
                cached = new Quaternion();
                cache.eyeLocalQ.set(boneName, cached);
            }
            cached.copyFrom(localQ);
        }

        // 写入既有实例，不外泄池引用
        const eyeQ = eyeRb.linkedBone.rotationQuaternion;
        if (eyeQ) {
            eyeQ.copyFrom(localQ);
        }
        (eyeRb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);
    }
}
