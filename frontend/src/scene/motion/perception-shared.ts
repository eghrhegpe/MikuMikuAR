// [doc:adr-071] 感知层共享类型、对象池与常量
// 供 perception.ts 及各 perception-*.ts 子模块复用

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { MorphTargetManager } from '@babylonjs/core/Morph/morphTargetManager';
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
    // 重心微动（[doc:adr-079] Phase 2：从 idle 躯干微晃迁入感知层）
    balanceSwayEnabled: boolean;
    // Lip-sync（从 lipsync-bridge.ts 迁入）
    lipSyncEnabled: boolean;
    lipSyncSensitivity: number; // 0..1，振幅阈值
    lipSyncIntensity: number; // 0..1，最大张嘴幅度
    lipSyncMultiMorphEnabled: boolean; // 驱动多口型 morph
    // ── 可调参数（原硬编码常量，[doc:adr-116] 暴露给用户） ──
    breathFrequency: number; // 0.1–1.0 Hz，默认 0.3
    breathAmplitude: number; // 0–0.05 rad，默认 0.02
    blinkFrequency: number; // 0.05–0.5 Hz，默认 0.15
    blinkAmplitude: number; // 0–1，默认 1.0（眨眼力度系数）
    headGazeMaxYaw: number; // 0–90°，默认 75
    headGazeMaxPitch: number; // 0–90°，默认 35
    eyeGazeMaxYaw: number; // 0–15°，默认 9
    eyeGazeMaxPitch: number; // 0–15°，默认 8
    eyeGazeSmooth: number; // 0–1，默认 0.35
    // ── 重心微动可调参数（[doc:adr-151] 暴露给用户） ──
    balanceSwayPeriod: number; // 0.5–5.0 s，默认 2.0
    balanceSwayAmplitude: number; // 0–2.0，默认 1.0（全局振幅乘数）
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
    // 可调参数默认值（与原硬编码常量一致）
    breathFrequency: 0.3,
    breathAmplitude: 0.02,
    blinkFrequency: 0.25, // 生理合理（每 4 秒一次，下界）
    blinkAmplitude: 1.0,
    headGazeMaxYaw: 75,
    headGazeMaxPitch: 35,
    eyeGazeMaxYaw: 9,
    eyeGazeMaxPitch: 8,
    eyeGazeSmooth: 0.35,
    // 重心微动可调参数默认值
    balanceSwayPeriod: 2.0,
    balanceSwayAmplitude: 1.0,
};

export interface MeshMetadata {
    skeleton?: { _markAsDirty?(): void };
}

/** MMD 模型最小接口（供 perception 子系统使用，避免 any） */
export interface MmdModelLike {
    runtimeBones: readonly IMmdRuntimeBone[];
    mesh: {
        metadata?: MeshMetadata;
        morphTargetManager?: MorphTargetManager;
    };
}

// ── 对象池（避免每帧 new Vector3/Matrix/Quaternion，消除 GC 压力） ──
// 池容量需 ≥ 单帧最大消费数，否则循环覆写会污染已外泄的引用。
// 单帧最大消费：breathing(2) + balance(8) + gaze-js head(8) + gaze-js eye(10) ≈ 28
const _v3Pool = Array.from({ length: 16 }, () => new Vector3());
const _mPool = Array.from({ length: 16 }, () => new Matrix());
const _qPool = Array.from({ length: 32 }, () => new Quaternion());
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
//
// 注意：递归内部不使用全局 _m() 池，避免深层递归时池槽被覆写导致外层数据污染。
// 骨骼链深度有限（通常 ≤10），局部 Matrix 的 GC 压力可控。
export function _propagateChildrenWasm(
    parent: IMmdRuntimeBone,
    parentOldMat: Matrix,
    parentNewMat: Matrix
): void {
    const parentOldInv = new Matrix();
    parentOldInv.copyFrom(parentOldMat);
    parentOldInv.invert();

    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) {
            continue;
        }

        const childOldMat = Matrix.FromArray(childBuf);
        const localMat = new Matrix();
        childOldMat.multiplyToRef(parentOldInv, localMat);

        const childNewMat = new Matrix();
        localMat.multiplyToRef(parentNewMat, childNewMat);

        _writeMatToBuffer(childBuf, childNewMat);
        _propagateChildrenWasm(child, childOldMat, childNewMat);
    }
}

export function _isWasmRuntime(bone: IMmdRuntimeBone): boolean {
    return !('updateWorldMatrix' in bone);
}

// ── 感知层可调角度状态（[doc:adr-116] 感知层滑块功能） ──
// 独立于 PerceptionState（避免 perception-gaze.ts 与 perception.ts 循环依赖）
// 由 perception.ts 的 setter 更新，由 perception-gaze.ts 的 clamp 函数读取

let _headGazeMaxYaw = (75 * Math.PI) / 180;
let _headGazeMaxPitch = (35 * Math.PI) / 180;
let _eyeGazeMaxYaw = (9 * Math.PI) / 180;
let _eyeGazeMaxPitch = (8 * Math.PI) / 180;
let _eyeGazeSmooth = 0.35;

/** 获取头部跟随最大偏航角（弧度） */
export function getHeadGazeMaxYaw(): number {
    return _headGazeMaxYaw;
}
/** 获取头部跟随最大俯仰角（弧度） */
export function getHeadGazeMaxPitch(): number {
    return _headGazeMaxPitch;
}
/** 获取眼部跟随最大偏航角（弧度） */
export function getEyeGazeMaxYaw(): number {
    return _eyeGazeMaxYaw;
}
/** 获取眼部跟随最大俯仰角（弧度） */
export function getEyeGazeMaxPitch(): number {
    return _eyeGazeMaxPitch;
}
/** 获取眼部跟随平滑度 */
export function getEyeGazeSmooth(): number {
    return _eyeGazeSmooth;
}

