// [doc:adr-071] Perception Layer — 角色感知系统（呼吸/眨眼/视线追踪）
// 职责: Always-on 实时叠加，独立于 VMD 生命周期
// 模块: 呼吸（躯干骨骼正弦微动）、眨眼（morph 权重脉冲）、头部跟随、眼部跟随
//
// 本文件为感知层主入口（barrel + 状态管理 + observer 调度）。
// 各功能实现见 perception-*.ts 子模块。

import type { Scene } from '@babylonjs/core/scene';
import { getMotionPipeline } from './motion-pipeline';

import { modelManager, focusedModelId, triggerAutoSave } from '../scene';
// scene 实例走 env-impl 的 getScene() 延迟获取，避免与 scene.ts 形成静态循环依赖
// (scene.ts → proc-motion-bridge.ts → perception.ts → scene.ts)
import { getScene } from '../env/env-impl';

import {
    type Emotion,
    type PerceptionState,
    type GazeConfig,
    DEFAULT_PERCEPTION_STATE,
    _writeMatToBuffer,
    _propagateChildrenWasm,
    _isWasmRuntime,
    _gazeAlpha,
    setGazeAngles,
} from './perception-shared';
import {
    _applyGaze,
    _clampHeadGazeTarget,
    _clampEyeGazeTarget,
    applyGazeWasm,
} from './perception-gaze';
import { _applyBreathing, _resetBreathingState } from './perception-breathing';
import { _applyBlinking } from './perception-blinking';
import { _applyMicroExpression, _resetLastEmotionMorphName } from './perception-expression';
import { _applyBalanceSway, _resetBalanceSwayState } from './perception-balance';
import { clamp01 } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { _applyLipSync } from './perception-lipsync';

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
let perceptionObserver: (() => void) | null = null;

// ══════════════════════════════════════════════════════════════
// 公共 API
// ══════════════════════════════════════════════════════════════

/** 激活感知层（呼吸/眨眼/gaze） */
export function activatePerception(modelId?: string): void {
    const targetId = modelId ?? focusedModelId ?? null;
    if (!targetId) {
        logWarn('perception', 'activate: 无目标模型 ID');
        return;
    }

    const inst = modelManager.get(targetId);
    if (!inst?.mmdModel) {
        logWarn('perception', 'activate: 模型未加载或无 mmdModel');
        return;
    }

    // 避免重复激活
    if (perceptionModelId === targetId && perceptionObserver) {
        return;
    }

    // 注销旧 observer
    deactivatePerception();

    // 重置 balance / breathing / gaze 增量状态，避免跨模型残留（与 _resetLastEmotionMorphName 同款守卫）
    _resetBalanceSwayState();
    _resetBreathingState();
    _resetGazeState();

    perceptionModelId = targetId;
    const mmdModel = inst.mmdModel;

    // ── 注册为管线层（stage=perception，显式保证在 bone-override 之后执行，根治 R1 双观察者隐式定序）──
    // 顺序约束：breath → blink → micro → balance → lipsync → gaze
    // gaze 必须最后（读 balance/breath 写入后的骨骼状态）；
    // lipsync 在 micro 之后（避免 smile morph 覆写冲突）。
    // 单帧异常不中断下游（try/catch 包裹每步）。
    perceptionObserver = getMotionPipeline().register({
        id: 'perception',
        stage: 'perception',
        order: 0,
        run: () => {
        const scene = getScene();
        if (!scene || scene.isDisposed) {
            return;
        }
        // 模型 dispose 后 observer 仍可能触发一帧：mmdModel 已销毁则注销自身，避免访问已释放骨骼
        if (!mmdModel || mmdModel.mesh?.isDisposed()) {
            deactivatePerception();
            return;
        }
        const time = performance.now() / 1000;

        // 1. 呼吸
        if (perceptionState.breathEnabled) {
            try {
                _applyBreathing(mmdModel, time);
            } catch (e) {
                logWarn('perception', 'breathing 异常:', (e as Error)?.message);
            }
        }

        // 2. 眨眼
        if (perceptionState.blinkEnabled) {
            try {
                _applyBlinking(mmdModel, time);
            } catch (e) {
                logWarn('perception', 'blinking 异常:', (e as Error)?.message);
            }
        }

        // 3. 微表情（无条件调用，内部处理关闭/neutral 复位）
        try {
            _applyMicroExpression(
                mmdModel,
                time,
                perceptionState.microExpressionEnabled,
                perceptionState.emotion
            );
        } catch (e) {
            logWarn('perception', 'micro-expression 异常:', (e as Error)?.message);
        }

        // 4. 重心微动（balance sway，[doc:adr-079] Phase 2）
        //    内部使用 delta 增量叠加，不会覆盖 VMD/Bone Override 的躯干基准旋转
        try {
            _applyBalanceSway(
                mmdModel,
                time,
                perceptionState.balanceSwayEnabled,
                perceptionState.balanceSwayPeriod,
                perceptionState.balanceSwayAmplitude
            );
        } catch (e) {
            logWarn('perception', 'balance-sway 异常:', (e as Error)?.message);
        }

        // 5. Lip-sync（无条件调用，内部处理关闭复位）
        try {
            _applyLipSync(
                mmdModel,
                time,
                perceptionState.lipSyncEnabled,
                perceptionModelId,
                perceptionState
            );
        } catch (e) {
            logWarn('perception', 'lipsync 异常:', (e as Error)?.message);
        }

        // 6. 头部跟随 + 眼部跟随（gaze）
        if (perceptionState.headTrackingEnabled || perceptionState.eyeTrackingEnabled) {
            const cam = getScene().activeCamera;
            if (cam) {
                try {
                    const dt = scene.getEngine().getDeltaTime() / 1000;
                    _applyGaze(mmdModel, cam, {
                        headEnabled: perceptionState.headTrackingEnabled,
                        eyeEnabled: perceptionState.eyeTrackingEnabled,
                    }, dt);
                } catch (e) {
                    logWarn('perception', 'gaze 异常:', (e as Error)?.message);
                }
            }
        }
    },
    });

    logWarn(
        'perception',
        `激活: 模型=${targetId} 呼吸=${perceptionState.breathEnabled} 眨眼=${perceptionState.blinkEnabled} 头=${perceptionState.headTrackingEnabled} 眼=${perceptionState.eyeTrackingEnabled}`
    );
}

