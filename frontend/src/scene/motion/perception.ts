// [doc:adr-071] Perception Layer — 角色感知系统（呼吸/眨眼/视线追踪）
// 职责: Always-on 实时叠加，独立于 VMD 生命周期
// 模块: 呼吸（躯干骨骼正弦微动）、眨眼（morph 权重脉冲）、头部跟随、眼部跟随
//
// 本文件为感知层主入口（barrel + 状态管理 + observer 调度）。
// 各功能实现见 perception-*.ts 子模块。
// [doc:adr-162] Phase 1: 单例 → Map<modelId, PerceptionContext>

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
    type PerceptionContext,
    type BalanceSwayState,
    type MmdModelLike,
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
export type { Emotion, PerceptionState, GazeConfig, PerceptionContext, BalanceSwayState };
export {
    _writeMatToBuffer,
    _propagateChildrenWasm,
    _isWasmRuntime,
    _clampHeadGazeTarget,
    _clampEyeGazeTarget,
    applyGazeWasm,
};

// ── 感知状态（[doc:adr-162] Phase 1: Map<modelId, Context>） ──

/** 当无焦点模型时的状态回退（兼容旧单例行为） */
let _fallbackState: PerceptionState = { ...DEFAULT_PERCEPTION_STATE };
/** 每模型感知上下文 */
let _contexts = new Map<string, PerceptionContext>();
/** 当前焦点模型 ID */
let _focusedContextId: string | null = null;
let perceptionObserver: (() => void) | null = null;

// ══════════════════════════════════════════════════════════════
// 内部 helpers
// ══════════════════════════════════════════════════════════════

function _getOrCreateContext(modelId: string): PerceptionContext {
    let ctx = _contexts.get(modelId);
    if (!ctx) {
        ctx = {
            modelId,
            state: { ..._fallbackState },
            isActive: false,
            isPinned: false,
            lastOffsets: {
                breath: 0,
                balance: {
                    lastBobY: 0,
                    swayCenterName: null,
                    lastCenterRz: 0,
                    lastCenterRx: 0,
                    lastUpperRx: 0,
                    lastWaistRz: 0,
                    lastAllParentRx: 0,
                    lastAllParentRz: 0,
                    lastSwayTime: 0,
                },
                emotion: null,
            },
        };
        _contexts.set(modelId, ctx);
    }
    return ctx;
}

/** 获取焦点上下文的状态（无焦点时回退到 fallback） */
function _getFocusedState(): PerceptionState {
    if (!_focusedContextId) {
        return _fallbackState;
    }
    return _contexts.get(_focusedContextId)?.state ?? _fallbackState;
}

/** 直接替换焦点上下文状态（用于 setPerceptionState 批量更新） */
function _setFocusedState(partial: Partial<PerceptionState>): void {
    if (_focusedContextId) {
        const ctx = _contexts.get(_focusedContextId);
        if (ctx) {
            ctx.state = { ...ctx.state, ...partial };
        }
    } else {
        _fallbackState = { ..._fallbackState, ...partial };
    }
}

/** 局部更新焦点上下文状态（用于各单项 setter） */
function _updateFocusedState(partial: Partial<PerceptionState>): void {
    _setFocusedState(partial);
}

/** 重置指定 context 的 lastOffsets（激活/注销时调用，避免跨模型残留） */
function _resetContextOffsets(ctx: PerceptionContext): void {
    ctx.lastOffsets.breath = 0;
    ctx.lastOffsets.balance = {
        lastBobY: 0,
        swayCenterName: null,
        lastCenterRz: 0,
        lastCenterRx: 0,
        lastUpperRx: 0,
        lastWaistRz: 0,
        lastAllParentRx: 0,
        lastAllParentRz: 0,
        lastSwayTime: 0,
    };
    ctx.lastOffsets.emotion = null;
}

