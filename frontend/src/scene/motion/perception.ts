// [doc:adr-071] Perception Layer — 角色感知系统（呼吸/眨眼/视线追踪）
// 职责: Always-on 实时叠加，独立于 VMD 生命周期
// 模块: 呼吸（躯干骨骼正弦微动）、眨眼（morph 权重脉冲）、头部跟随、眼部跟随

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { modelManager, focusedModelId, scene } from '../scene';
import { isARActive } from '../ar/ar-camera';

// ── WASM/JS 运行时差异的本地类型声明 ──
// babylon-mmd 的 IMmdRuntimeBone 接口未声明 worldMatrix 和 updateWorldMatrix，
// 但 WASM 与 JS 运行时在运行时均提供这些成员。
interface MmdRuntimeBoneExtended extends IMmdRuntimeBone {
    worldMatrix: Float32Array;
    updateWorldMatrix(updateAbsoluteTransform: boolean, updateLocalTransform: boolean): void;
}

interface MeshMetadata {
    skeleton?: { _markAsDirty?(): void };
}

// ── 感知状态（独立于 ProcMotionState） ──
export interface PerceptionState {
    breathEnabled: boolean;
    blinkEnabled: boolean;
    headTrackingEnabled: boolean;
    eyeTrackingEnabled: boolean;
}

/** Gaze 配置类型 */
export type GazeConfig = { headEnabled: boolean; eyeEnabled: boolean };

const DEFAULT_PERCEPTION_STATE: PerceptionState = {
    breathEnabled: true,
    blinkEnabled: true,
    headTrackingEnabled: true,
    eyeTrackingEnabled: true,
};

let perceptionState: PerceptionState = { ...DEFAULT_PERCEPTION_STATE };
let perceptionModelId: string | null = null;
let perceptionObserver: Observer<any> | null = null;

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

function _v3(): Vector3 {
    return _v3Pool[_v3Idx++ % _v3Pool.length];
}
function _m(): Matrix {
    return _mPool[_mIdx++ % _mPool.length];
}
function _q(): Quaternion {
    return _qPool[_qIdx++ % _qPool.length];
}

// ── 呼吸参数 ──
const BREATH_FREQ = 0.3; // Hz
const BREATH_AMP = 0.02; // radians

// ── 眨眼参数 ──
const BLINK_FREQ = 0.15; // Hz
const BLINK_MORPH_NAME = 'eyeClose';

// ── 眼球追踪平滑系数（0=完全平滑，1=无平滑） ──
const EYE_SMOOTH = 0.35;

// ── AR 模式视线距离（米） ──
const AR_GAZE_DISTANCE = 1.5;

// ══════════════════════════════════════════════════════════════
// 公共 API
// ══════════════════════════════════════════════════════════════

/** 激活感知层（呼吸/眨眼/gaze） */
export function activatePerception(modelId?: string): void {
    const targetId = modelId ?? focusedModelId ?? null;
    if (!targetId) {
        console.warn('[perception] activate: 无目标模型 ID');
        return;
    }

    const inst = modelManager.get(targetId);
    if (!inst?.mmdModel) {
        console.warn('[perception] activate: 模型未加载或无 mmdModel');
        return;
    }

    // 避免重复激活
    if (perceptionModelId === targetId && perceptionObserver) {
        return;
    }

    // 注销旧 observer
    deactivatePerception();

    perceptionModelId = targetId;
    const mmdModel = inst.mmdModel;

    // ── 注册统一 observer ──
    perceptionObserver = scene.onBeforeRenderObservable.add(() => {
        const time = performance.now() / 1000;

        // 1. 呼吸
        if (perceptionState.breathEnabled) {
            _applyBreathing(mmdModel, time);
        }

        // 2. 眨眼
        if (perceptionState.blinkEnabled) {
            _applyBlinking(mmdModel, time);
        }

        // 3. 头部跟随 + 眼部跟随（gaze）
        if (perceptionState.headTrackingEnabled || perceptionState.eyeTrackingEnabled) {
            const cam = scene.activeCamera;
            if (cam) {
                _applyGaze(mmdModel, cam, {
                    headEnabled: perceptionState.headTrackingEnabled,
                    eyeEnabled: perceptionState.eyeTrackingEnabled,
                });
            }
        }
    });

    console.log(
        `[perception] 激活: 模型=${targetId} 呼吸=${perceptionState.breathEnabled} 眨眼=${perceptionState.blinkEnabled} 头=${perceptionState.headTrackingEnabled} 眼=${perceptionState.eyeTrackingEnabled}`
    );
}

