import { describe, it, expect, vi } from 'vitest';

// 隔离 babylon-mmd / babylon 真实依赖，仅验证 _getBundles 的反射降级行为
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: class {
        constructor(
            public x = 0,
            public y = 0,
            public z = 0
        ) {}
        copyFrom() {
            return this;
        }
        scaleInPlace() {
            return this;
        }
    },
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: class {},
}));
vi.mock('../core/wind-utils', () => ({
    getWindVector: () => ({ x: 0, y: 0, z: 0 }),
    isWindActive: () => true,
}));
vi.mock('../core/utils', () => ({
    logWarn: vi.fn(),
}));

import { _getBundles } from '../physics/wind-physics';
import { logWarn } from '../core/utils';

describe('_getBundles reflection degradation', () => {
    it('warns once when _rigidBodyBundleMap is missing (renamed field) — no silent failure', () => {
        const impl: any = {};
        const result = [..._getBundles(impl)];
        expect(result).toHaveLength(0);
        expect(logWarn).toHaveBeenCalled();
    });

    it('returns empty iterator when field type is wrong', () => {
        const impl: any = { _rigidBodyBundleMap: { not: 'a map' } };
        expect([..._getBundles(impl)]).toHaveLength(0);
    });

    it('returns bundle keys when map is present', () => {
        const a = { count: 1, applyCentralForce() {} };
        const b = { count: 2, applyCentralForce() {} };
        const impl: any = {
            _rigidBodyBundleMap: new Map([
                [a, 0],
                [b, 1],
            ]),
        };
        expect([..._getBundles(impl)]).toEqual([a, b]);
    });
});
