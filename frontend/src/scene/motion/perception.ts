// [doc:adr-071] Perception Layer — 角色感知系统（呼吸/眨眼/视线追踪）
// 职责: Always-on 实时叠加，独立于 VMD 生命周期
// 模块: 呼吸（躯干骨骼正弦微动）、眨眼（morph 权重脉冲）、头部跟随、眼部跟随
//
// 本文件为感知层主入口（barrel + 状态管理 + observer 调度）。
// 各功能实现见 perception-*.ts 子模块。

import type { Observer } from '@babylonjs/core/Misc/observable';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { modelManager, focusedModelId, scene, triggerAutoSave } from '../scene';

import {
    type Emotion,
    type PerceptionState,
    type GazeConfig,
    type MeshMetadata,
    DEFAULT_PERCEPTION_STATE,
    _writeMatToBuffer,
    _propagateChildrenWasm,
    _isWasmRuntime,
} from './perception-shared';
import { _applyBreathing } from './perception-breathing';
import { _applyBlinking } from './perception-blinking';
import { _applyMicroExpression, _resetLastEmotionMorphName } from './perception-expression';
import { _applyBalanceSway, _resetBalanceSwayState } from './perception-balance';
import { _applyLipSync } from './perception-lipsync';
import {
    _applyGaze,
    _clampHeadGazeTarget,
    _clampEyeGazeTarget,
    applyGazeWasm,
} from './perception-gaze';

// ── re-export（保持外部导入路径不变） ──
export type { Emotion, PerceptionState, GazeConfig };
export {
    _writeMatToBuffer,
    _propagateChildrenWasm,
    _isWasmRuntime,
    _clampHeadGazeTarget,
    _clampEyeGazeTarget,
    applyGazeWasm,
};

// ── 感知状态 ──

let perceptionState: PerceptionState = { ...DEFAULT_PERCEPTION_STATE };
let perceptionModelId: string | null = null;
let perceptionObserver: Observer<any> | null = null;

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
    _resetBalanceSwayState();

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
        _applyMicroExpression(
            mmdModel,
            time,
            perceptionState.microExpressionEnabled,
            perceptionState.emotion
        );

        // 4. 重心微动（无条件调用，内部处理关闭复位）
        _applyBalanceSway(mmdModel, time, perceptionState.balanceSwayEnabled);

        // 5. Lip-sync（无条件调用，内部处理关闭复位）
        _applyLipSync(
            mmdModel,
            time,
            perceptionState.lipSyncEnabled,
            perceptionModelId,
            perceptionState
        );

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
    _resetLastEmotionMorphName(); // 模型切换时清空，避免旧 morph 名残留
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
