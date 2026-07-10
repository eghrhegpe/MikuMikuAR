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
    /** 角向姿态四元数 [x, y, z, w]，默认 [0,0,0,1]（identity）。
     *  纯 TS 存储，不依赖 Babylon Quaternion，保持 solver 纯净。 */
    orientation: Float32Array;
    /** 上一帧角向姿态（角向 Verlet 积分用） */
    prevOrientation: Float32Array;
    /** 角速度 [x, y, z] */
    angularVelocity: Float32Array;
    /** 转动惯量倒数 (1/I)，0 = 固定/无限惯量（与 invMass=0 语义对齐） */
    invInertia: number;
}

/** 约束类型 */
export type ConstraintType = 'distance' | 'bend' | 'volume' | 'ground' | 'sphere';

/** XPBD 约束 */
export interface XpbdConstraint {
    type: ConstraintType;
    /** 涉及的粒子索引 */
    indices: number[];
    /** 柔度 (compliance)，0 = 完全硬，值越大越软（逆刚度） */
    compliance: number;
    /** 静止值（距离 / 体积） */
    restValue: number;
    /** 拉格朗日乘子累积 */
    lambda: Float32Array;
    /**
     * 刚度 (0~1)，约束修正力度缩放因子。
     * 1.0 = 完全修正（默认），0.0 = 无修正。
     * 与 compliance 独立：compliance 控制弹性，stiffness 缩放单帧修正量。
     */
    stiffness: number;
    /**
     * 约束方向阻尼 (0~1)，沿约束方向的速度衰减系数。
     * 0.0 = 无阻尼（默认），值越大振动衰减越快。
     * 对 Volume 约束暂不生效。
     */
    damping: number;
    /** sphere 专属：圆锥限位半角（弧度），swing 摆动不超过此角 */
    coneHalfAngle?: number;
    /** sphere 专属：twist 扭转范围 [min, max]（弧度） */
    twistRange?: [number, number];
    /** sphere 专属：rest 姿态的相对四元数 [x,y,z,w]，约束目标 */
    restQuaternion?: Float32Array;
}

/**
 * 单个骨骼胶囊碰撞体（运行时数据，从 SdfCollider 同步）。
 * 与 xpbd-collider.ts 的 SdfCapsule 一致但不依赖 SdfCollider 类型，
 * 允许 XpbdSolver 在无外部依赖的情况下处理骨骼碰撞。
 */
export interface SolverCapsule {
    /** 胶囊名称（如 "chest"） */
    name: string;
    /** 关联的骨骼名（用于 boneFilter 匹配） */
    boneName: string;
    /** 半径 */
    radius: number;
    /** 半高（中心到端点的距离） */
    halfHeight: number;
    /** 世界空间中心位置 [x, y, z] */
    center: Float32Array;
    /** 世界空间方向（单位向量）[x, y, z] */
    direction: Float32Array;
    /** 启用标志 */
    enabled: boolean;
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
    /** 风场启用标志（默认 false，无风） */
    windEnabled?: boolean;
    /** 风向单位向量 [x, y, z]（默认 [0,0,0]） */
    windDirection?: [number, number, number];
    /** 风速 / 风力强度（默认 0，无风） */
    windStrength?: number;
}

export const DEFAULT_CONFIG: XpbdSolverConfig = {
  gravity: [0, -9.8, 0],
  substeps: 4,
  damping: 0.98,
  groundY: -10,
    windEnabled: false,
    windDirection: [0, 0, 0],
    windStrength: 0,
};

/**
 * 使用例（stiffness / damping 参数）：
 *
 * ```ts
 * // 软弹簧（stiffness=0.3 只修正 30%）
 * solver.addDistanceConstraint(a, b, 0, 1.0, 0.3);
 *
 * // 带阻尼的距离约束（damping=0.5 减振）
 * solver.addDistanceConstraint(a, b, 0.01, 0.5, 1.0, 0.5);
 *
 * // 默认值=完全刚性无阻尼（老代码向后兼容）
 * solver.addDistanceConstraint(a, b);    // compliance=0, stiffness=1, damping=0
 * ```
 */

