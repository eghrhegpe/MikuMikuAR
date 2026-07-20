// [doc:architecture] Bone Override — 逐骨骼覆盖系统
// 职责: 维护 overrideMap，在动画后逐骨骼覆盖局部旋转，支持 Quaternion.Slerp 混合
// 与 ADR-051 boneFilter 互补：boneFilter=屏蔽动画，Override=设定目标值
// 依赖: scene.ts (懒加载避免循环依赖)

import { Quaternion, Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { clamp01 } from '@/core/utils';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { getMotionPipeline } from './motion-pipeline';
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
    /**
     * [doc:adr-116 P1] 是否覆盖动画旋转。
     * - true：按 weight 混合/硬覆盖旋转（setBoneOverride / setBoneOverrideQuat 设置）
     * - false：沿用动画旋转，仅叠加位置偏移（setBoneOverridePosition 设置）
     * undefined 视为 false（安全默认：绝不静默抹除动画旋转）
     */
    overrideRotation?: boolean;
}

// ── 管理器（per-model） ──

let _observerHandle: (() => void) | null = null; // 已注册层的 unregister 句柄
let _driverHandle: ObserverHandle | null = null; // 单一驱动 observer 句柄
let _driverScene: import('@babylonjs/core/scene').Scene | null = null; // 驱动所绑定的 scene（随重建更新）
const _overrideMaps = new Map<string, Map<string, _OverrideSlot>>();
/** [doc:adr-116 P3] 每帧钩子条目：由时间驱动模块（sway/riding/hand-symmetry）注册，渲染回调每帧调用。
 *  原实现用 Set 按插入序遍历，钩子间同骨获胜者依赖模块注册次序（隐式定序，R2 病灶）。
 *  改为带 order 的数组并按 order 升序执行，顺序由声明决定，与注册时序解耦。 */
interface _FrameHookEntry {
    order: number;
    hook: (timeSec: number, modelId: string) => void;
}
const _frameHooks: _FrameHookEntry[] = [];
let _frameHooksSorted = false;
const _qPool = [new Quaternion(), new Quaternion(), new Quaternion(), new Quaternion()];
let _qIdx = 0;
function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

// ── Matrix / Vector3 复用池（WASM 路径，消除每帧 Matrix.FromArray / new Matrix 分配） ──
// 所有 _m() / _v() 调用必须在同一帧的 callback 内完成，帧首 _mReset() / _vReset() 重置计数器。
// 池大小 8192 = 5 根覆盖骨 × (3 主路径 + 4 × ~400 子骨传播)，安全覆盖任何 MMD 模型。
// 若 _mIdx 溢出则回绕并 warn（安全兜底，不应发生）。
const _mPool = Array.from({ length: 8192 }, () => new Matrix());
let _mIdx = 0;
function _m(): Matrix {
    if (_mIdx >= _mPool.length) {
        console.warn('[bone-override] _mPool 溢出，回绕。请增大池大小。');
        _mIdx = 0;
    }
    return _mPool[_mIdx++];
}
function _mReset(): void {
    _mIdx = 0;
}

const _vPool = Array.from({ length: 8 }, () => new Vector3());
let _vIdx = 0;
function _v(): Vector3 {
    return _vPool[_vIdx++ % _vPool.length];
}
function _vReset(): void {
    _vIdx = 0;
}

/** 复用常量，避免 Matrix.ComposeToRef 每次 new Vector3(1,1,1) */
const _ONE = new Vector3(1, 1, 1);

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
    const invMat = _m();
    invMat.copyFrom(parentOldMat);
    invMat.invert();
    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }
        const childOldMat = _m();
        Matrix.FromArrayToRef(childBuf, 0, childOldMat);
        const localMat = _m();
        childOldMat.multiplyToRef(invMat, localMat);
        const childNewMat = _m();
        localMat.multiplyToRef(parentNewMat, childNewMat);
        // 写回 worldMatrix buffer（copyToArray 避免 new Float32Array 分配）
        childNewMat.copyToArray(childBuf, 0);
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