/** 注销感知层 */
export function deactivatePerception(): void {
    if (perceptionObserver) {
        scene.onBeforeRenderObservable.remove(perceptionObserver);
        perceptionObserver = null;
    }
    perceptionModelId = null;
    console.log('[perception] 已注销');
}

/** 获取感知状态 */
export function getPerceptionState(): PerceptionState {
    return { ...perceptionState };
}

/** 设置感知状态（从存储恢复时使用） */
export function setPerceptionState(s: Partial<PerceptionState>): void {
    perceptionState = { ...perceptionState, ...s };
}

/** 设置呼吸开关 */
export function setBreathEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, breathEnabled: v };
}

/** 设置眨眼开关 */
export function setBlinkEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, blinkEnabled: v };
}

/** 设置头部跟随开关 */
export function setHeadTrackingEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, headTrackingEnabled: v };
}

/** 设置眼部跟随开关 */
export function setEyeTrackingEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, eyeTrackingEnabled: v };
}

// ══════════════════════════════════════════════════════════════
// 呼吸实现
// ══════════════════════════════════════════════════════════════

function _applyBreathing(mmdModel: any, time: number): void {
    const phase = time * BREATH_FREQ * 2 * Math.PI;
    const breathOffset = BREATH_AMP * Math.sin(phase);

    // 查找躯干骨骼（上半身/下半身）
    const spine = mmdModel.runtimeBones.find(
        (b: IMmdRuntimeBone) => b.name === '上半身' || b.name === '上半身2'
    );
    if (!spine) return;

    // 写入局部旋转（linkedBone 方式，与 gaze 一致）
    const localQ = spine.linkedBone.rotationQuaternion.clone();
    const targetQ = Quaternion.RotationAxis(Vector3.Up(), breathOffset);
    Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);

    spine.linkedBone.rotationQuaternion = localQ;

    // 触发骨骼链重算（JS 模式）
    if ('updateWorldMatrix' in spine) {
        (spine as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        for (const child of spine.childBones) {
            _updateBoneChain(child);
        }
    }
}

function _updateBoneChain(bone: IMmdRuntimeBone): void {
    if ('updateWorldMatrix' in bone) {
        (bone as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        for (const child of bone.childBones) {
            _updateBoneChain(child);
        }
    }
}

// ══════════════════════════════════════════════════════════════
// 眨眼实现
// ══════════════════════════════════════════════════════════════

function _applyBlinking(mmdModel: any, time: number): void {
    const phase = time * BLINK_FREQ * 2 * Math.PI;
    // 脉冲形态：sin(phase) - 0.8 后取 max(0, ...) * 5，产生周期性尖峰
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5;

    // 查找 eyeClose morph
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    const eyeClose = morphManager.getMorphTargetByName?.(BLINK_MORPH_NAME);
    if (eyeClose) {
        eyeClose.influence = blinkIntensity;
    }
}

// ══════════════════════════════════════════════════════════════
// 视线追踪实现（从 proc-motion-bridge.ts 迁移）
// ══════════════════════════════════════════════════════════════

function _applyGaze(
    mmdModel: any,
    cam: Camera,
    config: { headEnabled: boolean; eyeEnabled: boolean }
): void {
    if (!config.headEnabled && !config.eyeEnabled) return;

    const headRuntime = mmdModel.runtimeBones.find(
        (b: IMmdRuntimeBone) => b.name === '頭' || b.name === '首' || b.name === 'head' || b.name === 'Head'
    );
    const eyeRuntimes: IMmdRuntimeBone[] = mmdModel.runtimeBones.filter((b: IMmdRuntimeBone) =>
        ['右目', '左目', 'Eye_R', 'Eye_L', 'eye_r', 'eye_l', 'RightEye', 'LeftEye'].includes(b.name)
    );

    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;
    if (!needHead && !needEye) return;

    const isWasm = _isWasmRuntime(headRuntime ?? eyeRuntimes[0]);
    const gazeTarget = _getGazeTarget(cam, _v3());

    if (isWasm) {
        // WASM 模式：直写 frontBuffer + 递归传播子骨骼
        if (needHead && headRuntime) {
            _applyHeadGazeWasm(headRuntime, gazeTarget);
        }
        if (needEye) {
            _applyEyeGazeWasm(eyeRuntimes, gazeTarget);
        }
    } else {
        // JS 模式：改 linkedBone + updateWorldMatrix
        if (needHead && headRuntime) {
            _applyHeadGazeJS(headRuntime, gazeTarget);
        }
        if (needEye) {
            _applyEyeGazeJS(eyeRuntimes, gazeTarget);
        }
        // 触发 skeleton 重算
        const skeleton = (mmdModel.mesh.metadata as MeshMetadata)?.skeleton;
        skeleton?._markAsDirty?.();
    }
}

export function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return !('updateWorldMatrix' in bone);
}

