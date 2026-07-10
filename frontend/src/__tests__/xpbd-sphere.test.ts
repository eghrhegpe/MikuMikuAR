import { describe, it, expect } from 'vitest';
import type { XpbdParticle } from '@/physics/xpbd-solver';
import { XpbdSolver, type ConstraintType } from '@/physics/xpbd-solver';
import {
  quatNormalize, quatMultiply, quatConjugate, quatFromAxisAngle,
  quatToAxisAngle, quatSlerp, swingTwistDecompose
} from '@/physics/xpbd-solver';

describe('XpbdParticle angular state', () => {
  it('should have orientation defaulting to identity quaternion [0,0,0,1]', () => {
    const p: XpbdParticle = {
      p: new Float32Array(3),
      prevP: new Float32Array(3),
      v: new Float32Array(3),
      invMass: 1,
      radius: 0.1,
      orientation: new Float32Array([0, 0, 0, 1]),
      prevOrientation: new Float32Array([0, 0, 0, 1]),
      angularVelocity: new Float32Array(3),
      invInertia: 1,
    };
    expect(p.orientation).toEqual(new Float32Array([0, 0, 0, 1]));
    expect(p.invInertia).toBe(1);
    expect(p.prevOrientation.length).toBe(4);
    expect(p.angularVelocity.length).toBe(3);
  });
});

describe('sphere constraint type', () => {
  it('ConstraintType union should include sphere', () => {
    const t: ConstraintType = 'sphere';
    expect(t).toBe('sphere');
  });

  it('XpbdSolver should accept sphere constraint in constraints array', () => {
    const solver = new XpbdSolver({ gravity: [0, -9.8, 0], substeps: 1, damping: 1, groundY: -10 });
    solver.particles = [
      { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
        invMass: 0, radius: 0.1,
        orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]),
        angularVelocity: new Float32Array(3),
        invInertia: 0 },
      { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
        invMass: 1, radius: 0.1,
        orientation: new Float32Array([0,0,0,1]),
        prevOrientation: new Float32Array([0,0,0,1]),
        angularVelocity: new Float32Array(3),
        invInertia: 1 },
    ];
    solver.constraints = [{
      type: 'sphere',
      indices: [0, 1],
      coneHalfAngle: Math.PI / 4,
      twistRange: [-Math.PI / 4, Math.PI / 4],
      restQuaternion: new Float32Array([0, 0, 0, 1]),
      compliance: 0,
      restValue: 0,
      lambda: new Float32Array(2),
      stiffness: 1.0,
      damping: 0.0,
    }];
    expect(solver.constraints[0].type).toBe('sphere');
    expect(solver.constraints[0].coneHalfAngle).toBe(Math.PI / 4);
    expect(solver.constraints[0].twistRange).toEqual([-Math.PI / 4, Math.PI / 4]);
    expect(solver.constraints[0].restQuaternion).toEqual(new Float32Array([0, 0, 0, 1]));
  });
});

