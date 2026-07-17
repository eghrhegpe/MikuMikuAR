// [doc:architecture] Bone Override — 逐骨骼覆盖系统
// 职责: 维护 overrideMap，在动画后逐骨骼覆盖局部旋转，支持 Quaternion.Slerp 混合
// 与 ADR-051 boneFilter 互补：boneFilter=屏蔽动画，Override=设定目标值
// 依赖: scene.ts (懒加载避免循环依赖)

import { Quaternion, Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { clamp01 } from '@/core/utils';
import { focusedModelId } from '@/core/state';

/** 持久化的单条骨骼覆盖配置 */
export type BoneOverrideEntry = {
    boneName: string;
    /** 欧拉角（度），[pitch, yaw, roll] */
    euler: [number, number, number];
    /** 混合权重 0–1，1=硬覆盖 */
    weight: number;
    /** 启用/禁用 */
    enabled: boolean;
    /** [doc:adr-116] 可选位置覆盖 [x, y, z]（P2 引擎扩展，支持 height/fwdBack 等语义参数） */
    position?: [number, number, number];
};

/** 运行时缓存：四元数 + 混合参数 + 可选位置 */
interface _OverrideSlot {
    quat: Quaternion;
    weight: number;
    enabled: boolean;
    /** [doc:adr-116] 可选位置覆盖（P2 引擎扩展）。undefined=不动位置，沿用动画值 */
    pos?: Vector3;
}

// ── 管理器（per-model） ──

let _observerHandle: (() => void) | null = null; // unregister function
const _overrideMaps = new Map<string, Map<string, _OverrideSlot>>();
const _qPool = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
let _qIdx = 0;
function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

/** 懒加载获取指定模型的 override map */
function _getOverrideMap(modelId: string): Map<string, _OverrideSlot> {
    let map = _overrideMaps.get(modelId);
    if (!map) {
        map = new Map();
        _overrideMaps.set(modelId, map);
    }
    return map;
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
// 所有 API 均支持可选 modelId 参数，不传则作用于当前聚焦模型。
// 内部使用 per-model Map 存储，避免多模型场景下互相串扰。

function _resolveModelId(modelId?: string): string | null {
    if (modelId) {
        return modelId;
    }
    // 懒加载 focusedModelId（避免静态循环依赖，已从 @/core/state 直接导入）
    return focusedModelId ?? null;
}

/**
 * 设置单条骨骼覆盖。
 * @param boneName 目标骨骼名
 * @param euler 欧拉角（度）[pitch, yaw, roll]
 * @param weight 混合权重 0–1
 * @param enabled 是否启用
 * @param modelId 目标模型 ID（可选，默认聚焦模型）
 */
export function setBoneOverride(
    boneName: string,
    euler: [number, number, number],
    weight: number,
    enabled = true,
    modelId?: string
): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).set(boneName, {
        quat: _eulerToQuat(euler[0], euler[1], euler[2]),
        weight: clamp01(weight),
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
    enabled = true,
    modelId?: string
): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).set(boneName, {
        quat: quat.clone(),
        weight: clamp01(weight),
        enabled,
    });
}

/**
 * [doc:adr-116] 设置单条骨骼的位置覆盖（P2 引擎扩展）。
 * 保留现有旋转覆盖（若已有 slot），仅更新 pos 字段。
 * 用于 body-posture 的 height/fwdBack 等需要位置偏移的语义参数。
 *
 * @param boneName 目标骨骼名
 * @param position 位置 [x, y, z]
 * @param weight 混合权重 0–1（当前实现为硬覆盖，权重保留用于未来插值扩展）
 * @param enabled 是否启用
 * @param modelId 目标模型 ID（可选，默认聚焦模型）
 */
export function setBoneOverridePosition(
    boneName: string,
    position: [number, number, number],
    weight: number,
    enabled = true,
    modelId?: string
): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    const map = _getOverrideMap(mid);
    let slot = map.get(boneName);
    if (!slot) {
        // 新建 slot：旋转用 Identity（不影响动画旋转），仅覆盖位置
        slot = {
            quat: Quaternion.Identity(),
            weight: clamp01(weight),
            enabled,
        };
        map.set(boneName, slot);
    }
    slot.pos = new Vector3(position[0], position[1], position[2]);
    slot.weight = clamp01(weight);
    slot.enabled = enabled;
}

/** 清除指定骨骼的覆盖。 */
export function clearBoneOverride(boneName: string, modelId?: string): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).delete(boneName);
}

/** [doc:adr-116] 读取单条骨骼的覆盖条目（用于 UI 回填）。不存在返回 undefined。 */
export function getOverride(boneName: string, modelId?: string): BoneOverrideEntry | undefined {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return undefined;
    }
    const slot = _overrideMaps.get(mid)?.get(boneName);
    if (!slot) {
        return undefined;
    }
    const euler = slot.quat.toEulerAngles();
    return {
        boneName,
        euler: [(euler.x * 180) / Math.PI, (euler.y * 180) / Math.PI, (euler.z * 180) / Math.PI],
        weight: slot.weight,
        enabled: slot.enabled,
        position: slot.pos ? [slot.pos.x, slot.pos.y, slot.pos.z] : undefined,
    };
}

/** 清除所有骨骼覆盖。 */
export function clearAllOverrides(modelId?: string): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).clear();
}

/** 获取当前所有覆盖的条目列表（用于持久化/UI 展示）。 */
export function getAllOverrides(modelId?: string): BoneOverrideEntry[] {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return [];
    }
    const map = _overrideMaps.get(mid);
    if (!map) {
        return [];
    }
    const result: BoneOverrideEntry[] = [];
    for (const [boneName, slot] of map) {
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
            position: slot.pos ? [slot.pos.x, slot.pos.y, slot.pos.z] : undefined,
        });
    }
    return result;
}

/**
 * 从持久化的条目列表批量恢复覆盖。
 */
export function restoreOverrides(entries: BoneOverrideEntry[], modelId?: string): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    const map = _getOverrideMap(mid);
    map.clear();
    for (const e of entries) {
        map.set(e.boneName, {
            quat: _eulerToQuat(e.euler[0], e.euler[1], e.euler[2]),
            weight: clamp01(e.weight),
            enabled: e.enabled,
            pos: e.position ? new Vector3(e.position[0], e.position[1], e.position[2]) : undefined,
        });
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
        // 只对当前聚焦模型生效（per-model 存储，单模型应用）
        const focusedId = _resolveModelId();
        if (!focusedId) {
            return;
        }
        const overrideMap = _overrideMaps.get(focusedId);
        if (!overrideMap || overrideMap.size === 0) {
            return;
        }
        const bones = getRuntimeBones();
        if (bones.length === 0) {
            return;
        }

        const isWasm = _isWasmRuntime(bones[0]);

        for (const [boneName, slot] of overrideMap) {
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
                // [doc:adr-116] P2 引擎扩展：slot.pos 存在时覆盖位置，否则沿用动画位置
                const pos = slot.pos ? slot.pos : oldMat.getTranslation();
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

                // [doc:adr-116] P2 引擎扩展：slot.pos 存在时覆盖位置（局部坐标）
                // 注意：JS 模式 setPosition 设的是相对父骨骼的局部位置，
                // 对根骨骼（如 センター，parent=null）等价于世界位置
                if (slot.pos) {
                    linked.setPosition(slot.pos);
                }

                // 更新骨骼世界矩阵
                (rb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);

                // 标记脏标记
                const skeleton = linked.getSkeleton();
                skeleton?._markAsDirty?.();
            }
        }
    };

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
    }
    clearAllOverrides();
}
