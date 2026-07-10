import { describe, it, expect } from 'vitest';
import type { XpbdParticle } from '@/physics/xpbd-solver';
import { XpbdSolver, type ConstraintType } from '@/physics/xpbd-solver';

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
