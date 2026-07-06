/**
 * XPBD 物理系统测试 — solver / collider / cloth 整合
 *
 * 合并自: xpbd-solver.test.ts, xpbd-collider.test.ts, xpbd-cloth.test.ts
 */

// ── vi.mock must be hoisted BEFORE imports ──────────────────────
vi.mock('@babylonjs/core/scene', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Scene: m.MockScene };
});
vi.mock('@babylonjs/core/Meshes/mesh', () => {
    const { MockAbstractMesh } = require('./mocks/babylon-classes.ts');
    class MockClothMesh {
        position = { x: 0, y: 0, z: 0 };
        name = '';
        material: any = null;
        scaling = { x: 1, y: 1, z: 1 };
        rotation = { x: 0, y: 0, z: 0 };
        visibility = 1;
        constructor(name = '', _scene?: any) {
            this.name = name;
        }
        getClassName() {
            return 'Mesh';
        }
        setEnabled() {}
        getTotalVertices() {
            return 1000;
        }
        getTotalIndices() {
            return 3000;
        }
        dispose() {}
        updateVerticesData(_kind: string, _data: Float32Array, _b1: boolean, _b2: boolean) {}
    }
    return { AbstractMesh: MockAbstractMesh, Mesh: MockClothMesh };
});
vi.mock('@babylonjs/core/Meshes/mesh.vertexData', () => ({
    VertexData: class MockVertexData {
        positions: number[] = [];
        indices: number[] = [];
        normals: number[] = [];
        uvs: number[] = [];
        applyToMesh(_mesh: any) {}
        static ComputeNormals(
            _positions: Float32Array,
            _indices: Int32Array,
            normals: Float32Array
        ) {
            for (let i = 0; i < normals.length; i++) {
                normals[i] = 0;
            }
        }
    },
}));
vi.mock('@babylonjs/core/Buffers/buffer', () => ({
    VertexBuffer: { PositionKind: 'position', NormalKind: 'normal' },
}));
vi.mock('@babylonjs/core/Materials/standardMaterial', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { StandardMaterial: m.MockStandardMaterial };
});
vi.mock('@babylonjs/core/Maths/math.color', () => {
    const m = require('./mocks/babylon-classes.ts');
    return { Color3: m.MockColor3, Color4: m.MockColor4, TmpColors: { Color3: [] } };
});

import { vi, describe, it, expect, beforeEach, afterEach, assert } from 'vitest';
import { XpbdSolver } from '../physics/xpbd-solver';
import { SdfCollider, DEFAULT_BODY_CAPSULES } from '../physics/xpbd-collider';
import type { CapsuleSpec } from '../physics/xpbd-collider';
import {
    createCloth,
    buildClothUpdateFn,
    disposeCloth,
    setDebugUpdateFn,
    DEFAULT_CLOTH_CONFIG,
} from '../physics/xpbd-cloth';

// ====================================================================
// XpbdSolver — 粒子链 / 约束 / 边缘情况
// ====================================================================

describe('XpbdSolver particle chain free-fall', () => {
    function makeVerticalChain(solver: XpbdSolver, len = 1.0) {
        const i0 = solver.addParticle([0, 2, 0], Infinity);
        const i1 = solver.addParticle([0, 1, 0], 0.01);
        solver.addDistanceConstraint(i0, i1, 0, len);
        return { fixed: i0, lower: i1 };
    }

    it('free particle falls under gravity', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 1.0 });
        const idx = solver.addParticle([0, 5, 0], 1.0);
        const p = solver.particles[idx];
        expect(p.p[1]).toBeCloseTo(5.0, 5);
        for (let i = 0; i < 10; i++) {
            solver.step(1 / 60);
        }
        expect(p.p[1]).toBeLessThan(5.0);
        expect(p.p[1]).toBeGreaterThan(4.8);
    });

    it('fixed particle does not move', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 1.0 });
        const idx = solver.addParticle([0, 2, 0], Infinity);
        for (let i = 0; i < 60; i++) {
            solver.step(1 / 60);
        }
        expect(solver.particles[idx].p[1]).toBeCloseTo(2.0, 5);
    });

    it('distance constraint keeps chain at rest length', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const { fixed, lower } = makeVerticalChain(solver, 0.5);
        for (let i = 0; i < 240; i++) {
            solver.step(1 / 60);
        }
        const pf = solver.particles[fixed].p;
        const pl = solver.particles[lower].p;
        const dist = Math.sqrt((pf[0] - pl[0]) ** 2 + (pf[1] - pl[1]) ** 2 + (pf[2] - pl[2]) ** 2);
        expect(dist).toBeCloseTo(0.5, 1);
    });

    it('multi-particle chain hangs correctly', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const N = 5,
            linkLen = 0.3;
        const top = solver.addParticle([0, 3, 0], Infinity);
        const indices = [top];
        for (let i = 1; i < N; i++) {
            const idx = solver.addParticle([0, 3 - i * linkLen, 0], 0.01);
            indices.push(idx);
            solver.addDistanceConstraint(indices[i - 1], idx, 0, linkLen);
        }
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }
        const tp = solver.particles[top].p;
        const lp = solver.particles[indices[N - 1]].p;
        const total = Math.sqrt((tp[0] - lp[0]) ** 2 + (tp[1] - lp[1]) ** 2 + (tp[2] - lp[2]) ** 2);
        expect(total).toBeCloseTo((N - 1) * linkLen, 1);
    });

    it('ground collision prevents falling through', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98, groundY: 0 });
        solver.addGroundCollision();
        const idx = solver.addParticle([0, 3, 0], 1.0, 0.1);
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }
        expect(solver.particles[idx].p[1]).toBeGreaterThanOrEqual(0.1 - 1e-4);
        expect(solver.particles[idx].p[1]).toBeLessThan(0.15);
    });
});