// ── 纯函数：单槽覆盖合成（P1 抽离，便于单元测试） ──

/** 覆盖槽的最小形态，供 _computeOverride 接收（与内部 _OverrideSlot 结构兼容） */
export interface OverrideSlotLike {
    quat: Quaternion;
    weight: number;
    pos?: Vector3;
    overrideRotation?: boolean;
}

/**
 * [doc:adr-116 P1] 计算单槽覆盖后的平移与旋转。
 * - 平移：slot.pos 存在时 = 动画平移 + 偏移（加法语义）；否则沿用动画平移。
 * - 旋转：仅当 overrideRotation 为 true 才覆盖；否则沿用动画旋转。
 * 抽离为纯函数，无需真实骨骼运行时即可单测。
 */
export function _computeOverride(
    oldTranslation: Vector3,
    oldRotation: Quaternion,
    slot: OverrideSlotLike
): { translation: Vector3; rotation: Quaternion } {
    const translation = slot.pos ? oldTranslation.add(slot.pos) : oldTranslation;
    const rotation = slot.overrideRotation
        ? slot.weight >= 1
            ? oldRotation.multiply(slot.quat) // 复合：父骨传播旋转 × 本骨覆盖，不丢失父骨变换
            : Quaternion.Slerp(oldRotation, slot.quat, slot.weight)
        : oldRotation;
    return { translation, rotation };
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
    const map = _getOverrideMap(mid);
    const existing = map.get(boneName);
    map.set(boneName, {
        quat: _eulerToQuat(euler[0], euler[1], euler[2]),
        weight: clamp01(weight),
        enabled,
        // [doc:adr-116 P1] 保留既有位置覆盖，避免旋转覆盖静默清除位置
        pos: existing?.pos,
        overrideRotation: true,
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
    const map = _getOverrideMap(mid);
    const existing = map.get(boneName);
    map.set(boneName, {
        quat: quat.clone(),
        weight: clamp01(weight),
        enabled,
        // [doc:adr-116 P1] 保留既有位置覆盖，避免旋转覆盖静默清除位置
        pos: existing?.pos,
        overrideRotation: true,
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
        // 新建 slot：旋转用 Identity 且 overrideRotation=false（不覆盖动画旋转），仅叠加位置偏移
        slot = {
            quat: Quaternion.Identity(),
            weight: clamp01(weight),
            enabled,
            overrideRotation: false,
        };
        map.set(boneName, slot);
    }
    slot.pos = new Vector3(position[0], position[1], position[2]);
    slot.weight = clamp01(weight);
    slot.enabled = enabled;
    // overrideRotation 保持原值：若既有 slot 由 setBoneOverride 创建（旋转覆盖）则保留 true；
    // 若本就为位置覆盖则保持 false。勿在此处强制赋值，以免破坏「旋转+位置」组合覆盖。
}

/** 清除指定骨骼的覆盖。 */
export function clearBoneOverride(boneName: string, modelId?: string): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).delete(boneName);
}

/** [doc:adr-116] 将运行时 slot 转为持久化条目（getOverride / getAllOverrides 共用，避免重复反推欧拉角） */
function _slotToEntry(boneName: string, slot: _OverrideSlot): BoneOverrideEntry {
    const euler = slot.quat.toEulerAngles();
    return {
        boneName,
        euler: [(euler.x * 180) / Math.PI, (euler.y * 180) / Math.PI, (euler.z * 180) / Math.PI],
        weight: slot.weight,
        enabled: slot.enabled,
        position: slot.pos ? [slot.pos.x, slot.pos.y, slot.pos.z] : undefined,
    };
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
    return _slotToEntry(boneName, slot);
}

/** 清除所有骨骼覆盖。 */
export function clearAllOverrides(modelId?: string): void {
    const mid = _resolveModelId(modelId);
    if (!mid) {
        return;
    }
    _getOverrideMap(mid).clear();
}

/**
 * [doc:adr-116 P3] 注册每帧渲染钩子。
 * 时间驱动模块（sway/riding/hand-symmetry）用以逐帧更新自身骨骼覆盖（如正弦摇摆、踏板循环、手部对称）。
 * 钩子签名 (timeSec, modelId)：timeSec 为 performance.now()/1000（秒）。
 * 返回注销函数，模块 disable/卸载时必须调用以避免泄漏。
 *
 * @param order 同帧内执行序（升序优先）。治理 R2：取代原 Set 插入序的隐式定序，
 *   使「同骨获胜者」由声明顺序决定，不依赖模块注册先后。建议从 {@link FRAME_HOOK_ORDER} 取值。
 */
export const FRAME_HOOK_ORDER = {
    /** 下肢/骑行踏板：身体基础姿态，最先写入 */
    RIDING: 10,
    /** 身体摇摆：在下肢之上叠加 */
    SWAY: 20,
    /** 手部对称：上肢末端，最后写入 */
    HAND_SYMMETRY: 30,
} as const;

export function registerBoneOverrideFrameHook(
    hook: (timeSec: number, modelId: string) => void,
    order = 0
): () => void {
    const entry: _FrameHookEntry = { order, hook };
    _frameHooks.push(entry);
    _frameHooksSorted = false;
    return () => {
        const idx = _frameHooks.indexOf(entry);
        if (idx >= 0) {
            _frameHooks.splice(idx, 1);
        }
    };
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
        result.push(_slotToEntry(boneName, slot));
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
            // [doc:adr-116 P1] 含位置字段的条目必为位置覆盖（来自 setBoneOverridePosition），
            // 不应覆盖动画旋转；纯旋转条目（手动覆盖）overrideRotation=true。
            overrideRotation: !e.position,
        });
    }
}