/** 对单个 context 应用完整感知管线（[doc:adr-162] Phase 2 抽取） */
function _applyPerceptionForContext(
    ctx: PerceptionContext,
    mmdModel: MmdModelLike,
    time: number,
    dt: number
): void {
    const state = ctx.state;

    // 1. 呼吸
    if (state.breathEnabled) {
        try {
            _applyBreathing(mmdModel, time);
        } catch (e) {
            logWarn('perception', 'breathing 异常:', (e as Error)?.message);
        }
    }

    // 2. 眨眼
    if (state.blinkEnabled) {
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
            state.microExpressionEnabled,
            state.emotion
        );
    } catch (e) {
        logWarn('perception', 'micro-expression 异常:', (e as Error)?.message);
    }

    // 4. 重心微动（balance sway，[doc:adr-079] Phase 2）
    try {
        _applyBalanceSway(
            mmdModel,
            time,
            state.balanceSwayEnabled,
            state.balanceSwayPeriod,
            state.balanceSwayAmplitude
        );
    } catch (e) {
        logWarn('perception', 'balance-sway 异常:', (e as Error)?.message);
    }

    // 5. Lip-sync（无条件调用，内部处理关闭复位）
    try {
        _applyLipSync(
            mmdModel,
            time,
            state.lipSyncEnabled,
            ctx.modelId,
            state
        );
    } catch (e) {
        logWarn('perception', 'lipsync 异常:', (e as Error)?.message);
    }

    // 6. 头部跟随 + 眼部跟随（gaze）
    if (state.headTrackingEnabled || state.eyeTrackingEnabled) {
        const cam = getScene().activeCamera;
        if (cam) {
            try {
                _applyGaze(mmdModel, cam, {
                    headEnabled: state.headTrackingEnabled,
                    eyeEnabled: state.eyeTrackingEnabled,
                }, dt);
            } catch (e) {
                logWarn('perception', 'gaze 异常:', (e as Error)?.message);
            }
        }
    }
}

/** 注销单个 context（供 observer 遍历中发现模型已 dispose 时调用） */
function _deactivateContext(modelId: string): void {
    const ctx = _contexts.get(modelId);
    if (!ctx) return;
    ctx.isActive = false;
    if (_focusedContextId === modelId) {
        _focusedContextId = null;
    }
}

// ══════════════════════════════════════════════════════════════
// 公共 API
// ══════════════════════════════════════════════════════════════

/** 确保 perception observer 已注册（供 activatePerception / pinPerception 复用） */
function _ensureObserverRegistered(): void {
    if (perceptionObserver) return;

    perceptionObserver = getMotionPipeline().register({
        id: 'perception',
        stage: 'perception',
        order: 0,
        run: () => {
            const scene = getScene();
            if (!scene || scene.isDisposed) {
                return;
            }
            const time = performance.now() / 1000;
            const dt = (scene.getEngine?.().getDeltaTime?.() ?? 0) / 1000;

            for (const ctx of _contexts.values()) {
                if (!ctx.isActive) continue;
                const inst = modelManager.get(ctx.modelId);
                if (!inst?.mmdModel || inst.mmdModel.mesh?.isDisposed()) {
                    if (_focusedContextId === ctx.modelId) {
                        deactivatePerception();
                    } else {
                        _deactivateContext(ctx.modelId);
                    }
                    continue;
                }
                _applyPerceptionForContext(ctx, inst.mmdModel, time, dt);
            }
        },
    });
}

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

    // 避免重复激活同一焦点模型
    if (_focusedContextId === targetId && perceptionObserver) {
        return;
    }

    const hasPinned = Array.from(_contexts.values()).some((c) => c.isPinned && c.isActive);

    // 如果正在切换焦点，处理旧焦点（pinned 模型保持激活）
    if (_focusedContextId && _focusedContextId !== targetId) {
        const oldCtx = _contexts.get(_focusedContextId);
        if (oldCtx && !oldCtx.isPinned) {
            oldCtx.isActive = false;
            _resetContextOffsets(oldCtx);
        }
    }

    // 无 pinned 模型时保持旧行为：注销旧 observer 再注册新 observer
    // 有 pinned 模型时保留 observer，只重置增量状态
    if (!hasPinned) {
        deactivatePerception();
    } else {
        _resetBalanceSwayState();
        _resetBreathingState();
        _resetLastEmotionMorphName();
    }
    _resetGazeState();

    const ctx = _getOrCreateContext(targetId);
    _resetContextOffsets(ctx);

    _focusedContextId = targetId;
    ctx.isActive = true;

    _ensureObserverRegistered();

    logWarn(
        'perception',
        `激活: 模型=${targetId} 呼吸=${ctx.state.breathEnabled} 眨眼=${ctx.state.blinkEnabled} 头=${ctx.state.headTrackingEnabled} 眼=${ctx.state.eyeTrackingEnabled}`
    );
}