// ============================================================
// 纯 TS 四元数运算（保持 solver 无 Babylon 依赖）
// 四元数格式 [x, y, z, w]，w 为标量部分
// ============================================================

/** 归一化四元数 */
export function quatNormalize(src: Float32Array, out: Float32Array): void {
    const len = Math.sqrt(src[0]*src[0] + src[1]*src[1] + src[2]*src[2] + src[3]*src[3]);
    if (len < 1e-10) { out[0]=0; out[1]=0; out[2]=0; out[3]=1; return; }
    const inv = 1 / len;
    out[0] = src[0]*inv; out[1] = src[1]*inv; out[2] = src[2]*inv; out[3] = src[3]*inv;
}

/** 四元数乘法 out = a × b（Babylon 约定，行向量 v' = v × M 对应 q' = q_a × q_b） */
export function quatMultiply(a: Float32Array, b: Float32Array, out: Float32Array): void {
    const ax=a[0], ay=a[1], az=a[2], aw=a[3];
    const bx=b[0], by=b[1], bz=b[2], bw=b[3];
    out[0] = aw*bx + ax*bw + ay*bz - az*by;
    out[1] = aw*by - ax*bz + ay*bw + az*bx;
    out[2] = aw*bz + ax*by - ay*bx + az*bw;
    out[3] = aw*bw - ax*bx - ay*by - az*bz;
}

/** 共轭（单位四元数的逆） */
export function quatConjugate(src: Float32Array, out: Float32Array): void {
    out[0] = -src[0]; out[1] = -src[1]; out[2] = -src[2]; out[3] = src[3];
}

/** 从轴角构造四元数，返回新 Float32Array(4) */
export function quatFromAxisAngle(x: number, y: number, z: number, angle: number): Float32Array {
    const half = angle * 0.5;
    const s = Math.sin(half);
    return new Float32Array([x*s, y*s, z*s, Math.cos(half)]);
}

/** 四元数转轴角，返回 {ax, ay, az, angle} */
export function quatToAxisAngle(q: Float32Array): { ax: number; ay: number; az: number; angle: number } {
    const w = Math.max(-1, Math.min(1, q[3]));
    const angle = 2 * Math.acos(w);
    const s = Math.sqrt(1 - w*w);
    if (s < 1e-10) return { ax: 1, ay: 0, az: 0, angle: 0 };
    return { ax: q[0]/s, ay: q[1]/s, az: q[2]/s, angle };
}

/** 球面线性插值 */
export function quatSlerp(a: Float32Array, b: Float32Array, t: number, out: Float32Array): void {
    let dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
    let bx=b[0], by=b[1], bz=b[2], bw=b[3];
    if (dot < 0) { bx=-bx; by=-by; bz=-bz; bw=-bw; dot=-dot; }
    if (dot > 0.9995) {
        out[0] = a[0] + (bx-a[0])*t; out[1] = a[1] + (by-a[1])*t;
        out[2] = a[2] + (bz-a[2])*t; out[3] = a[3] + (bw-a[3])*t;
        quatNormalize(out, out); return;
    }
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    const ka = Math.sin((1-t)*theta) / sinTheta;
    const kb = Math.sin(t*theta) / sinTheta;
    out[0] = a[0]*ka + bx*kb; out[1] = a[1]*ka + by*kb;
    out[2] = a[2]*ka + bz*kb; out[3] = a[3]*ka + bw*kb;
}

/**
 * Swing-Twist 分解：将 q 分解为 swing（绕垂直于 twistAxis 的平面）× twist（绕 twistAxis）。
 * twist = normalize( projection of q.xyz onto twistAxis )，保留 q.w。
 * swing = q × twist⁻¹ = q × conj(twist)（单位四元数逆=共轭）。
 * @param q 待分解四元数
 * @param tx,ty,tz twist 轴（单位向量）
 * @param swingOut 输出 swing 四元数
 * @param twistOut 输出 twist 四元数
 */