/** 重置 gaze 增量状态（无持久化状态，仅清理临时变量） */
export function _resetGazeState(): void {
    // gaze 不累积旋转偏移，每帧重新计算 targetQ；
    // 本函数作为生命周期守卫，在 activate/deactivate/开关切换时调用，确保无残留
}

/** 注销感知层 */
export function deactivatePerception(): void {
    if (perceptionObserver) {
        perceptionObserver();
        perceptionObserver = null;
    }
    _resetLastEmotionMorphName(); // 模型切换时清空，避免旧 morph 名残留
    _resetBalanceSwayState(); // 重置 balance 增量状态，避免跨模型残留导致塌地
    _resetBreathingState(); // 重置 breathing 增量状态，避免跨模型残留导致旋转冻结
    _resetGazeState(); // 重置 gaze 状态，避免关闭后重新开启出现跳跃
    perceptionModelId = null;
    logWarn('perception', '已注销');
}

/** 获取感知状态 */
export function getPerceptionState(): PerceptionState {
    return { ...perceptionState };
}

/** 设置感知状态（从存储恢复时使用） */
export function setPerceptionState(s: Partial<PerceptionState>): void {
    perceptionState = { ...perceptionState, ...s };
    // 检测角度参数变化，同步到 perception-shared（避免循环依赖）
    if (
        'headGazeMaxYaw' in s ||
        'headGazeMaxPitch' in s ||
        'eyeGazeMaxYaw' in s ||
        'eyeGazeMaxPitch' in s ||
        'eyeGazeSmooth' in s
    ) {
        _syncGazeAngles();
    }
    triggerAutoSave();
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
    _resetGazeState();
    triggerAutoSave();
}

/** 设置眼部跟随开关 */
export function setEyeTrackingEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, eyeTrackingEnabled: v };
    _resetGazeState();
    triggerAutoSave();
}

/** 设置微表情开关 */
export function setMicroExpressionEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, microExpressionEnabled: v };
    triggerAutoSave();
}

/** 设置重心微动开关（[doc:adr-079] Phase 2） */
export function setBalanceSwayEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, balanceSwayEnabled: v };
    triggerAutoSave();
}

