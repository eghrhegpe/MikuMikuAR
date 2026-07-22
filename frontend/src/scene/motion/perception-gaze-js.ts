// [doc:adr-071] 感知层 — 视线追踪 JS 路径（改 linkedBone + updateWorldMatrix）

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _v3, _m, _q, _gazeAlpha, type GazeCache } from './perception-shared';
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
    const clampedTargetQ = _clampHeadGazeTarget(oldHeadRotQ, targetWorldQ, parentWorldQ);
    const alpha = _gazeAlpha(0.7, dt);
    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, clampedTargetQ, alpha));
    const finalQ = _clampHeadGazeTarget(blended, blended, parentWorldQ);
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

        const clampedTargetQ = _clampGazeTargetInParentFrame(
            curWorldQ,
            targetWorldQ,
            parentWorldQ,
            getEyeGazeMaxYaw(),
            getEyeGazeMaxPitch()
        );
        const alpha = _gazeAlpha(getEyeGazeSmooth(), dt);
        const newWorldQ = _q().copyFrom(Quaternion.Slerp(curWorldQ, clampedTargetQ, alpha));
        const finalEyeQ = _clampGazeTargetInParentFrame(newWorldQ, newWorldQ, parentWorldQ, getEyeGazeMaxYaw(), getEyeGazeMaxPitch());

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
