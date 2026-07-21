// [doc:adr-166] 感知层 observer 与 apply 函数
// 从 perception.ts 分离，职责：按 tier 筛选 context + 逐 context 运行感知管线
// 不持有模块级可变状态，全部通过参数注入

import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { _applyBreathing } from './perception-breathing';
import { _applyBlinking } from './perception-blinking';
import { _applyMicroExpression } from './perception-expression';
import { _applyBalanceSway } from './perception-balance';
import { _applyLipSync } from './perception-lipsync';
import { _applyGaze } from './perception-gaze';
import type { PerceptionContext, MmdModelLike, PerceptionTier } from './perception-shared';
import { logWarn } from '@/core/logger';
import { getScene } from '../env/env-impl';

/** [doc:adr-164] medium 档最多保留的非焦点非 pinned 模型数 */
const MEDIUM_MAX_OTHERS = 10;

/** [doc:adr-164] 根据 tier 返回应激活的 context 列表 */
export function _getActiveContextsByTier(
    tier: PerceptionTier,
    contexts: Map<string, PerceptionContext>,
    focusedContextId: string | null
): PerceptionContext[] {
    const all = Array.from(contexts.values()).filter((c) => c.isActive);
    if (tier === 'high') {
        return all;
    }
    if (tier === 'low') {
        return all.filter((c) => c.modelId === focusedContextId || c.isPinned);
    }
    const focused = all.find((c) => c.modelId === focusedContextId);
    const pinned = all.filter((c) => c.isPinned && c.modelId !== focusedContextId);
    const others = all.filter((c) => c.modelId !== focusedContextId && !c.isPinned);
    const result: PerceptionContext[] = [];
    if (focused) result.push(focused);
    result.push(...pinned);
    result.push(...others.slice(0, MEDIUM_MAX_OTHERS));
    return result;
}

/** 对单个 context 应用完整感知管线 */
export function _applyPerceptionForContext(
    ctx: PerceptionContext,
    mmdModel: MmdModelLike,
    time: number,
    dt: number,
    tier: PerceptionTier,
    frameCounter: number,
    ownedBonesMap: Map<string, Map<string, string[]>> | undefined
): void {
    const state = ctx.state;
    const owned = ownedBonesMap?.get(ctx.modelId);

    if (state.breathEnabled) {
        try {
            const claimed = owned?.get('perception.breath');
            _applyBreathing(mmdModel, time, ctx, claimed);
        } catch (e) {
            logWarn('perception', 'breathing 异常:', (e as Error)?.message);
        }
    }

    if (state.blinkEnabled) {
        try {
            _applyBlinking(mmdModel, time, ctx);
        } catch (e) {
            logWarn('perception', 'blinking 异常:', (e as Error)?.message);
        }
    }

    if (tier !== 'low') {
        const shouldRunExpr = tier === 'high' || (frameCounter % 4 === 0);
        if (shouldRunExpr) {
            try {
                _applyMicroExpression(
                    mmdModel,
                    time,
                    state.microExpressionEnabled,
                    state.emotion,
                    ctx,
                    tier
                );
            } catch (e) {
                logWarn('perception', 'micro-expression 异常:', (e as Error)?.message);
            }
        }
    }

    if (tier !== 'low') {
        try {
            const centerClaimed = owned?.get('perception.balance.center');
            const upperClaimed = owned?.get('perception.balance.upper');
            const waistClaimed = owned?.get('perception.balance.waist');
            _applyBalanceSway(
                mmdModel,
                time,
                ctx,
                centerClaimed,
                upperClaimed,
                waistClaimed,
                tier
            );
        } catch (e) {
            logWarn('perception', 'balance-sway 异常:', (e as Error)?.message);
        }
    }

    if (tier !== 'low') {
        try {
            _applyLipSync(
                mmdModel,
                time,
                state.lipSyncEnabled,
                ctx.modelId,
                state,
                tier
            );
        } catch (e) {
            logWarn('perception', 'lipsync 异常:', (e as Error)?.message);
        }
    }

    if (tier !== 'low') {
        const shouldRunGaze = tier === 'high' || (frameCounter % 2 === 0);
        if (shouldRunGaze && (state.headTrackingEnabled || state.eyeTrackingEnabled)) {
            const cam = getScene().activeCamera;
            if (cam) {
                try {
                    const headClaimed = owned?.get('perception.gaze.head');
                    const eyeClaimed = owned?.get('perception.gaze.eye');
                    _applyGaze(mmdModel, cam, {
                        headEnabled: state.headTrackingEnabled,
                        eyeEnabled: state.eyeTrackingEnabled,
                    }, dt, headClaimed, eyeClaimed, tier);
                } catch (e) {
                    logWarn('perception', 'gaze 异常:', (e as Error)?.message);
                }
            }
        }
    }
}
