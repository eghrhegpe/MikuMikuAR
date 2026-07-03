/**
 * XPBD (Extended Position Based Dynamics) 核心引擎
 *
 * 纯 TypeScript 实现，不依赖 WASM Bullet。
 * 用于布料模拟和软体物理，与 PMX 内建刚体链独立运行。
 *
 * 参考: Miles Macklin "XPBD: Position-Based Simulation of Compliant Constrained Dynamics"
 */

// ============================================================
// 接口
// ============================================================

/** 单个 XPBD 粒子 */
export interface XpbdParticle {
    /** 当前位置 [x, y, z] */
    p: Float32Array;
    /** 上一帧位置（Verlet 积分用） */
    prevP: Float32Array;
    /** 速度 [x, y, z] */
    v: Float32Array;
    /** 质量倒数 (1/mass)，0 = 固定/无限质量 */
    invMass: number;
    /** 碰撞半径 */
    radius: number;
}

/** 约束类型 */
export type ConstraintType = 'distance' | 'bend' | 'volume' | 'ground';

/** XPBD 约束 */
export interface XpbdConstraint {
    type: ConstraintType;
    /** 涉及的粒子索引 */
    indices: number[];
    /** 柔度 (compliance)，0 = 完全硬，值越大越软 */
    compliance: number;
    /** 静止值（距离 / 体积） */
    restValue: number;
    /** 拉格朗日乘子累积 */
    lambda: Float32Array;
}

/** 求解器配置 */
export interface XpbdSolverConfig {
    /** 重力 [x, y, z]，默认 [0, -9.8, 0] */
    gravity: [number, number, number];
    /** 子步数，默认 4 */
    substeps: number;
    /** 速度阻尼 (0~1)，每帧衰减，默认 0.98 */
    damping: number;
    /** 地面 Y 坐标，用于默认地面碰撞 */
    groundY: number;
}

const DEFAULT_CONFIG: XpbdSolverConfig = {
    gravity: [0, -9.8, 0],
    substeps: 4,
    damping: 0.98,
    groundY: -10,
};

// ============================================================
// XpbdSolver
// ============================================================

export class XpbdSolver {
    particles: XpbdParticle[] = [];
    constraints: XpbdConstraint[] = [];
    gravity: Float32Array;
    substeps: number;
    damping: number;
    groundY: number;

    /** 地面碰撞启用标志 */
    groundCollisionEnabled = false;

    /** 地面弹性系数（0=完全非弹性, 1=完全弹性），default 0.1 */
    restitution = 0.1;

    /** 粒子计数器（用于调试/统计） */
    private _particleCount = 0;

    constructor(config: Partial<XpbdSolverConfig> = {}) {
        const cfg = { ...DEFAULT_CONFIG, ...config };
        this.gravity = new Float32Array(cfg.gravity);
        this.substeps = cfg.substeps;
        this.damping = cfg.damping;
        this.groundY = cfg.groundY;
    }

    // ---- 粒子管理 ----

    /**
     * 添加一个粒子
     * @returns 粒子索引
     */
    addParticle(pos: [number, number, number] = [0, 0, 0], mass = 0.01, radius = 0.05): number {
        // mass <= 0 或 Infinity → invMass = 0（固定粒子）；NaN → 也视为固定
        const invMass = isFinite(mass) && mass > 0 ? 1.0 / mass : 0;
        const particle: XpbdParticle = {
            p: new Float32Array(pos),
            prevP: new Float32Array(pos),
            v: new Float32Array([0, 0, 0]),
            invMass,
            radius,
        };
        const idx = this.particles.length;
        this.particles.push(particle);
        this._particleCount++;
        return idx;
    }

    /** 批量添加多个粒子 */
    addParticles(
        positions: [number, number, number][],
        masses: number[],
        radii: number[]
    ): number[] {
        const count = positions.length;
        const indices: number[] = [];
        for (let i = 0; i < count; i++) {
            const m = masses[i] ?? 0.01;
            const r = radii[i] ?? 0.05;
            indices.push(this.addParticle(positions[i], m, r));
        }
        return indices;
    }

    /**
     * 软删除粒子——将 invMass 置 0，物理忽略但保持网格占位。
     *
     * 粒子设为固定后，所有涉及该粒子的约束被移除（无需再求解）。
     * 不使用 splice 的原因：外部持有 particleGrid 索引，splice 会导致索引失效。
     */
    removeParticle(idx: number): void {
        if (idx < 0 || idx >= this.particles.length) {
            return;
        }
        const p = this.particles[idx];
        if (p.invMass === 0) {
            return;
        }
        p.invMass = 0;
        this.constraints = this.constraints.filter((c) => !c.indices.includes(idx));
    }

