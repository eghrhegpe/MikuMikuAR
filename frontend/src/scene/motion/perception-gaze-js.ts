// [doc:adr-071] 感知层 — 视线追踪 JS 路径写入策略
// 共用骨架见 perception-gaze.ts:_applyHeadGazeCore / _applyEyeGazeCore
// 本文件仅实现 JS 路径的写入差异：改 linkedBone + 调 updateWorldMatrix

import { Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _m, _q, type GazeCache } from './perception-shared';
import { _updateBoneChain } from './perception-breathing';
import {
    _applyHeadGazeCore,
    _applyEyeGazeCore,
    type HeadGazeWriteStrategy,
    type EyeGazeWriteStrategy,
} from './perception-gaze';

/** JS 路径头部写入策略：改 linkedBone.rotationQuaternion + _updateBoneChain 传播 */
const _jsHeadStrategy: HeadGazeWriteStrategy = {
    writeHead(headRuntime, finalQ, _headPos, _oldHeadMat, parentWorldQ): void {
        // localQ = invParentQ × finalQ（core 已算过一次，但 strategy 不知道；这里重算以保持策略自包含）
        const parentBone = headRuntime.parentBone;
        const parentWorldInv = _m();
        if (parentBone) {
            const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
            parentMat.invertToRef(parentWorldInv);
        } else {
            Matrix.IdentityToRef(parentWorldInv);
        }
        const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
        const localQ = _q();
        parentInvQ.multiplyToRef(finalQ, localQ);

        // 写入既有实例，不外泄池引用
        const headQ = headRuntime.linkedBone.rotationQuaternion;
        if (headQ) {
            headQ.copyFrom(localQ);
        }
        _updateBoneChain(headRuntime);
    },
};

/** JS 路径眼部写入策略：改 linkedBone.rotationQuaternion + updateWorldMatrix 传播 */
const _jsEyeStrategy: EyeGazeWriteStrategy = {
    writeEye(eyeRb, _finalEyeQ, localQ, _eyeMat, _parentWorldQ): void {
        const eyeQ = eyeRb.linkedBone.rotationQuaternion;
        if (eyeQ) {
            eyeQ.copyFrom(localQ);
        }
        (eyeRb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);
    },
};

/** JS 模式：头部跟随（薄包装：调用 core + 注入 JS 写入策略） */
export function _applyHeadGazeJS(
    headRuntime: IMmdRuntimeBone,
    gazeTarget: import('@babylonjs/core/Maths/math.vector').Vector3,
    dt: number,
    cache?: GazeCache
): void {
    _applyHeadGazeCore(headRuntime, gazeTarget, dt, cache, _jsHeadStrategy);
}

/** JS 模式：眼部跟随（薄包装：调用 core + 注入 JS 写入策略） */
export function _applyEyeGazeJS(
    eyeRuntimes: IMmdRuntimeBone[],
    gazeTarget: import('@babylonjs/core/Maths/math.vector').Vector3,
    dt: number,
    cache?: GazeCache
): void {
    _applyEyeGazeCore(eyeRuntimes, gazeTarget, dt, cache, _jsEyeStrategy);
}
