/**
 * M4 测试：程序化布料网格生成 + 粒子密度 + 约束拓扑
 *
 * 由于 xpbd-cloth 的 createCloth 依赖 Babylon.js Scene，
 * 这里单独测试非渲染部分的核心逻辑：
 * 1. 粒子数量 = segmentsH * segmentsV
 * 2. 顶层粒子全部固定 (invMass = 0)
 * 3. 距离约束数量 = (horizontal: ringCount * ringSize) + (vertical: (ringCount-1) * ringSize)
 * 4. 弯曲约束数量 = (horizontal bend: ringCount * ringSize) + (vertical bend: (ringCount-2) * ringSize)
 * 5. 布料从重力下落并保持约束
 */

import { describe, it, expect } from 'vitest';
import { XpbdSolver } from '../physics/xpbd-solver';

// ============================================================
// 辅助：模拟 createCloth 的约束生成逻辑
// ============================================================

interface ClothTopoTest {
    solver: XpbdSolver;
    particleGrid: number[];
    anchorIndices: number[];
    ringSize: number;
    ringCount: number;
}

/**
 * 模拟 xpbd-cloth 的粒子放置 + 约束建立（不依赖 Babylon.js）
 */
function makeClothTopo(
    segmentsH: number,
    segmentsV: number,
    innerRadius: number,
    length: number,
    slopeDeg: number,
    compliance: number,
    bendCompliance: number
): ClothTopoTest {
    const solver = new XpbdSolver({ substeps: 4, damping: 0.96 });
    const ringSize = segmentsH;
    const ringCount = segmentsV;
    const totalMass = 0.5;
    const nonAnchorMass = totalMass / (ringSize * (ringCount - 1));

    const particleGrid: number[] = [];
    const anchorIndices: number[] = [];

    for (let row = 0; row < ringCount; row++) {
        const t = row / (ringCount - 1);
        const y = -t * length;
        const slopeRad = (slopeDeg * Math.PI) / 180;
        const r = innerRadius + t * length * Math.tan(slopeRad);

        for (let col = 0; col < ringSize; col++) {
            const angle = (col / ringSize) * Math.PI * 2;
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            const mass = row === 0 ? Infinity : nonAnchorMass;
            const idx = solver.addParticle([x, y, z], mass, 0.03);
            particleGrid.push(idx);
            if (row === 0) {
                anchorIndices.push(idx);
            }
        }
    }

    // 距离约束
    for (let row = 0; row < ringCount; row++) {
        for (let col = 0; col < ringSize; col++) {
            const i = particleGrid[row * ringSize + col];
            // 水平
            const nextCol = (col + 1) % ringSize;
            const h = particleGrid[row * ringSize + nextCol];
            solver.addDistanceConstraint(i, h, compliance);
            // 垂直
            if (row + 1 < ringCount) {
                const v = particleGrid[(row + 1) * ringSize + col];
                solver.addDistanceConstraint(i, v, compliance);
            }
        }
    }

    // 弯曲约束
    for (let row = 0; row < ringCount; row++) {
        for (let col = 0; col < ringSize; col++) {
            const i = particleGrid[row * ringSize + col];
            // 水平弯曲
            const bendH = particleGrid[row * ringSize + ((col + 2) % ringSize)];
            const midH = particleGrid[row * ringSize + ((col + 1) % ringSize)];
            solver.addBendConstraint(i, midH, bendH, bendCompliance);
            // 垂直弯曲
            if (row + 2 < ringCount) {
                const bendV = particleGrid[(row + 2) * ringSize + col];
                const midV = particleGrid[(row + 1) * ringSize + col];
                solver.addBendConstraint(i, midV, bendV, bendCompliance);
            }
        }
    }

    return { solver, particleGrid, anchorIndices, ringSize, ringCount };
}

// ============================================================
// 测试用例
// ============================================================

