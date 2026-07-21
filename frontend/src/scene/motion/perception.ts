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
    type PerceptionTier,
    DEFAULT_PERCEPTION_STATE,
    _writeMatToBuffer,
    _propagateChildrenWasm,
    _isWasmRuntime,
    _gazeAlpha,
    setGazeAngles,
    PerceptionPerfMonitor,
} from './perception-shared';
import {
    _clampHeadGazeTarget,
    _clampEyeGazeTarget,
    applyGazeWasm,
    HEAD_BONE_CANDIDATES,
    EYE_BONE_CANDIDATES,
} from './perception-gaze';
import { _resetBalanceSwayState } from './perception-balance';
import {
    BONE_UPPER_CANDIDATES,
    BONE_NECK_CANDIDATES,
    BONE_HEAD_CANDIDATES,
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
} from '../../motion-algos/proc-motion-shared';
import { clamp01 } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { getBoneOverrideStore } from './bone-override-store';
import { releaseOwnedBones } from './motion-modules/registry';
import { _applyPerceptionForContext, _getActiveContextsByTier } from './perception-observer';

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
/** [doc:adr-163] 感知层已认领骨骼：modelId → moduleId → claimed[] */
let _perceptionOwnedBones = new Map<string, Map<string, string[]>>();
/** [doc:adr-164] 性能监控器 */
let _perfMonitor = new PerceptionPerfMonitor();
/** [doc:adr-164] 全局帧计数器（供 tier 降采样使用） */
let _frameCounter = 0;
/** [doc:adr-164] 全员感知开关 */
let _allEnabled = false;
/** [doc:adr-166 P2-1] reclaim 监听器已注册标志，避免多次订阅 bone-override-store release 事件 */
let _reclaimListenerAdded = false;

/**
 * [doc:adr-166 P2-1] bone-override-store release 事件回调：
 * 感知层自有骨骼被释放时自动 reclaim，解决关闭 Bone Override 后 gaze 头部跟随永不恢复
 */
function _onBoneOverrideRelease(modelId: string, moduleId: string, _bones: Set<string>): void {
    // 忽略感知层自身释放（如 _releasePerceptionBones 内循环调 releaseOwnedBones 触发本监听器），避免递归 reclaim
    if (moduleId.startsWith('perception.')) return;
    if (_perceptionOwnedBones.has(modelId)) {
        _reclaimPerceptionBones(modelId);
    }
}

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
    _resetBalanceSwayState(ctx.lastOffsets.balance);
    ctx.lastOffsets.emotion = null;
}

/** [doc:adr-163] 为指定模型认领感知层骨骼（P3=100） */
function _claimPerceptionBones(modelId: string): void {
    const store = getBoneOverrideStore();
    const perModel = new Map<string, string[]>();
    _perceptionOwnedBones.set(modelId, perModel);

    const headClaimed = store.claimBones(modelId, 'perception.gaze.head', 100, HEAD_BONE_CANDIDATES);
    perModel.set('perception.gaze.head', headClaimed);

    const eyeClaimed = store.claimBones(modelId, 'perception.gaze.eye', 100, EYE_BONE_CANDIDATES);
    perModel.set('perception.gaze.eye', eyeClaimed);

    const breathBones = [
        ...BONE_UPPER_CANDIDATES,
        ...BONE_NECK_CANDIDATES,
        ...BONE_HEAD_CANDIDATES,
    ];
    const breathClaimed = store.claimBones(modelId, 'perception.breath', 100, breathBones);
    perModel.set('perception.breath', breathClaimed);

    const centerBones = [...BONE_CENTER_CANDIDATES, ...BONE_ALLPARENT_CANDIDATES];
    const centerClaimed = store.claimBones(modelId, 'perception.balance.center', 100, centerBones);
    perModel.set('perception.balance.center', centerClaimed);

    const upperClaimed = store.claimBones(modelId, 'perception.balance.upper', 100, BONE_UPPER2_CANDIDATES);
    perModel.set('perception.balance.upper', upperClaimed);

    const waistClaimed = store.claimBones(modelId, 'perception.balance.waist', 100, BONE_WAIST_CANDIDATES);
    perModel.set('perception.balance.waist', waistClaimed);
}

