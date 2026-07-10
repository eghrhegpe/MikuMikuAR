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

      // Then: particles.length = 3, root invMass=0, others >0, constraints.length=4 (2 distance + 2 sphere)
      expect(inst.particles).toHaveLength(3);
      expect(inst.particles[0].invMass).toBe(0);
      expect(inst.particles[1].invMass).toBe(1);
      expect(inst.particles[2].invMass).toBe(1);
      expect(inst.constraints).toHaveLength(4);
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

    it('should create sphere constraints alongside distance constraints', () => {
      const bones: IMmdRuntimeBone[] = [
        { name: '全ての親', parentBone: null, childBones: [], worldMatrix: new Float32Array(16) } as any,
        { name: '上半身', parentBone: null, childBones: [], worldMatrix: new Float32Array(16) } as any,
      ];
      // 设置世界矩阵：root 在原点（identity），spine 在 (0,1,0)（identity 旋转 + 平移）
      // Float32Array(16) 默认全 0，需设置 identity 旋转部分（对角线）+ 平移
      const rootMat = (bones[0].worldMatrix as Float32Array);
      rootMat[0]=1; rootMat[5]=1; rootMat[10]=1; rootMat[15]=1; // identity rotation
      rootMat[12]=0; rootMat[13]=0; rootMat[14]=0;
      const spineMat = (bones[1].worldMatrix as Float32Array);
      spineMat[0]=1; spineMat[5]=1; spineMat[10]=1; spineMat[15]=1; // identity rotation
      spineMat[12]=0; spineMat[13]=1; spineMat[14]=0;
      (bones[1].parentBone as any) = bones[0];

      const inst = buildRagdoll('m1', bones as any);
      const sphereConstraints = inst.constraints.filter(c => c.type === 'sphere');
      const distConstraints = inst.constraints.filter(c => c.type === 'distance');
      expect(distConstraints.length).toBeGreaterThan(0);
      expect(sphereConstraints.length).toBe(distConstraints.length);
      const sc = sphereConstraints[0];
      expect(sc.coneHalfAngle).toBeDefined();
      expect(sc.twistRange).toBeDefined();
      expect(sc.restQuaternion).toBeDefined();
      // identity rotation 的相对四元数应为 identity [0,0,0,1]
      expect(sc.restQuaternion![0]).toBeCloseTo(0, 5);
      expect(sc.restQuaternion![1]).toBeCloseTo(0, 5);
      expect(sc.restQuaternion![2]).toBeCloseTo(0, 5);
      expect(sc.restQuaternion![3]).toBeCloseTo(1, 5);
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