function _getGazeTarget(cam: Camera, out: Vector3): Vector3 {
    if (isARActive()) {
        // AR 模式：视线目标 = 相机位置 + 相机朝向 × 估算距离
        const forward = cam.getDirection(Vector3.Forward());
        out.copyFrom(cam.position);
        out.addInPlace(forward.scale(AR_GAZE_DISTANCE));
        return out;
    }
    out.copyFrom(cam.position);
    return out;
}

// ── WASM 模式：头部跟随 ──
function _applyHeadGazeWasm(headRuntime: IMmdRuntimeBone, gazeTarget: Vector3): void {
    const headBuf = (headRuntime as MmdRuntimeBoneExtended).worldMatrix;
    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headBuf));
    const headPos = oldHeadMat.getTranslation();
    const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));

    const lookDir = headPos.subtractToRef(gazeTarget, _v3());
    const lookLen = Math.sqrt(lookDir.x ** 2 + lookDir.y ** 2 + lookDir.z ** 2);
    if (lookLen <= 0.0001) return;

    lookDir.scaleInPlace(1 / lookLen);
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));
    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5));

    const newHeadMat = _m().copyFrom(Matrix.Compose(Vector3.One(), blended, headPos));
    _writeMatToBuffer(headBuf, newHeadMat);

    _propagateChildrenWasm(headRuntime, oldHeadMat, newHeadMat);
}

// ── WASM 模式：眼部跟随 ──
function _applyEyeGazeWasm(eyeRuntimes: IMmdRuntimeBone[], gazeTarget: Vector3): void {
    const eyeCenter = _v3();
    for (const eyeRb of eyeRuntimes) {
        const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        eyeCenter.x += eb[12];
        eyeCenter.y += eb[13];
        eyeCenter.z += eb[14];
    }
    eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

    const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
    if (lookDir.lengthSquared() < 0.0001) return;

    lookDir.normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    for (const eyeRb of eyeRuntimes) {
        const eyeBuf = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeBuf));
        const eyePos = eyeMat.getTranslation();
        const curEyeQ = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));

        const newEyeQ = _q().copyFrom(Quaternion.Slerp(curEyeQ, targetWorldQ, EYE_SMOOTH));
        const newEyeMat = _m().copyFrom(Matrix.Compose(Vector3.One(), newEyeQ, eyePos));

        _writeMatToBuffer(eyeBuf, newEyeMat);
        _propagateChildrenWasm(eyeRb, eyeMat, newEyeMat);
    }
}

// ── JS 模式：头部跟随 ──
function _applyHeadGazeJS(headRuntime: IMmdRuntimeBone, gazeTarget: Vector3): void {
    const headPos = _v3();
    headRuntime.getWorldTranslationToRef(headPos);

    const oldHeadMat = _m().copyFrom(Matrix.FromArray(headRuntime.worldMatrix));
    const oldHeadRotQ = _q().copyFrom(Quaternion.FromRotationMatrix(oldHeadMat.getRotationMatrix()));

    const lookDir = headPos.subtractToRef(gazeTarget, _v3()).normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));
    const blended = _q().copyFrom(Quaternion.Slerp(oldHeadRotQ, targetWorldQ, 0.5));

    // 世界旋转 → 局部旋转（左乘父骨骼世界逆）
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
    parentInvQ.multiplyToRef(blended, localQ);

    headRuntime.linkedBone.rotationQuaternion = localQ;

    // 递归重算骨骼链
    _updateBoneChain(headRuntime);
}

