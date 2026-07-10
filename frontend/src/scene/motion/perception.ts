// [doc:adr-071] Perception Layer — 角色感知系统（呼吸/眨眼/视线追踪）
// 职责: Always-on 实时叠加，独立于 VMD 生命周期
// 模块: 呼吸（躯干骨骼正弦微动）、眨眼（morph 权重脉冲）、头部跟随、眼部跟随

import { Quaternion, Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { modelManager, focusedModelId, scene, triggerAutoSave } from '../scene';
import { isARActive } from '../ar/ar-camera';
import { getProcBeatDetector } from './proc-motion-bridge';
import { isAudioPlaying, getAudioPath } from '@/outfit/audio';
import { findLipMorph, findAllLipMorphs, amplitudeToWeight } from '@/motion-algos/lipsync';
import {
    BONE_UPPER_CANDIDATES,
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    MORPH_BLINK_CANDIDATES,
    matchBone,
} from '../../motion-algos/proc-motion-shared';

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
    lipSyncSensitivity: number;  // 0..1，振幅阈值
    lipSyncIntensity: number;    // 0..1，最大张嘴幅度
    lipSyncMultiMorphEnabled: boolean;  // 驱动多口型 morph
}

/** Gaze 配置类型 */
export type GazeConfig = { headEnabled: boolean; eyeEnabled: boolean };

const DEFAULT_PERCEPTION_STATE: PerceptionState = {
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

    // 重置重心微动增量状态（避免跨模型/重激活残留导致塌地）
    _lastBobY = 0;
    _swayCenterName = null;
    _lastCenterRz = 0;
    _lastCenterRx = 0;
    _lastUpperRx = 0;
    _lastWaistRz = 0;
    _lastAllParentRx = 0;
    _lastAllParentRz = 0;

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

        // 3. 微表情（无条件调用，内部处理关闭/neutral 复位）
        _applyMicroExpression(mmdModel, time, perceptionState.microExpressionEnabled, perceptionState.emotion);

        // 4. 重心微动（无条件调用，内部处理关闭复位）
        _applyBalanceSway(mmdModel, time, perceptionState.balanceSwayEnabled);

        // 5. Lip-sync（无条件调用，内部处理关闭复位）
        _applyLipSync(mmdModel, time, perceptionState.lipSyncEnabled);

        // 6. 头部跟随 + 眼部跟随（gaze）
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
    _lastEmotionMorphName = null; // 模型切换时清空，避免旧 morph 名残留
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
    triggerAutoSave();
}

/** 设置眨眼开关 */
export function setBlinkEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, blinkEnabled: v };
    triggerAutoSave();
}

/** 设置头部跟随开关 */
export function setHeadTrackingEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, headTrackingEnabled: v };
    triggerAutoSave();
}

/** 设置眼部跟随开关 */
export function setEyeTrackingEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, eyeTrackingEnabled: v };
    triggerAutoSave();
}

/** 设置微表情开关 */
export function setMicroExpressionEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, microExpressionEnabled: v };
    triggerAutoSave();
}

/** 设置情绪类型 */
export function setEmotion(v: Emotion): void {
    perceptionState = { ...perceptionState, emotion: v };
    triggerAutoSave();
}

/** 设置重心微动开关 */
export function setBalanceSwayEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, balanceSwayEnabled: v };
    triggerAutoSave();
}

/** 设置 lip-sync 开关 */
export function setLipSyncEnabled(enabled: boolean): void {
    perceptionState = { ...perceptionState, lipSyncEnabled: enabled };
    triggerAutoSave();
}

/** 设置 lip-sync 灵敏度（钳制 0..1） */
export function setLipSyncSensitivity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncSensitivity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

/** 设置 lip-sync 强度（钳制 0..1） */
export function setLipSyncIntensity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncIntensity: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

/** 设置多口型 morph 开关 */
export function setLipSyncMultiMorphEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, lipSyncMultiMorphEnabled: v };
    triggerAutoSave();
}