let _gazeResetTick = 0;

/** 获取 gaze 重置计数（供测试验证调用时机） */
export function _getGazeResetTick(): number {
    return _gazeResetTick;
}

/** 重置 gaze 增量状态（无持久化状态，仅清理临时变量） */
export function _resetGazeState(): void {
    // gaze 不累积旋转偏移，每帧重新计算 targetQ；
    // 本函数作为生命周期守卫，在 activate/deactivate/开关切换时调用，确保无残留
    _gazeResetTick++;
}

/** 注销感知层 */
export function deactivatePerception(): void {
    const hasPinned = Array.from(_contexts.values()).some((c) => c.isPinned && c.isActive);

    // 有 pinned 模型时保留 observer，只清理焦点状态
    if (!hasPinned && perceptionObserver) {
        perceptionObserver();
        perceptionObserver = null;
    }
    _resetLastEmotionMorphName(); // 模型切换时清空，避免旧 morph 名残留
    _resetBalanceSwayState(); // 重置 balance 增量状态，避免跨模型残留导致塌地
    _resetBreathingState(); // 重置 breathing 增量状态，避免跨模型残留导致旋转冻结
    _resetGazeState(); // 重置 gaze 状态，避免关闭后重新开启出现跳跃

    if (_focusedContextId) {
        const ctx = _contexts.get(_focusedContextId);
        if (ctx) {
            _resetContextOffsets(ctx);
            if (!ctx.isPinned) {
                ctx.isActive = false;
            }
        }
        _focusedContextId = null;
    }
    logWarn('perception', '已注销');
}

/** 获取感知状态（焦点 context 状态，兼容旧 API） */
export function getPerceptionState(): PerceptionState {
    return { ..._getFocusedState() };
}

/** 设置感知状态（从存储恢复时使用） */
export function setPerceptionState(s: Partial<PerceptionState>): void {
    _setFocusedState(s);
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
    _updateFocusedState({ breathEnabled: v });
    triggerAutoSave();
}

/** 设置眨眼开关 */
export function setBlinkEnabled(v: boolean): void {
    _updateFocusedState({ blinkEnabled: v });
    triggerAutoSave();
}

/** 设置头部跟随开关 */
export function setHeadTrackingEnabled(v: boolean): void {
    _updateFocusedState({ headTrackingEnabled: v });
    _resetGazeState();
    triggerAutoSave();
}

/** 设置眼部跟随开关 */
export function setEyeTrackingEnabled(v: boolean): void {
    _updateFocusedState({ eyeTrackingEnabled: v });
    _resetGazeState();
    triggerAutoSave();
}

/** 设置微表情开关 */
export function setMicroExpressionEnabled(v: boolean): void {
    _updateFocusedState({ microExpressionEnabled: v });
    triggerAutoSave();
}

/** 设置重心微动开关（[doc:adr-079] Phase 2） */
export function setBalanceSwayEnabled(v: boolean): void {
    _updateFocusedState({ balanceSwayEnabled: v });
    triggerAutoSave();
}