describe('XpbdSolver constraint sanity', () => {
    it('bend constraint preserves angle between three particles', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const i0 = solver.addParticle([0, 2, 0], Infinity);
        const i1 = solver.addParticle([0, 1, 0], 0.01);
        const i2 = solver.addParticle([0.5, 1, 0], 0.01);
        solver.addDistanceConstraint(i0, i1, 0, 1.0);
        solver.addDistanceConstraint(i1, i2, 0, 0.5);
        solver.addBendConstraint(i0, i1, i2, 0);
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }
        const p0 = solver.particles[i0].p;
        const p2 = solver.particles[i2].p;
        const d = Math.sqrt((p0[0] - p2[0]) ** 2 + (p0[1] - p2[1]) ** 2 + (p0[2] - p2[2]) ** 2);
        expect(d).toBeCloseTo(Math.sqrt(1.25), 1);
    });

    it('volume constraint keeps tetrahedron stable', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const s2_3 = Math.sqrt(2) / 3,
            s6_3 = Math.sqrt(6) / 3,
            sz = 0.5;
        const pts = solver.addParticles(
            [
                [0, sz, 0],
                [sz * s2_3, -sz / 3, 0],
                [(-sz * s2_3) / 2, -sz / 3, (sz * s6_3) / 2],
                [(-sz * s2_3) / 2, -sz / 3, (-sz * s6_3) / 2],
            ],
            [0.01, 0.01, 0.01, 0.01],
            [0.03, 0.03, 0.03, 0.03]
        );
        solver.addVolumeConstraint(pts, 0);
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                solver.addDistanceConstraint(pts[i], pts[j], 0);
            }
        }
        solver.addGroundCollision(0);
        for (let i = 0; i < 300; i++) {
            solver.step(1 / 60);
        }
        const d01 = Math.sqrt(
            (solver.particles[pts[0]].p[0] - solver.particles[pts[1]].p[0]) ** 2 +
                (solver.particles[pts[0]].p[1] - solver.particles[pts[1]].p[1]) ** 2 +
                (solver.particles[pts[0]].p[2] - solver.particles[pts[1]].p[2]) ** 2
        );
        expect(d01).toBeGreaterThan(0.01);
    });

    it('reset clears all particles and constraints', () => {
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

describe('XpbdSolver edge cases', () => {
    it('empty solver step does not crash', () => {
        expect(() => new XpbdSolver().step(1 / 60)).not.toThrow();
    });

    it('high compliance creates soft spring', () => {
        const solver = new XpbdSolver({ substeps: 8, damping: 0.98 });
        const top = solver.addParticle([0, 2, 0], Infinity);
        const bot = solver.addParticle([0, 1, 0], 0.01);
        solver.addDistanceConstraint(top, bot, 0.5, 1.0);
        for (let i = 0; i < 200; i++) {
            solver.step(1 / 60);
        }
        expect(solver.particles[top].p[1] - solver.particles[bot].p[1]).toBeGreaterThan(1.01);
    });

    it('getKineticEnergy returns zero for fixed particles', () => {
        const solver = new XpbdSolver();
        solver.addParticle([0, 0, 0], Infinity);
        expect(solver.getKineticEnergy()).toBe(0);
    });

    it('getKineticEnergy returns positive value for moving particles', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0, 0, 0], 1.0);
        solver.particles[idx].v[1] = 5;
        solver.particles[idx].prevP[1] = solver.particles[idx].p[1] - 5 * (1 / 60);
        expect(solver.getKineticEnergy()).toBeGreaterThan(0);
    });
});

