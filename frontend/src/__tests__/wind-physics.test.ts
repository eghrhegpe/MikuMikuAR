// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// 隔离 babylon-mmd / babylon 真实依赖，验证 _getBundles 从公开属性读取 bundle
vi.mock('@babylonjs/core/Maths/math.vector', () => ({
    Vector3: class {
        constructor(
            public x = 0,
            public y = 0,
            public z = 0
        ) {}
        copyFrom(source: { x: number; y: number; z: number }) {
            this.x = source.x;
            this.y = source.y;
            this.z = source.z;
            return this;
        }
        scaleInPlace(scale: number) {
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
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
vi.mock('../core/mmd-adapter', () => ({
    getRigidBodyBundleMap: (impl: any) => impl.rigidBodyBundleReferenceCountMap?.keys() ?? [],
    getRigidBodyMap: () => [],
    getPhysicsImpl: vi.fn(() => ({
        onSyncObservable: { add: vi.fn(() => ({ dispose: vi.fn() })), remove: vi.fn(), hasObservers: () => false },
    })),
    applyForceToModelRigidBodiesNative: vi.fn(),
    applyWindForceToModelRigidBodiesNative: vi.fn(),
}));

import { MmdWasmRuntime as MmdWasmRuntimeClass } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { _getBundles, isWindPhysicsActive, initWindPhysics, disposeWindPhysics } from '@/scene/physics/wind-physics';
import { getPhysicsImpl } from '@/core/mmd-adapter';

const mockGetPhysicsImpl = getPhysicsImpl as ReturnType<typeof vi.fn>;

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

    it('returns empty iterable when map is empty', () => {
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map(),
        };
        expect([..._getBundles(impl)]).toEqual([]);
    });

    it('returns single bundle key', () => {
        const bundle = { count: 5, applyCentralForce() {} };
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map([[bundle, 0]]),
        };
        const result = [..._getBundles(impl)];
        expect(result).toHaveLength(1);
        expect(result[0]).toBe(bundle);
    });

    it('returns all bundle keys regardless of reference count values', () => {
        const a = { count: 1, applyCentralForce() {} };
        const b = { count: 2, applyCentralForce() {} };
        const c = { count: 3, applyCentralForce() {} };
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map([
                [a, 0],
                [b, 5],
                [c, 99],
            ]),
        };
        expect([..._getBundles(impl)]).toEqual([a, b, c]);
    });
});

describe('isWindPhysicsActive', () => {
    it('returns false when no runtime registered', () => {
        expect(isWindPhysicsActive()).toBe(false);
    });

    it('returns true after initWindPhysics with WASM runtime', () => {
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        expect(isWindPhysicsActive()).toBe(true);
    });

    it('returns false after disposeWindPhysics clears all', () => {
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        disposeWindPhysics();
        expect(isWindPhysicsActive()).toBe(false);
    });

    it('returns false after per-runtime dispose', () => {
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        disposeWindPhysics(runtime);
        expect(isWindPhysicsActive()).toBe(false);
    });

    it('returns false when WASM runtime registered but impl missing (not subscribed)', () => {
        // impl 缺失时 _trySubscribe 不建立 observer，isWindPhysicsActive 应返回 false
        mockGetPhysicsImpl.mockReturnValueOnce(null);
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        expect(isWindPhysicsActive()).toBe(false);
    });
});