/** 设置重心微动周期（秒，钳制 0.5–5.0） */
export function setBalanceSwayPeriod(v: number): void {
    perceptionState = { ...perceptionState, balanceSwayPeriod: Math.max(0.5, Math.min(5.0, v)) };
    triggerAutoSave();
}

/** 设置重心微动振幅（全局乘数，钳制 0–2.0） */
export function setBalanceSwayAmplitude(v: number): void {
    perceptionState = { ...perceptionState, balanceSwayAmplitude: Math.max(0, Math.min(2.0, v)) };
    triggerAutoSave();
}

/** 设置情绪类型 */
export function setEmotion(v: Emotion): void {
    perceptionState = { ...perceptionState, emotion: v };
    triggerAutoSave();
}

/** 设置 lip-sync 开关 */
export function setLipSyncEnabled(enabled: boolean): void {
    perceptionState = { ...perceptionState, lipSyncEnabled: enabled };
    triggerAutoSave();
}

/** 设置 lip-sync 灵敏度（钳制 0..1） */
export function setLipSyncSensitivity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncSensitivity: clamp01(v) };
    triggerAutoSave();
}

/** 设置 lip-sync 强度（钳制 0..1） */
export function setLipSyncIntensity(v: number): void {
    perceptionState = { ...perceptionState, lipSyncIntensity: clamp01(v) };
    triggerAutoSave();
}

/** 设置多口型 morph 开关 */
export function setLipSyncMultiMorphEnabled(v: boolean): void {
    perceptionState = { ...perceptionState, lipSyncMultiMorphEnabled: v };
    triggerAutoSave();
}

// ── 可调参数 setter（[doc:adr-116] 感知层滑块功能） ──

/** 设置呼吸频率（Hz，钳制 0.1–1.0） */
export function setBreathFrequency(v: number): void {
    perceptionState = { ...perceptionState, breathFrequency: Math.max(0.1, Math.min(1.0, v)) };
    triggerAutoSave();
}

/** 设置呼吸幅度（弧度，钳制 0–0.05） */
export function setBreathAmplitude(v: number): void {
    perceptionState = { ...perceptionState, breathAmplitude: Math.max(0, Math.min(0.05, v)) };
    triggerAutoSave();
}

/** 设置眨眼频率（Hz，钳制 0.05–0.5） */
export function setBlinkFrequency(v: number): void {
    perceptionState = { ...perceptionState, blinkFrequency: Math.max(0.05, Math.min(0.5, v)) };
    triggerAutoSave();
}

/** 设置眨眼幅度（0–1，钳制） */
export function setBlinkAmplitude(v: number): void {
    perceptionState = { ...perceptionState, blinkAmplitude: Math.max(0, Math.min(1, v)) };
    triggerAutoSave();
}

/** 设置头部跟随最大偏航角（度，钳制 0–90） */
export function setHeadGazeMaxYaw(v: number): void {
    perceptionState = { ...perceptionState, headGazeMaxYaw: Math.max(0, Math.min(90, v)) };
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置头部跟随最大俯仰角（度，钳制 0–90） */
export function setHeadGazeMaxPitch(v: number): void {
    perceptionState = { ...perceptionState, headGazeMaxPitch: Math.max(0, Math.min(90, v)) };
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随最大偏航角（度，钳制 0–15） */
export function setEyeGazeMaxYaw(v: number): void {
    perceptionState = { ...perceptionState, eyeGazeMaxYaw: Math.max(0, Math.min(15, v)) };
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随最大俯仰角（度，钳制 0–15） */
export function setEyeGazeMaxPitch(v: number): void {
    perceptionState = { ...perceptionState, eyeGazeMaxPitch: Math.max(0, Math.min(15, v)) };
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随平滑度（0–1） */
export function setEyeGazeSmooth(v: number): void {
    perceptionState = { ...perceptionState, eyeGazeSmooth: Math.max(0, Math.min(1, v)) };
    _syncGazeAngles();
    triggerAutoSave();
}

/** 同步角度到 perception-shared 模块（避免循环依赖） */
function _syncGazeAngles(): void {
    setGazeAngles(
        perceptionState.headGazeMaxYaw,
        perceptionState.headGazeMaxPitch,
        perceptionState.eyeGazeMaxYaw,
        perceptionState.eyeGazeMaxPitch,
        perceptionState.eyeGazeSmooth
    );
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
