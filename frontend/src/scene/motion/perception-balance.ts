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

/** 重心微动周期（秒，从 idle loopFrames=120@60fps 转换：120/60=2s） */
const BALANCE_SWAY_PERIOD = 2.0;
/** 重心微动各骨骼振幅（从 idle 算法提取，intensity 固定 1.0） */
const SWAY_AMP = {
    center_rz: 0.1, // center 慢速摆动
    center_rx: 0.03, // center 微动
    center_bobY: 0.04, // center 上下浮动
    upper2_rx: 0.015, // 上半身2 前后倾
    waist_rz: 0.02, // 腰 左右摆
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

/** 重置增量状态（activatePerception / 重激活时调用，避免跨模型残留导致塌地） */
export function _resetBalanceSwayState(): void {
    _lastBobY = 0;
    _swayCenterName = null;
    _lastCenterRz = 0;
    _lastCenterRx = 0;
    _lastUpperRx = 0;
    _lastWaistRz = 0;
    _lastAllParentRx = 0;
    _lastAllParentRz = 0;
}

export function _applyBalanceSway(mmdModel: any, time: number, enabled: boolean): void {
    const boneNames: string[] = mmdModel.runtimeBones.map((b: IMmdRuntimeBone) => b.name);
    const centerName = matchBone(boneNames, BONE_CENTER_CANDIDATES);
    const upper2Name = matchBone(boneNames, BONE_UPPER2_CANDIDATES);
    const waistName = matchBone(boneNames, BONE_WAIST_CANDIDATES);
    const allParentName = matchBone(boneNames, BONE_ALLPARENT_CANDIDATES);

    // 关闭时撤销 center position 的 bob 残留（恢复真实基准 position.y，避免塌到地面）
    if (!enabled) {
        if (_lastBobY !== 0 && _swayCenterName) {
            const bone = mmdModel.runtimeBones.find(
                (b: IMmdRuntimeBone) => b.name === _swayCenterName
            );
            if (bone?.linkedBone) {
                bone.linkedBone.position.y -= _lastBobY;
            }
        }
        _lastBobY = 0;
        _swayCenterName = null;
        _lastBalanceSwayBones = [];
        return;
    }

    const phase = ((time % BALANCE_SWAY_PERIOD) / BALANCE_SWAY_PERIOD) * Math.PI * 2;
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
                const deltaQ = _q().copyFrom(
                    Quaternion.FromEulerAngles(deltaCenterRx, 0, deltaCenterRz)
                );
                const localQ = _q().copyFrom(bone.linkedBone.rotationQuaternion);
                deltaQ.multiplyToRef(localQ, localQ);
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
                deltaQ.multiplyToRef(localQ, localQ);
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
                deltaQ.multiplyToRef(localQ, localQ);
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
                deltaQ.multiplyToRef(localQ, localQ);
                bone.linkedBone.rotationQuaternion = localQ;
            }
            _lastAllParentRx = rx;
            _lastAllParentRz = rz;
            written.push(allParentName);
        }
    }

    _lastBalanceSwayBones = written;
}
