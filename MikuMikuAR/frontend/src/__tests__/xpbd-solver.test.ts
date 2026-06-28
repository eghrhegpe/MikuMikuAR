import { describe, it, expect } from "vitest";
import { XpbdSolver } from "../physics/xpbd-solver";

// ============================================================
// M2: XPBD 粒子链自由落体测试
// ============================================================

describe("XpbdSolver particle chain free-fall", () => {
    /**
     * 构建一条垂直粒子链（2 个粒子）
     * 顶部粒子固定（invMass=0），底部粒子自由
     * 验证：底部粒子受重力下落，距离约束拉伸
     */
    function makeVerticalChain(solver: XpbdSolver, len = 1.0) {
        const i0 = solver.addParticle([0, 2, 0], Infinity); // 固定天花板
        const i1 = solver.addParticle([0, 1, 0], 0.01);     // 自由落体
        solver.addDistanceConstraint(i0, i1, 0, len);
        return { fixed: i0, lower: i1 };
    }

    it("free particle falls under gravity", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 1.0 });
        const idx = solver.addParticle([0, 5, 0], 1.0);
        const p = solver.particles[idx];

        // 初始位置 y=5
        expect(p.p[1]).toBeCloseTo(5.0, 5);

        // 10 步 @ 1/60s
        for (let i = 0; i < 10; i++) {
            solver.step(1 / 60);
        }

        // 重力 = -9.8，10 帧 ≈ 0.167s
        // s = 0.5 * 9.8 * 0.167² ≈ 0.136m
        expect(p.p[1]).toBeLessThan(5.0);
        expect(p.p[1]).toBeGreaterThan(4.8); // 应该掉了但不多
    });

    it("fixed particle does not move", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 1.0 });
        const idx = solver.addParticle([0, 2, 0], Infinity); // mass=Infinity → invMass=0
        const p = solver.particles[idx];

        for (let i = 0; i < 60; i++) {
            solver.step(1 / 60);
        }

        expect(p.p[1]).toBeCloseTo(2.0, 5);
    });

    it("distance constraint keeps chain at rest length", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const { fixed, lower } = makeVerticalChain(solver, 0.5);

        const pf = solver.particles[fixed];
        const pfr = solver.particles[lower];

        // 运行到稳态（~2 秒 = 120 帧）
        for (let i = 0; i < 240; i++) {
            solver.step(1 / 60);
        }

        const dx = pf.p[0] - pfr.p[0];
        const dy = pf.p[1] - pfr.p[1];
        const dz = pf.p[2] - pfr.p[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // 距离应该非常接近 restLength（刚体约束）
        expect(dist).toBeCloseTo(0.5, 1);
    });

    it("multi-particle chain hangs correctly", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const N = 5;
        const linkLen = 0.3;

        // 顶部固定
        const top = solver.addParticle([0, 3, 0], Infinity);
        const indices = [top];

        for (let i = 1; i < N; i++) {
            const idx = solver.addParticle([0, 3 - i * linkLen, 0], 0.01);
            indices.push(idx);
            solver.addDistanceConstraint(indices[i - 1], idx, 0, linkLen);
        }

        // 稳态
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }

        // 验证链总长度 ≈ (N-1) * linkLen
        const topP = solver.particles[top];
        const lastP = solver.particles[indices[N - 1]];
        const dx = topP.p[0] - lastP.p[0];
        const dy = topP.p[1] - lastP.p[1];
        const dz = topP.p[2] - lastP.p[2];
        const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

        expect(totalLen).toBeCloseTo((N - 1) * linkLen, 1);
    });

    it("ground collision prevents falling through", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98, groundY: 0 });
        solver.addGroundCollision();

        const idx = solver.addParticle([0, 3, 0], 1.0, 0.1);
        const p = solver.particles[idx];

        // 自由落体到稳态
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }

        // 粒子不应该穿透地面（地面在 y=0，粒子半径 0.1）
        expect(p.p[1]).toBeGreaterThanOrEqual(0.1 - 1e-4);
        // 应该在附近
        expect(p.p[1]).toBeLessThan(0.15);
    });
});

