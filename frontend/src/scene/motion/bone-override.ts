// [doc:architecture] Bone Override — 逐骨骼覆盖系统
// 职责: 维护 overrideMap，在动画后逐骨骼覆盖局部旋转，支持 Quaternion.Slerp 混合
// 与 ADR-051 boneFilter 互补：boneFilter=屏蔽动画，Override=设定目标值
// 依赖: scene.ts (懒加载避免循环依赖)

import { Quaternion, Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '@/core/types';

/** 持久化的单条骨骼覆盖配置 */
export type BoneOverrideEntry = {
    boneName: string;
    /** 欧拉角（度），[pitch, yaw, roll] */
    euler: [number, number, number];
    /** 混合权重 0–1，1=硬覆盖 */
    weight: number;
    /** 启用/禁用 */
    enabled: boolean;
};

/** 运行时缓存：四元数 + 混合参数 */
interface _OverrideSlot {
    quat: Quaternion;
    weight: number;
    enabled: boolean;
}

// ── 单例管理器 ──

let _observer: (() => void) | null = null;
let _observerHandle: (() => void) | null = null; // unregister function
const _overrideMap = new Map<string, _OverrideSlot>();
const _qPool = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
let _qIdx = 0;
function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

// ── 工具：欧拉角 → 四元数（ZYX 顺序：yaw→pitch→roll） ──
// Babylon Euler 顺序：Quaternion.FromEulerAngles(pitch, yaw, roll) = YXZ
// MMD 惯例用 ZXY，但为 UI 直观用 Babylon 默认 YXZ
function _eulerToQuat(pitchDeg: number, yawDeg: number, rollDeg: number): Quaternion {
    return Quaternion.FromEulerAngles(
        (pitchDeg * Math.PI) / 180,
        (yawDeg * Math.PI) / 180,
        (rollDeg * Math.PI) / 180
    );
}

// ── WASM 运行时辅助 ──

function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return !('updateWorldMatrix' in bone);
}

/**
 * 递归传播子骨骼变换（WASM 模式）。
 * 覆盖父骨骼后需更正子骨骼的 worldMatrix 以维持相对变换。
 */
function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = _q(); // 复用 temp Quaternion
    const pQ = _q();
    // 用 Matrix.invert 太贵，改为：localMat = childOldMat × parentOld⁻¹
    // 使用 Matrix 运算
    const invMat = new Matrix().copyFrom(parentOldMat);
    invMat.invert();
    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }
        const childOldMat = Matrix.FromArray(childBuf);
        const localMat = new Matrix();
        childOldMat.multiplyToRef(invMat, localMat);
        const childNewMat = new Matrix();
        localMat.multiplyToRef(parentNewMat, childNewMat);
        // 写回 worldMatrix buffer
        const arr = childNewMat.asArray();
        for (let i = 0; i < 16; i++) {
            childBuf[i] = arr[i];
        }
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

// ── 核心 API ──

/**
 * 设置单条骨骼覆盖。
 * @param boneName 目标骨骼名
 * @param euler 欧拉角（度）[pitch, yaw, roll]
 * @param weight 混合权重 0–1
 * @param enabled 是否启用
 */
export function setBoneOverride(
    boneName: string,
    euler: [number, number, number],
    weight: number,
    enabled = true
): void {
    _overrideMap.set(boneName, {
        quat: _eulerToQuat(euler[0], euler[1], euler[2]),
        weight: Math.max(0, Math.min(1, weight)),
        enabled,
    });
}

/**
 * 设置单条骨骼覆盖（直接传四元数）。
 */
export function setBoneOverrideQuat(
    boneName: string,
    quat: Quaternion,
    weight: number,
    enabled = true
): void {
    _overrideMap.set(boneName, {
        quat: quat.clone(),
        weight: Math.max(0, Math.min(1, weight)),
        enabled,
    });
}

/** 清除指定骨骼的覆盖。 */
export function clearBoneOverride(boneName: string): void {
    _overrideMap.delete(boneName);
}

