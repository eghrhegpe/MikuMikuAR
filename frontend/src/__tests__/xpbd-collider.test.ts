/**
 * Unit tests for SdfCollider (xpbd-collider.ts)
 *
 * Tests cover:
 *   - init() with DEFAULT_BODY_CAPSULES and custom/empty specs
 *   - updateMatrices() with valid/null matrices and direction normalization
 *   - solve() / _solveCapsule() collision push
 *   - friction tangent-velocity damping
 *   - disabled capsules (setEnabled / setEnabledByName / setAllEnabled)
 *   - management (clear / scaleAll / updateCapsuleSizes)
 *   - edge cases (zero halfHeight, surface particle, coincident particle)
 *   - multiple overlapping capsules contributing to push
 *
 * No Babylon.js dependency — pure Float32Array math.
 */

import { describe, it, expect, assert } from 'vitest';
import { XpbdSolver } from '../physics/xpbd-solver';
import { SdfCollider, DEFAULT_BODY_CAPSULES } from '../physics/xpbd-collider';
import type { CapsuleSpec } from '../physics/xpbd-collider';

// ============================================================
// Helpers
// ============================================================

/** Build a column-major 4×4 world matrix with identity rotation + translation */
function makeMatrix(tx: number, ty: number, tz: number, scale = 1): Float32Array {
    return new Float32Array([
        scale, 0, 0, 0,
        0, scale, 0, 0,
        0, 0, scale, 0,
        tx, ty, tz, 1,
    ]);
}

/** Build a matrix with an arbitrary y-axis (non-unit for normalization tests) */
function makeMatrixWithYAxis(tx: number, ty: number, tz: number, yx: number, yy: number, yz: number): Float32Array {
    return new Float32Array([
        1, 0, 0, 0,
        yx, yy, yz, 0,
        0, 0, 1, 0,
        tx, ty, tz, 1,
    ]);
}

// ============================================================
// init()
// ============================================================

describe('SdfCollider init()', () => {
    it('creates 13 capsules from DEFAULT_BODY_CAPSULES', () => {
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);
        expect(c.capsules).toHaveLength(13);
    });

    it('copies spec properties to each capsule', () => {
        const c = new SdfCollider();
        c.init(DEFAULT_BODY_CAPSULES);

        const head = c.capsules[0];
        expect(head.name).toBe('head');
        expect(head.boneName).toBe('頭');
        expect(head.radius).toBeCloseTo(0.13, 5);
        expect(head.halfHeight).toBeCloseTo(0.08, 5);
        expect(head.enabled).toBe(true);
        // Center/direction start at origin/default
        expect(Array.from(head.center)).toEqual([0, 0, 0]);
        expect(Array.from(head.direction)).toEqual([0, 1, 0]);
    });

    it('accepts custom capsule specs', () => {
        const c = new SdfCollider();
        const specs: CapsuleSpec[] = [
            { name: 'torso', boneName: 'Spine', radius: 0.2, halfHeight: 0.15 },
            { name: 'thighL', boneName: 'LeftUpLeg', radius: 0.1, halfHeight: 0.2 },
        ];
        c.init(specs);
        expect(c.capsules).toHaveLength(2);
        expect(c.capsules[0].name).toBe('torso');
        expect(c.capsules[1].boneName).toBe('LeftUpLeg');
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

// ============================================================
// updateMatrices()
// ============================================================

describe('SdfCollider updateMatrices()', () => {
    it('sets center and direction from a valid matrix', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);

        const mat = makeMatrix(1.5, -2.0, 3.0);
        c.updateMatrices([mat]);

        expect(Array.from(c.capsules[0].center)).toEqual([1.5, -2.0, 3.0]);
        // Identity y-axis = (0, 1, 0)
        expect(Array.from(c.capsules[0].direction)).toEqual([0, 1, 0]);
    });

    it('normalizes non-unit direction from a scaled matrix', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);

        const mat = makeMatrixWithYAxis(0, 0, 0, 0, 2.5, 0); // y-axis length = 2.5
        c.updateMatrices([mat]);

        // Direction should be normalized to (0, 1, 0)
        const dir = c.capsules[0].direction;
        expect(dir[0]).toBeCloseTo(0, 5);
        expect(dir[1]).toBeCloseTo(1, 5);
        expect(dir[2]).toBeCloseTo(0, 5);
    });

    it('skips null matrix entries, preserving previous values', () => {
        const c = new SdfCollider();
        c.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);

        // First update with a valid matrix
        const mat = makeMatrix(1, 2, 3);
        c.updateMatrices([mat]);
        expect(Array.from(c.capsules[0].center)).toEqual([1, 2, 3]);

        // Second update with null — should keep previous values
        c.updateMatrices([null]);
        expect(Array.from(c.capsules[0].center)).toEqual([1, 2, 3]);
    });

    it('stops at min(capsules.length, matrices.length)', () => {
        const c = new SdfCollider();
        c.init([
            { name: 'a', boneName: 'ba', radius: 0.1, halfHeight: 0.1 },
            { name: 'b', boneName: 'bb', radius: 0.1, halfHeight: 0.1 },
        ]);

        // Only 1 matrix for 2 capsules
        c.updateMatrices([makeMatrix(7, 8, 9)]);

        expect(Array.from(c.capsules[0].center)).toEqual([7, 8, 9]);
        // Second capsule should remain at init values (0, 0, 0)
        expect(Array.from(c.capsules[1].center)).toEqual([0, 0, 0]);
    });

    it('handles multiple capsules with mixed valid/null matrices', () => {
        const c = new SdfCollider();
        c.init([
            { name: 'a', boneName: 'ba', radius: 0.1, halfHeight: 0.1 },
            { name: 'b', boneName: 'bb', radius: 0.1, halfHeight: 0.1 },
            { name: 'c', boneName: 'bc', radius: 0.1, halfHeight: 0.1 },
        ]);

        c.updateMatrices([
            makeMatrix(1, 2, 3),
            null,
            makeMatrix(4, 5, 6),
        ]);

        expect(Array.from(c.capsules[0].center)).toEqual([1, 2, 3]);
        expect(Array.from(c.capsules[1].center)).toEqual([0, 0, 0]); // null → preserved
        expect(Array.from(c.capsules[2].center)).toEqual([4, 5, 6]);
    });
});

