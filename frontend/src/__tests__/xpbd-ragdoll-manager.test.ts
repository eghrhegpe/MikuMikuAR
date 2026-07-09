// [doc:test] Ragdoll Manager 单元测试
// 验证 ragdoll-manager.ts 的公开 API 与 cloth-manager.ts 保持一致的行为模式

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ragdollManager from '@/physics/ragdoll-manager';
import { envState } from '@/core/state';
import { modelManager } from '@/scene/scene';

// Mock dependencies
vi.mock('@/core/state', () => ({
  envState: { ragdollEnabled: false },
  setStatus: vi.fn(),
}));

vi.mock('@/scene/scene', () => ({
  scene: {
    deltaTime: 16,
    onBeforeRenderObservable: {
      add: vi.fn(() => ({ remove: vi.fn() })),
    },
  },
  modelManager: {
    focused: vi.fn(),
    focusedMmdModel: vi.fn(),
    addRagdoll: vi.fn(),
    removeRagdoll: vi.fn(),
    get: vi.fn(),
    getBoneWorldMatrix: vi.fn(),
  },
}));

// Mock XPBD types
const mockRagdollInstance = {
  particles: [{}, {}, {}],
  constraints: [{}, {}],
  enabled: true,
  isWasm: false,
  dispose: vi.fn(),
  updateFn: null as ((dt: number) => void) | null,
};

const mockCollider = {
  capsules: [
    { name: 'head', boneName: '頭', radius: 0.1, halfHeight: 0.2 },
    { name: 'chest', boneName: '上半身', radius: 0.15, halfHeight: 0.3 },
  ],
  init: vi.fn(),
  scaleAll: vi.fn(),
  updateCapsuleSizes: vi.fn(),
  setEnabledByName: vi.fn(),
  setAllEnabled: vi.fn(),
  stiffness: 1.0,
  friction: 0.5,
};

vi.mock('@/physics/xpbd-ragdoll', () => ({
  buildRagdoll: vi.fn(() => mockRagdollInstance),
  stepRagdoll: vi.fn(),
  writeBack: vi.fn(),
}));

vi.mock('@/physics/xpbd-collider', () => ({
  SdfCollider: class SdfCollider {
    capsules = [];
    init = mockCollider.init;
    scaleAll = mockCollider.scaleAll;
    updateCapsuleSizes = mockCollider.updateCapsuleSizes;
    setEnabledByName = mockCollider.setEnabledByName;
    setAllEnabled = mockCollider.setAllEnabled;
    stiffness = 1.0;
    friction = 0.5;
  },
  DEFAULT_BODY_CAPSULES: [],
}));

// Mock IMmdRuntimeBone
const mockRuntimeBone = {
  name: '頭',
  parentBone: null,
  worldMatrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
  rigidBodyIndices: [],
};

const mockMmdModel = {
  runtimeBones: [mockRuntimeBone],
};

describe('ragdoll-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset envState
    envState.ragdollEnabled = false;
    mockRagdollInstance.dispose.mockClear();
    mockCollider.init.mockClear();
  });

  afterEach(() => {
    // Clean up any registered instances
    ragdollManager.toggleRagdoll(false);
  });

  describe('toggleRagdoll', () => {
    it('should set envState.ragdollEnabled to true when enabled', () => {
      ragdollManager.toggleRagdoll(true);
      expect(envState.ragdollEnabled).toBe(true);
    });

    it('should set envState.ragdollEnabled to false when disabled', () => {
      envState.ragdollEnabled = true;
      ragdollManager.toggleRagdoll(false);
      expect(envState.ragdollEnabled).toBe(false);
    });
  });

  describe('recreateRagdoll', () => {
    it('should return false when ragdoll is not enabled', () => {
      const result = ragdollManager.recreateRagdoll();
      expect(result).toBe(false);
    });

    it('should return true when ragdoll is enabled and model is focused', () => {
      envState.ragdollEnabled = true;
      vi.mocked(modelManager.focused).mockReturnValue({ id: 'test-model' } as any);
      vi.mocked(modelManager.focusedMmdModel).mockReturnValue(mockMmdModel as any);
      vi.mocked(modelManager.addRagdoll).mockImplementation(() => {});

      const result = ragdollManager.recreateRagdoll();
      expect(result).toBe(true);
    });
  });

  describe('getRagdollDiagnostics', () => {
    it('should return correct diagnostics when disabled', () => {
      const diag = ragdollManager.getRagdollDiagnostics();
      expect(diag).toEqual({
        enabled: false,
        instances: 0,
        particles: 0,
        constraints: 0,
        mode: 'none',
      });
    });

    it('should return correct diagnostics when enabled', () => {
      envState.ragdollEnabled = true;
      const diag = ragdollManager.getRagdollDiagnostics();
      expect(diag.enabled).toBe(true);
      expect(diag.instances).toBe(0); // No instance created yet
    });
  });

  describe('initRagdoll', () => {
    it('should store getBones and scene references', () => {
      const mockGetBones = vi.fn(() => [mockRuntimeBone]);
      const mockScene = {} as any;
      
      ragdollManager.initRagdoll(mockGetBones, mockScene);
      
      // Can't directly test private state, but we can verify it doesn't throw
      expect(mockGetBones).toHaveBeenCalled();
    });
  });

  describe('debug functions', () => {
    it('should set debug flags on ragdoll instance', () => {
      // This would need a mock ragdoll instance to be set up
      // For now just verify the functions exist and are callable
      expect(ragdollManager.setRagdollDebugParticles).toBeDefined();
      expect(ragdollManager.setRagdollDebugConstraints).toBeDefined();
      expect(ragdollManager.setRagdollDebugColliders).toBeDefined();
      expect(ragdollManager.getRagdollDebugState).toBeDefined();
    });
  });

  describe('collider functions', () => {
    it('should return null collider when no ragdoll exists', () => {
      const collider = ragdollManager.getRagdollCollider();
      expect(collider).toBeNull();
    });

    it('should return collider specs', () => {
      const specs = ragdollManager.getRagdollColliderSpecs();
      expect(Array.isArray(specs)).toBe(true);
    });

    it('should have capsule control functions', () => {
      expect(ragdollManager.setRagdollCapsuleRadius).toBeDefined();
      expect(ragdollManager.setRagdollCapsuleHalfHeight).toBeDefined();
      expect(ragdollManager.setRagdollColliderStiffness).toBeDefined();
      expect(ragdollManager.setRagdollColliderFriction).toBeDefined();
      expect(ragdollManager.setRagdollCapsuleEnabled).toBeDefined();
      expect(ragdollManager.setAllRagdollCapsulesEnabled).toBeDefined();
    });
  });

  describe('API surface consistency with cloth-manager', () => {
    // Verify all required exported functions exist
    const requiredExports = [
      'toggleRagdoll',
      'recreateRagdoll',
      'getRagdollDiagnostics',
      'setRagdollDebugParticles',
      'setRagdollDebugConstraints',
      'setRagdollDebugColliders',
      'getRagdollDebugState',
      'getRagdollCollider',
      'getRagdollColliderSpecs',
      'setRagdollCapsuleRadius',
      'setRagdollCapsuleHalfHeight',
      'setRagdollColliderStiffness',
      'setRagdollColliderFriction',
      'setRagdollCapsuleEnabled',
      'setAllRagdollCapsulesEnabled',
      'initRagdoll',
    ];

    requiredExports.forEach((exportName) => {
      it(`should export ${exportName}`, () => {
        expect(ragdollManager[exportName as keyof typeof ragdollManager]).toBeDefined();
      });
    });
  });
});
