// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../scene/env/_shared/env-context', () => ({
  _envSys: { sky: { skyMesh: null, skyCubeTexture: null, skyDynamicTex: null } },
  getScene: () => ({ environmentTexture: null }),
  resolveStaticAsset: (p: string) => p,
}));
vi.mock('../scene/env/env', () => ({ ensureEnvUpdateObserver: () => {} }));
vi.mock('../scene/render/lighting', () => ({ _disposeSunDisc: vi.fn() }));

import { disposeSky, clearStarsTexCache } from '../scene/env/env-sky';
import { _disposeSunDisc } from '../scene/render/lighting';
import { _envSys } from '../scene/env/_shared/env-context';

function makeDisposable(extras: Record<string, unknown> = {}) {
  return { dispose: vi.fn(), ...extras };
}

describe('env-sky', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _envSys.sky.skyMesh = null;
    _envSys.sky.skyCubeTexture = null;
    _envSys.sky.skyDynamicTex = null;
  });

  describe('disposeSky', () => {
    it('空资源时幂等执行不抛错，且到达 _disposeSunDisc', () => {
      expect(() => disposeSky()).not.toThrow();
      expect(() => disposeSky()).not.toThrow();
      expect(_disposeSunDisc).toHaveBeenCalledTimes(2);
    });

    it('释放 skyMesh 和其 material，并将引用置 null', () => {
      const mat = makeDisposable();
      const mesh = makeDisposable({ material: mat });
      _envSys.sky.skyMesh = mesh as any;

      disposeSky();

      expect(mat.dispose).toHaveBeenCalled();
      expect(mesh.dispose).toHaveBeenCalled();
      expect(_envSys.sky.skyMesh).toBeNull();
      expect(_disposeSunDisc).toHaveBeenCalled();
    });

    it('释放 skyCubeTexture 并将引用置 null', () => {
      const tex = makeDisposable();
      _envSys.sky.skyCubeTexture = tex as any;

      disposeSky();

      expect(tex.dispose).toHaveBeenCalled();
      expect(_envSys.sky.skyCubeTexture).toBeNull();
      expect(_disposeSunDisc).toHaveBeenCalled();
    });

    it('释放 skyDynamicTex 并将引用置 null', () => {
      const tex = makeDisposable();
      _envSys.sky.skyDynamicTex = tex as any;

      disposeSky();

      expect(tex.dispose).toHaveBeenCalled();
      expect(_envSys.sky.skyDynamicTex).toBeNull();
      expect(_disposeSunDisc).toHaveBeenCalled();
    });

    it('每次调用均触发 _disposeSunDisc', () => {
      disposeSky();
      expect(_disposeSunDisc).toHaveBeenCalledOnce();

      disposeSky();
      expect(_disposeSunDisc).toHaveBeenCalledTimes(2);

      disposeSky();
      expect(_disposeSunDisc).toHaveBeenCalledTimes(3);
    });
  });

  describe('clearStarsTexCache', () => {
    it('执行不抛错', () => {
      expect(() => clearStarsTexCache()).not.toThrow();
    });
  });
});
