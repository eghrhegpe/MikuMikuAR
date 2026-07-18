// ground-collision.test.ts — 验证 WASM 地面碰撞刚体的注入/移除/幂等/空转
// 完全 mock babylon-mmd 物理类与 @/core/config，隔离测试业务逻辑。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const shared = vi.hoisted(() => {
    const addRigidBodyToGlobal = vi.fn(() => true);
    const removeRigidBodyFromGlobal = vi.fn(() => true);
    const rbDispose = vi.fn();
    const infoDispose = vi.fn();
    const shapeDispose = vi.fn();
    const setInitialTransform = vi.fn();
    const last = { info: null as any, shape: null as any, body: null as any };

    class MockImpl {
        wasmInstance = {};
        addRigidBodyToGlobal = addRigidBodyToGlobal;
        removeRigidBodyFromGlobal = removeRigidBodyFromGlobal;
    }
    class MockPhysicsBoxShape {
        dispose = shapeDispose;
        constructor() {
            last.shape = this;
        }
    }
    class MockRigidBodyConstructionInfo {
        shape: any = null;
        motionType = 0;
        mass = 0;
        collisionGroup = 0;
        collisionMask = 0;
        friction = 0;
        restitution = 0;
        setInitialTransform = setInitialTransform;
        dispose = infoDispose;
        constructor() {
            last.info = this;
        }
    }
    class MockRigidBody {
        dispose = rbDispose;
        constructor() {
            last.body = this;
        }
    }
    const MotionType = { Dynamic: 0, Static: 1, Kinematic: 2 };
    class MockMmdWasmRuntime {
        physics: any;
        constructor(impl: any) {
            this.physics = { impl };
        }
    }
    return {
        addRigidBodyToGlobal,
        removeRigidBodyFromGlobal,
        rbDispose,
        infoDispose,
        shapeDispose,
        setInitialTransform,
        last,
        MockImpl,
        MockPhysicsBoxShape,
        MockRigidBodyConstructionInfo,
        MockRigidBody,
        MotionType,
        MockMmdWasmRuntime,
    };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({
    MmdWasmRuntime: shared.MockMmdWasmRuntime,
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl', () => ({
    MmdWasmPhysicsRuntimeImpl: shared.MockImpl,
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody', () => ({
    RigidBody: shared.MockRigidBody,
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo', () => ({
    RigidBodyConstructionInfo: shared.MockRigidBodyConstructionInfo,
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape', () => ({
    PhysicsBoxShape: shared.MockPhysicsBoxShape,
}));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType', () => ({
    MotionType: shared.MotionType,
}));

const cfg = vi.hoisted(() => ({
    mmdRuntime: null as any,
    envState: { groundCollisionEnabled: false } as { groundCollisionEnabled: boolean },
}));
vi.mock('@/core/config', () => ({
    get mmdRuntime() {
        return cfg.mmdRuntime;
    },
    envState: cfg.envState,
}));

import {
    enableGroundCollision,
    disableGroundCollision,
    isGroundCollisionEnabled,
    applyGroundCollision,
} from '../scene/physics/ground-collision';

function setRuntime(impl = new shared.MockImpl()): void {
    cfg.mmdRuntime = new shared.MockMmdWasmRuntime(impl);
}

beforeEach(() => {
    cfg.mmdRuntime = null;
    cfg.envState.groundCollisionEnabled = false;
    shared.addRigidBodyToGlobal.mockClear();
    shared.removeRigidBodyFromGlobal.mockClear();
    shared.rbDispose.mockClear();
    shared.infoDispose.mockClear();
    shared.shapeDispose.mockClear();
    shared.setInitialTransform.mockClear();
    shared.last.info = null;
    shared.last.shape = null;
    shared.last.body = null;
    // 确保跨用例的模块级状态清空
    setRuntime();
    disableGroundCollision();
    cfg.mmdRuntime = null;
});

afterEach(() => {
    setRuntime();
    disableGroundCollision();
    cfg.mmdRuntime = null;
});

describe('ground-collision', () => {
    it('enableGroundCollision 注入静态刚体到全局世界', () => {
        setRuntime();
        enableGroundCollision();

        expect(shared.addRigidBodyToGlobal).toHaveBeenCalledTimes(1);
        expect(shared.last.info.motionType).toBe(shared.MotionType.Static);
        expect(shared.last.info.mass).toBe(0);
        expect(shared.last.info.collisionGroup).toBe(0xffff);
        expect(shared.last.info.collisionMask).toBe(0xffff);
        expect(shared.setInitialTransform).toHaveBeenCalledTimes(1);
        expect(isGroundCollisionEnabled()).toBe(true);
    });

    it('enableGroundCollision 幂等（重复调用只注入一次）', () => {
        setRuntime();
        enableGroundCollision();
        enableGroundCollision();

        expect(shared.addRigidBodyToGlobal).toHaveBeenCalledTimes(1);
        expect(isGroundCollisionEnabled()).toBe(true);
    });

    it('addRigidBodyToGlobal 失败时保持未启用并释放资源', () => {
        const impl = new shared.MockImpl();
        impl.addRigidBodyToGlobal = vi.fn(() => false);
        setRuntime(impl);
        enableGroundCollision();

        expect(shared.rbDispose).toHaveBeenCalledTimes(1);
        expect(shared.infoDispose).toHaveBeenCalledTimes(1);
        expect(shared.shapeDispose).toHaveBeenCalledTimes(1);
        expect(isGroundCollisionEnabled()).toBe(false);
    });

    it('disableGroundCollision 移除并释放资源（顺序：remove → rb → info → shape）', () => {
        setRuntime();
        enableGroundCollision();
        shared.rbDispose.mockClear();
        shared.infoDispose.mockClear();
        shared.shapeDispose.mockClear();
        shared.removeRigidBodyFromGlobal.mockClear();

        disableGroundCollision();

        expect(shared.removeRigidBodyFromGlobal).toHaveBeenCalledTimes(1);
        expect(shared.rbDispose).toHaveBeenCalledTimes(1);
        expect(shared.infoDispose).toHaveBeenCalledTimes(1);
        expect(shared.shapeDispose).toHaveBeenCalledTimes(1);
        expect(isGroundCollisionEnabled()).toBe(false);
    });

    it('非 WASM 运行时下 enable/disable 空转', () => {
        cfg.mmdRuntime = {}; // 非 MmdWasmRuntime 实例
        enableGroundCollision();
        expect(shared.addRigidBodyToGlobal).not.toHaveBeenCalled();
        expect(isGroundCollisionEnabled()).toBe(false);

        disableGroundCollision();
        expect(shared.removeRigidBodyFromGlobal).not.toHaveBeenCalled();
    });

    it('applyGroundCollision 依据 envState 还原', () => {
        setRuntime();
        cfg.envState.groundCollisionEnabled = true;
        applyGroundCollision();
        expect(isGroundCollisionEnabled()).toBe(true);

        cfg.envState.groundCollisionEnabled = false;
        applyGroundCollision();
        expect(isGroundCollisionEnabled()).toBe(false);
    });
});
