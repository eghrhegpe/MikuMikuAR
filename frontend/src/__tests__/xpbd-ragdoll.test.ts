// ============================================================
// Unit tests for xpbd-ragdoll.ts
// Tests follow Given/When/Then pattern and verify behavior without real Babylon
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRagdoll, stepRagdoll, writeBack } from '@/physics/xpbd-ragdoll';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';

// Mock Babylon Vector3 and Quaternion
vi.mock('@babylonjs/core/Maths/math.vector', () => {
  const Vector3 = class Vector3 {
    constructor(public x: number, public y: number, public z: number) {}
    static FromArray(arr: Float32Array | number[]): Vector3 {
      return new Vector3(arr[0], arr[1], arr[2]);
    }
    subtract(other: Vector3): Vector3 {
      return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
    }
    clone(): Vector3 {
      return new Vector3(this.x, this.y, this.z);
    }
    set(x: number, y: number, z: number): void {
      this.x = x; this.y = y; this.z = z;
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
    asArray(): number[] { return Array(16).fill(0); }
    copyFrom(_other: Matrix): Matrix { return this; }
    invert(): Matrix { return this; }
    multiplyToRef(_a: Matrix, _out: Matrix): void {}
    getTranslation(): any { return { x: 0, y: 0, z: 0 }; }
    getRotationMatrix(): Matrix { return new Matrix(); }
    static FromArray(_arr: Float32Array): Matrix { return new Matrix(); }
    static Compose(_scale: any, _rot: any, _pos: any): Matrix { return new Matrix(); }
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
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '上半身',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 0, 1]),
          parentBone: { name: '全ての親', worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]) } as any,
          childBones: [],
        } as any,
        {
          name: '上半身2',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          parentBone: { name: '上半身', worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, 0, 1]) } as any,
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
      // Given: bones including finger/toe/eye (use English names that match the filter)
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'RightFinger',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: 'LeftToe',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: 'RightEye',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
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

    it('should not skip main-body bones with Japanese names', () => {
      // Given: main-body bones with Japanese names (should NOT be skipped)
      const bones: IMmdRuntimeBone[] = [
        {
          name: '右手首',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '左足首',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
      ];

      // When: buildRagdoll
      const inst = buildRagdoll('test-model', bones);

      // Then: particles created (Japanese names don't match English filter)
      expect(inst.particles).toHaveLength(2);
    });

    it('should handle empty bones array', () => {
      // Given: empty array
      const bones: IMmdRuntimeBone[] = [];

      // When: buildRagdoll
      const inst = buildRagdoll('test-model', bones);

      // Then: empty particles and constraints
      expect(inst.particles).toHaveLength(0);
      expect(inst.constraints).toHaveLength(0);
      expect(inst.modelId).toBe('test-model');
    });
  });

  describe('stepRagdoll', () => {
    it('should clamp non-root particles below groundY', () => {
      // Given: non-root particle below groundY (invMass > 0 so clamp applies)
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'センター',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
        {
          name: '下半身',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -15, 0, 1]),
          parentBone: { name: 'センター', worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) } as any,
          childBones: [],
        } as any,
      ];
      const inst = buildRagdoll('test-model', bones);

      // When: step
      stepRagdoll(inst, 0.016);

      // Then: non-root particle (index 1) y clamped to groundY (-10)
      expect(inst.particles[1].p[1]).toBe(-10);
    });

    it('should not clamp particles above groundY', () => {
      // Given: particle above groundY
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'センター',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
          parentBone: null,
          childBones: [],
        } as any,
      ];
      const inst = buildRagdoll('test-model', bones);

      // When: step
      stepRagdoll(inst, 0.016);

      // Then: y stays above ground
      expect(inst.particles[0].p[1]).toBe(5);
    });
  });

  describe('writeBack (JS mode)', () => {
    it('should set linkedBone.rotationQuaternion and call setPosition', () => {
      // Given: ragdoll instance and mock bones with linkedBone
      const bones: IMmdRuntimeBone[] = [
        {
          name: 'Root',
          worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1]),
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
