// [doc:adr-079] 感知层 — 重心微动（躯干骨骼平衡微晃，从 proc-motion-idle.ts 迁移）

import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

import {
    BONE_CENTER_CANDIDATES,
    BONE_UPPER2_CANDIDATES,
    BONE_WAIST_CANDIDATES,
    BONE_ALLPARENT_CANDIDATES,
    matchBone,
} from '../../motion-algos/proc-motion-shared';
import { _q } from './perception-shared';
import type { BalanceSwayState, MmdModelLike, PerceptionTier } from './perception-shared';

/** 重心微动周期（秒，从 idle loopFrames=120@60fps 转换：120/60=2s） */
const BALANCE_SWAY_PERIOD = 2.0;
/** 重心微动各骨骼振幅（从 idle 算法提取，已削至微动量级，intensity 固定 1.0） */
const SWAY_AMP = {
    center_rz: 0.05, // center 慢速摆动（削半：原 0.1 → 0.05，避免 VMD 播放时过晃）
    center_rx: 0.02, // center 微动（原 0.03）
    center_bobY: 0.03, // center 上下浮动（原 0.04）
    upper2_rx: 0.015, // 上半身2 前后倾（不变）
    waist_rz: 0.015, // 腰 左右摆（原 0.02，配合 center_rz 削幅）
    allParent_rx: 0.005, // 全ての親 微倾（不变）
    allParent_rz: 0.005, // （不变）
};

/** 旋转增量缩放系数（<1.0 使微动更柔和，保留 VMD 基准旋转） */
const SWAY_DELTA_FACTOR = 0.6;

/** 重置增量状态到默认值（每个模型 context 独立持有 balanceState，避免跨模型污染） */
export function _resetBalanceSwayState(state: BalanceSwayState): void {
    state.lastBobY = 0;
    state.swayCenterName = null;
    state.lastCenterRz = 0;
    state.lastCenterRx = 0;
    state.lastUpperRx = 0;
    state.lastWaistRz = 0;
    state.lastAllParentRx = 0;
    state.lastAllParentRz = 0;
    state.lastSwayTime = 0;
    state.lastBalanceSwayBones = [];
}

export function _applyBalanceSway(
    mmdModel: MmdModelLike,
    time: number,
    enabled: boolean,
    period: number,
    amplitude: number,
    balanceState: BalanceSwayState,
    centerClaimed?: readonly string[],
    upper2Claimed?: readonly string[],
    waistClaimed?: readonly string[],
    tier?: PerceptionTier
): void {
    // [doc:adr-164] tier 守卫：low 跳过
    if (tier === 'low') return;
    const boneNames: string[] = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const centerName = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Name = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistName = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentName = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    // 关闭时撤销 center position 的 bob 残留 + 重置增量状态（避免残留冻结）
    if (!enabled || amplitude === 0) {
        if (balanceState.lastBobY !== 0 && balanceState.swayCenterName) {
            const bone = mmdModel.runtimeBones.find(
                (b: IMmdRuntimeBone) => b.name === balanceState.swayCenterName
            );
            if (bone?.linkedBone) {
                bone.linkedBone.position.y -= balanceState.lastBobY;
            }
        }
        _resetBalanceSwayState(balanceState);
        return;
    }

    const phase = ((time % period) / period) * Math.PI * 2;
    const slowPhase = phase * 0.5;
    const written: string[] = [];

    // center: position bobY + rotation rz/rx
    if (centerName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === centerName);
        if (bone?.linkedBone && (!centerClaimed || centerClaimed.includes(centerName))) {
            const bobY = Math.sin(phase) * SWAY_AMP.center_bobY * amplitude;
            // 增量叠加：先撤上帧 bob，再加本帧 bob，保持基准 position.y 不变（修复塌到地面）
            bone.linkedBone.position.y = bone.linkedBone.position.y - balanceState.lastBobY + bobY;
            balanceState.lastBobY = bobY;
            balanceState.swayCenterName = centerName;

            const rz = Math.sin(slowPhase) * SWAY_AMP.center_rz * amplitude;
            const rx = Math.sin(phase * 0.37 + 0.5) * SWAY_AMP.center_rx * amplitude;
            // rotation 增量叠加（deltaQ * currentQ × SWAY_DELTA_FACTOR，
            // 避免 Slerp 平均吃掉非零基准旋转 / VMD 旋转，同时控制振幅感知）
            const deltaCenterRz = (rz - balanceState.lastCenterRz) * SWAY_DELTA_FACTOR;
            const deltaCenterRx = (rx - balanceState.lastCenterRx) * SWAY_DELTA_FACTOR;
            if (
                (deltaCenterRz !== 0 || deltaCenterRx !== 0) &&
                bone.linkedBone.rotationQuaternion
            ) {
                const deltaQ = _q().copyFrom(
                    Quaternion.FromEulerAngles(deltaCenterRx, 0, deltaCenterRz)
                );
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            }
            balanceState.lastCenterRz = rz;
            balanceState.lastCenterRx = rx;
            written.push(centerName);
        }
    }

    // upper2: rotation rx
    if (upper2Name) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === upper2Name);
        if (bone?.linkedBone && (!upper2Claimed || upper2Claimed.includes(upper2Name))) {
            const rx = Math.sin(phase * 0.7 + 0.3) * SWAY_AMP.upper2_rx * amplitude;
            const deltaRx = (rx - balanceState.lastUpperRx) * SWAY_DELTA_FACTOR;
            if (deltaRx !== 0 && bone.linkedBone.rotationQuaternion) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(deltaRx, 0, 0));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            }
            balanceState.lastUpperRx = rx;
            written.push(upper2Name);
        }
    }

    // waist: rotation rz
    if (waistName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === waistName);
        if (bone?.linkedBone && (!waistClaimed || waistClaimed.includes(waistName))) {
            const rz = Math.sin(phase + 0.5) * SWAY_AMP.waist_rz * amplitude;
            const deltaRz = (rz - balanceState.lastWaistRz) * SWAY_DELTA_FACTOR;
            if (deltaRz !== 0 && bone.linkedBone.rotationQuaternion) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(0, 0, deltaRz));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            }
            balanceState.lastWaistRz = rz;
            written.push(waistName);
        }
    }

    // allParent: rotation rx/rz（归属 perception.balance.center）
    if (allParentName) {
        const bone = mmdModel.runtimeBones.find((b: IMmdRuntimeBone) => b.name === allParentName);
        if (bone?.linkedBone && (!centerClaimed || centerClaimed.includes(allParentName))) {
            const rx = Math.sin(phase * 0.2 + 1.1) * SWAY_AMP.allParent_rx * amplitude;
            const rz = Math.sin(phase * 0.3 + 2.3) * SWAY_AMP.allParent_rz * amplitude;
            const deltaRx = (rx - balanceState.lastAllParentRx) * SWAY_DELTA_FACTOR;
            const deltaRz = (rz - balanceState.lastAllParentRz) * SWAY_DELTA_FACTOR;
            if ((deltaRx !== 0 || deltaRz !== 0) && bone.linkedBone.rotationQuaternion) {
                const deltaQ = _q().copyFrom(Quaternion.FromEulerAngles(deltaRx, 0, deltaRz));
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion.copyFrom(localQ);
            }
            balanceState.lastAllParentRx = rx;
            balanceState.lastAllParentRz = rz;
            written.push(allParentName);
        }
    }

    balanceState.lastBalanceSwayBones = written;
}