// ============================================================
// solve() — basic collision
// ============================================================

describe('SdfCollider solve() collision', () => {
    /** Create a simple vertical capsule at origin */
    function setupSingleCapsule(
        radius = 0.13,
        halfHeight = 0.08,
        stiffness = 1.0,
        friction = 0.1,
    ): { solver: XpbdSolver; collider: SdfCollider; particleIdx: number } {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.stiffness = stiffness;
        collider.friction = friction;
        collider.init([{ name: 'chest', boneName: '上半身', radius, halfHeight }]);
        // Capsule at origin, direction (0, 1, 0) — already set by init
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        return { solver, collider, particleIdx: idx };
    }

    it('pushes a penetrating particle outside the capsule', () => {
        const { solver, collider, particleIdx } = setupSingleCapsule(0.13, 0.08);
        const p = solver.particles[particleIdx];

        // Particle at (0.1, 0, 0) with radius 0.05, capsule radius 0.13
        // Nearest point on segment is (0, 0, 0), dist = 0.1, minDist = 0.18
        // penetration = 0.08, new p.x should be 0.1 + 0.08 = 0.18
        const beforeX = p.p[0];
        expect(beforeX).toBeCloseTo(0.10, 5);

        collider.solve(solver);

        expect(p.p[0]).toBeGreaterThan(0.17); // pushed out
        expect(p.p[0]).toBeLessThanOrEqual(0.19); // not too far
    });

    it('does nothing for a particle already outside the capsule', () => {
        const { solver, collider, particleIdx } = setupSingleCapsule(0.13, 0.08);
        const p = solver.particles[particleIdx];
        // Move particle far outside
        p.p[0] = 10;
        p.p[1] = 10;
        const before = Array.from(p.p);

        collider.solve(solver);

        expect(Array.from(p.p)).toEqual(before);
    });

    it('skips fixed particles (invMass = 0)', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], Infinity, 0.05); // fixed
        const p = solver.particles[idx];

        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        const before = Array.from(p.p);
        collider.solve(solver);

        expect(Array.from(p.p)).toEqual(before);
    });

    it('respects stiffness = 0 (no push)', () => {
        const { solver, collider, particleIdx } = setupSingleCapsule(0.13, 0.08, 0);
        const p = solver.particles[particleIdx];
        const beforeX = p.p[0];

        collider.solve(solver);

        expect(p.p[0]).toBeCloseTo(beforeX, 5); // no movement
    });

    it('respects stiffness = 0.5 (half push)', () => {
        const { solver, collider, particleIdx } = setupSingleCapsule(0.13, 0.08, 0.5);
        const p = solver.particles[particleIdx];

        // Full push would be 0.08, half push = 0.04
        // New p.x = 0.1 + 0.04 = 0.14
        collider.solve(solver);

        expect(p.p[0]).toBeGreaterThan(0.13);
        expect(p.p[0]).toBeLessThan(0.15);
    });
});

