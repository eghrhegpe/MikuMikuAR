// ============================================================
// Unit tests for xpbd-ragdoll.ts
// Tests follow Given/When/Then pattern and verify behavior without real Babylon
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRagdoll, stepRagdoll, writeBack } from '@/physics/xpbd-ragdoll';
import { DEFAULT_CONFIG } from '@/physics/xpbd-solver';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

// Mock Babylon Vector3 and Quaternion
vi.mock('@babylonjs/core/Maths/math.vector', () => {
  const Vector3 = class Vector3 {
    constructor(public x: number, public y: number, public z: number) {}
    static FromArray(arr: Float32Array | number[]): Vector3 {
      return new Vector3(arr[0], arr[1], arr[2]);
    }
    static FromArray3(x: number, y: number, z: number): Vector3 {
      return new Vector3(x, y, z);
    }
    subtract(other: Vector3): Vector3 {
      return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
    }
    clone(): Vector3 {
      return new Vector3(this.x, this.y, this.z);
    }
  };
  const Quaternion = class Quaternion {
    constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
    static Identity(): Quaternion {
      return new Quaternion(0, 0, 0, 1);
    }
  };
  return { Vector3, Quaternion };
});

// Mock Matrix for _propagateChildrenWasm
vi.mock('@babylonjs/core/Maths/math.matrix', () => ({
  Matrix: class Matrix {
    asArray(): number[] {
      return Array(16).fill(0);
    }
    copyFrom(_other: Matrix): Matrix {
      return this;
    }
    invert(): Matrix {
      return this;
    }
    multiplyToRef(_a: Matrix, _out: Matrix): void {}
    static FromArray(_arr: Float32Array): Matrix {
      return new Matrix();
    }
    static Compose(_rot: Quaternion, _pos: any, _scale: any): Matrix {
      return new Matrix();
    }
  },
}));

describe('xpbd-ragdoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildRagdoll', () => {
    it('should create particles and constraints for main-body bones', () => {
      // Given: 3 bones: root, spine, chest
      const bones: IMmdRuntimeBone[] = [
        {
          name: '全ての親',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
          invMass: 0,
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '上半身',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 0, 1]),
          invMass: 1,
          parentBone: { name: '全ての親' } as any,
          childBones: [],
        } as any,
        {
          name: '上半身2',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          invMass: 1,
          parentBone: { name: '上半身' } as any,
          childBones: [],
        } as any,
      ];

      // When: buildRagdoll
      const inst = buildRagdoll('test-model', bones);

      // Then: particles.length = 3, root invMass=0, others >0, constraints.length=2
      expect(inst.particles).toHaveLength(3);
      expect(inst.particles[0].invMass).toBe(0);
      expect(inst.particles[1].invMass).toBe(1);
      expect(inst.particles[2].invMass).toBe(1);
      expect(inst.constraints).toHaveLength(2);
      expect(inst.enabled).toBe(true);
      expect(inst.modelId).toBe('test-model');
    });

    it('should skip bones with finger/toe/eye in name', () => {
      // Given: bones including finger/toe/eye
      const bones: IMmdRuntimeBone[] = [
        {
          name: '右手首',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          invMass: 1,
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '左足首',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          invMass: 1,
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '右目',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          invMass: 1,
          parentBone: null,
          childBones: [],
        } as any,
      ];

      // When: buildRagdoll
      const inst = buildRagdoll('test-model', bones);

      // Then: no particles created (all skipped)
      expect(inst.particles).toHaveLength(0);
      expect(inst.constraints).toHaveLength(0);
    });

    it('should handle empty bones array', () => {
      // Given: empty array
      const bones: IMmdRuntimeBone[] = [];

      // When: buildRagdoll
      const inst = buildRagdoll('test-model', bones);

      // Then: empty particles and constraints
      expect(inst.particles).toHaveLength(0);
      expect(inst.constraints).toHaveLength(0);
    });
  });

  describe('stepRagdoll', () => {
    it('should clamp particles below groundY', () => {
      // Given: particle below groundY
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'Root',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -15, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
      ];
      const inst = buildRagdoll('test-model', bones);

      // When: step
      stepRagdoll(inst, 0.016);

      // Then: y clamped to groundY (-10)
      expect(inst.particles[0].p[1]).toBe(-10);
    });
  });

  describe('writeBack (JS mode)', () => {
    it('should set linkedBone.rotationQuaternion and call setPosition', () => {
      // Given: ragdoll instance and mock bones with linkedBone
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'Root',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
          invMass: 0,
          parentBone: null,
          childBones: [],
          updateWorldMatrix: vi.fn(),
        } as any,
      ];

      const inst = buildRagdoll('test-model', bones);
      const mockLinkedBone = {
        rotationQuaternion: null,
        setPosition: vi.fn(),
        getSkeleton: () => ({ _markAsDirty: vi.fn() }),
      };

      bones[0] = {
        ...bones[0],
        linkedBone: mockLinkedBone,
      } as any;

      // When: writeBack JS mode
      writeBack(inst, false, () => bones);

      // Then: rotationQuaternion set and setPosition called
      expect(mockLinkedBone.rotationQuaternion).toBeTruthy();
      expect(mockLinkedBone.setPosition).toHaveBeenCalled();
    });
  });
});

describe('stepRagdoll', () => {
  it('should move particles under gravity', () => {
    // Given: ragdoll with 1 particle at y=5, groundY=-10
    const bones: IMmdRuntimeBone[] = [
      {
        name: 'Root',
        worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
        invMass: 0,
        parentBone: null,
        childBones: [],
      } as any,
    ];
    const inst = buildRagdoll('test-model', bones);

    const initialY = inst.particles[0].p[1];
    // When: step with dt
    stepRagdoll(inst, 0.016);

    // Then: particle moved (y changed)
    expect(inst.particles[0].p[1]).not.toBe(initialY);
  });

  it('should clamp particles below groundY', () => {
    // Given: particle below groundY
    const bones: IMmdRuntimeBone[] = [
      {
        name: 'Root',
        worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -15, 0, 1]),
        invMass: 1,
        parentBone: null,
        childBones: [],
      } as any,
    ];
    const inst = buildRagdoll('test-model', bones);

    // When: step
    stepRagdoll(inst, 0.016);

    // Then: y clamped to groundY (-10)
    expect(inst.particles[0].p[1]).toBe(-10);
  });
});

describe('writeBack (JS mode)', () => {
  it('should set linkedBone.rotationQuaternion and call setPosition', () => {
    // Given: ragdoll instance and mock bones with linkedBone
    const bones: IMmdRuntimeBone[] = [
      {
        name: 'Root',
        worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
        invMass: 0,
        parentBone: null,
        childBones: [],
        updateWorldMatrix: vi.fn(),
      } as any,
    ];

    const inst = buildRagdoll('test-model', bones);
    const mockLinkedBone = {
      rotationQuaternion: null,
      setPosition: vi.fn(),
      getSkeleton: () => ({ _markAsDirty: vi.fn() }),
    };

    bones[0] = { ...bones[0], linkedBone: mockLinkedBone } as any;

    // When: writeBack JS mode
    writeBack(inst, false, () => bones);

    // Then: rotationQuaternion set and setPosition called
    expect(mockLinkedBone.rotationQuaternion).toBeTruthy();
    expect(mockLinkedBone.setPosition).toHaveBeenCalled();
  });
});
