/**
 * wind-physics-state.test.ts — 风力物理状态机测试
 *
 * 验证 wind-physics 模块的订阅/重试/销毁/幂等等时序行为，
 * 确保「算法对了但实际没认」的静默失效不会发生。
 * 全部 mock babylon-mmd + mmd-adapter + wind-utils，不依赖真实 WASM。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ======== 共享 mock 状态 (hoisted，跨模块可见) ========
const mocks = vi.hoisted(() => {
    let _notifyFn: (() => void) | null = null;
    const onSyncObservable = {
        add: vi.fn(() => ({ tag: 'wind-obs' })),
        remove: vi.fn(),
        get _notify() {
            return _notifyFn ?? (() => {});
        },
        set _notify(fn: () => void) {
            _notifyFn = fn;
        },
    };
    const observerHandle = { dispose: vi.fn(), tag: 'wind-obs' };

    const mockImpl = {
        onSyncObservable,
    };

    const bundleA = {
        count: 3,
        applyCentralForce: vi.fn(),
    };
    const bundleB = {
        count: 2,
        applyCentralForce: vi.fn(),
    };
    const bundles = [bundleA, bundleB];

    // 控制 getPhysicsImpl 返回值
    let implReturn: typeof mockImpl | null = mockImpl;
    // 控制 wind-utils 返回值（不能用 Vector3，hoisted 在 import 之前执行）
    let windActive = true;
    let windRaw = { x: 3, y: 0, z: 4 }; // 风速 5, 方向 (0.6, 0, 0.8)

    return {
        onSyncObservable,
        observerHandle,
        mockImpl,
        bundleA,
        bundleB,
        bundles,
        get implReturn() {
            return implReturn;
        },
        set implReturn(v: typeof mockImpl | null) {
            implReturn = v;
        },
        get windActive() {
            return windActive;
        },
        set windActive(v: boolean) {
            windActive = v;
        },
        get windRaw() {
            return windRaw;
        },
        set windRaw(v: { x: number; y: number; z: number }) {
            windRaw = v;
        },
    };
});

// ======== mock babylon-mmd ========
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: class {},
}));

// ======== mock mmd-adapter ========
vi.mock('@/core/mmd-adapter', () => ({
    getPhysicsImpl: vi.fn(() => mocks.implReturn),
    getRigidBodyBundleMap: vi.fn(() => mocks.bundles),
}));

// ======== mock wind-utils ========
vi.mock('@/core/wind-utils', () => ({
    getWindVector: vi.fn(() => {
        const { x, y, z } = mocks.windRaw;
        return new Vector3(x, y, z);
    }),
    isWindActive: vi.fn(() => mocks.windActive),
}));

// ======== mock observer-handle ========
const mockObserve = vi.hoisted(() => vi.fn());
vi.mock('@/core/observer-handle', () => ({
    observe: mockObserve,
}));

import { getPhysicsImpl, getRigidBodyBundleMap } from '@/core/mmd-adapter';
import { observe } from '@/core/observer-handle';
import { getWindVector, isWindActive } from '@/core/wind-utils';
import {
    initWindPhysics,
    retryWindPhysicsSubscription,
    disposeWindPhysics,
} from '../physics/wind-physics';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';

function makeWasmRuntime(): InstanceType<typeof MmdWasmRuntime> {
    return new (MmdWasmRuntime as any)() as InstanceType<typeof MmdWasmRuntime>;
}

function makeJsRuntime() {
    // JS 运行时不是 MmdWasmRuntime 实例，initWindPhysics 应走 instanceof 守卫空转
    return {} as unknown as InstanceType<typeof MmdWasmRuntime>;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.implReturn = mocks.mockImpl;
    mocks.windActive = true;
    mocks.windRaw = { x: 3, y: 0, z: 4 };
    mocks.onSyncObservable._notify = () => {};
    mocks.bundleA.applyCentralForce.mockClear();
    mocks.bundleB.applyCentralForce.mockClear();
    // 将 observe mock 连接到 _notify 回调机制
    mockObserve.mockImplementation((_obs: unknown, cb: () => void) => {
        mocks.onSyncObservable._notify = () => cb();
        return mocks.observerHandle;
    });
    disposeWindPhysics();
});

afterEach(() => {
    disposeWindPhysics();
});

describe('wind-physics 状态机', () => {
    describe('initWindPhysics', () => {
        it('JS 运行时空转（不订阅、不抛异常）', () => {
            const runtime = makeJsRuntime();
            initWindPhysics(runtime);

            expect(observe).not.toHaveBeenCalled();
            expect(getPhysicsImpl).not.toHaveBeenCalled();
        });

        it('WASM 运行时且 impl 就绪：立即订阅 onSyncObservable', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            expect(getPhysicsImpl).toHaveBeenCalledWith(runtime);
            expect(observe).toHaveBeenCalledTimes(1);
        });

        it('WASM 运行时但 impl 未就绪：注册 runtime 但不订阅（由 retry 补）', () => {
            mocks.implReturn = null;
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            expect(getPhysicsImpl).toHaveBeenCalledWith(runtime);
            expect(observe).not.toHaveBeenCalled();
        });

        it('幂等：重复调用不重复订阅', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);
            initWindPhysics(runtime);
            initWindPhysics(runtime);

            expect(observe).toHaveBeenCalledTimes(1);
        });
    });

    describe('retryWindPhysicsSubscription', () => {
        it('impl 就绪后补订阅成功', () => {
            mocks.implReturn = null;
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);
            expect(observe).not.toHaveBeenCalled();

            // 模拟模型加载后 impl 就绪
            mocks.implReturn = mocks.mockImpl;
            retryWindPhysicsSubscription(runtime);

            expect(observe).toHaveBeenCalledTimes(1);
        });

        it('impl 仍不可用时重试不订阅（不抛异常）', () => {
            mocks.implReturn = null;
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            retryWindPhysicsSubscription(runtime);

            expect(observe).not.toHaveBeenCalled();
        });

        it('已订阅后重试不重复订阅', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);
            expect(observe).toHaveBeenCalledTimes(1);

            retryWindPhysicsSubscription(runtime);

            expect(observe).toHaveBeenCalledTimes(1);
        });

        it('省略 runtime 参数时重试所有已注册 runtime', () => {
            mocks.implReturn = null;
            const rt1 = makeWasmRuntime();
            const rt2 = makeWasmRuntime();
            initWindPhysics(rt1);
            initWindPhysics(rt2);
            expect(observe).not.toHaveBeenCalled();

            mocks.implReturn = mocks.mockImpl;
            retryWindPhysicsSubscription(); // 全局重试

            expect(observe).toHaveBeenCalledTimes(2);
        });
    });

    describe('disposeWindPhysics', () => {
        it('移除所有 observer 并清空注册表', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);
            expect(observe).toHaveBeenCalledTimes(1);

            disposeWindPhysics();

            expect(mocks.observerHandle.dispose).toHaveBeenCalledTimes(1);
        });

        it('dispose 后再 initWindPhysics 可重新订阅', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);
            disposeWindPhysics();

            vi.clearAllMocks();
            initWindPhysics(runtime);

            expect(observe).toHaveBeenCalledTimes(1);
        });

        it('空 dispose 不抛异常', () => {
            expect(() => disposeWindPhysics()).not.toThrow();
        });
    });

    describe('_onPhysicsSync — 风力施加', () => {
        it('风力活跃时对所有 Bundle 的所有刚体施加风力', () => {
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            // 手动触发 onSync 回调
            mocks.onSyncObservable._notify();

            // bundleA 有 3 个刚体，bundleB 有 2 个
            expect(mocks.bundleA.applyCentralForce).toHaveBeenCalledTimes(3);
            expect(mocks.bundleB.applyCentralForce).toHaveBeenCalledTimes(2);

            // 验证风力向量 = 方向 × 速度 × WIND_FORCE_SCALE(1.0)
            const expectedForce = new Vector3(3, 0, 4);
            const call0 = mocks.bundleA.applyCentralForce.mock.calls[0];
            expect(call0[0]).toBe(0); // 第 0 个刚体
            expect(call0[1].x).toBeCloseTo(expectedForce.x);
            expect(call0[1].y).toBeCloseTo(expectedForce.y);
            expect(call0[1].z).toBeCloseTo(expectedForce.z);
        });

        it('风力不活跃时跳过（不施加力）', () => {
            mocks.windActive = false;
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            mocks.onSyncObservable._notify();

            expect(mocks.bundleA.applyCentralForce).not.toHaveBeenCalled();
            expect(mocks.bundleB.applyCentralForce).not.toHaveBeenCalled();
        });

        it('Bundle 列表为空时不抛异常', () => {
            // 清空 bundle 列表
            vi.mocked(getRigidBodyBundleMap).mockReturnValueOnce([]);
            const runtime = makeWasmRuntime();
            initWindPhysics(runtime);

            expect(() => mocks.onSyncObservable._notify()).not.toThrow();
        });
    });
});