// ====================================================================
// SdfCollider — 碰撞体
// ====================================================================

function makeMatrix(tx: number, ty: number, tz: number, scale = 1): Float32Array {
    return new Float32Array([scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, tx, ty, tz, 1]);
}
function makeMatrixWithYAxis(
    tx: number,
    ty: number,
    tz: number,
    yx: number,
    yy: number,
    yz: number
): Float32Array {
    return new Float32Array([1, 0, 0, 0, yx, yy, yz, 0, 0, 0, 1, 0, tx, ty, tz, 1]);
}

describe('SdfCollider init()', () => {
    it('creates 13 capsules from DEFAULT_BODY_CAPSULES', () => {
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);
        expect(c.capsules).toHaveLength(13);
    });
    it('copies spec properties to each capsule', () => {
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);
        expect(c.capsules[0].name).toBe('head');
        expect(c.capsules[0].radius).toBeCloseTo(0.13, 5);
    });
    it('accepts custom capsule specs', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'Spine', radius: 0.2, halfHeight: 0.15 }]);
        expect(c.capsules).toHaveLength(1);
    });
    it('accepts empty spec array', () => {
        const c = new SdfCollider();
        c.init([]);
        expect(c.capsules).toHaveLength(0);
    });
    it('default stiffness is 1.0 and friction is 0.1', () => {
        const c = new SdfCollider();
        expect(c.stiffness).toBe(1.0);
        expect(c.friction).toBe(0.1);
    });
});

describe('SdfCollider updateMatrices()', () => {
    it('sets center and direction from a valid matrix', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);
        c.updateMatrices([makeMatrix(1.5, -2, 3)]);
        expect(Array.from(c.capsules[0].center)).toEqual([1.5, -2, 3]);
        expect(Array.from(c.capsules[0].direction)).toEqual([0, 1, 0]);
    });
    it('normalizes non-unit direction', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);
        c.updateMatrices([makeMatrixWithYAxis(0, 0, 0, 0, 2.5, 0)]);
        expect(c.capsules[0].direction[1]).toBeCloseTo(1, 5);
    });
    it('skips null matrix entries', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);
        c.updateMatrices([makeMatrix(1, 2, 3)]);
        expect(Array.from(c.capsules[0].center)).toEqual([1, 2, 3]);
        c.updateMatrices([null]);
        expect(Array.from(c.capsules[0].center)).toEqual([1, 2, 3]);
    });
    it('stops at min(capsules.length, matrices.length)', () => {
        const c = new SdfCollider();
        c.init([
            { name: 'a', boneName: 'ba', radius: 0.1, halfHeight: 0.1 },
            { name: 'b', boneName: 'bb', radius: 0.1, halfHeight: 0.1 },
        ]);
        c.updateMatrices([makeMatrix(7, 8, 9)]);
        expect(Array.from(c.capsules[0].center)).toEqual([7, 8, 9]);
        expect(Array.from(c.capsules[1].center)).toEqual([0, 0, 0]);
    });
});