describe('M4: Cloth Topology (xpbd-cloth)', () => {
    // ---- 默认参数 (24, 12) ----
    const DEFAULT_H = 24;
    const DEFAULT_V = 12;

    it('total particles = segmentsH * segmentsV', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );
        expect(solver.particles.length).toBe(ringSize * ringCount);
        expect(solver.particles.length).toBe(288); // 24 * 12
    });

    it('all top-ring particles are fixed (invMass = 0)', () => {
        const { solver, anchorIndices, ringSize } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );
        expect(anchorIndices.length).toBe(ringSize);
        for (const idx of anchorIndices) {
            expect(solver.particles[idx].invMass).toBe(0);
        }
    });

    it('all non-anchor particles have positive invMass', () => {
        const { solver, anchorIndices } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );
        const anchorSet = new Set(anchorIndices);
        for (let i = 0; i < solver.particles.length; i++) {
            if (!anchorSet.has(i)) {
                expect(solver.particles[i].invMass).toBeGreaterThan(0);
            }
        }
    });

    it('distance constraints count = (V*H) horizontal + (V-1)*H vertical', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );
        const expectedDistance = ringCount * ringSize + (ringCount - 1) * ringSize;
        const distCount = solver.constraints.filter((c) => c.type === 'distance').length;
        expect(distCount).toBe(expectedDistance); // 12*24 + 11*24 = 288 + 264 = 552
    });

    it('bend constraints count = (V*H) horizontal + (V-2)*H vertical', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );
        const expectedBend = ringCount * ringSize + (ringCount - 2) * ringSize;
        const bendCount = solver.constraints.filter((c) => c.type === 'bend').length;
        expect(bendCount).toBe(expectedBend); // 12*24 + 10*24 = 288 + 240 = 528
    });

    it('cloth hangs vertically when top ring is fixed', () => {
        const { solver, anchorIndices, ringSize, ringCount } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            0,
            0.001,
            0.005
        );

        // 固定所有 anchor 粒子
        for (const idx of anchorIndices) {
            const p = solver.particles[idx];
            p.invMass = 0;
        }

        // 模拟 300 帧 (5 秒) 让布料充分下垂并稳定
        for (let f = 0; f < 300; f++) {
            solver.step(1 / 60);
        }

        // 底层粒子的 Y 应该 < 初始 Y (-0.6) 即被重力拉下
        const lastRowStart = (ringCount - 1) * ringSize;
        for (let col = 0; col < ringSize; col++) {
            const p = solver.particles[lastRowStart + col];
            // 初始 Y = -0.6，重力下垂后 Y 在 -1 ~ -2 之间（无偏移织物自由下垂）
            expect(p.p[1]).toBeLessThan(-0.8);
        }

        // 无人为 NaN
        for (const p of solver.particles) {
            expect(isFinite(p.p[0])).toBe(true);
            expect(isFinite(p.p[1])).toBe(true);
            expect(isFinite(p.p[2])).toBe(true);
        }
    });

    it('skirt topology: bottom ring radius > innerRadius when slope > 0', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            DEFAULT_H,
            DEFAULT_V,
            0.15,
            0.6,
            45,
            0.001,
            0.005 // 45 度 slope
        );

        // 顶层粒子到原点的平均距离 ≈ innerRadius
        let topDistSum = 0;
        for (let col = 0; col < ringSize; col++) {
            const p = solver.particles[col];
            topDistSum += Math.sqrt(p.p[0] * p.p[0] + p.p[2] * p.p[2]);
        }
        const avgTopDist = topDistSum / ringSize;
        expect(avgTopDist).toBeCloseTo(0.15, 1);

        // 底层粒子到原点的平均距离 > innerRadius (锥形扩展)
        const lastRowStart = (ringCount - 1) * ringSize;
        let botDistSum = 0;
        for (let col = 0; col < ringSize; col++) {
            const p = solver.particles[lastRowStart + col];
            botDistSum += Math.sqrt(p.p[0] * p.p[0] + p.p[2] * p.p[2]);
        }
        const avgBotDist = botDistSum / ringSize;
        // slope=45°, length=0.6, bottom radius = 0.15 + 0.6*tan(45°) = 0.15 + 0.6 = 0.75
        expect(avgBotDist).toBeCloseTo(0.75, 1);
    });

    // ---- 低分辨率 (12, 6) 端到端 ----
    it('low-res (12,6) end-to-end stability', () => {
        const { solver, anchorIndices, ringSize, ringCount } = makeClothTopo(
            12,
            6,
            0.15,
            0.6,
            15,
            0.001,
            0.005
        );

        // 固定 anchor
        for (const idx of anchorIndices) {
            solver.particles[idx].invMass = 0;
        }

        // 启用地面碰撞
        solver.addGroundCollision(-1.5);

        // 模拟 200 帧
        for (let f = 0; f < 200; f++) {
            solver.step(1 / 60);
        }

        // 没有 NaN
        for (const p of solver.particles) {
            expect(isNaN(p.p[0])).toBe(false);
            expect(isNaN(p.p[1])).toBe(false);
            expect(isNaN(p.p[2])).toBe(false);
            expect(isFinite(p.p[0])).toBe(true);
            expect(isFinite(p.p[1])).toBe(true);
            expect(isFinite(p.p[2])).toBe(true);
        }

        // 所有粒子 Y >= groundY (地面碰撞)
        for (const p of solver.particles) {
            expect(p.p[1]).toBeGreaterThanOrEqual(-1.6); // 留一点浮点容差
        }
    });

    // ---- 边界：最简布料 (4, 3) ----
    it('minimal (4,3) cloth topology correctness', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(4, 3, 0.15, 0.6, 0, 0.001, 0.005);
        expect(solver.particles.length).toBe(12); // 4 * 3
        // 距离: 3*4 + 2*4 = 20
        expect(solver.constraints.filter((c) => c.type === 'distance').length).toBe(20);
        // 弯曲: 3*4 + 1*4 = 16
        expect(solver.constraints.filter((c) => c.type === 'bend').length).toBe(16);
    });
});