// ══════════════════════════════════════════════════════════════
// 呼吸实现
// ══════════════════════════════════════════════════════════════

function _applyBreathing(mmdModel: any, time: number): void {
    const phase = time * BREATH_FREQ * 2 * Math.PI;
    const breathOffset = BREATH_AMP * Math.sin(phase);

    const boneNames = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const spineName = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const spine = spineName
        ? mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === spineName)
        : null;
    if (!spine) return;

    const targetQ = _q().copyFrom(Quaternion.RotationAxis(Vector3.Up(), breathOffset));
    const localQ = _q().copyFrom(spine.linkedBone.rotationQuaternion);
    Quaternion.SlerpToRef(localQ, targetQ, 0.5, localQ);

    spine.linkedBone.rotationQuaternion = localQ;

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
    const blinkIntensity = Math.max(0, Math.sin(phase) - 0.8) * 5;

    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    const morphNames = morphManager.getMorphTargetNames?.() || [];
    const blinkName = matchBone(morphNames, MORPH_BLINK_CANDIDATES);
    if (!blinkName) return;

    const eyeClose = morphManager.getMorphTargetByName?.(blinkName);
    if (eyeClose) {
        eyeClose.influence = blinkIntensity;
    }
}

// ══════════════════════════════════════════════════════════════
// 微表情实现（情绪 morph 实时脉冲）
// ══════════════════════════════════════════════════════════════

/** 情绪 → morph 名候选（按优先级降序匹配，复用 matchBone） */
const EMOTION_MORPH_CANDIDATES: Record<Exclude<Emotion, 'neutral'>, string[]> = {
    happy: ['笑み', 'Smile', 'smile', 'にっこり', 'Happy'],
    sad: ['困り', 'Troubled', 'troubled', '悲しい', 'Sad'],
    surprised: ['驚き', 'Surprised', 'surprised', 'びっくり', 'Surprise'],
    angry: ['怒り', 'Angry', 'angry', '怒', 'Angry2'],
};

/** 微表情脉冲周期（秒） */
const MICRO_EXPR_PERIOD = 4.0;
/** 微表情脉冲峰值权重 */
const MICRO_EXPR_PEAK = 0.12;

/** 上次写入的 morph 名（用于关闭/切换情绪时复位，防止残留冻结） */
let _lastEmotionMorphName: string | null = null;

function _applyMicroExpression(
    mmdModel: any,
    time: number,
    enabled: boolean,
    emotion: Emotion
): void {
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    // 关闭或 neutral：复位上次 morph 并退出（防止非零权重定格）
    if (!enabled || emotion === 'neutral') {
        if (_lastEmotionMorphName) {
            const old = morphManager.getMorphTargetByName?.(_lastEmotionMorphName);
            if (old) old.influence = 0;
            _lastEmotionMorphName = null;
        }
        return;
    }

    const candidates = EMOTION_MORPH_CANDIDATES[emotion];
    if (!candidates || candidates.length === 0) return;

    // 复用 matchBone 匹配候选 morph 名（与 _applyBlinking 同款模式）
    const morphNames = morphManager.getMorphTargetNames?.() || [];
    const targetName = matchBone(morphNames, candidates);
    if (!targetName) return;

    const targetMorph = morphManager.getMorphTargetByName?.(targetName);
    if (!targetMorph) return;

    // 情绪切换时复位旧 morph（如 happy→angry，清零笑み防串味）
    if (_lastEmotionMorphName && _lastEmotionMorphName !== targetName) {
        const old = morphManager.getMorphTargetByName?.(_lastEmotionMorphName);
        if (old) old.influence = 0;
    }

    // 周期性脉冲：sin²(t * 2π / period) 在 [0,1] 间振荡，乘以峰值权重
    const phase = (time % MICRO_EXPR_PERIOD) / MICRO_EXPR_PERIOD; // [0,1)
    const pulse = Math.sin(phase * Math.PI * 2) ** 2; // [0,1]
    const weight = pulse * MICRO_EXPR_PEAK;

    // 写入 morph 权重（与 _applyBlinking 的 influence 赋值一致）
    targetMorph.influence = weight;
    _lastEmotionMorphName = targetName;
}

