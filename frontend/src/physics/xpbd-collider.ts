/**
 * SDF 胶囊碰撞器 (Signed Distance Field Capsule Collider)
 *
 * 用一组胶囊体（头/颈/胸/腰/臀/四肢）近似身体碰撞体积，
 * 每帧从骨骼世界矩阵更新胶囊位置，XPBD 粒子碰撞求解。
 *
 * 不依赖动画计算——胶囊的世界矩阵由外部提供。
 */

import type { XpbdSolver } from './xpbd-solver';

// ============================================================
// 类型
// ============================================================

/** 单个 SDF 胶囊 */
export interface SdfCapsule {
    /** 胶囊名称（如 "chest"） */
    name: string;
    /** 关联的骨骼名（用于每帧从骨骼矩阵更新位置） */
    boneName: string;
    /** 半径 */
    radius: number;
    /** 半高（中心到端点的距离），总高度 = radius*2 + halfHeight*2 */
    halfHeight: number;
    /** 世界空间中心位置 [x, y, z] */
    center: Float32Array;
    /** 世界空间方向（单位向量）[x, y, z] */
    direction: Float32Array;
    /** 启用标志 */
    enabled: boolean;
}

/** 胶囊规格（不包含运行时位置） */
export interface CapsuleSpec {
    name: string;
    radius: number;
    halfHeight: number;
    /** 关联的骨骼名（用于外部查询矩阵） */
    boneName: string;
}

// ============================================================
// 默认身体胶囊规格
// ============================================================

export const DEFAULT_BODY_CAPSULES: CapsuleSpec[] = [
    { name: 'head', boneName: '頭', radius: 0.13, halfHeight: 0.08 },
    { name: 'neck', boneName: '首', radius: 0.06, halfHeight: 0.04 },
    { name: 'chest', boneName: '上半身', radius: 0.15, halfHeight: 0.12 },
    { name: 'waist', boneName: '下半身', radius: 0.13, halfHeight: 0.1 },
    { name: 'hip', boneName: '腰', radius: 0.16, halfHeight: 0.08 },
    { name: 'upperArmL', boneName: '左腕', radius: 0.07, halfHeight: 0.1 },
    { name: 'upperArmR', boneName: '右腕', radius: 0.07, halfHeight: 0.1 },
    { name: 'lowerArmL', boneName: '左ひじ', radius: 0.06, halfHeight: 0.1 },
    { name: 'lowerArmR', boneName: '右ひじ', radius: 0.06, halfHeight: 0.1 },
    { name: 'upperLegL', boneName: '左足', radius: 0.09, halfHeight: 0.14 },
    { name: 'upperLegR', boneName: '右足', radius: 0.09, halfHeight: 0.14 },
    { name: 'lowerLegL', boneName: '左ひざ', radius: 0.08, halfHeight: 0.14 },
    { name: 'lowerLegR', boneName: '右ひざ', radius: 0.08, halfHeight: 0.14 },
];

// ============================================================
// SdfCollider
// ============================================================

export class SdfCollider {
    capsules: SdfCapsule[] = [];

    /** 碰撞刚度（0~1，默认 1 = 全刚度），控制排斥力大小 */
    stiffness = 1.0;

    /** 碰撞摩擦系数（0~1），模拟表面摩擦力 */
    friction = 0.1;

    /** 每帧已摩擦过的粒子索引集合（防止多胶囊重复摩擦导致过度阻尼） */
    private _frictionApplied = new Set<number>();

    /**
     * 从规格初始化胶囊（运行时位置先放原点，由 updateMatrices 填充）
     */
    init(specs: CapsuleSpec[]): void {
        this.capsules = specs.map((s) => ({
            name: s.name,
            boneName: s.boneName,
            radius: s.radius,
            halfHeight: s.halfHeight,
            center: new Float32Array([0, 0, 0]),
            direction: new Float32Array([0, 1, 0]),
            enabled: true,
        }));
    }