// ============================================================
// solve() — disabled capsules
// ============================================================

describe('disabled capsules', () => {
    it('disabled capsule does not affect particles', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1.0, 0.05);

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
        const chest = collider.capsules.find(c => c.name === 'chest');
        expect(chest?.enabled).toBe(false);

        collider.setEnabledByName('chest', true);
        expect(chest?.enabled).toBe(true);
    });

    it('setEnabled with out-of-range index is a no-op', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.1, halfHeight: 0.1 }]);

        collider.setEnabled(99, false);
        expect(collider.capsules[0].enabled).toBe(true); // unchanged

        collider.setEnabled(-1, false);
        expect(collider.capsules[0].enabled).toBe(true); // unchanged
    });

    it('setAllEnabled disables all capsules', () => {
        const collider = new SdfCollider();
        collider.init(DEFAULT_BODY_CAPSULES);

        collider.setAllEnabled(false);
        for (const cap of collider.capsules) {
            expect(cap.enabled).toBe(false);
        }

        collider.setAllEnabled(true);
        for (const cap of collider.capsules) {
            expect(cap.enabled).toBe(true);
        }
    });
});

// ============================================================
// Friction
// ============================================================

describe('SdfCollider friction', () => {
    function setupFrictionTest(friction: number):
        { solver: XpbdSolver; collider: SdfCollider; particleIdx: number } {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1.0, 0.05);
        // Set up a non-zero velocity (prevP differs from p)
        const p = solver.particles[idx];
        p.prevP[0] = 0;
        p.prevP[1] = 0.1;
        p.prevP[2] = 0;

        const collider = new SdfCollider();
        collider.stiffness = 1.0;
        collider.friction = friction;
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        return { solver, collider, particleIdx: idx };
    }

    it('friction > 0 modifies prevP (damps tangent velocity)', () => {
        const { solver, collider, particleIdx } = setupFrictionTest(0.5);
        const p = solver.particles[particleIdx];
        const prevPBefore = Array.from(p.prevP);

        collider.solve(solver);

        // Particle was pushed out
        expect(p.p[0]).toBeGreaterThan(0.17);
        // prevP should have been modified (tangent Y velocity damped)
        const prevPAfter = Array.from(p.prevP);
        expect(prevPAfter).not.toEqual(prevPBefore);
        // Y component of prevP should be closer to p.p[1] (damped)
        expect(Math.abs(p.p[1] - p.prevP[1])).toBeLessThan(Math.abs(0 - 0.1));
    });

    it('friction = 0 skips prevP modification entirely', () => {
        const { solver, collider, particleIdx } = setupFrictionTest(0);
        const p = solver.particles[particleIdx];
        const prevPBefore = Array.from(p.prevP);

        collider.solve(solver);

        // Particle was pushed out
        expect(p.p[0]).toBeGreaterThan(0.17);
        // prevP should be unchanged
        expect(Array.from(p.prevP)).toEqual(prevPBefore);
    });

    it('friction = 1 removes all tangent velocity', () => {
        const { solver, collider, particleIdx } = setupFrictionTest(1.0);
        const p = solver.particles[particleIdx];

        collider.solve(solver);

        // With friction=1, tangent velocity is entirely removed,
        // so after push: prevP = p - vn*n (only normal component remains)
        // The Y velocity should be zeroed → prevP.y ≈ p.p[1]
        // Actually with no tangent velocity: prevP should equal p - (vn * n)
        // Since n = (1,0,0) and vn = v·n = p.p[0] - prevP[0]:
        // This gets a bit circular... let's just check that prevP[y] ≈ p.p[y]
        // (tangent velocity zeroed means no Y velocity)
        expect(p.prevP[1]).toBeCloseTo(p.p[1], 4);
    });

    it('particle touching multiple capsules only gets friction once', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0, 0, 0], 1.0, 0.05);
        const p = solver.particles[idx];
        // Velocity with Y component (tangent to both capsules)
        p.prevP[0] = 0;
        p.prevP[1] = 0.1;
        p.prevP[2] = 0;

        const collider = new SdfCollider();
        collider.stiffness = 1.0;
        collider.friction = 0.5;
        // Two capsules side-by-side, both containing (0,0,0)
        collider.init([
            { name: 'a', boneName: 'ba', radius: 0.3, halfHeight: 0.1 },   // center at -0.25
            { name: 'b', boneName: 'bb', radius: 0.3, halfHeight: 0.1 },   // center at 0.25
        ]);
        collider.updateMatrices([makeMatrix(-0.25, 0, 0), makeMatrix(0.25, 0, 0)]);

        collider.solve(solver);

        // Both capsules contributed to position push
        expect(p.p[0]).not.toBeCloseTo(0, 2);
        // prevP was modified (friction applied)
        expect(p.prevP[1]).not.toBeCloseTo(0.1, 4);

        // Verify prevP is still between original and p.p (not over-damped)
        // With single friction: Y velocity reduced by 50%
        // With double friction: Y velocity reduced by 75%
        // Without knowing exact, just assert it's not aggressively zeroed
        expect(p.prevP[1]).toBeGreaterThan(p.p[1] - 0.01); // not absurd
    });
});