describe('SdfCollider solve() collision', () => {
    function setup(radius = 0.13, hh = 0.08, stiffness = 1, friction = 0.1) {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1, 0.05);
        const collider = new SdfCollider();
        collider.stiffness = stiffness;
        collider.friction = friction;
        collider.init([{ name: 'chest', boneName: '上半身', radius, halfHeight: hh }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);
        return { solver, collider, particleIdx: idx };
    }
    it('pushes a penetrating particle outside', () => {
        const { solver, collider, particleIdx } = setup();
        collider.solve(solver);
        expect(solver.particles[particleIdx].p[0]).toBeGreaterThan(0.17);
        expect(solver.particles[particleIdx].p[0]).toBeLessThanOrEqual(0.19);
    });
    it('does nothing for outside particle', () => {
        const { solver, collider, particleIdx } = setup();
        solver.particles[particleIdx].p[0] = 10;
        const before = Array.from(solver.particles[particleIdx].p);
        collider.solve(solver);
        expect(Array.from(solver.particles[particleIdx].p)).toEqual(before);
    });
    it('skips fixed particles', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], Infinity, 0.05);
        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);
        const before = Array.from(solver.particles[idx].p);
        collider.solve(solver);
        expect(Array.from(solver.particles[idx].p)).toEqual(before);
    });
    it('respects stiffness = 0 (no push)', () => {
        const { solver, collider, particleIdx } = setup(0.13, 0.08, 0);
        const beforeX = solver.particles[particleIdx].p[0];
        collider.solve(solver);
        expect(solver.particles[particleIdx].p[0]).toBeCloseTo(beforeX, 5);
    });
    it('respects stiffness = 0.5 (half push)', () => {
        const { solver, collider, particleIdx } = setup(0.13, 0.08, 0.5);
        collider.solve(solver);
        expect(solver.particles[particleIdx].p[0]).toBeGreaterThan(0.13);
        expect(solver.particles[particleIdx].p[0]).toBeLessThan(0.15);
    });
});

describe('disabled capsules', () => {
    it('disabled capsule does not affect particles', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1, 0.05);
        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.capsules[0].enabled = false;
        const before = Array.from(solver.particles[idx].p);
        collider.solve(solver);
        expect(Array.from(solver.particles[idx].p)).toEqual(before);
    });
    it('setEnabledByName toggles a capsule', () => {
        const collider = new SdfCollider();
        collider.init(DEFAULT_BODY_CAPSULES);
        collider.setEnabledByName('chest', false);
        expect(collider.capsules.find((c) => c.name === 'chest')?.enabled).toBe(false);
    });
    it('setAllEnabled disables all capsules', () => {
        const collider = new SdfCollider();
        collider.init(DEFAULT_BODY_CAPSULES);
        collider.setAllEnabled(false);
        expect(collider.capsules.every((c) => !c.enabled)).toBe(true);
    });
});

describe('SdfCollider friction', () => {
    it('friction > 0 modifies prevP', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1, 0.05);
        solver.particles[idx].prevP[1] = 0.1;
        const collider = new SdfCollider();
        collider.stiffness = 1;
        collider.friction = 0.5;
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);
        const before = Array.from(solver.particles[idx].prevP);
        collider.solve(solver);
        expect(Array.from(solver.particles[idx].prevP)).not.toEqual(before);
    });
    it('friction = 1 removes tangent velocity', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1, 0.05);
        solver.particles[idx].prevP[1] = 0.1;
        const collider = new SdfCollider();
        collider.stiffness = 1;
        collider.friction = 1;
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);
        collider.solve(solver);
        expect(solver.particles[idx].prevP[1]).toBeCloseTo(solver.particles[idx].p[1], 4);
    });
});

describe('SdfCollider management', () => {
    it('clear empties the capsules array', () => {
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);
        c.clear();
        expect(c.capsules).toHaveLength(0);
    });
    it('scaleAll multiplies radius and halfHeight', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.2 }]);
        c.scaleAll(2);
        expect(c.capsules[0].radius).toBeCloseTo(0.2, 5);
    });
});

describe('SdfCollider edge cases', () => {
    it('zero halfHeight degenerates to sphere', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.05, 0, 0], 1, 0.05);
        const c = new SdfCollider();
        c.init([{ name: 's', boneName: 'b', radius: 0.1, halfHeight: 0 }]);
        c.updateMatrices([makeMatrix(0, 0, 0)]);
        c.solve(solver);
        expect(solver.particles[idx].p[0]).toBeGreaterThan(0.12);
    });
    it('particle exactly at surface is not pushed', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.18, 0, 0], 1, 0.05);
        const c = new SdfCollider();
        c.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        c.updateMatrices([makeMatrix(0, 0, 0)]);
        const before = solver.particles[idx].p[0];
        c.solve(solver);
        expect(solver.particles[idx].p[0]).toBeCloseTo(before, 10);
    });
    it('many particles with many capsules does not crash', () => {
        const solver = new XpbdSolver();
        for (let i = 0; i < 50; i++) {
            const theta = (i / 50) * Math.PI * 2;
            solver.addParticle([Math.cos(theta) * 0.5, Math.sin(theta) * 0.5, 0], 1, 0.03);
        }
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);
        c.updateMatrices(DEFAULT_BODY_CAPSULES.map(() => makeMatrix(0, 0, 0)));
        assert.doesNotThrow(() => c.solve(solver));
    });
});

