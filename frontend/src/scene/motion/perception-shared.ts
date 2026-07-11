// [doc:adr-071] 感知层共享类型、对象池与常量
// 供 perception.ts 及各 perception-*.ts 子模块复用

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '@/core/types';

// ── 感知状态（独立于 ProcMotionState） ──

/** 情绪类型（微表情驱动） */
export type Emotion = 'neutral' | 'happy' | 'sad' | 'surprised' | 'angry';

export interface PerceptionState {
    breathEnabled: boolean;
    blinkEnabled: boolean;
    headTrackingEnabled: boolean;
    eyeTrackingEnabled: boolean;
    microExpressionEnabled: boolean;
    emotion: Emotion;
    /** 重心微动开关（躯干骨骼平衡微晃） */
    balanceSwayEnabled: boolean;
    // Lip-sync（从 lipsync-bridge.ts 迁入）
    lipSyncEnabled: boolean;
    lipSyncSensitivity: number; // 0..1，振幅阈值
    lipSyncIntensity: number; // 0..1，最大张嘴幅度
    lipSyncMultiMorphEnabled: boolean; // 驱动多口型 morph
}

/** Gaze 配置类型 */
export type GazeConfig = { headEnabled: boolean; eyeEnabled: boolean };

export const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: true,
    headTrackingEnabled: true,
    eyeTrackingEnabled: true,
    microExpressionEnabled: true,
    emotion: 'neutral',
    balanceSwayEnabled: true,
    lipSyncEnabled: false,
    lipSyncSensitivity: 0.2,
    lipSyncIntensity: 0.8,
    lipSyncMultiMorphEnabled: false,
};

export interface MeshMetadata {
    skeleton?: { _markAsDirty?(): void };
}

// ── 对象池（避免每帧 new Vector3/Matrix/Quaternion，消除 GC 压力） ──
const _v3Pool = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
];
const _mPool = [
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
    new Matrix(),
];
const _qPool = [
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
];
let _v3Idx = 0,
    _mIdx = 0,
    _qIdx = 0;

export function _v3(): Vector3 {
    return _v3Pool[_v3Idx++ % _v3Pool.length];
}
export function _m(): Matrix {
    return _mPool[_mIdx++ % _mPool.length];
}
export function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

// ── WASM 辅助 ──

/** 把 Matrix 写回 Float32Array(16) */
export function _writeMatToBuffer(buf: Float32Array, m: Matrix): void {
    buf.set(m.asArray());
}

/** 递归传播子骨骼 worldMatrix */
// 数学推导：
//   childWorld = childLocal × parentWorld
//   childLocal = childWorld × parentWorld⁻¹ = childOldMat × parentOldInv
//   childNewWorld = childLocal × parentNewMat = localMat × parentNewMat
export function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = _m().copyFrom(parentOldMat);
    parentOldInv.invert();

    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }

        const childOldMat = Matrix.FromArrayToRef(childBuf, 0, _m());
        const localMat = _m();
        childOldMat.multiplyToRef(parentOldInv, localMat);

        const childNewMat = _m();
        localMat.multiplyToRef(parentNewMat, childNewMat);

        _writeMatToBuffer(childBuf, childNewMat);
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

export function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return !('updateWorldMatrix' in bone);
}