/** 设置重心微动周期（秒，钳制 0.5–5.0） */
export function setBalanceSwayPeriod(v: number): void {
    _updateFocusedState({ balanceSwayPeriod: Math.max(0.5, Math.min(5.0, v)) });
    triggerAutoSave();
}

/** 设置重心微动振幅（全局乘数，钳制 0–2.0） */
export function setBalanceSwayAmplitude(v: number): void {
    _updateFocusedState({ balanceSwayAmplitude: Math.max(0, Math.min(2.0, v)) });
    triggerAutoSave();
}

/** 设置情绪类型 */
export function setEmotion(v: Emotion): void {
    _updateFocusedState({ emotion: v });
    triggerAutoSave();
}

/** 设置 lip-sync 开关 */
export function setLipSyncEnabled(enabled: boolean): void {
    _updateFocusedState({ lipSyncEnabled: enabled });
    triggerAutoSave();
}

/** 设置 lip-sync 灵敏度（钳制 0..1） */
export function setLipSyncSensitivity(v: number): void {
    _updateFocusedState({ lipSyncSensitivity: clamp01(v) });
    triggerAutoSave();
}

/** 设置 lip-sync 强度（钳制 0..1） */
export function setLipSyncIntensity(v: number): void {
    _updateFocusedState({ lipSyncIntensity: clamp01(v) });
    triggerAutoSave();
}

/** 设置多口型 morph 开关 */
export function setLipSyncMultiMorphEnabled(v: boolean): void {
    _updateFocusedState({ lipSyncMultiMorphEnabled: v });
    triggerAutoSave();
}

// ── 可调参数 setter（[doc:adr-116] 感知层滑块功能） ──

/** 设置呼吸频率（Hz，钳制 0.1–1.0） */
export function setBreathFrequency(v: number): void {
    _updateFocusedState({ breathFrequency: Math.max(0.1, Math.min(1.0, v)) });
    triggerAutoSave();
}

/** 设置呼吸幅度（弧度，钳制 0–0.05） */
export function setBreathAmplitude(v: number): void {
    _updateFocusedState({ breathAmplitude: Math.max(0, Math.min(0.05, v)) });
    triggerAutoSave();
}

/** 设置眨眼频率（Hz，钳制 0.05–0.5） */
export function setBlinkFrequency(v: number): void {
    _updateFocusedState({ blinkFrequency: Math.max(0.05, Math.min(0.5, v)) });
    triggerAutoSave();
}

/** 设置眨眼幅度（0–1，钳制） */
export function setBlinkAmplitude(v: number): void {
    _updateFocusedState({ blinkAmplitude: Math.max(0, Math.min(1, v)) });
    triggerAutoSave();
}