/** [doc:adr-163] 释放指定模型的全部感知层骨骼 */
function _releasePerceptionBones(modelId: string): void {
    // 先标记释放，防止 releaseOwnedBones 触发的 _onBoneOverrideRelease 回调
    // 通过 _perceptionOwnedBones.has(modelId) 判断后尝试 reclaim → 形成无限递归
    _perceptionOwnedBones.delete(modelId);
    const modules = [
        'perception.gaze.head',
        'perception.gaze.eye',
        'perception.breath',
        'perception.balance.center',
        'perception.balance.upper',
        'perception.balance.waist',
    ];
    for (const moduleId of modules) {
        releaseOwnedBones(modelId, moduleId);
    }
}

/** [doc:adr-166] 回收指定模型的感知骨骼：先释放再重认领，解决 Close Override 夺走后不回抢 */
function _reclaimPerceptionBones(modelId: string): void {
    _releasePerceptionBones(modelId);
    _claimPerceptionBones(modelId);
}

/** 注销单个 context（供 observer 遍历中发现模型已 dispose 时调用） */
function _deactivateContext(modelId: string): void {
    const ctx = _contexts.get(modelId);
    if (!ctx) return;
    _releasePerceptionBones(modelId);
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
            _frameCounter++;

            // [doc:adr-164] 性能监控与 tier 决策
            const activeCount = Array.from(_contexts.values()).filter((c) => c.isActive).length;
            _perfMonitor.update(scene, activeCount);
            const tier = _perfMonitor.getTier();

            const activeContexts = _getActiveContextsByTier(tier, _contexts, _focusedContextId);

            // [doc:adr-164 P3-2] 无活跃 context 时注销 observer，避免空转
            if (activeContexts.length === 0) {
                if (perceptionObserver) {
                    perceptionObserver();
                    perceptionObserver = null;
                }
                return;
            }

            for (const ctx of activeContexts) {
                const inst = modelManager.get(ctx.modelId);
                if (!inst?.mmdModel || inst.mmdModel.mesh?.isDisposed()) {
                    if (_focusedContextId === ctx.modelId) {
                        deactivatePerception();
                    } else {
                        _deactivateContext(ctx.modelId);
                    }
                    continue;
                }
                _applyPerceptionForContext(ctx, inst.mmdModel, time, dt, tier, _frameCounter, _perceptionOwnedBones);
            }
        },
    });

    // [doc:adr-166 P2-1] 注册 bone-override-store release 监听器（仅一次），
    // 当其他模块释放骨骼（如关闭 Bone Override）时自动触发感知层 reclaim
    if (!_reclaimListenerAdded) {
        getBoneOverrideStore().addReleaseListener(_onBoneOverrideRelease);
        _reclaimListenerAdded = true;
    }
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

    // [doc:adr-164] 非焦点模型激活（全员感知模式）：不切换焦点，仅激活 context
    if (_allEnabled && modelId && modelId !== _focusedContextId) {
        const ctx = _getOrCreateContext(targetId);
        _resetContextOffsets(ctx);
        ctx.isActive = true;
        _claimPerceptionBones(targetId);
        _ensureObserverRegistered();
        return;
    }

    // 避免重复激活同一焦点模型
    if (_focusedContextId === targetId && perceptionObserver) {
        _resetGazeState();
        return;
    }

    const hasPinned = Array.from(_contexts.values()).some((c) => c.isPinned && c.isActive);

    // 如果正在切换焦点，处理旧焦点（pinned 模型保持激活）
    if (_focusedContextId && _focusedContextId !== targetId) {
        const oldCtx = _contexts.get(_focusedContextId);
        if (oldCtx && !oldCtx.isPinned) {
            oldCtx.isActive = false;
            _releasePerceptionBones(oldCtx.modelId);
            _resetContextOffsets(oldCtx);
        }
    }

    // 无 pinned 模型时注销旧 observer；有 pinned 模型时保留 observer
    // （增量状态已通过 _resetContextOffsets 按 ctx 独立管理，无需模块级重置）
    if (!hasPinned) {
        deactivatePerception();
    }
    _resetGazeState();

    const ctx = _getOrCreateContext(targetId);
    _resetContextOffsets(ctx);

    _focusedContextId = targetId;
    ctx.isActive = true;

    _claimPerceptionBones(targetId);
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
    _resetGazeState(); // 重置 gaze 状态，避免关闭后重新开启出现跳跃

    if (_focusedContextId) {
        _releasePerceptionBones(_focusedContextId);
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
    // 钳制 gaze 角度参数（与各单项 setter 一致，避免绕过 clamp）
    const clamped: Partial<PerceptionState> = {};
    if ('headGazeMaxYaw' in s) clamped.headGazeMaxYaw = Math.max(0, Math.min(90, s.headGazeMaxYaw!));
    if ('headGazeMaxPitch' in s) clamped.headGazeMaxPitch = Math.max(0, Math.min(90, s.headGazeMaxPitch!));
    if ('eyeGazeMaxYaw' in s) clamped.eyeGazeMaxYaw = Math.max(0, Math.min(15, s.eyeGazeMaxYaw!));
    if ('eyeGazeMaxPitch' in s) clamped.eyeGazeMaxPitch = Math.max(0, Math.min(15, s.eyeGazeMaxPitch!));
    if ('eyeGazeSmooth' in s) clamped.eyeGazeSmooth = Math.max(0, Math.min(1, s.eyeGazeSmooth!));
    // 非 gaze 字段原样传入
    for (const k of Object.keys(s)) {
        if (!(k in clamped)) {
            (clamped as Record<string, unknown>)[k] = (s as Record<string, unknown>)[k];
        }
    }
    _setFocusedState(clamped);
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

/** [doc:adr-164] pin 模型感知（原 ≤5 上限已移除，全员感知由 tier 控制） */
export function pinPerception(modelId: string, state?: Partial<PerceptionState>): void {
    const ctx = _getOrCreateContext(modelId);

    if (ctx.isPinned) {
        if (state) {
            ctx.state = { ...ctx.state, ...state };
        }
        return;
    }

    ctx.isPinned = true;
    ctx.isActive = true;
    if (state) {
        ctx.state = { ...ctx.state, ...state };
    }

    _claimPerceptionBones(modelId);
    _ensureObserverRegistered();
    logWarn('perception', `pin: 模型=${modelId}`);
}

/** unpin 模型感知（非焦点模型同步 deactivate） */
export function unpinPerception(modelId: string): void {
    const ctx = _contexts.get(modelId);
    if (!ctx || !ctx.isPinned) return;

    ctx.isPinned = false;

    // 焦点 unpin 仅清 pinned 标志，isActive 保留至焦点切换（仍为当前编辑目标，不应释放骨骼）
    // 非焦点模型：取消激活
    if (_focusedContextId !== modelId) {
        _releasePerceptionBones(modelId);
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
    // 钳制 gaze 角度参数（与各单项 setter 一致，避免绕过 clamp）
    const clamped: Partial<PerceptionState> = {};
    if ('headGazeMaxYaw' in s) clamped.headGazeMaxYaw = Math.max(0, Math.min(90, s.headGazeMaxYaw!));
    if ('headGazeMaxPitch' in s) clamped.headGazeMaxPitch = Math.max(0, Math.min(90, s.headGazeMaxPitch!));
    if ('eyeGazeMaxYaw' in s) clamped.eyeGazeMaxYaw = Math.max(0, Math.min(15, s.eyeGazeMaxYaw!));
    if ('eyeGazeMaxPitch' in s) clamped.eyeGazeMaxPitch = Math.max(0, Math.min(15, s.eyeGazeMaxPitch!));
    if ('eyeGazeSmooth' in s) clamped.eyeGazeSmooth = Math.max(0, Math.min(1, s.eyeGazeSmooth!));
    // 非 gaze 字段原样传入
    for (const k of Object.keys(s)) {
        if (!(k in clamped)) {
            (clamped as Record<string, unknown>)[k] = (s as Record<string, unknown>)[k];
        }
    }

    const ctx = _contexts.get(modelId);
    if (!ctx) {
        const newCtx = _getOrCreateContext(modelId);
        newCtx.state = { ...newCtx.state, ...clamped };
    } else {
        ctx.state = { ...ctx.state, ...clamped };
    }
    triggerAutoSave();
}

// ══════════════════════════════════════════════════════════════
// [doc:adr-164] Phase 3 — enableAll / disableAll / tier API
// ══════════════════════════════════════════════════════════════

/** 全员激活感知层（受 tier 限制） */
export function enableAllPerception(): void {
    _allEnabled = true;
    for (const [id, inst] of modelManager.modelRegistry) {
        if (inst?.mmdModel && !inst.mmdModel.mesh?.isDisposed()) {
            const ctx = _getOrCreateContext(id);
            if (!ctx.isActive) {
                _resetContextOffsets(ctx);
                ctx.isActive = true;
                _claimPerceptionBones(id);
            } else {
                // [doc:adr-166] 已激活但骨骼可能被 Close Override 夺走
                const store = getBoneOverrideStore();
                const headOwned = store.getOwnedBones(id, 'perception.gaze.head');
                if (headOwned.size === 0) {
                    _reclaimPerceptionBones(id);
                }
                // [doc:adr-164] toggle enable→disable→enable 时重置 offsets，避免残留
                _resetContextOffsets(ctx);
            }
        }
    }
    _ensureObserverRegistered();
    logWarn('perception', '全员感知已开启');
}

/** 全员关闭感知层（仅焦点 + pinned 保留） */
export function disableAllPerception(): void {
    _allEnabled = false;
    for (const ctx of _contexts.values()) {
        if (ctx.modelId === _focusedContextId || ctx.isPinned) {
            continue;
        }
        // [doc:adr-164] 已 dispose 的模型直接移除 context，避免占位
        const inst = modelManager.get(ctx.modelId);
        if (!inst?.mmdModel || inst.mmdModel.mesh?.isDisposed()) {
            _releasePerceptionBones(ctx.modelId);
            _contexts.delete(ctx.modelId);
            _perceptionOwnedBones.delete(ctx.modelId);
            continue;
        }
        ctx.isActive = false;
        _releasePerceptionBones(ctx.modelId);
        _resetContextOffsets(ctx);
    }
    logWarn('perception', '全员感知已关闭');
}

/** 获取当前性能档位 */
export function getPerceptionPerfTier(): PerceptionTier {
    return _perfMonitor.getTier();
}

/** [doc:adr-164] 获取手动档位设置（'auto' 表示自动降级模式） */
export function getPerceptionPerfManualTier(): PerceptionTier | 'auto' {
    return _perfMonitor.getManualTier();
}

/** 手动设置性能档位（auto/high/medium/low） */
export function setPerceptionPerfTier(tier: PerceptionTier | 'auto'): void {
    _perfMonitor.setManualTier(tier);
    triggerAutoSave();
}

/** [doc:adr-164] 获取全员感知开关状态 */
export function isAllPerceptionEnabled(): boolean {
    return _allEnabled;
}

/** [doc:adr-164] 设置全员感知开关状态 */
export function setAllPerceptionEnabled(enabled: boolean): void {
    if (enabled) {
        enableAllPerception();
    } else {
        disableAllPerception();
    }
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

/** 内部统一：完全移除指定 context（释放骨骼 + 删除 Map 占位） */
function _removeContext(modelId: string): void {
    const ctx = _contexts.get(modelId);
    if (ctx) {
        _releasePerceptionBones(modelId);
        _contexts.delete(modelId);
        _perceptionOwnedBones.delete(modelId);
    }
}

/** 测试用：获取指定模型的 context（含 lastOffsets） */
export function __testOnlyGetContext(modelId: string): PerceptionContext | undefined {
    return _contexts.get(modelId);
}

/** 兼容接口：模型移除时清理（供 proc-motion-bridge.ts 调用） */
export function onPerceptionModelRemoved(id: string): void {
    if (_focusedContextId === id) {
        deactivatePerception();
    } else {
        _removeContext(id);
    }
}
