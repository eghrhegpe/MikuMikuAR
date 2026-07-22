// [doc:adr-071] 感知层 — 视线追踪 WASM 路径（直写 frontBuffer + 递归传播）

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import type { MmdRuntimeBoneExtended } from '@/core/types';
import {
    _v3,
    _m,
    _q,
    _gazeAlpha,
    _writeMatToBuffer,
    _propagateChildrenWasm,
    type GazeCache,
} from './perception-shared';
import {
    _clampHeadGazeTarget,
    _clampGazeTargetInParentFrame,
    getEyeGazeMaxYaw,
    getEyeGazeMaxPitch,
    getEyeGazeSmooth,
} from './perception-gaze';

/** WASM 模式：头部跟随 */
export function _applyHeadGazeWasm(
    headRuntime: IMmdRuntimeBone,
    gazeTarget: Vector3,
    dt: number,
    cache?: GazeCache
): void {
    const headBuf = (headRuntime as MmdRuntimeBoneExtended).worldMatrix;
    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headBuf));
    const headPos = oldHeadMat.getTranslation();
    const oldHeadRotQ = cache?.headWorldQ ?? _q().copyFrom(
        Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix())
    );

    const lookDir = headPos.subtractToRef(gazeTarget, _v3());
    const lookLen = Math.sqrt(lookDir.x ** 2 + lookDir.y ** 2 + lookDir.z ** 2);
    if (lookLen <= 0.0001) {
        return;
    }

    lookDir.scaleInPlace(1 / lookLen);
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    const parentWorldQ = _q();
    const parentBoneWasm = headRuntime.parentBone;
    if (parentBoneWasm) {
        const pb = parentBoneWasm as MmdRuntimeBoneExtended;
        if (pb.worldMatrix) {
            parentWorldQ.copyFrom(Quaternion.FromRotationMatrix(Matrix.FromArray(pb.worldMatrix)));
        } else {
            parentWorldQ.copyFrom(Quaternion.Identity());
        }
    } else {
        parentWorldQ.copyFrom(Quaternion.Identity());
    }
    const clampedTargetQ = _clampHeadGazeTarget(oldHeadRotQ, targetWorldQ, parentWorldQ);
    const alpha = _gazeAlpha(0.7, dt);
    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, clampedTargetQ, alpha));
    const finalQ = _clampHeadGazeTarget(blended, blended, parentWorldQ);

    if (cache) {
        if (!cache.headWorldQ) cache.headWorldQ = new Quaternion();
        cache.headWorldQ.copyFrom(finalQ);
        if (!cache.headTargetWorldQ) cache.headTargetWorldQ = new Quaternion();
        cache.headTargetWorldQ.copyFrom(clampedTargetQ);
    }

    const newHeadMat = _m().copyFrom(Matrix.Compose(Vector3.One(), finalQ, headPos));
    _writeMatToBuffer(headBuf, newHeadMat);

    _propagateChildrenWasm(headRuntime, oldHeadMat, newHeadMat);
}

/** WASM 模式：眼部跟随 */
export function _applyEyeGazeWasm(
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

    const parentWorldQ = _q();
    if (cache?.headTargetWorldQ) {
        parentWorldQ.copyFrom(cache.headTargetWorldQ);
    } else {
        const eyeParentBone = eyeRuntimes[0].parentBone;
        if (eyeParentBone) {
            const pMat = _m().copyFrom(Matrix.FromArray(eyeParentBone.worldMatrix));
            Quaternion.FromRotationMatrixToRef(pMat.getRotationMatrix(), parentWorldQ);
        } else {
            parentWorldQ.copyFrom(Quaternion.Identity());
        }
    }

    for (const eyeRb of eyeRuntimes) {
        const eyeBuf = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBuf));
        const eyePos = eyeMat.getTranslation();
        const boneName = eyeRb.linkedBone?.name ?? '';

        const cachedLocal = cache?.eyeLocalQ.get(boneName);
        const curEyeQ = cachedLocal
            ? _q().copyFrom(parentWorldQ).multiplyInPlace(cachedLocal)
            : _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));

        const clampedTargetQ = _clampGazeTargetInParentFrame(
            curEyeQ,
            targetWorldQ,
            parentWorldQ,
            getEyeGazeMaxYaw(),
            getEyeGazeMaxPitch()
        );
        const alpha = _gazeAlpha(getEyeGazeSmooth(), dt);
        const newEyeQ = _q().copyFrom(Quaternion.Slerp(curEyeQ, clampedTargetQ, alpha));
        const finalEyeQ = _clampGazeTargetInParentFrame(newEyeQ, newEyeQ, parentWorldQ, getEyeGazeMaxYaw(), getEyeGazeMaxPitch());

        const invParentQ = _q().copyFrom(parentWorldQ).invert();
        const localQ = _q().copyFrom(invParentQ).multiplyInPlace(finalEyeQ);

        if (cache) {
            let cached = cache.eyeLocalQ.get(boneName);
            if (!cached) {
                cached = new Quaternion();
                cache.eyeLocalQ.set(boneName, cached);
            }
            cached.copyFrom(localQ);
        }

        const newEyeMat = _m().copyFrom(Matrix.Compose(Vector3.One(), finalEyeQ, eyePos));

        _writeMatToBuffer(eyeBuf, newEyeMat);
        _propagateChildrenWasm(eyeRb, eyeMat, newEyeMat);
    }
}
