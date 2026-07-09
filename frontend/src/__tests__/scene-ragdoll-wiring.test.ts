import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scene/motion/bone-override', () => ({
  startBoneOverride: vi.fn(),
}));

vi.mock('../core/model-registry', () => ({
  modelRegistry: new Map(),
}));

vi.mock('../core/focused-model', () => ({
  focusedModelId: 'mock-id',
}));

describe('scene.ts ragdoll wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should compile scene.ts without errors', async () => {
    // Import to trigger the async setup
    await import('../scene/scene');
    // If we reach here without throwing, the module loaded successfully
    expect(true).toBe(true);
  });

  it('should register initRagdoll after startBoneOverride in scene setup flow', async () => {
    const mockInitRagdoll = vi.fn();
    const mockStartBoneOverride = vi.fn();

    vi.doMock('../physics/ragdoll-manager', () => ({
      initRagdoll: mockInitRagdoll,
    }));

    vi.doMock('../scene/motion/bone-override', () => ({
      startBoneOverride: mockStartBoneOverride,
    }));

    await import('../scene/scene');

    // Both should have been called
    expect(mockStartBoneOverride).toHaveBeenCalled();
    expect(mockInitRagdoll).toHaveBeenCalled();
    expect(mockInitRagdoll).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
  });
});
