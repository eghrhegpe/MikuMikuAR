import { describe, it, expect, vi } from 'vitest';

// 隔离 babylon-mmd / babylon 真实依赖，验证 _getBundles 从公开属性读取 bundle
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

import { _getBundles } from '../physics/wind-physics';

describe('_getBundles reads public rigidBodyBundleReferenceCountMap', () => {
    it('returns bundle keys from public API', () => {
        const a = { count: 1, applyCentralForce() {} };
        const b = { count: 2, applyCentralForce() {} };
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map([
                [a, 0],
                [b, 1],
            ]),
        };
        expect([..._getBundles(impl)]).toEqual([a, b]);
    });
});