    /** 清空所有粒子和约束 */
    reset(): void {
        this.particles = [];
        this.constraints = [];
        this._particleCount = 0;
    }

    // ---- 约束管理 ----

    /**
     * 添加距离约束（两个粒子之间的固定距离）
     * @param i 粒子 1 索引
     * @param j 粒子 2 索引
     * @param compliance 柔度 (0~1)，默认 0（完全刚性）
     * @param restLength 静止长度，不传则自动使用当前距离
     */
    addDistanceConstraint(i: number, j: number, compliance = 0.0, restLength?: number): void {
        const pi = this.particles[i].p;
        const pj = this.particles[j].p;
        const dx = pi[0] - pj[0];
        const dy = pi[1] - pj[1];
        const dz = pi[2] - pj[2];
        const d = restLength ?? Math.sqrt(dx * dx + dy * dy + dz * dz);

        this.constraints.push({
            type: 'distance',
            indices: [i, j],
            compliance: Math.max(0, compliance),
            restValue: d,
            lambda: new Float32Array(1),
        });
    }

    /**
     * 添加弯曲约束（连续三个粒子，保持 i 到 k 的距离）
     * 防止布料过度折叠
     */
    addBendConstraint(
        i: number,
        j: number,
        k: number,
        compliance = 0.0,
        restLength?: number
    ): void {
        const pi = this.particles[i].p;
        const pk = this.particles[k].p;
        const dx = pi[0] - pk[0];
        const dy = pi[1] - pk[1];
        const dz = pi[2] - pk[2];
        const d = restLength ?? Math.sqrt(dx * dx + dy * dy + dz * dz);

        this.constraints.push({
            type: 'bend',
            indices: [i, j, k],
            compliance: Math.max(0, compliance),
            restValue: d,
            lambda: new Float32Array(1),
        });
    }

    /**
     * 添加体积约束（四面体体积保持）
     * @param indices 4 个粒子索引（四面体的四个顶点）
     * @param compliance 柔度
     * @param restVolume 静止体积，不传则自动计算
     */
    addVolumeConstraint(indices: number[], compliance = 0.0, restVolume?: number): void {
        if (indices.length !== 4) {
            throw new Error('Volume constraint requires exactly 4 particles');
        }

        const [i0, i1, i2, i3] = indices;
        const p0 = this.particles[i0].p;
        const p1 = this.particles[i1].p;
        const p2 = this.particles[i2].p;
        const p3 = this.particles[i3].p;

        // 四面体体积 = |(p1-p0)·((p2-p0)×(p3-p0))| / 6
        const v = restVolume ?? this._tetraVolume(p0, p1, p2, p3);

        this.constraints.push({
            type: 'volume',
            indices: [...indices],
            compliance: Math.max(0, compliance),
            restValue: v,
            lambda: new Float32Array(1),
        });
    }

    /** 启用地面碰撞（Y 轴向上） */
    addGroundCollision(groundY?: number): void {
        if (groundY !== undefined) {
            this.groundY = groundY;
        }
        this.groundCollisionEnabled = true;
    }

    /** 关闭地面碰撞 */
    disableGroundCollision(): void {
        this.groundCollisionEnabled = false;
    }

    // ---- 核心求解器 ----

    /**
     * 主步进函数，每帧调用一次。
     *
     * 标准 XPBD 流程：每个子步内完成 Verlet 积分 → 约束求解 → 地面碰撞，
     * 确保外力和约束在同一时间尺度（subDt）上交互，子步数增加可提升精度。
     *
     * @param dt 时间步长（秒），如 1/60
     */
    step(dt: number): void {
        if (this.particles.length === 0) {
            return;
        }

        const invDt = 1.0 / dt;
        const subDt = dt / this.substeps;
        const alphaTilde = 1.0 / (subDt * subDt); // compliance → α̃ 转换因子

        // 每个子步：Verlet 积分 + 约束求解 + 地面碰撞
        for (let s = 0; s < this.substeps; s++) {
            // ---- 子步内 Verlet 积分 ----
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p.invMass === 0) {
                    continue;
                }

                const px = p.p[0],
                    py = p.p[1],
                    pz = p.p[2];
                const prevX = p.prevP[0],
                    prevY = p.prevP[1],
                    prevZ = p.prevP[2];

                // 速度（带阻尼）: v = (p - prevP) * damping / subDt
                let vx = ((px - prevX) * this.damping) / subDt;
                let vy = ((py - prevY) * this.damping) / subDt;
                let vz = ((pz - prevZ) * this.damping) / subDt;

                // 重力: v += gravity * subDt
                vx += this.gravity[0] * subDt;
                vy += this.gravity[1] * subDt;
                vz += this.gravity[2] * subDt;

                // 保存旧位置
                p.prevP[0] = px;
                p.prevP[1] = py;
                p.prevP[2] = pz;

                // p += v * subDt
                p.p[0] = px + vx * subDt;
                p.p[1] = py + vy * subDt;
                p.p[2] = pz + vz * subDt;
            }