// ── 渲染循环钩子 ──

/** [doc:adr-116 P3] 执行每帧钩子（时间驱动模块在此更新自身 slot）。
 *  按 order 升序遍历（治理 R2 隐式定序）；快照遍历以支持钩子执行期间安全注销/注册。 */
function _runFrameHooks(focusedId: string): void {
    const t = performance.now() / 1000;
    if (!_frameHooksSorted) {
        _frameHooks.sort((a, b) => a.order - b.order);
        _frameHooksSorted = true;
    }
    for (const entry of _frameHooks.slice()) {
        entry.hook(t, focusedId);
    }
}

/** WASM 单骨覆盖：直写 worldMatrix（使用池复用，零分配） */
function _applyWasmOverride(slot: _OverrideSlot, rb: IMmdRuntimeBone): void {
    const buf = (rb as MmdRuntimeBoneExtended).worldMatrix;
    if (!buf) {
        return;
    }
    const oldMat = _m();
    Matrix.FromArrayToRef(buf, 0, oldMat);
    const oldT = _v();
    oldMat.getTranslationToRef(oldT);
    const rotMat = _m();
    oldMat.getRotationMatrixToRef(rotMat);
    const oldQ = _q();
    Quaternion.FromRotationMatrixToRef(rotMat, oldQ);
    const { translation, rotation } = _computeOverride(oldT, oldQ, slot);
    const newMat = _m();
    Matrix.ComposeToRef(_ONE, rotation, translation, newMat);
    newMat.copyToArray(buf, 0);
    _propagateChildrenWasm(rb, oldMat, newMat);
}