/** 清除所有骨骼覆盖。 */
export function clearAllOverrides(): void {
    _overrideMap.clear();
}

/** 获取当前所有覆盖的条目列表（用于持久化/UI 展示）。 */
export function getAllOverrides(): BoneOverrideEntry[] {
    const result: BoneOverrideEntry[] = [];
    for (const [boneName, slot] of _overrideMap) {
        if (!slot.enabled) {
            continue;
        }
        // 需要从四元数反推欧拉角
        const euler = slot.quat.toEulerAngles();
        result.push({
            boneName,
            euler: [
                (euler.x * 180) / Math.PI,
                (euler.y * 180) / Math.PI,
                (euler.z * 180) / Math.PI,
            ],
            weight: slot.weight,
            enabled: slot.enabled,
        });
    }
    return result;
}

/**
 * 从持久化的条目列表批量恢复覆盖。
 */
export function restoreOverrides(entries: BoneOverrideEntry[]): void {
    _overrideMap.clear();
    for (const e of entries) {
        setBoneOverride(e.boneName, e.euler, e.weight, e.enabled);
    }
}

// ── 渲染循环钩子 ──

/**
 * 启动覆盖系统：注册 onBeforeRenderObservable 回调。
 * 必须在动画写入之后执行，因此注册在 gaze tracking 之后。
 */
export function startBoneOverride(
    getRuntimeBones: () => readonly IMmdRuntimeBone[],
    scene: import('@babylonjs/core/scene').Scene
): void {
    if (_observerHandle) {
        return;
    } // 已启动

    const callback = () => {
        if (_overrideMap.size === 0) {
            return;
        }
        const bones = getRuntimeBones();
        if (bones.length === 0) {
            return;
        }

        const isWasm = _isWasmRuntime(bones[0]);

        for (const [boneName, slot] of _overrideMap) {
            if (!slot.enabled) {
                continue;
            }
            const rb = bones.find((b) => b.name === boneName);
            if (!rb) {
                continue;
            }

            if (isWasm) {
                // WASM 模式：直写 worldMatrix
                const buf = (rb as MmdRuntimeBoneExtended).worldMatrix;
                if (!buf) {
                    continue;
                }
                const oldMat = Matrix.FromArray(buf);
                const pos = oldMat.getTranslation();
                const oldQ = _q().copyFrom(
                    Quaternion.FromRotationMatrix(oldMat.getRotationMatrix())
                );
                const blended =
                    slot.weight >= 1 ? slot.quat : Quaternion.Slerp(oldQ, slot.quat, slot.weight);
                const newMat = Matrix.Compose(Vector3.One(), blended, pos);
                const arr = newMat.asArray();
                for (let i = 0; i < 16; i++) {
                    buf[i] = arr[i];
                }
                _propagateChildrenWasm(rb, oldMat, newMat);
            } else {
                // JS 模式：linkedBone 是 MmdRuntimeBone 的伪私有属性，
                // 类型声明未暴露，运行时 JS 模式下一定存在
                const linked = (
                    rb as unknown as { linkedBone?: import('@babylonjs/core/Bones/bone').Bone }
                ).linkedBone;
                if (!linked) {
                    continue;
                }

                if (slot.weight >= 1) {
                    linked.rotationQuaternion = slot.quat.clone();
                } else {
                    const cur = linked.rotationQuaternion ?? Quaternion.Identity();
                    linked.rotationQuaternion = Quaternion.Slerp(cur, slot.quat, slot.weight);
                }

                // 更新骨骼世界矩阵
                (rb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);

                // 标记脏标记
                const skeleton = linked.getSkeleton();
                skeleton?._markAsDirty?.();
            }
        }
    };

    _observer = callback;
    _observerHandle = () => {
        scene.onBeforeRenderObservable.removeCallback(callback);
    };
    scene.onBeforeRenderObservable.add(callback);
}

/** 停止覆盖系统。 */
export function stopBoneOverride(): void {
    if (_observerHandle) {
        _observerHandle();
        _observerHandle = null;
        _observer = null;
    }
    clearAllOverrides();
}
