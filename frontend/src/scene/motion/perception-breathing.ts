// [doc:adr-071] 感知层 — 呼吸（躯干骨骼正弦微动）
//
// 实现策略：delta 增量叠加（与 perception-balance.ts 同款），
// 不直接覆写当前旋转，而是「撤销上帧偏移 + 应用本帧偏移」，
// 保留 VMD / Bone Override 写入的躯干基准旋转。
// 参考 ADR-079 §决策关键约束 1「分层叠加而非互斥」。

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import { BONE_UPPER_CANDIDATES, matchBone } from '../../motion-algos/proc-motion-shared';
import type { MmdRuntimeBoneExtended } from '@/core/types';
import { _q } from './perception-shared';
import type { MmdModelLike, PerceptionContext } from './perception-shared';

// ── 呼吸参数（默认值，实际从 perceptionState 读取） ──
const DEFAULT_BREATH_FREQ = 0.3; // Hz
const DEFAULT_BREATH_AMP = 0.02; // radians

/** 旋转增量缩放系数（<1.0 使微动更柔和，保留 VMD 基准旋转） */
const BREATH_DELTA_FACTOR = 0.6;

export function _applyBreathing(
    mmdModel: MmdModelLike,
    time: number,
    ctx: PerceptionContext,
    claimedBones?: readonly string[]
): void {
    const s = ctx.state;
    const freq = s.breathFrequency ?? DEFAULT_BREATH_FREQ;
    const amp = s.breathAmplitude ?? DEFAULT_BREATH_AMP;
    const phase = time * freq * 2 * Math.PI;
    const breathOffset = amp * Math.sin(phase);

    const boneNames = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const spineName = matchBone(boneNames, BONE_UPPER_CANDIDATES);
    const spine = spineName
        ? mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === spineName)
        : null;
    if (!spine) {
        return;
    }
    if (claimedBones && spineName && !claimedBones.includes(spineName)) {
        return;
    }

    // [audit:round44 P2] linkedBone 可能为 null（round-15 P1-2 遗留）：不加守卫时
    // 每帧抛 TypeError（observer try-catch 降级为 logWarn + 呼吸静默失效）。
    // 与 perception-balance.ts:78/92 的 bone?.linkedBone 模式对齐。
    const curQ = spine.linkedBone?.rotationQuaternion;
    if (!curQ) {
        return;
    }

    // delta 增量叠加：
    //   deltaQ = RotationAxis(Right(), (currentOffset - lastOffset) * FACTOR)
    //   newQ = deltaQ × currentQ
    // 这样 VMD / Bone Override 的躯干基准旋转被保留，呼吸只是叠加微动。
    // amp=0 时仍执行：撤销上帧偏移，确保关闭瞬间不残留冻结。
    const deltaOffset = (breathOffset - ctx.lastOffsets.breath) * BREATH_DELTA_FACTOR;
    if (deltaOffset !== 0) {
        const deltaQ = _q().copyFrom(Quaternion.RotationAxis(Vector3.Right(), deltaOffset));
        const localQ = _q().copyFrom(curQ);
        deltaQ.multiplyToRef(localQ, localQ);
        curQ.copyFrom(localQ);
    }
    ctx.lastOffsets.breath = breathOffset;

    if ('updateWorldMatrix' in spine) {
        (spine as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        for (const child of spine.childBones) {
            _updateBoneChain(child);
        }
    }
}

/**
 * [fix:P3 round15#3] 骨骼链世界矩阵更新的深度上限。
 * 真实 MMD 骨骼树深度 ≤10（见 perception-shared.ts:186 注释），64 留足余量；
 * 畸形/环状数据（存档损坏或第三方模型）可把递归打成无限链爆栈。
 * 超限分支只截断传播、不抛错：单帧世界矩阵不更新会由下一帧自愈，
 * 比整个 observer 抛异常拖垮呼吸模块更优。
 */
const _BONE_CHAIN_MAX_DEPTH = 64;

export function _updateBoneChain(bone: IMmdRuntimeBone): void {
    _updateBoneChainDepth(bone, 0);
}

function _updateBoneChainDepth(bone: IMmdRuntimeBone, depth: number): void {
    if ('updateWorldMatrix' in bone) {
        (bone as MmdRuntimeBoneExtended).updateWorldMatrix(false, false);
        if (depth >= _BONE_CHAIN_MAX_DEPTH) {
            return;
        }
        for (const child of bone.childBones) {
            _updateBoneChainDepth(child, depth + 1);
        }
    }
}