/** JS 单骨覆盖：写 linkedBone rotationQuaternion / position */
function _applyJsOverride(slot: _OverrideSlot, rb: IMmdRuntimeBone): void {
    // IMmdRuntimeBone.linkedBone 已声明为 IMmdRuntimeLinkedBone (duck-typed abstraction)，
    // 但运行时 babylon-mmd MmdRuntimeBone 的 linkedBone 是完整的 Babylon.js Bone 实例。
    // 此处保留一小步类型断言以获取 getSkeleton() 等原生 Bone API。
    // [doc:adr-116 P1] 旋转覆盖使用 linked (IMmdRuntimeLinkedBone) 的 rotationQuaternion,
    //         位置覆盖 / skeleton dirty 用 bone (Babylon Bone) 的 getPosition/setPosition/getSkeleton。
    const linked = rb.linkedBone;
    // 运行时守卫：极边缘情况下 linkedBone 可能为 null（如骨架未完全初始化）

    if (!linked) {
        return;
    }
    const bone = linked as unknown as import('@babylonjs/core/Bones/bone').Bone;

    // [doc:adr-116 P1] 旋转覆盖：复合当前旋转 × 覆盖旋转，不丢失父骨传播变换（与 WASM 路径 _computeOverride 一致）
    if (slot.overrideRotation) {
        const cur = linked.rotationQuaternion ?? Quaternion.Identity();
        if (slot.weight >= 1) {
            linked.rotationQuaternion = cur.multiply(slot.quat);
        } else {
            const target = cur.multiply(slot.quat);
            linked.rotationQuaternion = Quaternion.Slerp(cur, target, slot.weight);
        }
    }

    // 位置覆盖：叠加偏移（加法语义）
    if (slot.pos) {
        const curPos = bone.getPosition();
        curPos.addInPlace(slot.pos);
        bone.setPosition(curPos);
    }

    // 更新骨骼世界矩阵
    (rb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);

    // 标记脏标记
    const skeleton = bone.getSkeleton();
    skeleton?._markAsDirty?.();
}

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
        // 帧首重置 Matrix/Vector3 池（WASM 路径复用，避免每帧分配）
        _mReset();
        _vReset();

        // 只对当前聚焦模型生效（per-model 存储，单模型应用）
        const focusedId = _resolveModelId();
        if (!focusedId) {
            return;
        }

        _runFrameHooks(focusedId);

        const overrideMap = _overrideMaps.get(focusedId);
        if (!overrideMap || overrideMap.size === 0) {
            return;
        }
        const bones = getRuntimeBones();
        if (bones.length === 0) {
            return;
        }

        // 构建 boneName → bone 索引（O(1) 查找，替代 O(n²) bones.find）
        const boneMap = new Map<string, IMmdRuntimeBone>();
        for (const b of bones) {
            boneMap.set(b.name, b);
        }
        const isWasm = _isWasmRuntime(bones[0]);

        for (const [boneName, slot] of overrideMap) {
            if (!slot.enabled) {
                continue;
            }
            const rb = boneMap.get(boneName);
            if (!rb) {
                continue;
            }
            if (isWasm) {
                _applyWasmOverride(slot, rb);
            } else {
                _applyJsOverride(slot, rb);
            }
        }
    };

    // 单一驱动 observer：每帧按 (stage, order) 显式调度所有骨骼写入层，
    // 取代原先 bone-override 与 perception 各自注册 onBeforeRenderObservable 的隐式定序（治理 R1）
    if (!_driverHandle || _driverScene !== scene) {
        _driverHandle = safeDispose(_driverHandle);
        _driverScene = scene;
        _driverHandle = observe(scene.onBeforeRenderObservable, () => getMotionPipeline().runFrame({ scene }));
    }
    _observerHandle = getMotionPipeline().register({
        id: 'bone-override',
        stage: 'bone-override',
        order: 0,
        run: callback,
    });
}

/** 停止覆盖系统。 */
export function stopBoneOverride(): void {
    if (_observerHandle) {
        _observerHandle();
        _observerHandle = null;
    }
    // 释放单一驱动 observer，避免 stop 后每帧仍触发 runFrame（残留旧场景 observer 泄漏；ADR-147 审核 P2）
    _driverHandle = safeDispose(_driverHandle);
    _driverScene = null;
    _frameHooks.length = 0;
    _frameHooksSorted = false;
    clearAllOverrides();
}