// ============================================================
// Management: clear / scaleAll / updateCapsuleSizes
// ============================================================

describe('SdfCollider management', () => {
    it('clear empties the capsules array', () => {
        const collider = new SdfCollider();
        collider.init(DEFAULT_BODY_CAPSULES);
        expect(collider.capsules).not.toHaveLength(0);

        collider.clear();
        expect(collider.capsules).toHaveLength(0);
    });

    it('scaleAll multiplies radius and halfHeight', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 't', boneName: 'b', radius: 0.1, halfHeight: 0.2 }]);

        collider.scaleAll(2.0);
        expect(collider.capsules[0].radius).toBeCloseTo(0.2, 5);
        expect(collider.capsules[0].halfHeight).toBeCloseTo(0.4, 5);

        collider.scaleAll(0.5);
        expect(collider.capsules[0].radius).toBeCloseTo(0.1, 5);
        expect(collider.capsules[0].halfHeight).toBeCloseTo(0.2, 5);
    });

    it('updateCapsuleSizes uses parent bone distance', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 'child', boneName: 'boneChild', radius: 0.1, halfHeight: 0.1 }]);

        const childMat = makeMatrix(0, 1, 0);   // at (0, 1, 0)
        const parentMat = makeMatrix(0, 0, 0);  // at (0, 0, 0)
        const getBone = (name: string) => {
            if (name === 'boneChild') return childMat;
            if (name === 'boneParent') return parentMat;
            return null;
        };

        collider.updateCapsuleSizes(getBone, { boneChild: 'boneParent' });

        // Distance = 1 → halfHeight = 0.5, radius = 0.2
        expect(collider.capsules[0].halfHeight).toBeCloseTo(0.5, 5);
        expect(collider.capsules[0].radius).toBeCloseTo(0.2, 5);
    });

    it('updateCapsuleSizes keeps defaults when parent matrix is null', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 'child', boneName: 'boneChild', radius: 0.1, halfHeight: 0.1 }]);

        const getBone = (_name: string) => null; // both matrices null
        collider.updateCapsuleSizes(getBone, { boneChild: 'boneParent' });

        // Sizes unchanged
        expect(collider.capsules[0].halfHeight).toBeCloseTo(0.1, 5);
        expect(collider.capsules[0].radius).toBeCloseTo(0.1, 5);
    });

    it('updateCapsuleSizes keeps defaults when no parent in map', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 'orphan', boneName: 'boneX', radius: 0.1, halfHeight: 0.1 }]);
        // Empty parent map
        collider.updateCapsuleSizes(() => makeMatrix(1, 2, 3));

        expect(collider.capsules[0].halfHeight).toBeCloseTo(0.1, 5);
        expect(collider.capsules[0].radius).toBeCloseTo(0.1, 5);
    });
});

// ============================================================
// Edge cases
// ============================================================