describe('quaternion utilities', () => {
  it('quatNormalize should normalize to unit length', () => {
    const q = new Float32Array([2, 0, 0, 0]);
    quatNormalize(q, q);
    expect(q[0]).toBeCloseTo(1);
    expect(q[3]).toBeCloseTo(0);
  });

  it('quatNormalize of zero should return identity', () => {
    const q = new Float32Array([0, 0, 0, 0]);
    quatNormalize(q, q);
    expect(q[0]).toBeCloseTo(0);
    expect(q[1]).toBeCloseTo(0);
    expect(q[2]).toBeCloseTo(0);
    expect(q[3]).toBeCloseTo(1);
  });

  it('quatMultiply: identity * q = q', () => {
    const a = new Float32Array([0, 0, 0, 1]);
    const b = new Float32Array([0.1, 0.2, 0.3, 0.9]);
    const out = new Float32Array(4);
    quatMultiply(a, b, out);
    expect(out[0]).toBeCloseTo(b[0]);
    expect(out[1]).toBeCloseTo(b[1]);
    expect(out[2]).toBeCloseTo(b[2]);
    expect(out[3]).toBeCloseTo(b[3]);
  });

  it('quatConjugate should negate xyz keep w', () => {
    const q = new Float32Array([0.1, 0.2, 0.3, 0.9]);
    const out = new Float32Array(4);
    quatConjugate(q, out);
    expect(out[0]).toBeCloseTo(-0.1);
    expect(out[1]).toBeCloseTo(-0.2);
    expect(out[2]).toBeCloseTo(-0.3);
    expect(out[3]).toBeCloseTo(0.9);
  });

  it('quatFromAxisAngle: 90deg around Y', () => {
    const out = quatFromAxisAngle(0, 1, 0, Math.PI / 2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out[2]).toBeCloseTo(0, 5);
    expect(out[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('quatToAxisAngle: identity should return zero angle', () => {
    const q = new Float32Array([0, 0, 0, 1]);
    const aa = quatToAxisAngle(q);
    expect(aa.angle).toBeCloseTo(0);
  });

  it('quatToAxisAngle: 0.5rad around Z', () => {
    const q = quatFromAxisAngle(0, 0, 1, 0.5);
    const aa = quatToAxisAngle(q);
    expect(aa.angle).toBeCloseTo(0.5, 5);
    expect(aa.az).toBeCloseTo(1, 5);
  });

  it('quatSlerp: t=0 returns a, t=1 returns b', () => {
    const a = new Float32Array([0, 0, 0, 1]);
    const b = quatFromAxisAngle(0, 1, 0, Math.PI / 2);
    const out = new Float32Array(4);
    quatSlerp(a, b, 0, out);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[3]).toBeCloseTo(1, 5);
    quatSlerp(a, b, 1, out);
    expect(out[1]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(out[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('swingTwistDecompose: pure twist around Z', () => {
    const q = quatFromAxisAngle(0, 0, 1, 0.5);
    const swing = new Float32Array(4);
    const twist = new Float32Array(4);
    swingTwistDecompose(q, 0, 0, 1, swing, twist);
    expect(twist[2]).toBeCloseTo(Math.sin(0.25), 5);
    expect(swing[0]).toBeCloseTo(0, 5);
    expect(swing[1]).toBeCloseTo(0, 5);
  });

  it('swingTwistDecompose: pure swing around X', () => {
    const q = quatFromAxisAngle(1, 0, 0, 0.5);
    const swing = new Float32Array(4);
    const twist = new Float32Array(4);
    swingTwistDecompose(q, 0, 0, 1, swing, twist);
    expect(swing[0]).toBeCloseTo(Math.sin(0.25), 5);
    expect(twist[2]).toBeCloseTo(0, 5);
    expect(twist[3]).toBeCloseTo(1, 5);
  });
});

describe('_solveSphereConstraint convergence', () => {
  it('should clamp swing beyond coneHalfAngle back toward limit', () => {
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 1, damping: 1, groundY: -100 });
    const parent = { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
      invMass: 0, radius: 0.1,
      orientation: new Float32Array([0,0,0,1]),
      prevOrientation: new Float32Array([0,0,0,1]),
      angularVelocity: new Float32Array(3),
      invInertia: 0 };
    const child = { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
      invMass: 1, radius: 0.1,
      orientation: quatFromAxisAngle(1, 0, 0, 1.0),
      prevOrientation: new Float32Array([0,0,0,1]),
      angularVelocity: new Float32Array(3),
      invInertia: 1 };
    solver.particles = [parent, child];
    solver.constraints = [{
      type: 'sphere', indices: [0, 1],
      coneHalfAngle: Math.PI / 4,
      twistRange: [-Math.PI/4, Math.PI/4],
      restQuaternion: new Float32Array([0,0,0,1]),
      compliance: 0, restValue: 0, lambda: new Float32Array(2), stiffness: 1.0, damping: 0.0,
    }];
    for (let i = 0; i < 50; i++) solver.step(1/60);
    const aa = quatToAxisAngle(child.orientation);
    expect(aa.angle).toBeLessThan(Math.PI / 4 + 0.15);
  });

  it('should not modify orientation within limits', () => {
    const solver = new XpbdSolver({ gravity: [0,0,0], substeps: 1, damping: 1, groundY: -100 });
    const parent = { p: new Float32Array([0,0,0]), prevP: new Float32Array([0,0,0]), v: new Float32Array(3),
      invMass: 0, radius: 0.1,
      orientation: new Float32Array([0,0,0,1]),
      prevOrientation: new Float32Array([0,0,0,1]),
      angularVelocity: new Float32Array(3),
      invInertia: 0 };
    const smallSwing = quatFromAxisAngle(0, 1, 0, 0.1);
    const child = { p: new Float32Array([0,1,0]), prevP: new Float32Array([0,1,0]), v: new Float32Array(3),
      invMass: 1, radius: 0.1,
      orientation: new Float32Array(smallSwing),
      prevOrientation: new Float32Array([0,0,0,1]),
      angularVelocity: new Float32Array(3),
      invInertia: 1 };
    solver.particles = [parent, child];
    solver.constraints = [{
      type: 'sphere', indices: [0, 1],
      coneHalfAngle: Math.PI / 4, twistRange: [-Math.PI/4, Math.PI/4],
      restQuaternion: new Float32Array([0,0,0,1]),
      compliance: 0, restValue: 0, lambda: new Float32Array(2), stiffness: 1.0, damping: 0.0,
    }];
    const before = child.orientation.slice();
    for (let i = 0; i < 10; i++) solver.step(1/60);
    expect(Math.abs(child.orientation[0] - before[0])).toBeLessThan(0.05);
  });
});
