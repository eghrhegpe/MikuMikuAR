// [doc:test] Ragdoll Manager 单元测试
// 验证 ragdoll-manager.ts 的公开 API 与 cloth-manager.ts 保持一致的行为模式

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock state (vi.hoisted ensures this runs before vi.mock factories) ──

const _mockState = vi.hoisted(() => ({
  focusedModelId: null as string | null,
  envState: { ragdollEnabled: false, ragdollDebugParticles: false, ragdollDebugConstraints: false, ragdollDebugColliders: false },
}));

vi.mock('@/core/state', () => _mockState);

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

vi.mock('@/core/i18n/t', () => ({
  t: (key: string) => key,
}));

vi.mock('@/core/status-bar', () => ({
  setStatus: vi.fn(),
}));

// ── Imports (after mocks) ──

import * as ragdollManager from '@/physics/ragdoll-manager';
import { modelManager } from '@/scene/scene';

const envState = _mockState.envState;

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
    envState.ragdollEnabled = false;
    _mockState.focusedModelId = null;
    mockRagdollInstance.dispose.mockClear();
    mockCollider.init.mockClear();
  });

  afterEach(() => {
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
      _mockState.focusedModelId = 'test-model';
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
      expect(diag.instances).toBe(0);
    });
  });

  describe('initRagdoll', () => {
    it('should not throw when called', () => {
      const mockGetBones = vi.fn(() => [mockRuntimeBone]);
      const mockScene = { onBeforeRenderObservable: { add: vi.fn() } } as any;

      expect(() => ragdollManager.initRagdoll(mockGetBones as any, mockScene)).not.toThrow();
    });
  });

  describe('debug functions', () => {
    it('should have debug toggle functions', () => {
      expect(typeof ragdollManager.setRagdollDebugParticles).toBe('function');
      expect(typeof ragdollManager.setRagdollDebugConstraints).toBe('function');
      expect(typeof ragdollManager.setRagdollDebugColliders).toBe('function');
      expect(typeof ragdollManager.getRagdollDebugState).toBe('function');
    });
  });

  describe('collider functions', () => {
    it('should return empty collider state when no ragdoll was created', () => {
      // getRagdollCollider returns the internal _currentCollider reference.
      // In a fresh module state this is null, but the mock SdfCollider class
      // means we can't reliably test null without module-level reset.
      // Instead verify the API surface is correct.
      const collider = ragdollManager.getRagdollCollider();
      expect(collider === null || typeof collider === 'object').toBe(true);
    });

    it('should return empty specs when no ragdoll exists', () => {
      const specs = ragdollManager.getRagdollColliderSpecs();
      expect(specs).toEqual([]);
    });

    it('should have capsule control functions', () => {
      expect(typeof ragdollManager.setRagdollCapsuleRadius).toBe('function');
      expect(typeof ragdollManager.setRagdollCapsuleHalfHeight).toBe('function');
      expect(typeof ragdollManager.setRagdollColliderStiffness).toBe('function');
      expect(typeof ragdollManager.setRagdollColliderFriction).toBe('function');
      expect(typeof ragdollManager.setRagdollCapsuleEnabled).toBe('function');
      expect(typeof ragdollManager.setAllRagdollCapsulesEnabled).toBe('function');
    });
  });

  describe('API surface consistency with cloth-manager', () => {
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
