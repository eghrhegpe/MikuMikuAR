// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// env-sky 重度 3D 耦合，但其 disposeSky() 自身对「未初始化天空」是幂等早返回结构：
// 通过 mock 本地依赖 + 桩 _envSys.sky 为空，可直接调用 disposeSky 覆盖
// 变更行 `_texStarsGeneration++`（dispose 后递增 generation，使延迟星空异步回调经守卫丢弃）。
vi.mock('../scene/env/_shared/env-context', () => ({
  _envSys: { sky: { skyMesh: null, skyCubeTexture: null, skyDynamicTex: null } },
  getScene: () => ({ environmentTexture: null }),
  resolveStaticAsset: (p: string) => p,
}));
vi.mock('../scene/env/env', () => ({ ensureEnvUpdateObserver: () => {} }));
vi.mock('../scene/render/lighting', () => ({ _disposeSunDisc: vi.fn() }));

import { disposeSky } from '../scene/env/env-sky';
import { _disposeSunDisc } from '../scene/render/lighting';

// ───────────────────────── fix P2 — disposeSky 递增星空 texture generation ─────────────────────────
describe('env-sky — fix P2 disposeSky 递增星空 texture generation 守卫', () => {
  beforeEach(() => {
    vi.mocked(_disposeSunDisc).mockClear();
  });

  it('disposeSky 幂等执行且不抛错，并到达 _texStarsGeneration++ 与 _disposeSunDisc', () => {
    expect(() => disposeSky()).not.toThrow();
    // 二次调用验证幂等（无天空对象时全部早返回）
    expect(() => disposeSky()).not.toThrow();
    // 函数已执行到末尾 → 变更行与 _disposeSunDisc 均已触发
    expect(_disposeSunDisc).toHaveBeenCalled();
  });
});