// ══════════════════════════════════════════════════════════════
// 重心微动实现（躯干骨骼平衡微晃，从 proc-motion-idle.ts 迁移）
// ══════════════════════════════════════════════════════════════

/** 重心微动周期（秒，从 idle loopFrames=120@60fps 转换：120/60=2s） */
const BALANCE_SWAY_PERIOD = 2.0;
/** 重心微动各骨骼振幅（从 idle 算法提取，intensity 固定 1.0） */
const SWAY_AMP = {
    center_rz: 0.1,      // center 慢速摆动
    center_rx: 0.03,     // center 微动
    center_bobY: 0.04,   // center 上下浮动
    upper2_rx: 0.015,    // 上半身2 前后倾
    waist_rz: 0.02,      // 腰 左右摆
    allParent_rx: 0.005, // 全ての親 微倾
    allParent_rz: 0.005,
};

/** 上次写入的骨骼名（用于关闭时复位 position，防止残留冻结，与微表情复位逻辑同款） */
let _lastBalanceSwayBones: string[] = [];
/** 上次写入 center 的 bobY 偏移，用于增量撤销（避免直接改写 position.y 吃掉基准导致塌地） */
let _lastBobY = 0;
/** 受重心微动影响的 center 骨骼名，用于关闭时精确撤销 */
let _swayCenterName: string | null = null;

/** Rotation 增量跟踪（避免 Slerp 平均吃掉非零基准旋转 / VMD 旋转） */
let _lastCenterRz = 0;
let _lastCenterRx = 0;
let _lastUpperRx = 0;
let _lastWaistRz = 0;
let _lastAllParentRx = 0;
let _lastAllParentRz = 0;

