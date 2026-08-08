import { describe, it, expect, vi } from 'vitest';

// env-caustics 在模块求值期实例化 DEFAULT_CONFIG（new Color3），故需可构造的 Color3；
// 其余 Babylon 类型仅作类型/instanceof 用，给空类即可。
vi.mock('@babylonjs/core', () => {
  class Color3 {
    constructor(
      public r = 0,
      public g = 0,
      public b = 0
    ) {}
  }
  return {
    Color3,
    Material: class {},
    PBRMaterial: class {},
    StandardMaterial: class {},
    Texture: class {},
    Scene: class {},
  };
});
vi.mock('../scene/env/_shared/env-texture', () => ({
  createCanvasTexture: () => ({ dispose() {}, uOffset: 0, vOffset: 0 }),
}));
vi.mock('@/core/math/hash-noise', () => ({ hash2v: () => [0, 0] }));

import { causticsController } from '../scene/env/env-caustics';

// DEFAULT_CONFIG.scrollX/scrollY 的默认值（与 env-caustics.ts 内 DEFAULT_SCROLL_SPEED 一致）
const DEFAULT_SCROLL_SPEED = 0.05;

// ───────────────────────── fix P2 — dispose 复位 config ─────────────────────────
// 变更行：CausticsControllerImpl.dispose() 内 `this._config = { ...DEFAULT_CONFIG }`
// （HMR 重入后残留 scrollX/scrollY 与新场景 envState 不同步的修复）。
describe('env-caustics — fix P2 dispose 复位 config', () => {
  it('setConfig 写入非默认 scroll 后，dispose 将 config 复位为 DEFAULT', () => {
    causticsController.setConfig({ scrollX: 9, scrollY: 8, scale: 3, intensity: 5 });
    expect(causticsController.getConfig().scrollX).toBe(9);
    expect(causticsController.getConfig().scrollY).toBe(8);

    causticsController.dispose();

    const c = causticsController.getConfig();
    // 变更行覆盖：scroll 回到 DEFAULT_CONFIG
    expect(c.scrollX).toBe(DEFAULT_SCROLL_SPEED);
    expect(c.scrollY).toBeCloseTo(DEFAULT_SCROLL_SPEED * 0.7);
    expect(c.scale).toBe(1.0);
    expect(c.intensity).toBe(1.0);
  });
});
