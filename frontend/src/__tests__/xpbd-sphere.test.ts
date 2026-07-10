import { describe, it, expect } from 'vitest';
import type { XpbdParticle } from '@/physics/xpbd-solver';

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