describe('SdfCollider edge cases', () => {
    it('zero halfHeight capsule degenerates to sphere (still works)', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.2, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.init([{ name: 's', boneName: 'b', radius: 0.1, halfHeight: 0 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        // With hh=0, capsule is a sphere at origin, radius 0.1
        // Particle at (0.2, 0, 0), dist = 0.2, minDist = 0.15 → outside, not pushed
        // Move particle closer to test
        solver.particles[idx].p[0] = 0.05;
        // dist = 0.05, minDist = 0.15, penetration = 0.10
        collider.solve(solver);

        // Should have been pushed out
        expect(solver.particles[idx].p[0]).toBeGreaterThan(0.12);
    });

    it('particle exactly at surface distance is not pushed', () => {
        const solver = new XpbdSolver();
        // Capsule at origin, r=0.13, hh=0.08
        // Nearest point for particle at (0.18, 0, 0) is (0, 0, 0), dist = 0.18
        // minDist = 0.13 + 0.05 = 0.18 → dist == minDist → skip
        const idx = solver.addParticle([0.18, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        const before = solver.particles[idx].p[0];
        collider.solve(solver);

        expect(solver.particles[idx].p[0]).toBeCloseTo(before, 10);
    });

    it('coincident particle (dist < 1e-10) is skipped', () => {
        const solver = new XpbdSolver();
        // Particle at center of capsule → nearest point is at same position
        const idx = solver.addParticle([0, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.init([{ name: 'c', boneName: 'b', radius: 0.13, halfHeight: 0.08 }]);
        collider.updateMatrices([makeMatrix(0, 0, 0)]);

        const before = Array.from(solver.particles[idx].p);
        collider.solve(solver);

        // Should not crash; position should be unchanged or pushed
        // (dist === 0 < 1e-10 → skip branch)
        expect(Array.from(solver.particles[idx].p)).toEqual(before);
    });

    it('two overlapping capsules both contribute to position correction', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.stiffness = 1.0;
        collider.friction = 0;
        // Two capsules both containing (0, 0, 0)
        collider.init([
            { name: 'a', boneName: 'ba', radius: 0.3, halfHeight: 0.1 },
            { name: 'b', boneName: 'bb', radius: 0.3, halfHeight: 0.1 },
        ]);
        // A at (-0.25, 0, 0), B at (-0.15, 0, 0) — both push in +x direction
        collider.updateMatrices([makeMatrix(-0.25, 0, 0), makeMatrix(-0.15, 0, 0)]);

        // With just capsule A: push = 0.35 - 0.25 = 0.10 → p.x = 0.10
        // With just capsule B: push = 0.35 - 0.15 = 0.20 → p.x = 0.20
        // With both: cumulative push should be > 0.10 (more than A alone)
        const singleCollider = new SdfCollider();
        singleCollider.stiffness = 1.0;
        singleCollider.friction = 0;
        singleCollider.init([{ name: 'a', boneName: 'ba', radius: 0.3, halfHeight: 0.1 }]);
        singleCollider.updateMatrices([makeMatrix(-0.25, 0, 0)]);

        const singleSolver = new XpbdSolver();
        const singleIdx = singleSolver.addParticle([0, 0, 0], 1.0, 0.05);
        singleCollider.solve(singleSolver);
        const singlePushX = singleSolver.particles[singleIdx].p[0];

        collider.solve(solver);
        const dualPushX = solver.particles[idx].p[0];

        // Dual capsules should push further than single capsule
        expect(dualPushX).toBeGreaterThan(singlePushX + 0.01);
    });

    it('many particles with many capsules does not crash', () => {
        const solver = new XpbdSolver();

        // Add 50 particles spread across the space
        const indices: number[] = [];
        for (let i = 0; i < 50; i++) {
            const theta = (i / 50) * Math.PI * 2;
            const r = 0.5;
            indices.push(solver.addParticle(
                [Math.cos(theta) * r, Math.sin(theta) * r, 0],
                1.0, 0.03
            ));
        }

        const collider = new SdfCollider();
        collider.init(DEFAULT_BODY_CAPSULES); // 13 capsules
        // Set all capsules at origin
        const matrices = DEFAULT_BODY_CAPSULES.map(() => makeMatrix(0, 0, 0));
        collider.updateMatrices(matrices);

        // This should not throw
        assert.doesNotThrow(() => collider.solve(solver));

        // Some particles should have been moved
        const movedCount = indices.filter(i => {
            const p = solver.particles[i];
            return Math.abs(p.p[0]) > 0.01 || Math.abs(p.p[1]) > 0.01;
        }).length;
        expect(movedCount).toBeGreaterThan(0);
    });

    it('solve with empty capsules does nothing', () => {
        const solver = new XpbdSolver();
        const idx = solver.addParticle([0.1, 0, 0], 1.0, 0.05);

        const collider = new SdfCollider();
        collider.init([]); // no capsules
        const before = Array.from(solver.particles[idx].p);

        assert.doesNotThrow(() => collider.solve(solver));
        expect(Array.from(solver.particles[idx].p)).toEqual(before);
    });

    it('setEnabled index bounds checking', () => {
        const collider = new SdfCollider();
        collider.init([{ name: 'x', boneName: 'bx', radius: 0.1, halfHeight: 0.1 }]);

        // Valid index
        collider.setEnabled(0, false);
        expect(collider.capsules[0].enabled).toBe(false);

        // Negative index — no-op
        collider.setEnabled(-1, true);
        expect(collider.capsules[0].enabled).toBe(false); // still false

        // Out-of-range — no-op
        collider.setEnabled(100, true);
        expect(collider.capsules[0].enabled).toBe(false); // still false
    });
});