function _applyBalanceSway(mmdModel: any, time: number, enabled: boolean): void {
    const boneNames: string[] = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const centerName = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Name = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistName = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentName = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    // 关闭时撤销 center position 的 bob 残留（恢复真实基准 position.y，避免塌到地面）
    if (!enabled) {
        if (_lastBobY !== 0 && _swayCenterName) {
            const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === _swayCenterName);
            if (bone?.linkedBone) {
                bone.linkedBone.position.y -= _lastBobY;
            }
        }
        _lastBobY = 0;
        _swayCenterName = null;
        _lastBalanceSwayBones = [];
        return;
    }

    const phase = (time % BALANCE_SWAY_PERIOD) / BALANCE_SWAY_PERIOD * Math.PI * 2;
    const slowPhase = phase * 0.5;
    const written: string[] = [];

    // center: position bobY + rotation rz/rx
    if (centerName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === centerName);
        if (bone?.linkedBone) {
            const bobY = Math.sin(phase) * SWAY_AMP.center_bobY;
            // 增量叠加：先撤上帧 bob，再加本帧 bob，保持基准 position.y 不变（修复塌到地面）
            bone.linkedBone.position.y = bone.linkedBone.position.y - _lastBobY + bobY;
            _lastBobY = bobY;
            _swayCenterName = centerName;

            const rz = Math.sin(slowPhase) * SWAY_AMP.center_rz;
            const rx = Math.sin(phase * 0.37 + 0.5) * SWAY_AMP.center_rx;
            // rotation 增量叠加（deltaQ * currentQ，避免 Slerp 平均吃掉基准旋转）
            const deltaCenterRz = rz - _lastCenterRz;
            const deltaCenterRx = rx - _lastCenterRx;
            if (deltaCenterRz !== 0 || deltaCenterRx !== 0) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(deltaCenterRx, 0, deltaCenterRz));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                localQ.multiplyToRef(deltaQ, localQ);
                bone.linkedBone.rotationQuaternion = localQ;
            }
            _lastCenterRz = rz;
            _lastCenterRx = rx;
            written.push(centerName);
        }
    }

    // upper2: rotation rx
    if (upper2Name) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === upper2Name);
        if (bone?.linkedBone) {
            const rx = Math.sin(phase * 0.7 + 0.3) * SWAY_AMP.upper2_rx;
            const deltaRx = rx - _lastUpperRx;
            if (deltaRx !== 0) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(deltaRx, 0, 0));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                localQ.multiplyToRef(deltaQ, localQ);
                bone.linkedBone.rotationQuaternion = localQ;
            }
            _lastUpperRx = rx;
            written.push(upper2Name);
        }
    }

    // waist: rotation rz
    if (waistName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === waistName);
        if (bone?.linkedBone) {
            const rz = Math.sin(phase + 0.5) * SWAY_AMP.waist_rz;
            const deltaRz = rz - _lastWaistRz;
            if (deltaRz !== 0) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(0, 0, deltaRz));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                localQ.multiplyToRef(deltaQ, localQ);
                bone.linkedBone.rotationQuaternion = localQ;
            }
            _lastWaistRz = rz;
            written.push(waistName);
        }
    }

    // allParent: rotation rx/rz
    if (allParentName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === allParentName);
        if (bone?.linkedBone) {
            const rx = Math.sin(phase * 0.2 + 1.1) * SWAY_AMP.allParent_rx;
            const rz = Math.sin(phase * 0.3 + 2.3) * SWAY_AMP.allParent_rz;
            const deltaRx = rx - _lastAllParentRx;
            const deltaRz = rz - _lastAllParentRz;
            if (deltaRx !== 0 || deltaRz !== 0) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(deltaRx, 0, deltaRz));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                localQ.multiplyToRef(deltaQ, localQ);
                bone.linkedBone.rotationQuaternion = localQ;
            }
            _lastAllParentRx = rx;
            _lastAllParentRz = rz;
            written.push(allParentName);
        }
    }

    _lastBalanceSwayBones = written;
}

// ══════════════════════════════════════════════════════════════
// Lip-sync 实现（口型同步，从 lipsync-bridge.ts 迁移）
// ══════════════════════════════════════════════════════════════

/** 人声频段范围（与 lipsync-bridge.ts 一致） */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;
const HIGH_BIN_START = 25;
const HIGH_BIN_END = 50;

/** lip-sync 状态机（从 lipsync-bridge.ts 搬运：音源切换重置 + 静音指数衰减 + 低通滤波 + morph 缓存） */
let _lipSyncMorphName: string | null = null;
let _lipSyncMorphSet: { open: string | null; close: string | null; pucker: string | null; smile: string | null } | null = null;
let _lastLipSyncModelId: string | null = null;
let _lastLipSyncMorphNames: string[] = [];
let _lastLipSyncMorphNameSet = new Set<string>();
let _smoothLow = 0;
let _smoothHigh = 0;
let _lastLipSyncAudioPath = '';

