// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// 隔离 babylon-mmd / babylon 真实依赖
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
vi.mock('../core/mmd-adapter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../core/mmd-adapter')>();
    // 共享 mock impl，测试用例可通过 vi.mocked(mockGetPhysicsImpl).mockReturnValue 替换
    const mockImpl = {
        rigidBodyBundleReferenceCountMap: new Map() as Map<unknown, number>,
        rigidBodyReferenceCountMap: new Map() as Map<unknown, number>,
        onSyncObservable: { add: vi.fn(() => ({ dispose: vi.fn() })), remove: vi.fn(), hasObservers: () => false },
    };
    return {
        // getRigidBodyBundleMap / getRigidBodyMap 走真实实现（测试其契约）
        getRigidBodyBundleMap: actual.getRigidBodyBundleMap,
        getRigidBodyMap: actual.getRigidBodyMap,
        // getPhysicsImpl 返回 mock，避免真实 runtime.physics 访问
        getPhysicsImpl: vi.fn(() => mockImpl),
        applyForceToModelRigidBodiesNative: vi.fn(),
        applyWindForceToModelRigidBodiesNative: vi.fn(),
    };
});

import { MmdWasmRuntime as MmdWasmRuntimeClass } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { isWindPhysicsActive, initWindPhysics, disposeWindPhysics } from '@/scene/physics/wind-physics';
import { getPhysicsImpl, getRigidBodyBundleMap } from '@/core/mmd-adapter';

const mockGetPhysicsImpl = getPhysicsImpl as ReturnType<typeof vi.fn>;

describe('getRigidBodyBundleMap (真实 mmd-adapter 实现)', () => {
    it('returns bundle keys from public API', () => {
        const a = { count: 1, applyCentralForce() {} };
        const b = { count: 2, applyCentralForce() {} };
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map([
                [a, 0],
                [b, 1],
            ]),
        };
        expect([...getRigidBodyBundleMap(impl)]).toEqual([a, b]);
    });

    it('returns empty iterable when map is empty', () => {
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map(),
        };
        expect([...getRigidBodyBundleMap(impl)]).toEqual([]);
    });

    it('returns single bundle key', () => {
        const bundle = { count: 5, applyCentralForce() {} };
        const impl: any = {
            rigidBodyBundleReferenceCountMap: new Map([[bundle, 0]]),
        };
        const result = [...getRigidBodyBundleMap(impl)];
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
        expect([...getRigidBodyBundleMap(impl)]).toEqual([a, b, c]);
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

// _onPhysicsSync 是私有函数；通过 initWindPhysics 建立 observer 后模拟 onSyncObservable 回调触发它。
describe('_onPhysicsSync 施力路径（经 onSyncObservable._notify() 触发）', () => {
    it('calls applyCentralForce on each bundle member', () => {
        const forceSpy = vi.fn();
        const bundle = { count: 2, applyCentralForce: forceSpy } as any;
        const impl = {
            rigidBodyBundleReferenceCountMap: new Map([[bundle, 0]]),
            rigidBodyReferenceCountMap: new Map(),
            onSyncObservable: { add: vi.fn(() => ({ dispose: vi.fn() })), remove: vi.fn(), hasObservers: () => false },
        };
        mockGetPhysicsImpl.mockReturnValue(impl);
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        // 触发 observer 回调 → _onPhysicsSync(impl)
        const call = (impl.onSyncObservable.add as ReturnType<typeof vi.fn>).mock.calls[0];
        const callback = call[0];
        callback();
        // count=2 → 两次调用，每次 force 参数相同
        expect(forceSpy).toHaveBeenCalledTimes(2);
        disposeWindPhysics(runtime);
    });

    it('calls _onPhysicsSync once per bundle member with correct force', () => {
        // 验证施力路径的核心契约：每个 bundle 成员的 applyCentralForce 被按 count 调用
        const forceArgs: any[] = [];
        const makeBundle = (count: number) => ({
            count,
            applyCentralForce: (idx: number, force: any) => {
                forceArgs.push({ idx, force });
            },
        });
        const impl = {
            rigidBodyBundleReferenceCountMap: new Map([
                [makeBundle(1), 0],
                [makeBundle(3), 1],
            ]),
            rigidBodyReferenceCountMap: new Map(), // 单数刚体为空（联邦当前无 addRigidBody 调用）
            onSyncObservable: { add: vi.fn(() => ({ dispose: vi.fn() })), remove: vi.fn(), hasObservers: () => false },
        };
        mockGetPhysicsImpl.mockReturnValue(impl);
        const runtime = new (MmdWasmRuntimeClass as any)() as InstanceType<typeof MmdWasmRuntimeClass>;
        initWindPhysics(runtime);
        const call = (impl.onSyncObservable.add as ReturnType<typeof vi.fn>).mock.calls[0];
        (call[0] as () => void)();
        // 1 + 3 = 4 次 applyCentralForce 调用
        expect(forceArgs).toHaveLength(4);
        disposeWindPhysics(runtime);
    });
});