/**
 * 计算 gaze Slerp alpha（基于 deltaTime 的指数衰减，帧率无关）
 * @param smooth 平滑度（0=迟钝，1=快速）
 * @param dt 帧时间增量（秒）
 * @param timeConstant 时间常数（秒），默认 0.15
 */
export function _gazeAlpha(smooth: number, dt: number, timeConstant = 0.15): number {
    const tau = timeConstant * (1.1 - smooth);
    return Math.max(0, Math.min(1, 1 - Math.exp(-dt / tau)));
}

/** 更新头部跟随角度限位（度→弧度，由 perception.ts setter 调用） */
export function setGazeAngles(
    headYawDeg: number,
    headPitchDeg: number,
    eyeYawDeg: number,
    eyePitchDeg: number,
    eyeSmooth: number
): void {
    _headGazeMaxYaw = (headYawDeg * Math.PI) / 180;
    _headGazeMaxPitch = (headPitchDeg * Math.PI) / 180;
    _eyeGazeMaxYaw = (eyeYawDeg * Math.PI) / 180;
    _eyeGazeMaxPitch = (eyePitchDeg * Math.PI) / 180;
    _eyeGazeSmooth = eyeSmooth;
}

// ── PerceptionContext 类型（[doc:adr-162] Phase 1） ──

/** 重心微动增量状态（供 PerceptionContext.lastOffsets.balance 使用） */
export interface BalanceSwayState {
    lastBobY: number;
    swayCenterName: string | null;
    lastCenterRz: number;
    lastCenterRx: number;
    lastUpperRx: number;
    lastWaistRz: number;
    lastAllParentRx: number;
    lastAllParentRz: number;
    lastSwayTime: number;
}

/** 每模型感知上下文（替代原单例，支持焦点 + pinned 多模型） */
export interface PerceptionContext {
    modelId: string;
    state: PerceptionState;
    isActive: boolean;
    isPinned: boolean;
    lastOffsets: {
        breath: number;
        balance: BalanceSwayState;
        emotion: string | null;
    };
}

// ── [doc:adr-164] Phase 1 — 性能档位与监控 ──

export type PerceptionTier = 'high' | 'medium' | 'low';

/** 感知层性能监控器：三档自动降级 + 手动覆盖 */
export class PerceptionPerfMonitor {
    fps = 60;
    modelCount = 0;
    tier: PerceptionTier = 'high';

    private _manualTier: PerceptionTier | 'auto' = 'auto';
    private _frameCounter = 0;
    private _sampleInterval = 30;
    private _lowStreak = 0;
    private _highStreak = 0;
    private _thresholdDown = 45;
    private _thresholdUp = 55;
    private _framesForDown = 60;
    private _framesForUp = 120;
    private _forceLowModelCount = 50;
    private _forceHighModelCount = 20;

    /** 每帧调用（内部按 _sampleInterval 采样 fps） */
    update(scene: { getEngine(): { getFps(): number } } | null, modelCount: number): void {
        this.modelCount = modelCount;
        this._frameCounter++;

        // 手动覆盖优先
        if (this._manualTier !== 'auto') {
            this.tier = this._manualTier;
            return;
        }

        // 模型数硬边界
        if (modelCount > this._forceLowModelCount) {
            this.tier = 'low';
            this._lowStreak = 0;
            this._highStreak = 0;
            return;
        }
        if (modelCount <= this._forceHighModelCount) {
            this.tier = 'high';
            this._lowStreak = 0;
            this._highStreak = 0;
            return;
        }

        // 采样 fps
        if (this._frameCounter % this._sampleInterval !== 0) {
            return;
        }

        const fps = scene?.getEngine().getFps() ?? 60;
        this.fps = fps;

        if (fps < this._thresholdDown) {
            this._lowStreak += this._sampleInterval;
            this._highStreak = 0;
        } else if (fps > this._thresholdUp) {
            this._highStreak += this._sampleInterval;
            this._lowStreak = 0;
        } else {
            // 45–55 之间：稳定带，不累积 streak（避免边缘抖动）
            this._lowStreak = 0;
            this._highStreak = 0;
        }

        // 降级（滞后 60 帧）
        if (this._lowStreak >= this._framesForDown) {
            this.tier = this._stepDown(this.tier);
            this._lowStreak = 0;
        }
        // 升级（滞后 120 帧，更保守）
        if (this._highStreak >= this._framesForUp) {
            this.tier = this._stepUp(this.tier);
            this._highStreak = 0;
        }
    }

    getTier(): PerceptionTier {
        return this.tier;
    }

    setManualTier(tier: PerceptionTier | 'auto'): void {
        this._manualTier = tier;
        if (tier !== 'auto') {
            this.tier = tier;
        } else {
            // 切回 auto 时立即根据当前模型数重新评估（fps 采样需等下一帧）
            if (this.modelCount <= this._forceHighModelCount) {
                this.tier = 'high';
            } else if (this.modelCount > this._forceLowModelCount) {
                this.tier = 'low';
            }
            // 否则保持当前 tier，等 fps 采样自然调整
        }
        this._lowStreak = 0;
        this._highStreak = 0;
    }

    private _stepDown(t: PerceptionTier): PerceptionTier {
        if (t === 'high') return 'medium';
        if (t === 'medium') return 'low';
        return 'low';
    }

    private _stepUp(t: PerceptionTier): PerceptionTier {
        if (t === 'low') return 'medium';
        if (t === 'medium') return 'high';
        return 'high';
    }
}