// ====================================================================
// xpbd-cloth — 布料拓扑与真实函数
// ====================================================================

interface ClothTopoTest {
    solver: XpbdSolver;
    particleGrid: number[];
    anchorIndices: number[];
    ringSize: number;
    ringCount: number;
}

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
    const ringSize = segmentsH,
        ringCount = segmentsV,
        totalMass = 0.5;
    const nonAnchorMass = totalMass / (ringSize * (ringCount - 1));
    const particleGrid: number[] = [],
        anchorIndices: number[] = [];
    for (let row = 0; row < ringCount; row++) {
        const t = row / (ringCount - 1),
            y = -t * length;
        const slopeRad = (slopeDeg * Math.PI) / 180,
            r = innerRadius + t * length * Math.tan(slopeRad);
        for (let col = 0; col < ringSize; col++) {
            const angle = (col / ringSize) * Math.PI * 2;
            const idx = solver.addParticle(
                [Math.cos(angle) * r, y, Math.sin(angle) * r],
                row === 0 ? Infinity : nonAnchorMass,
                0.03
            );
            particleGrid.push(idx);
            if (row === 0) {
                anchorIndices.push(idx);
            }
        }
    }
    for (let row = 0; row < ringCount; row++) {
        for (let col = 0; col < ringSize; col++) {
            const i = particleGrid[row * ringSize + col];
            solver.addDistanceConstraint(
                i,
                particleGrid[row * ringSize + ((col + 1) % ringSize)],
                compliance
            );
            if (row + 1 < ringCount) {
                solver.addDistanceConstraint(
                    i,
                    particleGrid[(row + 1) * ringSize + col],
                    compliance
                );
            }
        }
    }
    for (let row = 0; row < ringCount; row++) {
        for (let col = 0; col < ringSize; col++) {
            const i = particleGrid[row * ringSize + col];
            solver.addBendConstraint(
                i,
                particleGrid[row * ringSize + ((col + 1) % ringSize)],
                particleGrid[row * ringSize + ((col + 2) % ringSize)],
                bendCompliance
            );
            if (row + 2 < ringCount) {
                solver.addBendConstraint(
                    i,
                    particleGrid[(row + 1) * ringSize + col],
                    particleGrid[(row + 2) * ringSize + col],
                    bendCompliance
                );
            }
        }
    }
    return { solver, particleGrid, anchorIndices, ringSize, ringCount };
}

describe('M4: Cloth Topology (xpbd-cloth)', () => {
    const DH = 24,
        DV = 12;
    const baseOpts = { h: DH, v: DV, inner: 0.15, len: 0.6, slope: 15, comp: 0.001, bend: 0.005 };

    it('total particles = segmentsH * segmentsV', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            baseOpts.inner,
            baseOpts.len,
            baseOpts.slope,
            baseOpts.comp,
            baseOpts.bend
        );
        expect(solver.particles.length).toBe(ringSize * ringCount);
        expect(solver.particles.length).toBe(288);
    });

    it('all top-ring particles are fixed', () => {
        const { anchorIndices, ringSize } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            baseOpts.inner,
            baseOpts.len,
            baseOpts.slope,
            baseOpts.comp,
            baseOpts.bend
        );
        expect(anchorIndices.length).toBe(ringSize);
    });

    it('distance constraints count = V*H + (V-1)*H', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            baseOpts.inner,
            baseOpts.len,
            baseOpts.slope,
            baseOpts.comp,
            baseOpts.bend
        );
        expect(solver.constraints.filter((c) => c.type === 'distance').length).toBe(
            ringCount * ringSize + (ringCount - 1) * ringSize
        );
    });

    it('bend constraints count = V*H + (V-2)*H', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            baseOpts.inner,
            baseOpts.len,
            baseOpts.slope,
            baseOpts.comp,
            baseOpts.bend
        );
        expect(solver.constraints.filter((c) => c.type === 'bend').length).toBe(
            ringCount * ringSize + (ringCount - 2) * ringSize
        );
    });

    it('cloth hangs vertically when top ring is fixed', () => {
        const { solver, anchorIndices, ringSize, ringCount } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            baseOpts.inner,
            baseOpts.len,
            0,
            baseOpts.comp,
            baseOpts.bend
        );
        for (const idx of anchorIndices) {
            solver.particles[idx].invMass = 0;
        }
        for (let f = 0; f < 300; f++) {
            solver.step(1 / 60);
        }
        const lastRowStart = (ringCount - 1) * ringSize;
        for (let col = 0; col < ringSize; col++) {
            expect(solver.particles[lastRowStart + col].p[1]).toBeLessThan(-0.8);
        }
    });

    it('skirt topology: bottom radius > innerRadius when slope > 0', () => {
        const { solver, ringSize, ringCount } = makeClothTopo(
            baseOpts.h,
            baseOpts.v,
            0.15,
            0.6,
            45,
            baseOpts.comp,
            baseOpts.bend
        );
        let botDistSum = 0;
        const lastRowStart = (ringCount - 1) * ringSize;
        for (let col = 0; col < ringSize; col++) {
            botDistSum += Math.sqrt(
                solver.particles[lastRowStart + col].p[0] ** 2 +
                    solver.particles[lastRowStart + col].p[2] ** 2
            );
        }
        expect(botDistSum / ringSize).toBeCloseTo(0.75, 1);
    });

    it('low-res (12,6) end-to-end stability', () => {
        const { solver, anchorIndices } = makeClothTopo(12, 6, 0.15, 0.6, 15, 0.001, 0.005);
        for (const idx of anchorIndices) {
            solver.particles[idx].invMass = 0;
        }
        solver.addGroundCollision(-1.5);
        for (let f = 0; f < 200; f++) {
            solver.step(1 / 60);
        }
        for (const p of solver.particles) {
            expect(isFinite(p.p[0])).toBe(true);
        }
    });

    it('minimal (4,3) cloth topology correctness', () => {
        const { solver } = makeClothTopo(4, 3, 0.15, 0.6, 0, 0.001, 0.005);
        expect(solver.particles.length).toBe(12);
        expect(solver.constraints.filter((c) => c.type === 'distance').length).toBe(20);
        expect(solver.constraints.filter((c) => c.type === 'bend').length).toBe(16);
    });
});