    /**
     * 批量更新胶囊位置
     * @param matrices 16 元素 Float32Array 或 null 的数组（列主序 world matrix）
     *   null 表示该胶囊的骨骼未找到，跳过更新保留上次位置
     */
    updateMatrices(matrices: (Float32Array | null)[]): void {
        for (let i = 0; i < this.capsules.length && i < matrices.length; i++) {
            const m = matrices[i];
            if (!m) {
                continue;
            }
            const c = this.capsules[i];
            c.center[0] = m[12];
            c.center[1] = m[13];
            c.center[2] = m[14];
            c.direction[0] = m[4];
            c.direction[1] = m[5];
            c.direction[2] = m[6];
            const lenSq =
                c.direction[0] * c.direction[0] +
                c.direction[1] * c.direction[1] +
                c.direction[2] * c.direction[2];
            if (lenSq < 0.998001 || lenSq > 1.002001) {
                const len = Math.sqrt(lenSq);
                if (len > 1e-10) {
                    c.direction[0] /= len;
                    c.direction[1] /= len;
                    c.direction[2] /= len;
                }
            }
        }
    }

    /**
     * 主碰撞求解：将所有粒子推向胶囊外部
     * @param solver XPBD 求解器实例
     */
    solve(solver: XpbdSolver): void {
        this._frictionApplied.clear();
        for (const capsule of this.capsules) {
            if (!capsule.enabled) {
                continue;
            }
            this._solveCapsule(solver, capsule);
        }
    }

    // ---- SDF 胶囊→粒子碰撞 ----

