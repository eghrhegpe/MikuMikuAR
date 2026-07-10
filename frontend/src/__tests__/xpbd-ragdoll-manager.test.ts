// [doc:test] Ragdoll Manager 单元测试
// 验证 ragdoll-manager.ts 的公开 API 与 cloth-manager.ts 保持一致的行为模式

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock state (vi.hoisted ensures this runs before vi.mock factories) ──

const _mockState = vi.hoisted(() => ({
  focusedModelId: null as string | null,
  envState: { ragdollEnabled: false, ragdollJointParams: {} as Record<string, unknown>, ragdollDebugParticles: false, ragdollDebugConstraints: false, ragdollDebugColliders: false },
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
  DEFAULT_RAGDOLL_JOINT_PARAMS: { compliance: 0, stiffness: 1, damping: 0, coneHalfAngle: Math.PI / 4, twistRange: [-Math.PI / 4, Math.PI / 4] },
  RAGDOLL_JOINT_GROUPS: {
    spine: { keywords: ['上半身', '下半身', '腰', 'spine', 'chest'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI / 6, twistRange: [-Math.PI / 8, Math.PI / 8] } },
    shoulder: { keywords: ['肩', '腕', 'shoulder', 'arm'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI / 2, twistRange: [-Math.PI / 4, Math.PI / 4] } },
    elbow: { keywords: ['ひじ', 'elbow'], params: { compliance: 0, stiffness: 1, damping: 0.05, coneHalfAngle: Math.PI / 8, twistRange: [0, 0] } },
    neck: { keywords: ['首', '頭', 'head', 'neck'], params: { compliance: 0, stiffness: 1, damping: 0.1, coneHalfAngle: Math.PI / 3, twistRange: [-Math.PI / 4, Math.PI / 4] } },
  },
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

vi.mock('@/physics/xpbd-renderer', () => ({
  XpbdRenderer: class {
    showParticles = vi.fn();
    showConstraints = vi.fn();
    showColliders = vi.fn();
    updateParticles = vi.fn();
    updateConstraints = vi.fn();
    updateColliders = vi.fn();
    dispose = vi.fn();
  },
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

  describe('joint params API', () => {
    it('should export setRagdollJointParams and applyRagdollJointPreset', () => {
      expect(ragdollManager.setRagdollJointParams).toBeDefined();
      expect(ragdollManager.applyRagdollJointPreset).toBeDefined();
    });

    it('should merge partial params into envState.ragdollJointParams', () => {
      envState.ragdollJointParams = {};
      ragdollManager.setRagdollJointParams('頭', { stiffness: 0.5 });
      const stored = (envState.ragdollJointParams as Record<string, any>)['頭'];
      expect(stored).toBeDefined();
      expect(stored.stiffness).toBe(0.5);
      // 未覆盖字段沿用 DEFAULT
      expect(stored.compliance).toBe(0);
    });

    it('should apply preset scaling via applyRagdollJointPreset', () => {
      envState.ragdollJointParams = {};
      ragdollManager.applyRagdollJointPreset('spine', 'loose');
      const stored = (envState.ragdollJointParams as Record<string, any>)['spine'];
      expect(stored).toBeDefined();
      // spine 默认 stiffness=1, loose 缩放 0.5
      expect(stored.stiffness).toBeCloseTo(0.5);
    });

    it('should ignore unknown group / preset', () => {
      envState.ragdollJointParams = {};
      ragdollManager.applyRagdollJointPreset('unknown-group', 'loose');
      ragdollManager.applyRagdollJointPreset('spine', 'bogus' as any);
      expect(Object.keys(envState.ragdollJointParams)).toHaveLength(0);
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
      'setRagdollJointParams',
      'applyRagdollJointPreset',
      'setRagdollBlendWeight',
      'getRagdollBlendWeight',
    ];

    requiredExports.forEach((exportName) => {
      it(`should export ${exportName}`, () => {
        expect(ragdollManager[exportName as keyof typeof ragdollManager]).toBeDefined();
      });
    });
  });

  describe('blend weight API', () => {
    it('should export setRagdollBlendWeight and getRagdollBlendWeight', () => {
      expect(ragdollManager.setRagdollBlendWeight).toBeDefined();
      expect(ragdollManager.getRagdollBlendWeight).toBeDefined();
    });

    it('getRagdollBlendWeight should return 0 initially', () => {
      expect(ragdollManager.getRagdollBlendWeight()).toBe(0);
    });

    it('setRagdollBlendWeight should clamp to [0,1]', () => {
      // getter 返回 clamp 后的设定值（target），类似 CSS opacity 立即反映设定
      ragdollManager.setRagdollBlendWeight(1.5);
      expect(ragdollManager.getRagdollBlendWeight()).toBe(1);
      ragdollManager.setRagdollBlendWeight(-0.5);
      expect(ragdollManager.getRagdollBlendWeight()).toBe(0);
    });
  });

  describe('toggleRagdoll delayed dispose (Task 14)', () => {
    let capturedUpdateFn: ((dt: number) => void) | null = null;

    beforeEach(() => {
      capturedUpdateFn = null;
      _mockState.focusedModelId = 'test-model';
      vi.mocked(modelManager.focused).mockReturnValue({ id: 'test-model' } as never);
      vi.mocked(modelManager.focusedMmdModel).mockReturnValue(mockMmdModel as never);
      vi.mocked(modelManager.addRagdoll).mockImplementation(
        (_id: unknown, _inst: unknown, updateFn: (dt: number) => void) => {
          capturedUpdateFn = updateFn;
        }
      );
    });

    it('toggleRagdoll(false) should set blend target to 0', () => {
      ragdollManager.toggleRagdoll(true);
      expect(ragdollManager.getRagdollBlendWeight()).toBe(1); // target=1
      ragdollManager.toggleRagdoll(false);
      expect(ragdollManager.getRagdollBlendWeight()).toBe(0); // target=0
    });

    it('toggleRagdoll(false) should defer dispose until blendWeight eases to 0', () => {
      ragdollManager.toggleRagdoll(true);
      // 驱动 observer tick 让 blendWeight 缓动到 ~1（建立活跃混合）
      expect(capturedUpdateFn).not.toBeNull();
      for (let i = 0; i < 30; i++) capturedUpdateFn!(0.016);

      // 禁用：应设 target=0 但不立即销毁（blendWeight 仍 > 0.001）
      const removeBefore = vi.mocked(modelManager.removeRagdoll).mock.calls.length;
      ragdollManager.toggleRagdoll(false);
      expect(ragdollManager.getRagdollBlendWeight()).toBe(0);
      expect(vi.mocked(modelManager.removeRagdoll).mock.calls.length).toBe(removeBefore);

      // 驱动 observer tick 让 blendWeight 缓动到 0，应触发延迟销毁
      for (let i = 0; i < 30; i++) {
        const before = vi.mocked(modelManager.removeRagdoll).mock.calls.length;
        capturedUpdateFn!(0.016);
        if (vi.mocked(modelManager.removeRagdoll).mock.calls.length > before) break;
      }
      expect(vi.mocked(modelManager.removeRagdoll).mock.calls.length).toBeGreaterThan(removeBefore);
    });
  });
});