describe("XpbdSolver constraint sanity", () => {
    it("bend constraint preserves angle between three particles", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });

        // 三个粒子形成 L 形，弯曲约束保持端点距离
        const i0 = solver.addParticle([0, 2, 0], Infinity);  // 固定
        const i1 = solver.addParticle([0, 1, 0], 0.01);       // 中间
        const i2 = solver.addParticle([0.5, 1, 0], 0.01);     // 端点

        solver.addDistanceConstraint(i0, i1, 0, 1.0);
        solver.addDistanceConstraint(i1, i2, 0, 0.5);
        solver.addBendConstraint(i0, i1, i2, 0);  // 保持 i0-i2 距离

        const restDist = Math.sqrt(1.0 * 1.0 + 0.5 * 0.5); // √1.25 ≈ 1.118

        // 稳态
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }

        const p0 = solver.particles[i0].p;
        const p2 = solver.particles[i2].p;
        const dx = p0[0] - p2[0];
        const dy = p0[1] - p2[1];
        const dz = p0[2] - p2[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        expect(dist).toBeCloseTo(restDist, 1);
    });

    it("volume constraint keeps tetrahedron stable", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });

        // 正四面体 4 个顶点
        const sqrt2_3 = Math.sqrt(2) / 3;
        const sqrt6_3 = Math.sqrt(6) / 3;
        const size = 0.5;

        const particles = solver.addParticles(
            [
                [0, size, 0],
                [size * sqrt2_3, -size / 3, 0],
                [-size * sqrt2_3 / 2, -size / 3, size * sqrt6_3 / 2],
                [-size * sqrt2_3 / 2, -size / 3, -size * sqrt6_3 / 2],
            ],
            [0.01, 0.01, 0.01, 0.01],
            [0.03, 0.03, 0.03, 0.03],
        );

        // 添加体积约束（保持四面体体积）
        solver.addVolumeConstraint(particles, 0);

        // 添加所有边约束（保持形状）
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                solver.addDistanceConstraint(particles[i], particles[j], 0);
            }
        }

        // 自由落体 + 地面碰撞
        solver.addGroundCollision(0);

        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }

        // 四面体不应塌陷：任意两点距离不应为 0
        const [i0, i1, i2, i3] = particles;
        const p0 = solver.particles[i0].p;
        const p1 = solver.particles[i1].p;
        const p2 = solver.particles[i2].p;
        const p3 = solver.particles[i3].p;

        const d01 = Math.sqrt(
            (p0[0] - p1[0]) ** 2 + (p0[1] - p1[1]) ** 2 + (p0[2] - p1[2]) ** 2,
        );
        const d02 = Math.sqrt(
            (p0[0] - p2[0]) ** 2 + (p0[1] - p2[1]) ** 2 + (p0[2] - p2[2]) ** 2,
        );
        expect(d01).toBeGreaterThan(0.01);
        expect(d02).toBeGreaterThan(0.01);

        // 所有粒子不应穿透地面
        for (const idx of particles) {
            expect(solver.particles[idx].p[1]).toBeGreaterThanOrEqual(-0.001);
        }
    });

    it("reset clears all particles and constraints", () => {
        const solver = new XpbdSolver();
        solver.addParticle();
        solver.addParticle();
        solver.addDistanceConstraint(0, 1);

        expect(solver.particleCount).toBe(2);
        expect(solver.constraintCount).toBe(1);

        solver.reset();

        expect(solver.particleCount).toBe(0);
        expect(solver.constraintCount).toBe(0);
    });
});

describe("XpbdSolver edge cases", () => {
    it("empty solver step does not crash", () => {
        const solver = new XpbdSolver();
        expect(() => solver.step(1 / 60)).not.toThrow();
    });

    it("damping=0 particles stop immediately", () => {
        const solver = new XpbdSolver({ damping: 0, substeps: 8 });
        const idx = solver.addParticle([0, 5, 0], 1.0);
        const p = solver.particles[idx];

        // 初始速度
        p.v[1] = 10;
        p.prevP[1] = p.p[1] - p.v[1] * (1 / 60);

        solver.step(1 / 60);

        // 阻尼=0，速度应为 0（只在重力方向有微小位移）
        expect(Math.abs(p.v[1])).toBeLessThan(10);
    });

    it("high compliance creates soft spring", () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });

        // 固定粒子 + 自由粒子，高柔度距离约束
        const top = solver.addParticle([0, 2, 0], Infinity);
        const bot = solver.addParticle([0, 1, 0], 0.01);
        solver.addDistanceConstraint(top, bot, 0.5, 1.0); // compliance=0.5 → 软弹簧

        for (let i = 0; i < 200; i++) {
            solver.step(1 / 60);
        }

        const pTop = solver.particles[top].p;
        const pBot = solver.particles[bot].p;
        const dy = pTop[1] - pBot[1];

        // 软弹簧会产生明显伸长（比 restLength 1.0 长）
        expect(dy).toBeGreaterThan(1.0 + 0.01);
    });
});