// ── JS 模式：眼部跟随 ──
function _applyEyeGazeJS(eyeRuntimes: IMmdRuntimeBone[], gazeTarget: Vector3): void {
    const eyeCenter = _v3();
    for (const eyeRb of eyeRuntimes) {
        const eb = (eyeRb as MmdRuntimeBoneExtended).worldMatrix;
        eyeCenter.x += eb[12];
        eyeCenter.y += eb[13];
        eyeCenter.z += eb[14];
    }
    eyeCenter.scaleInPlace(1 / eyeRuntimes.length);

    const lookDir = eyeCenter.subtractToRef(gazeTarget, _v3());
    if (lookDir.lengthSquared() < 0.0001) return;

    lookDir.normalize();
    const targetWorldQ = _q().copyFrom(Quaternion.FromLookDirectionRH(lookDir, Vector3.UpReadOnly));

    for (const eyeRb of eyeRuntimes) {
        const eyeMat = _m().copyFrom(Matrix.FromArray(eyeRb.worldMatrix));
        const curWorldQ = _q().copyFrom(Quaternion.FromRotationMatrix(eyeMat.getRotationMatrix()));
        const newWorldQ = _q().copyFrom(Quaternion.Slerp(curWorldQ, targetWorldQ, EYE_SMOOTH));

        // 世界旋转 → 局部旋转
        const parentBone = eyeRb.parentBone;
        const parentWorldInv = _m();
        if (parentBone) {
            const parentMat = _m().copyFrom(Matrix.FromArray(parentBone.worldMatrix));
            parentMat.invertToRef(parentWorldInv);
        } else {
            Matrix.IdentityToRef(parentWorldInv);
        }

        const parentInvQ = Quaternion.FromRotationMatrix(parentWorldInv);
        const localQ = _q();
        parentInvQ.multiplyToRef(newWorldQ, localQ);

        eyeRb.linkedBone.rotationQuaternion = localQ;
        (eyeRb as MmdRuntimeBoneExtended).updateWorldMatrix?.(false, false);
    }
}

// ── WASM 辅助：把 Matrix 写回 Float32Array(16) ──
export function _writeMatToBuffer(buf: Float32Array, m: Matrix): void {
    const a = m.asArray();
    for (let i = 0; i < 16; ++i) {
        buf[i] = a[i];
    }
}

// ── WASM 辅助：递归传播子骨骼 worldMatrix ──
// 数学推导：
//   childWorld = childLocal × parentWorld
//   childLocal = childWorld × parentWorld⁻¹ = childOldMat × parentOldInv
//   childNewWorld = childLocal × parentNewMat = localMat × parentNewMat
export function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = new Matrix().copyFrom(parentOldMat);
    parentOldInv.invert();

    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) continue;

        const childOldMat = Matrix.FromArray(childBuf);
        const localMat = new Matrix();
        childOldMat.multiplyToRef(parentOldInv, localMat);

        const childNewMat = new Matrix();
        localMat.multiplyToRef(parentNewMat, childNewMat);

        _writeMatToBuffer(childBuf, childNewMat);
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

// ══════════════════════════════════════════════════════════════
// 兼容层：供 proc-motion-bridge.ts 调用（过渡期）
// ══════════════════════════════════════════════════════════════

/** 兼容接口：设置 gaze 配置（供 proc-motion-bridge.ts 调用） */
export function setGazeConfig(headEnabled: boolean, eyeEnabled: boolean): void {
    perceptionState = {
        ...perceptionState,
        headTrackingEnabled: headEnabled,
        eyeTrackingEnabled: eyeEnabled,
    };
}

/** 兼容接口：模型移除时清理（供 proc-motion-bridge.ts 调用） */
export function onPerceptionModelRemoved(id: string): void {
    if (perceptionModelId === id) {
        deactivatePerception();
    }
}

/** 导出类型供 wasm-layers-blender.ts 使用 */
export type { MmdRuntimeBoneExtended };

/** WASM 模式下的 gaze 应用（供 wasm-layers-blender.ts 调用） */
export function applyGazeWasm(
    bones: readonly IMmdRuntimeBone[],
    cam: Camera,
    config: GazeConfig
): void {
    if (!config.headEnabled && !config.eyeEnabled) return;

    const headRuntime = bones.find((b) => b.name === '頭' || b.name === '首');
    const eyeRuntimes = bones.filter((b) => b.name.includes('目'));
    const needHead = config.headEnabled && !!headRuntime;
    const needEye = config.eyeEnabled && eyeRuntimes.length > 0;

    if (!needHead && !needEye) return;

    const gazeTarget = _getGazeTarget(cam, _v3());

    if (needHead && headRuntime) {
        _applyHeadGazeWasm(headRuntime, gazeTarget);
    }

    if (needEye) {
        _applyEyeGazeWasm(eyeRuntimes, gazeTarget);
    }
}