function _applyLipSync(mmdModel: any, time: number, enabled: boolean): void {
    const morphManager = mmdModel.mesh?.morphTargetManager;
    if (!morphManager) return;

    // 关闭时复位 morph influence（防残留冻结，与 _applyMicroExpression 同款）
    if (!enabled) {
        if (_lipSyncMorphName) {
            const old = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
            if (old) old.influence = 0;
        }
        if (_lipSyncMorphSet?.smile) {
            const oldSmile = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
            if (oldSmile) oldSmile.influence = 0;
        }
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        return;
    }

    // #10: 音源切换 → 立即重置状态
    if (getAudioPath() !== _lastLipSyncAudioPath) {
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
        _smoothLow = 0;
        _smoothHigh = 0;
        _lastLipSyncAudioPath = getAudioPath();
    }

    // #12: 音频停止时指数衰减（约 20 帧淡出）
    if (!isAudioPlaying()) {
        _smoothLow *= 0.85;
        _smoothHigh *= 0.85;
        if (_smoothLow < 0.005 && _smoothHigh < 0.005) {
            _smoothLow = 0;
            _smoothHigh = 0;
            if (_lipSyncMorphName) {
                const morph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
                if (morph) morph.influence = 0;
            }
            return;
        }
        // 仍在衰减期：继续以衰减值应用 morph 权重
    }

    // morph 名缓存：仅 modelId 变化时重建（消除每帧 O(M) 扫描）
    const modelId = perceptionModelId;
    if (modelId !== _lastLipSyncModelId) {
        _lastLipSyncModelId = modelId;
        const morphNames = morphManager.getMorphTargetNames?.() || [];
        _lastLipSyncMorphNames = morphNames;
        _lastLipSyncMorphNameSet = new Set(morphNames);
        _lipSyncMorphName = null;
        _lipSyncMorphSet = null;
    }

    // 查找口型 morph（仅首次或 modelId 变化时）
    if (!_lipSyncMorphName || !_lastLipSyncMorphNameSet.has(_lipSyncMorphName)) {
        _lipSyncMorphName = findLipMorph(_lastLipSyncMorphNames);
        _lipSyncMorphSet = findAllLipMorphs(_lastLipSyncMorphNames);
    }
    if (!_lipSyncMorphName) return;

    // 从 BeatDetector 取频段能量
    const beatDetector = getProcBeatDetector();
    const lowLevel = beatDetector ? beatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const highLevel = beatDetector ? beatDetector.getLevel(HIGH_BIN_START, HIGH_BIN_END) : 0;

    // 低通滤波（音频播放时才平滑，衰减期保留衰减值）
    if (isAudioPlaying()) {
        _smoothLow = _smoothLow * 0.7 + lowLevel * 0.3;
        _smoothHigh = _smoothHigh * 0.7 + highLevel * 0.3;
    }

    // open morph（あ）
    const openWeight = amplitudeToWeight(
        _smoothLow,
        perceptionState.lipSyncSensitivity,
        perceptionState.lipSyncIntensity
    );
    const openMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphName);
    if (openMorph) openMorph.influence = openWeight;

    // 多口型 morph（close 反比 + pucker 高频驱动）
    if (perceptionState.lipSyncMultiMorphEnabled && _lipSyncMorphSet) {
        // close：与 open 反比（嘴开时 close=0，嘴闭时 close=1）
        if (_lipSyncMorphSet.close) {
            const closeWeight = amplitudeToWeight(
                1 - _smoothLow,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const closeMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.close);
            if (closeMorph) closeMorph.influence = closeWeight;
        }
        // pucker：由高频能量驱动（模拟「う」口型）
        if (_lipSyncMorphSet.pucker) {
            const puckerWeight = amplitudeToWeight(
                _smoothHigh * 0.8,
                perceptionState.lipSyncSensitivity,
                perceptionState.lipSyncIntensity
            );
            const puckerMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.pucker);
            if (puckerMorph) puckerMorph.influence = puckerWeight;
        }
    }

    // smile：高频能量大时轻微微笑（模拟说话表情）
    if (_lipSyncMorphSet?.smile) {
        const smileWeight = Math.max(0, openWeight * 0.3 - 0.1);
        const smileMorph = morphManager.getMorphTargetByName?.(_lipSyncMorphSet.smile);
        if (smileMorph) smileMorph.influence = smileWeight;
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
    const parentOldInv = _m().copyFrom(parentOldMat);
    parentOldInv.invert();

    for (const child of parent.childBones) {
        const childBuf = (child as MmdRuntimeBoneExtended).worldMatrix;
        if (!childBuf) continue;

        const childOldMat = Matrix.FromArrayToRef(childBuf, 0, _m());
        const localMat = _m();
        childOldMat.multiplyToRef(parentOldInv, localMat);

        const childNewMat = _m();
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
    triggerAutoSave();
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