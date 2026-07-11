// [doc:adr-085] Feet Adjustment — 纯数学解算（无 Babylon 依赖，可单测）
// 与 motion-algos/ 其他算法同层：仅依赖类型，不引入 scene / env / babylon-mmd 运行时。
// 引擎钩子（scene/motion/feet-adjustment.ts）负责把结果写入 IK 骨骼。

import type { FeetState } from '@/core/types';

export interface SolveFootInput {
    /** 当前 IK 骨骼（脚踝目标）世界 Y */
    footY: number;
    /** 地面高度 getGroundHeightAt(x, z) */
    groundY: number;
    /** 髋→当前脚世界距离（估算腿是否够得到地面） */
    hipToFootDist: number;
    /** 髋→踝静止腿长 L1+L2（估算，用作 maxAngle/reachAngle 缩放基准） */
    legLength: number;
    /** 上一帧平滑目标 Y（首帧为 null） */
    prevTargetY: number | null;
    /** 脚部调整状态 */
    feet: FeetState;
}

export interface SolveFootOutput {
    /** true=脚在空中，跳过校正（允许踢腿/跳跃） */
    skip: boolean;
    /** 目标脚底 Y（skip 时等于 footY） */
    targetY: number;
    /** 是否已贴地 */
    grounded: boolean;
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 解算单脚应处的世界 Y 坐标。
 * 语义:
 *  - footY > jumpThreshold → 脚在空中，跳过（不修改），允许动画抬脚
 *  - 否则目标 = groundY + soleHeight
 *  - reachAngle: 腿够不到地面（hipToFootDist > legLength）时趾尖额外下沉
 *  - maxAngle: 钳制单帧垂直修正量，避免高脚被瞬拉到地面产生突兀
 *  - footSmooth: 离地（下拉）时按 footSmooth 软化过渡；着地（上推）立即贴合防穿插
 *  - intensity: <1 时部分保留动画位置
 */
export function solveFootTarget(input: SolveFootInput): SolveFootOutput {
    const { footY, groundY, feet, prevTargetY, hipToFootDist, legLength } = input;

    if (footY > feet.jumpThreshold) {
        return { skip: true, targetY: footY, grounded: false };
    }

    let desiredY = groundY + feet.soleHeight;

    // 触及倾角：腿伸展仍够不到地面时，趾尖额外下沉补偿
    const reach = (feet.reachAngle * Math.PI) / 180;
    if (hipToFootDist > legLength && legLength > 1e-4) {
        const overshoot = hipToFootDist - legLength;
        desiredY -= Math.sin(reach) * overshoot;
    }

    // 最大足倾角：限制单帧垂直下拉幅度（防高脚被瞬拉）
    const maxDrop = Math.sin((feet.maxAngle * Math.PI) / 180) * legLength;
    if (footY - desiredY > maxDrop) {
        desiredY = footY - maxDrop;
    }

    // 平滑过渡
    let targetY = desiredY;
    if (prevTargetY !== null) {
        if (desiredY > footY) {
            // 需要上推（脚低于/在地面下）：立即贴合，避免穿插
            targetY = desiredY;
        } else {
            // 需要下拉（脚高于地面）：按 footSmooth 软化，避免抖动
            const a = clamp01(feet.footSmooth);
            targetY = prevTargetY + (desiredY - prevTargetY) * a;
        }
    }

    // 总体强度混合（intensity<1 保留部分动画位置）
    if (feet.intensity < 1) {
        targetY = footY + (targetY - footY) * clamp01(feet.intensity);
    }

    return { skip: false, targetY, grounded: true };
}