    /**
     * 对单个胶囊求解所有粒子碰撞
     *
     * 胶囊 SDF: signedDistance = |point - nearestPointOnSegment| - radius
     * 超出胶囊的粒子被推回表面。
     */
    private _solveCapsule(solver: XpbdSolver, cap: SdfCapsule): void {
        const cx = cap.center[0];
        const cy = cap.center[1];
        const cz = cap.center[2];
        const dx = cap.direction[0];
        const dy = cap.direction[1];
        const dz = cap.direction[2];
        const radius = cap.radius;
        const hh = cap.halfHeight;

        // 胶囊端点：center ± direction * halfHeight
        const topX = cx + dx * hh;
        const topY = cy + dy * hh;
        const topZ = cz + dz * hh;
        const botX = cx - dx * hh;
        const botY = cy - dy * hh;
        const botZ = cz - dz * hh;

        // 线段方向向量
        const segX = topX - botX;
        const segY = topY - botY;
        const segZ = topZ - botZ;
        const segLenSq = segX * segX + segY * segY + segZ * segZ;

        for (let i = 0; i < solver.particles.length; i++) {
            const p = solver.particles[i];
            if (p.invMass === 0) {
                continue;
            }

            const px = p.p[0];
            const py = p.p[1];
            const pz = p.p[2];

            // 求点到线段最近点
            const toBotX = px - botX;
            const toBotY = py - botY;
            const toBotZ = pz - botZ;

            let t;
            if (segLenSq < 1e-12) {
                // 退化为球体
                t = 0;
            } else {
                t = (toBotX * segX + toBotY * segY + toBotZ * segZ) / segLenSq;
                t = Math.max(0, Math.min(1, t));
            }

            const nearX = botX + segX * t;
            const nearY = botY + segY * t;
            const nearZ = botZ + segZ * t;

            // 距离
            const diffX = px - nearX;
            const diffY = py - nearY;
            const diffZ = pz - nearZ;
            const dist = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);

            const minDist = radius + p.radius;
            if (dist >= minDist || dist < 1e-10) {
                continue;
            }

            // 穿透深度
            const penetration = minDist - dist;

            // 法线方向（粒子指向胶囊表面外侧）
            const nx = diffX / dist;
            const ny = diffY / dist;
            const nz = diffZ / dist;

            // 推出粒子（乘以刚度）
            p.p[0] += nx * penetration * this.stiffness;
            p.p[1] += ny * penetration * this.stiffness;
            p.p[2] += nz * penetration * this.stiffness;

            // 摩擦：基于 prevP 衰减切线速度（solver.step 末尾会覆写 p.v，直接改 v 无效）
            if (this.friction > 0 && !this._frictionApplied.has(i)) {
                this._frictionApplied.add(i);
                // 隐含速度 v = p - prevP
                const vx = p.p[0] - p.prevP[0];
                const vy = p.p[1] - p.prevP[1];
                const vz = p.p[2] - p.prevP[2];
                // 法线分量
                const vn = vx * nx + vy * ny + vz * nz;
                // 仅衰减切线分量，保留法线反弹
                const tvx = vx - vn * nx;
                const tvy = vy - vn * ny;
                const tvz = vz - vn * nz;
                // 写回 prevP: prevP = p - (vn*n + tv*(1-friction))
                p.prevP[0] = p.p[0] - (vn * nx + tvx * (1 - this.friction));
                p.prevP[1] = p.p[1] - (vn * ny + tvy * (1 - this.friction));
                p.prevP[2] = p.p[2] - (vn * nz + tvz * (1 - this.friction));
            }
        }
    }

    // ---- 管理 ----

    /** 开关单个胶囊 */
    setEnabled(index: number, enabled: boolean): void {
        if (index >= 0 && index < this.capsules.length) {
            this.capsules[index].enabled = enabled;
        }
    }

    /** 按名称开关胶囊 */
    setEnabledByName(name: string, enabled: boolean): void {
        const c = this.capsules.find((c) => c.name === name);
        if (c) {
            c.enabled = enabled;
        }
    }

    /** 全部开关 */
    setAllEnabled(enabled: boolean): void {
        for (const c of this.capsules) {
            c.enabled = enabled;
        }
    }

    /** 清空所有胶囊 */
    clear(): void {
        this.capsules = [];
    }

    /**
     * 根据骨骼世界矩阵动态更新胶囊规格（半径和半高）
     *
     * 对于每段骨骼（如 上半身→腰），根据骨骼距离动态调整胶囊半高。
     * 半径保持默认值（可根据模型大小缩放）。
     *
     * @param getBoneMatrix 根据骨骼名返回世界矩阵的函数
     * @param boneParentMap 骨骼名 → 父骨骼名的映射（用于计算骨骼长度）
     */
    updateCapsuleSizes(
        getBoneMatrix: (boneName: string) => Float32Array | null,
        boneParentMap?: Record<string, string>
    ): void {
        for (const capsule of this.capsules) {
            const boneName = capsule.boneName;
            const parentName = boneParentMap?.[boneName];

            if (parentName) {
                // 有父骨骼：根据骨骼距离计算半高
                const boneMat = getBoneMatrix(boneName);
                const parentMat = getBoneMatrix(parentName);

                if (boneMat && parentMat) {
                    const dx = boneMat[12] - parentMat[12];
                    const dy = boneMat[13] - parentMat[13];
                    const dz = boneMat[14] - parentMat[14];
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    // 半高 = 骨骼距离的 0.35 倍（保守一点防止卡住）
                    capsule.halfHeight = dist * 0.35;

                    // 半径 = 骨骼距离 × 0.3
                    // 匹配原始 MMD 刚体尺寸：size[0]=0.6 → 球半径 = 0.6*L*0.5 = 0.3*L
                    // 注意：MMD 刚体实际尺寸比布料预设更小，这样对齐可以减少撕裂但可能增加穿透风险
                    capsule.radius = dist * 0.3;
                }
            }

            // 如果没有父骨骼，保持默认半径和半高
        }
    }

    /**
     * 缩放所有胶囊的尺寸（用于适配不同大小的模型）
     * @param scaleFactor 缩放因子（1.0 = 原始大小）
     */
    scaleAll(scaleFactor: number): void {
        for (const capsule of this.capsules) {
            capsule.radius *= scaleFactor;
            capsule.halfHeight *= scaleFactor;
        }
    }
}
