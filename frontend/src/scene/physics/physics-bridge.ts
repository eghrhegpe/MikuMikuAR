/**
 * physics-bridge.ts — 与物理后端无关的骨骼桥 + 挂件 auto-fit 几何工具
 *
 * 起源：原 XPBD(TS) 物理栈已删除（仅保留 WASM MMD 原生物理）。其中部分构件与物理
 * 求解器无关、可在任意后端（WASM / 将来其它引擎）之上复用。此处把它们抽成独立工具，
 * 避免重蹈「测试物理寄生 MMD 加载主链」的覆辙——本模块**不被任何启动期代码 eager 导入**，
 * 仅作为将来实现挂载布料 / ragdoll / attachment 时的基础设施备用。
 *
 * 职责边界：
 *  - 骨骼 READ（锚点跟随）：读取 runtimeBones 的局部矩阵/位置（历史 API 名含 World，实际为 rootMesh 局部系），后端无关。
 *  - auto-fit：从模型尺寸推算挂件几何参数（纯数学，无求解器依赖）。
 *  - 不在此处：每帧 update 编排（`PerFrameUpdateRegistry` 已上移至 `@/core/frame-registry`，
 *    它是通用机制，不该寄住在专业模块里）。
 *  - 不在此处：求解器内部的步进/写回（writeBack），因其随后端语义不同，应在具体实现里处理。
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { clamp, clampInt } from '@/core/clamp';

// ============================================================================
// 骨骼 READ 桥（锚点跟随）
// ============================================================================

/**
 * 在模型 runtimeBones 中按名查找。WASM / JS runtime 都暴露 runtimeBones，故后端无关。
 */
export function findRuntimeBone(
    model: IMmdModel | null | undefined,
    boneName: string
): IMmdRuntimeBone | null {
    if (!model?.runtimeBones) {
        return null;
    }
    return model.runtimeBones.find((b) => b.name === boneName) ?? null;
}

/**
 * 取骨骼在 rootMesh **局部坐标系**下的矩阵（列主序 Float32Array[16]），用于挂件锚点跟随。
 *
 * 命名消歧：本函数返回 babylon-mmd 的 `bone.worldMatrix`（rootMesh 局部坐标系，
 * 不含 rootMesh 的 scaling/rotation/translation），**不是世界坐标系矩阵**。
 * 世界系矩阵请走 `@/core/mmd-adapter` 的 `getBoneWorldMatrix`（局部 × rootWorld），二者同名不同义。
 */
export function getBoneLocalMatrix(
    model: IMmdModel | null | undefined,
    boneName: string
): Float32Array | null {
    return findRuntimeBone(model, boneName)?.worldMatrix ?? null;
}

/**
 * 从骨骼局部矩阵提取位置（米，场景单位）。
 * 注意：函数名沿用历史 `getBoneWorldPosition`，实际返回的是 rootMesh **局部坐标系**平移；
 * 需要世界位置时应与 rootMesh 世界矩阵相乘（virtual-skirt 已按此语义使用）。
 */
export function getBoneWorldPosition(
    model: IMmdModel | null | undefined,
    boneName: string
): Vector3 | null {
    const m = getBoneLocalMatrix(model, boneName);
    if (!m) {
        return null;
    }
    return new Vector3(m[12], m[13], m[14]);
}

// ============================================================================
// 挂件 auto-fit 几何（纯数学，无求解器依赖）
// ============================================================================

export interface AttachmentAnchors {
    /** 模型整体包围盒尺寸 {x,y,z}（米，场景单位） */
    modelSize: { x: number; y: number; z: number };
}

export interface AttachmentFit {
    segmentsH: number;
    segmentsV: number;
    /** 锚点环半径（米） */
    innerRadius: number;
    /** 挂件下垂长度（米） */
    length: number;
    /** 粒子半径（米） */
    particleRadius: number;
    /** 期望粒子间距（米） */
    particleSpacing: number;
}

// clamp / clampInt 已收敛至 @/core/clamp

/**
 * 从模型尺寸启发式推算挂件几何参数。
 * 注意：此为与物理后端无关的几何起点。原 XPBD 的 auto-fit 算法已随删除遗失，
 * 这里基于模型高度给出合理默认；具体物理材质参数（compliance/mass/damping 等）不在此范围。
 */
export function autoFitAttachment(
    anchor: AttachmentAnchors,
    opts?: { density?: number }
): AttachmentFit {
    // 期望粒子间距（米）。守卫非法 density（<=0 / NaN / Infinity）：
    // 否则 particleRadius=0 甚至负数、circumference/density 扩散成非有限值。
    const rawDensity = opts?.density;
    const density =
        rawDensity !== undefined && Number.isFinite(rawDensity) && rawDensity > 0
            ? rawDensity
            : 0.06;
    // 模型高度缺失 / 非有限 / 非正数时回退 1e-3，避免 NaN/Infinity 扩散到全部几何参数
    const rawHeight = anchor?.modelSize?.y;
    const h =
        typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
            ? Math.max(rawHeight, 1e-3)
            : 1e-3;
    const length = clamp(h * 0.3, 0.1, 2.0); // 挂件下垂长度 ≈ 模型高度 30%
    const innerRadius = clamp(h * 0.12, 0.03, 0.6); // 锚点环半径
    const segmentsV = clampInt(length / density, 4, 32);
    const circumference = 2 * Math.PI * innerRadius;
    const segmentsH = clampInt(circumference / density, 6, 64);
    const particleRadius = density * 0.5;
    return { segmentsH, segmentsV, innerRadius, length, particleRadius, particleSpacing: density };
}