export function swingTwistDecompose(
    q: Float32Array, tx: number, ty: number, tz: number,
    swingOut: Float32Array, twistOut: Float32Array
): void {
    const dot = q[0]*tx + q[1]*ty + q[2]*tz;
    twistOut[0] = dot*tx; twistOut[1] = dot*ty; twistOut[2] = dot*tz; twistOut[3] = q[3];
    quatNormalize(twistOut, twistOut);
    const twistInv = new Float32Array(4);
    quatConjugate(twistOut, twistInv);
    quatMultiply(q, twistInv, swingOut);
    quatNormalize(swingOut, swingOut);
}

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

    // ---- 骨骼碰撞体（从 SdfCollider 同步，用于子步内穿透检测） ----

    /** 骨骼碰撞体数组（每帧从 SdfCollider 同步），空数组 = 跳过骨骼碰撞 */
    collisionCapsules: SolverCapsule[] = [];

    /** 骨骼碰撞过滤列表。
     *  空数组 = 检查所有碰撞体；非空 = 仅检查 boneName 在此列表中的碰撞体。
     *  与 VmdLayer.boneFilter 语义一致。 */
    boneFilter: string[] = [];

    /** 主开关：启用后在 _resolvePenetrations() 中子步级别检测粒子-骨骼碰撞 */
    boneCollisionEnabled = false;

    // ---- 风场配置 ----

    /** 风场启用标志（默认 false） */
    windEnabled = false;

    /** 风向单位向量 [x, y, z]（默认 [0, 0, 0] = 无方向） */
    windDirection: [number, number, number] = [0, 0, 0];

    /** 风力强度（越大风越强，默认 0 = 无风） */
    windStrength = 0;

    /** 粒子计数器（用于调试/统计） */
    private _particleCount = 0;

    constructor(config: Partial<XpbdSolverConfig> = {}) {
        const cfg = { ...DEFAULT_CONFIG, ...config };
        this.gravity = new Float32Array(cfg.gravity);
        this.substeps = cfg.substeps;
        this.damping = cfg.damping;
        this.groundY = cfg.groundY;
        // 风场配置（默认值由 DEFAULT_CONFIG 提供，windEnabled=false 则无风）
        this.windEnabled = cfg.windEnabled ?? false;
        this.windDirection = cfg.windDirection ?? [0, 0, 0];
        this.windStrength = cfg.windStrength ?? 0;
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
            orientation: new Float32Array([0, 0, 0, 1]),
            prevOrientation: new Float32Array([0, 0, 0, 1]),
            angularVelocity: new Float32Array(3),
            invInertia: invMass === 0 ? 0 : 1,
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
     * @param stiffness 刚度 (0~1)，修正量缩放，默认 1.0（完全修正）
     * @param damping 约束方向阻尼 (0~1)，默认 0.0（无阻尼）
     */
    addDistanceConstraint(
        i: number,
        j: number,
        compliance = 0.0,
        restLength?: number,
        stiffness = 1.0,
        damping = 0.0
    ): void {
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
            stiffness: Math.max(0, Math.min(1, stiffness)),
            damping: Math.max(0, Math.min(1, damping)),
        });
    }

    /**
     * 添加弯曲约束（连续三个粒子，保持 i 到 k 的距离）
     * 防止布料过度折叠
     * @param stiffness 刚度 (0~1)，修正量缩放，默认 1.0
     * @param damping 约束方向阻尼 (0~1)，默认 0.0
     */
    addBendConstraint(
        i: number,
        j: number,
        k: number,
        compliance = 0.0,
        restLength?: number,
        stiffness = 1.0,
        damping = 0.0
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
            stiffness: Math.max(0, Math.min(1, stiffness)),
            damping: Math.max(0, Math.min(1, damping)),
        });
    }

    /**
     * 添加体积约束（四面体体积保持）
     * @param indices 4 个粒子索引（四面体的四个顶点）
     * @param compliance 柔度
     * @param restVolume 静止体积，不传则自动计算
     * @param stiffness 刚度 (0~1)，修正量缩放，默认 1.0
     * @param damping 约束方向阻尼 (0~1)，默认 0.0（对体积约束暂不生效）
     */
    addVolumeConstraint(
        indices: number[],
        compliance = 0.0,
        restVolume?: number,
        stiffness = 1.0,
        _damping = 0.0
    ): void {
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
            stiffness: Math.max(0, Math.min(1, stiffness)),
            damping: Math.max(0, Math.min(1, _damping)),
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

                // 风场力: v += windDirection * windStrength * subDt（带随机扰动产生自然飘动）
                // 仅在 windEnabled=true 且 windStrength>0 时生效
                if (this.windEnabled && this.windStrength > 0) {
                    // 每粒子随机因子 0.6~1.4，使布料产生自然起伏/飘动效果
                    const flutter = 0.6 + Math.random() * 0.8;
                    vx += this.windDirection[0] * this.windStrength * subDt * flutter;
                    vy += this.windDirection[1] * this.windStrength * subDt * flutter;
                    vz += this.windDirection[2] * this.windStrength * subDt * flutter;
                }

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
                this._solveConstraint(c, alphaTilde, subDt);
            }

            // ---- 角向状态维护：约束求解后归一化 orientation ----
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p.invInertia === 0) continue;
                quatNormalize(p.orientation, p.orientation);
            }

            // ---- 粒子间穿透检测 ----
            this._resolvePenetrations();

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
     *
     * @param subDt 子步时间步长，用于约束阻尼计算
     */
    private _solveConstraint(c: XpbdConstraint, alphaTilde: number, subDt: number): void {
        switch (c.type) {
            case 'distance':
            case 'bend':
                this._solveDistanceConstraint(c, alphaTilde, subDt);
                break;
            case 'volume':
                this._solveVolumeConstraint(c, alphaTilde, subDt);
                break;
            case 'sphere':
                this._solveSphereConstraint(c, alphaTilde, subDt);
                break;
        }
    }

    /** 距离/弯曲约束求解 */
    private _solveDistanceConstraint(c: XpbdConstraint, alphaTilde: number, subDt: number): void {
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

        // ∇C direction: (pi - pk) / dist
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // ---- 刚度缩放 ----
        // stiffness 缩放修正量：1.0 = 完全修正，0.5 = 半修正，0.0 = 无修正
        const s = c.stiffness;

        // Δp = dLambda * M⁻¹ * ∇C * stiffness
        // ∇C_i = (pi - pk) / dist, ∇C_k = (pk - pi) / dist = -∇C_i
        pi.p[0] += dLambda * pi.invMass * nx * s;
        pi.p[1] += dLambda * pi.invMass * ny * s;
        pi.p[2] += dLambda * pi.invMass * nz * s;

        pk.p[0] -= dLambda * pk.invMass * nx * s;
        pk.p[1] -= dLambda * pk.invMass * ny * s;
        pk.p[2] -= dLambda * pk.invMass * nz * s;

        // ---- 约束方向阻尼 ----
        // 沿约束方向阻尼相对速度，减少振荡
        if (c.damping > 0) {
            // 当前相对速度沿约束方向 (from verlet: v = (p - prevP) / subDt)
            const vix = (pi.p[0] - pi.prevP[0]) / subDt;
            const viy = (pi.p[1] - pi.prevP[1]) / subDt;
            const viz = (pi.p[2] - pi.prevP[2]) / subDt;
            const vkx = (pk.p[0] - pk.prevP[0]) / subDt;
            const vky = (pk.p[1] - pk.prevP[1]) / subDt;
            const vkz = (pk.p[2] - pk.prevP[2]) / subDt;

            // 相对速度沿法线分量
            const relVn = (vix - vkx) * nx + (viy - vky) * ny + (viz - vkz) * nz;

            // 阻尼修正：修改 prevP 以影响下一帧速度
            // impulse = -damping * relVn / wSum
            const dampFactor = c.damping / (wSum + 1e-10);
            const dampDelta = -dampFactor * relVn * subDt;

            pi.prevP[0] += dampDelta * pi.invMass * nx;
            pi.prevP[1] += dampDelta * pi.invMass * ny;
            pi.prevP[2] += dampDelta * pi.invMass * nz;
            pk.prevP[0] -= dampDelta * pk.invMass * nx;
            pk.prevP[1] -= dampDelta * pk.invMass * ny;
            pk.prevP[2] -= dampDelta * pk.invMass * nz;
        }
    }

    /** 体积约束求解（四面体） */
    private _solveVolumeConstraint(c: XpbdConstraint, alphaTilde: number, _subDt: number): void {
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

        // Δp_i = dLambda * invMass_i * ∇C_i * stiffness
        const s = c.stiffness;
        for (let i = 0; i < 4; i++) {
            const g = grads[i];
            const mass = particles[i].invMass;
            particles[i].p[0] += dLambda * mass * g[0] * s;
            particles[i].p[1] += dLambda * mass * g[1] * s;
            particles[i].p[2] += dLambda * mass * g[2] * s;
        }
    }

    /**
     * 球窝（sphere）约束求解：3-DOF 角向限位。
     * 分解为 swing（2D，锥面内摆动，限 coneHalfAngle）+ twist（1D，绕局部 Z 扭转，限 twistRange）。
     * 各自 XPBD 标量 λ：lambda[0]=swing, lambda[1]=twist。
     * 角度约束，对称化用 invInertia（非 invMass）。
     */
    private _solveSphereConstraint(c: XpbdConstraint, alphaTilde: number, _subDt: number): void {
        const i = c.indices[0];
        const k = c.indices[1];
        const pi = this.particles[i];
        const pk = this.particles[k];

        const wSum = pi.invInertia + pk.invInertia;
        if (wSum < 1e-10) return; // 两端均固定

        // 相对旋转 q_rel = q_child × q_parent⁻¹（child 相对 parent 的姿态）
        const qParentInv = new Float32Array(4);
        quatConjugate(pi.orientation, qParentInv);
        const qRel = new Float32Array(4);
        quatMultiply(pk.orientation, qParentInv, qRel);
        quatNormalize(qRel, qRel);

        // 减去 rest 姿态：qErr = qRel × restQuaternion⁻¹
        const restQ = c.restQuaternion ?? new Float32Array([0,0,0,1]);
        const restInv = new Float32Array(4);
        quatConjugate(restQ, restInv);
        const qErr = new Float32Array(4);
        quatMultiply(qRel, restInv, qErr);
        quatNormalize(qErr, qErr);

        // swing-twist 分解，twist 轴 = 局部 Z [0,0,1]
        const swing = new Float32Array(4);
        const twist = new Float32Array(4);
        swingTwistDecompose(qErr, 0, 0, 1, swing, twist);

        // ---- swing 限位（cone）----
        const swingAA = quatToAxisAngle(swing);
        const coneHalf = c.coneHalfAngle ?? Math.PI;
        if (swingAA.angle > coneHalf) {
            const C_swing = swingAA.angle - coneHalf;
            const denom = wSum + (c.compliance ?? 0) * alphaTilde;
            if (denom > 1e-10) {
                const dLambda = -(C_swing + (c.compliance ?? 0) * alphaTilde * c.lambda[0]) / denom;
                c.lambda[0] += dLambda;
                const s = c.stiffness;
                const corrAngle = dLambda * s;
                const corrQuat = quatFromAxisAngle(swingAA.ax, swingAA.ay, swingAA.az, corrAngle);
                // 对称化：parent 反向，child 正向
                const newChild = new Float32Array(4);
                quatMultiply(corrQuat, pk.orientation, newChild);
                quatNormalize(newChild, pk.orientation);
                const corrInv = new Float32Array(4);
                quatConjugate(corrQuat, corrInv);
                const newParent = new Float32Array(4);
                quatMultiply(corrInv, pi.orientation, newParent);
                quatNormalize(newParent, pi.orientation);
            }
        }

        // ---- twist 限位（clamped range）----
        const twistAA = quatToAxisAngle(twist);
        let twistAngle = twistAA.angle;
        if (twistAA.az < 0) twistAngle = -twistAngle;
        const twistRange = c.twistRange ?? [-Math.PI, Math.PI];
        const twistMin = twistRange[0];
        const twistMax = twistRange[1];
        if (twistAngle < twistMin || twistAngle > twistMax) {
            const clamped = Math.max(twistMin, Math.min(twistMax, twistAngle));
            const C_twist = twistAngle - clamped;
            const denom = wSum + (c.compliance ?? 0) * alphaTilde;
            if (denom > 1e-10) {
                const dLambda = -(C_twist + (c.compliance ?? 0) * alphaTilde * c.lambda[1]) / denom;
                c.lambda[1] += dLambda;
                const s = c.stiffness;
                const corrAngle = dLambda * s;
                const corrQuat = quatFromAxisAngle(0, 0, 1, corrAngle);
                const newChild = new Float32Array(4);
                quatMultiply(corrQuat, pk.orientation, newChild);
                quatNormalize(newChild, pk.orientation);
                const corrInv = new Float32Array(4);
                quatConjugate(corrQuat, corrInv);
                const newParent = new Float32Array(4);
                quatMultiply(corrInv, pi.orientation, newParent);
                quatNormalize(newParent, pi.orientation);
            }
        }
    }

    // ---- 穿透检测 ----

    /**
     * 检测并解决粒子间以及粒子-骨骼碰撞体间的相互穿透。
     *
     * 第一部分（原有）：遍历所有距离/弯曲约束的端点对，如果粒子间距离小于半径和，
     * 说明发生了穿透（快速运动或大时间步导致约束未能阻止重叠），
     * 将粒子沿分离方向推开消除重叠。
     *
     * 第二部分（boneFilter 骨骼碰撞）：当 boneCollisionEnabled 为 true 时，
     * 检查每个粒子与 collisionCapsules 中每个启用胶囊体的穿透。
     * 如果 boneFilter 非空，仅检测 boneName 在 filter 中的胶囊体。
     * 穿透后沿胶囊体法线方向推开粒子，不修改胶囊体位置（胶囊体视为静态碰撞体）。
     */
    private _resolvePenetrations(): void {
        // ---- 粒子-粒子穿透检测（原有逻辑） ----
        const visited = new Set<string>();

        for (const c of this.constraints) {
            if (c.type === 'distance' || c.type === 'bend') {
                const i = c.indices[0];
                const k = c.indices[c.indices.length - 1];

                // 避免重复处理同一对 (a,b)
                const key = i < k ? `${i},${k}` : `${k},${i}`;
                if (visited.has(key)) {
                    continue;
                }
                visited.add(key);

                const pi = this.particles[i];
                const pk = this.particles[k];

                const dx = pi.p[0] - pk.p[0];
                const dy = pi.p[1] - pk.p[1];
                const dz = pi.p[2] - pk.p[2];
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                const minDist = pi.radius + pk.radius;
                if (dist >= minDist || dist < 1e-10) {
                    continue;
                }

                const nx = dx / dist;
                const ny = dy / dist;
                const nz = dz / dist;

                const wSum = pi.invMass + pk.invMass;
                if (wSum < 1e-10) {
                    continue;
                }

                // 穿透深度
                const overlap = minDist - dist;
                // 按质量倒数比例推开
                const push = overlap / wSum;

                pi.p[0] += push * pi.invMass * nx;
                pi.p[1] += push * pi.invMass * ny;
                pi.p[2] += push * pi.invMass * nz;
                pk.p[0] -= push * pk.invMass * nx;
                pk.p[1] -= push * pk.invMass * ny;
                pk.p[2] -= push * pk.invMass * nz;
            }
        }

        // ---- 粒子-骨骼碰撞体穿透检测（boneFilter 过滤） ----
        if (!this.boneCollisionEnabled || this.collisionCapsules.length === 0) {
            return;
        }

        // 预构建 boneFilter 查找集（仅一次）
        const filterSet = this.boneFilter.length > 0 ? new Set(this.boneFilter) : null;

        for (let ci = 0; ci < this.collisionCapsules.length; ci++) {
            const cap = this.collisionCapsules[ci];
            if (!cap.enabled) {
                continue;
            }

            // boneFilter 过滤：非空时仅检查列出的骨骼
            if (filterSet && !filterSet.has(cap.boneName)) {
                continue;
            }

            // 胶囊参数：端点 c ± direction * halfHeight
            const cx = cap.center[0];
            const cy = cap.center[1];
            const cz = cap.center[2];
            const dx = cap.direction[0];
            const dy = cap.direction[1];
            const dz = cap.direction[2];
            const radius = cap.radius;
            const hh = cap.halfHeight;

            const topX = cx + dx * hh;
            const topY = cy + dy * hh;
            const topZ = cz + dz * hh;
            const botX = cx - dx * hh;
            const botY = cy - dy * hh;
            const botZ = cz - dz * hh;

            const segX = topX - botX;
            const segY = topY - botY;
            const segZ = topZ - botZ;
            const segLenSq = segX * segX + segY * segY + segZ * segZ;

            for (let pi = 0; pi < this.particles.length; pi++) {
                const p = this.particles[pi];
                if (p.invMass === 0) {
                    continue; // 固定粒子不碰撞
                }

                const px = p.p[0];
                const py = p.p[1];
                const pz = p.p[2];

                // 点到胶囊线段最近点
                const toBotX = px - botX;
                const toBotY = py - botY;
                const toBotZ = pz - botZ;

                let t: number;
                if (segLenSq < 1e-12) {
                    t = 0; // 退化为球体
                } else {
                    t = (toBotX * segX + toBotY * segY + toBotZ * segZ) / segLenSq;
                    t = Math.max(0, Math.min(1, t));
                }

                const nearX = botX + segX * t;
                const nearY = botY + segY * t;
                const nearZ = botZ + segZ * t;

                const diffX = px - nearX;
                const diffY = py - nearY;
                const diffZ = pz - nearZ;
                const dist = Math.sqrt(diffX * diffX + diffY * diffY + diffZ * diffZ);

                const minDist = radius + p.radius;
                if (dist >= minDist || dist < 1e-10) {
                    continue; // 未穿透
                }

                // 穿透深度
                const penetration = minDist - dist;

                // 单位法线（粒子指向胶囊表面外侧）
                const nx = diffX / dist;
                const ny = diffY / dist;
                const nz = diffZ / dist;

                // 沿法线推开粒子（胶囊体视为刚性，不移动）
                p.p[0] += nx * penetration;
                p.p[1] += ny * penetration;
                p.p[2] += nz * penetration;
            }
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

// ============================================================
// 风场工具函数
// ============================================================

/**
 * 对求解器中所有非固定粒子施加风场力。
 *
 * 使用求解器的 windEnabled / windDirection / windStrength 属性。
 * 每粒子添加随机扰动因子 (0.6~1.4) 以产生自然的布料起伏效果。
 *
 * 可在 step() 前调用作为预置风场，或由 step() 内部每子步自动调用。
 *
 * @param solver  XPBD 求解器实例
 * @param dt      时间步长（秒）
 */
export function applyWind(solver: XpbdSolver, dt: number): void {
    if (!solver.windEnabled || solver.windStrength <= 0) {
        return;
    }

    const [wx, wy, wz] = solver.windDirection;
    const strength = solver.windStrength;

    for (let i = 0; i < solver.particles.length; i++) {
        const p = solver.particles[i];
        if (p.invMass === 0) {
            continue; // 固定粒子不受风场影响
        }

        // 随机扰动因子 0.6~1.4，为每粒子产生不同的受力，形成自然飘动
        const flutter = 0.6 + Math.random() * 0.8;

        // Verlet 积分中，修改 prevP 等价于施加速度脉冲：
        //   v = (p - prevP) / dt  →  prevP 减去 impulse 后 v 增加 impulse/dt
        const impulse = wx * strength * dt * flutter;
        const impulseY = wy * strength * dt * flutter;
        const impulseZ = wz * strength * dt * flutter;

        p.prevP[0] -= impulse;
        p.prevP[1] -= impulseY;
        p.prevP[2] -= impulseZ;
    }
}
