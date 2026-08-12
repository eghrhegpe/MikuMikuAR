// [doc:adr-071] 感知层 — 视线追踪 WASM 路径写入策略
// 共用骨架见 perception-gaze.ts:_applyHeadGazeCore / _applyEyeGazeCore
// 本文件仅实现 WASM 路径的写入差异：直写 worldMatrix frontBuffer + _propagateChildrenWasm 传播

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { guardNum } from '@/core/guards';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _m, _writeMatToBuffer, _propagateChildrenWasm, type GazeCache } from './perception-shared';
import {
    _applyHeadGazeCore,
    _applyEyeGazeCore,
    type HeadGazeWriteStrategy,
    type EyeGazeWriteStrategy,
} from './perception-gaze';

/** WASM 路径头部写入策略：直写 worldMatrix frontBuffer + 递归传播子骨骼 */
const _wasmHeadStrategy: HeadGazeWriteStrategy = {
    writeHead(headRuntime, finalQ, headPos, oldHeadMat, _parentWorldQ): void {
        const headBuf = (headRuntime as MmdRuntimeBoneExtended).worldMatrix;
        const safeHeadPos = new Vector3(
            guardNum(headPos.x),
            guardNum(headPos.y),
            guardNum(headPos.z)
        );
        const newHeadMat = _m().copyFrom(Matrix.Compose(Vector3.One(), finalQ, safeHeadPos));
        _writeMatToBuffer(headBuf, newHeadMat);
        _propagateChildrenWasm(headRuntime, oldHeadMat, newHeadMat);
    },
};

/** WASM 路径眼部写入策略：直写 worldMatrix frontBuffer + 递归传播子骨骼 */
const _wasmEyeStrategy: EyeGazeWriteStrategy = {
    writeEye(eyeRb, finalEyeQ, _localQ, eyeMat, _parentWorldQ): void {
        const eyeBuf = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        const eyePos = eyeMat.getTranslation();
        const safeEyePos = new Vector3(
            guardNum(eyePos.x),
            guardNum(eyePos.y),
            guardNum(eyePos.z)
        );
        const newEyeMat = _m().copyFrom(Matrix.Compose(Vector3.One(), finalEyeQ, safeEyePos));
        _writeMatToBuffer(eyeBuf, newEyeMat);
        _propagateChildrenWasm(eyeRb, eyeMat, newEyeMat);
    },
};

/** WASM 模式：头部跟随（薄包装：调用 core + 注入 WASM 写入策略） */
export function _applyHeadGazeWasm(
    headRuntime: IMmdRuntimeBone,
    gazeTarget: import('@babylonjs/core/Maths/math.vector').Vector3,
    dt: number,
    cache?: GazeCache
): void {
    _applyHeadGazeCore(headRuntime, gazeTarget, dt, cache, _wasmHeadStrategy);
}

/** WASM 模式：眼部跟随（薄包装：调用 core + 注入 WASM 写入策略） */
export function _applyEyeGazeWasm(
    eyeRuntimes: IMmdRuntimeBone[],
    gazeTarget: import('@babylonjs/core/Maths/math.vector').Vector3,
    dt: number,
    cache?: GazeCache
): void {
    _applyEyeGazeCore(eyeRuntimes, gazeTarget, dt, cache, _wasmEyeStrategy);
}