describe('xpbd-cloth real function coverage', () => {
    beforeEach(() => setDebugUpdateFn(null));

    it('DEFAULT_CLOTH_CONFIG has expected default values', () => {
        expect(DEFAULT_CLOTH_CONFIG.anchorBone).toBe('腰');
        expect(DEFAULT_CLOTH_CONFIG.length).toBe(0.6);
    });

    it('createCloth returns valid ClothInstance', () => {
        const instance = createCloth({} as any);
        expect(instance.solver).toBeDefined();
        expect(instance.mesh).not.toBeNull();
        expect(instance.enabled).toBe(true);
        expect(instance.ringSize).toBe(24);
        expect(instance.ringCount).toBe(12);
        expect(instance.particleGrid.length).toBe(288);
    });

    it('createCloth with partial config overrides defaults', () => {
        const instance = createCloth({} as any, { length: 0.8, slope: 30, totalMass: 1 });
        expect(instance.config.length).toBe(0.8);
        expect(instance.config.anchorBone).toBe('腰');
    });

    it('createCloth clamps small segments', () => {
        const instance = createCloth({} as any, { segmentsH: 3, segmentsV: 2 });
        expect(instance.ringSize).toBe(8);
        expect(instance.ringCount).toBe(4);
    });

    it('createCloth with extreme values does not throw', () => {
        expect(() =>
            createCloth({} as any, { segmentsH: 64, segmentsV: 32, slope: 90 })
        ).not.toThrow();
    });

    it('buildClothUpdateFn returns callable closure', () => {
        const instance = createCloth({} as any, { segmentsH: 8, segmentsV: 4 });
        const fn = buildClothUpdateFn(instance, vi.fn().mockReturnValue(null));
        expect(fn).toBeInstanceOf(Function);
        expect(() => fn(1 / 60)).not.toThrow();
    });

    it('buildClothUpdateFn closure skips when cloth is disabled', () => {
        const anchorFn = vi.fn();
        const instance = createCloth({} as any, { segmentsH: 8, segmentsV: 4 });
        const fn = buildClothUpdateFn(instance, anchorFn);
        instance.enabled = false;
        expect(() => fn(1 / 60)).not.toThrow();
        expect(anchorFn).toHaveBeenCalledTimes(0);
    });

    it('disposeCloth disables cloth and disposes mesh/material', () => {
        const instance = createCloth({} as any, { segmentsH: 8, segmentsV: 4 });
        const meshDispose = vi.spyOn(instance.mesh!, 'dispose');
        disposeCloth(instance);
        expect(instance.enabled).toBe(false);
        expect(meshDispose).toHaveBeenCalledOnce();
    });
});