/** 设置头部跟随最大偏航角（度，钳制 0–90） */
export function setHeadGazeMaxYaw(v: number): void {
    _updateFocusedState({ headGazeMaxYaw: Math.max(0, Math.min(90, v)) });
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置头部跟随最大俯仰角（度，钳制 0–90） */
export function setHeadGazeMaxPitch(v: number): void {
    _updateFocusedState({ headGazeMaxPitch: Math.max(0, Math.min(90, v)) });
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随最大偏航角（度，钳制 0–15） */
export function setEyeGazeMaxYaw(v: number): void {
    _updateFocusedState({ eyeGazeMaxYaw: Math.max(0, Math.min(15, v)) });
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随最大俯仰角（度，钳制 0–15） */
export function setEyeGazeMaxPitch(v: number): void {
    _updateFocusedState({ eyeGazeMaxPitch: Math.max(0, Math.min(15, v)) });
    _syncGazeAngles();
    triggerAutoSave();
}

/** 设置眼部跟随平滑度（0–1） */
export function setEyeGazeSmooth(v: number): void {
    _updateFocusedState({ eyeGazeSmooth: Math.max(0, Math.min(1, v)) });
    _syncGazeAngles();
    triggerAutoSave();
}

/** 同步角度到 perception-shared 模块（避免循环依赖） */
function _syncGazeAngles(): void {
    const state = _getFocusedState();
    setGazeAngles(
        state.headGazeMaxYaw,
        state.headGazeMaxPitch,
        state.eyeGazeMaxYaw,
        state.eyeGazeMaxPitch,
        state.eyeGazeSmooth
    );
}

// ══════════════════════════════════════════════════════════════
// [doc:adr-162] Phase 3 — pin / unpin API
// ══════════════════════════════════════════════════════════════

const MAX_PINNED_MODELS = 5;

/** pin 模型感知（≤5 上限，超限 console.warn 并拒绝） */
export function pinPerception(modelId: string, state?: Partial<PerceptionState>): void {
    const pinnedCount = Array.from(_contexts.values()).filter((c) => c.isPinned).length;
    const ctx = _getOrCreateContext(modelId);

    if (ctx.isPinned) {
        if (state) {
            ctx.state = { ...ctx.state, ...state };
        }
        return;
    }

    if (pinnedCount >= MAX_PINNED_MODELS) {
        console.warn(`[perception] pin 上限 ${MAX_PINNED_MODELS}，拒绝 pin 模型 ${modelId}`);
        return;
    }

    ctx.isPinned = true;
    ctx.isActive = true;
    if (state) {
        ctx.state = { ...ctx.state, ...state };
    }

    _ensureObserverRegistered();
    logWarn('perception', `pin: 模型=${modelId}`);
}

/** unpin 模型感知（非焦点模型同步 deactivate） */
export function unpinPerception(modelId: string): void {
    const ctx = _contexts.get(modelId);
    if (!ctx || !ctx.isPinned) return;

    ctx.isPinned = false;

    // 非焦点模型：取消激活
    if (_focusedContextId !== modelId) {
        ctx.isActive = false;
        _resetContextOffsets(ctx);
    }

    // 若已无激活 context，注销 observer
    const hasActive = Array.from(_contexts.values()).some((c) => c.isActive);
    if (!hasActive && perceptionObserver) {
        perceptionObserver();
        perceptionObserver = null;
    }
}

/** 获取当前 pinned 模型 ID 列表 */
export function getPinnedModelIds(): string[] {
    return Array.from(_contexts.values())
        .filter((c) => c.isPinned)
        .map((c) => c.modelId);
}

/** 获取指定模型的感知状态（不存在时回退 fallback） */
export function getPerceptionStateFor(modelId: string): PerceptionState {
    const ctx = _contexts.get(modelId);
    if (!ctx) {
        return { ..._fallbackState };
    }
    return { ...ctx.state };
}

/** 设置指定模型的感知状态 */
export function setPerceptionStateFor(modelId: string, s: Partial<PerceptionState>): void {
    const ctx = _contexts.get(modelId);
    if (!ctx) {
        const newCtx = _getOrCreateContext(modelId);
        newCtx.state = { ...newCtx.state, ...s };
    } else {
        ctx.state = { ...ctx.state, ...s };
    }
    triggerAutoSave();
}

// ══════════════════════════════════════════════════════════════
// 兼容层：供 proc-motion-bridge.ts 调用（过渡期）
// ══════════════════════════════════════════════════════════════

/** 兼容接口：设置 gaze 配置（供 proc-motion-bridge.ts 调用） */
export function setGazeConfig(headEnabled: boolean, eyeEnabled: boolean): void {
    _updateFocusedState({
        headTrackingEnabled: headEnabled,
        eyeTrackingEnabled: eyeEnabled,
    });
    triggerAutoSave();
}

/** 兼容接口：模型移除时清理（供 proc-motion-bridge.ts 调用） */
export function onPerceptionModelRemoved(id: string): void {
    if (_focusedContextId === id) {
        deactivatePerception();
    }
    _contexts.delete(id);
}