            // ---- 约束求解 ----
            for (const c of this.constraints) {
                this._solveConstraint(c, alphaTilde);
            }

            // ---- 地面碰撞 ----
            if (this.groundCollisionEnabled) {
                for (let i = 0; i < this.particles.length; i++) {
                    const p = this.particles[i];
                    if (p.invMass === 0) {
                        continue;
                    }
                    const ground = this.groundY + p.radius;
                    if (p.p[1] < ground) {
                        // 垂直速度 = (p - prevP) / subDt，反弹部分速度
                        const vy = (p.p[1] - p.prevP[1]) / subDt;
                        p.p[1] = ground;
                        // prevP: 产生反弹速度（restitution）的反向分量
                        p.prevP[1] = p.p[1] + vy * this.restitution * subDt;
                    }
                }
            }
        }

        // ---- 最终速度更新 ----
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.invMass === 0) {
                p.v[0] = 0;
                p.v[1] = 0;
                p.v[2] = 0;
                continue;
            }
            p.v[0] = (p.p[0] - p.prevP[0]) * invDt;
            p.v[1] = (p.p[1] - p.prevP[1]) * invDt;
            p.v[2] = (p.p[2] - p.prevP[2]) * invDt;
        }
    }

    // ---- 内部约束求解 ----

    /**
     * 求解单个约束（XPBD 公式）
     *
     * 距离约束: C(p_i, p_j) = |p_i - p_j| - restLength
     * 弯曲约束: C(p_i, p_k) = |p_i - p_k| - restLength  (skip j in distance)
     * 体积约束: C = 6 * V - restVolume
     */
    private _solveConstraint(c: XpbdConstraint, alphaTilde: number): void {
        switch (c.type) {
            case 'distance':
            case 'bend':
                this._solveDistanceConstraint(c, alphaTilde);
                break;
            case 'volume':
                this._solveVolumeConstraint(c, alphaTilde);
                break;
        }
    }

    /** 距离/弯曲约束求解 */
    private _solveDistanceConstraint(c: XpbdConstraint, alphaTilde: number): void {
        // 距离约束和弯曲约束都使用两个端点粒子：i 和最后一个粒子 k
        const i = c.indices[0];
        const k = c.indices[c.indices.length - 1];

        const pi = this.particles[i];
        const pk = this.particles[k];

        const dx = pi.p[0] - pk.p[0];
        const dy = pi.p[1] - pk.p[1];
        const dz = pi.p[2] - pk.p[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 1e-10) {
            return;
        } // 避免除零

        const wSum = pi.invMass + pk.invMass;
        if (wSum < 1e-10) {
            return;
        } // 两个粒子都固定

        // C = dist - restLength
        const C = dist - c.restValue;

        // ∇C·M⁻¹·∇C = pi.invMass + pk.invMass = wSum
        // (梯度是单位方向向量，点乘自身 = 1)
        const denom = wSum + c.compliance * alphaTilde;

        // Δλ = -(C + α̃ * λ) / (∇C·M⁻¹·∇C + α̃)
        const dLambda = -(C + c.compliance * alphaTilde * c.lambda[0]) / denom;
        c.lambda[0] += dLambda;

        // Δp = -Δλ * M⁻¹ * ∇C
        // ∇C direction: (pi - pk) / dist
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // Δp = dLambda * M⁻¹ * ∇C
        // ∇C_i = (pi - pk) / dist, ∇C_k = (pk - pi) / dist = -∇C_i
        pi.p[0] += dLambda * pi.invMass * nx;
        pi.p[1] += dLambda * pi.invMass * ny;
        pi.p[2] += dLambda * pi.invMass * nz;

        pk.p[0] -= dLambda * pk.invMass * nx;
        pk.p[1] -= dLambda * pk.invMass * ny;
        pk.p[2] -= dLambda * pk.invMass * nz;
    }

    /** 体积约束求解（四面体） */
    private _solveVolumeConstraint(c: XpbdConstraint, alphaTilde: number): void {
        const [i0, i1, i2, i3] = c.indices;
        const p0 = this.particles[i0];
        const p1 = this.particles[i1];
        const p2 = this.particles[i2];
        const p3 = this.particles[i3];

        // 当前体积
        const V = this._tetraVolume(p0.p, p1.p, p2.p, p3.p);

        // 计算梯度（每个顶点的面积法向量 / 3）
        const grads = this._tetraVolumeGradients(p0.p, p1.p, p2.p, p3.p);
        const particles = [p0, p1, p2, p3];

        // ∇C·M⁻¹·∇C = Σ invMass_i * |grad_i|²
        let wSum = 0;
        for (let i = 0; i < 4; i++) {
            const g = grads[i];
            wSum += particles[i].invMass * (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]);
        }
        if (wSum < 1e-10) {
            return;
        }

        const C = 6.0 * V - c.restValue; // 乘以 6 免得梯度太小
        const denom = wSum + c.compliance * alphaTilde;
        const dLambda = -(C + c.compliance * alphaTilde * c.lambda[0]) / denom;
        c.lambda[0] += dLambda;

        // Δp_i = dLambda * invMass_i * ∇C_i
        for (let i = 0; i < 4; i++) {
            const g = grads[i];
            const mass = particles[i].invMass;
            particles[i].p[0] += dLambda * mass * g[0];
            particles[i].p[1] += dLambda * mass * g[1];
            particles[i].p[2] += dLambda * mass * g[2];
        }
    }

    // ---- 几何工具 ----

    /** 计算四面体体积（有符号） */
    private _tetraVolume(
        p0: Float32Array,
        p1: Float32Array,
        p2: Float32Array,
        p3: Float32Array
    ): number {
        // V = (p1-p0)·((p2-p0)×(p3-p0)) / 6
        const e10 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const e20 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const e30 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];

        const cx = e20[1] * e30[2] - e20[2] * e30[1];
        const cy = e20[2] * e30[0] - e20[0] * e30[2];
        const cz = e20[0] * e30[1] - e20[1] * e30[0];

        return (e10[0] * cx + e10[1] * cy + e10[2] * cz) / 6.0;
    }

    /**
     * 计算四面体四个顶点的体积梯度。
     *
     * 四面体体积 V = 1/6 * |(p1-p0)·((p2-p0)×(p3-p0))|
     *
     * 对顶点 i 的梯度 ∇_i V = -1/6 * (对边的面积法向量)
     * 即 grad_i = -1/6 * ((p_j - p_k) × (p_l - p_k))，其中 j,k,l 是其余三个顶点
     *
     * 返回 [grad0, grad1, grad2, grad3]
     * 每个 grad 是 [x, y, z]
     */
    private _tetraVolumeGradients(
        p0: Float32Array,
        p1: Float32Array,
        p2: Float32Array,
        p3: Float32Array
    ): [number, number, number][] {
        const pts = [p0, p1, p2, p3];
        const grads: [number, number, number][] = [];

        // 顶点排列：(0,1,2,3)
        // 对顶点 i：取 j=(i+1)%4, k=(i+2)%4, l=(i+3)%4
        // grad_i = -1/6 * ((p_j - p_k) × (p_l - p_k))
        for (let i = 0; i < 4; i++) {
            const pj = pts[(i + 1) % 4];
            const pk = pts[(i + 2) % 4];
            const pl = pts[(i + 3) % 4];

            const e1x = pj[0] - pk[0],
                e1y = pj[1] - pk[1],
                e1z = pj[2] - pk[2];
            const e2x = pl[0] - pk[0],
                e2y = pl[1] - pk[1],
                e2z = pl[2] - pk[2];

            // cross(e1, e2)
            const cx = e1y * e2z - e1z * e2y;
            const cy = e1z * e2x - e1x * e2z;
            const cz = e1x * e2y - e1y * e2x;

            // grad_i = -1/6 * cross
            grads.push([-cx / 6, -cy / 6, -cz / 6]);
        }

        return grads;
    }

    // ---- 查询 ----

    /** 粒子总数 */
    get particleCount(): number {
        return this._particleCount;
    }

    /** 约束总数 */
    get constraintCount(): number {
        return this.constraints.length;
    }

    /** 获取当前总动能（调试用） */
    getKineticEnergy(): number {
        let ke = 0;
        for (const p of this.particles) {
            if (p.invMass === 0) {
                continue;
            }
            const mass = 1.0 / p.invMass;
            ke += 0.5 * mass * (p.v[0] * p.v[0] + p.v[1] * p.v[1] + p.v[2] * p.v[2]);
        }
        return ke;
    }

    /** 设置重力 */
    setGravity(x: number, y: number, z: number): void {
        this.gravity[0] = x;
        this.gravity[1] = y;
        this.gravity[2] = z;
    }
}
