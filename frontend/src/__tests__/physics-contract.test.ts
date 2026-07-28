/**
 * physics-contract.test.ts — WASM 物理 API 行为契约测试
 *
 * 在 Node.js 环境下通过 initSync 加载 babylon-mmd SPR WASM 模块，
 * 验证 Bullet 物理引擎的底层 API 契约：
 *   - 物理世界创建/销毁
 *   - 形状创建/销毁
 *   - 内存分配/释放
 *   - 刚体创建、施力、步进、速度读取（物理真的在动）
 *
 * 全部测试不依赖 Babylon.js，只依赖 raw WASM API。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMinimalPhysicsImpl } from './helpers/minimal-physics-impl';
import type { MinimalPhysicsImpl } from './helpers/minimal-physics-impl';
import type * as sprWasm from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

// ======== 全局 WASM 实例（所有测试共享） ========
let phys: MinimalPhysicsImpl;
let api: typeof sprWasm;
let memory: WebAssembly.Memory;

beforeAll(() => {
    phys = createMinimalPhysicsImpl();
    api = phys.api;
    memory = phys.memory;
});

// ======== 辅助函数：手动构造 RigidBodyConstructionInfo ========

/** RigidBodyConstructionInfo 大小（字节） */
const INFO_SIZE = 144;

/** 刚体构造信息偏移量 */
const OFF = {
    Shape: 0, // uint32
    InitialTransform: 16, // float32[16]
    DataMask: 80, // uint16
    MotionType: 82, // uint8
    Mass: 84, // float32
    LocalInertia: 88, // float32[3]
    LinearDamping: 100, // float32
    AngularDamping: 104, // float32
    Friction: 108, // float32
    Restitution: 112, // float32
    LinearSleepingThreshold: 116, // float32
    AngularSleepingThreshold: 120, // float32
    CollisionGroup: 124, // uint16
    CollisionMask: 126, // uint16
    AdditionalDamping: 128, // uint8
    NoContactResponse: 129, // uint8
    DisableDeactivation: 130, // uint8
} as const;

/**
 * 在 WASM 内存中手动构造一个 RigidBodyConstructionInfo。
 * 返回 info 指针（调用方负责 deallocateBuffer）。
 */
function buildRigidBodyInfo(
    shapePtr: number,
    overrides?: { mass?: number; disableDeactivation?: boolean }
): number {
    const infoPtr = api.allocateBuffer(INFO_SIZE);
    const buf = new DataView(memory.buffer, infoPtr, INFO_SIZE);

    // shape pointer (uint32, little-endian)
    buf.setUint32(OFF.Shape, shapePtr, true);

    // initial transform: identity matrix (float32[16])
    const tf = new Float32Array(memory.buffer, infoPtr + OFF.InitialTransform, 16);
    tf[0] = 1;
    tf[1] = 0;
    tf[2] = 0;
    tf[3] = 0;
    tf[4] = 0;
    tf[5] = 1;
    tf[6] = 0;
    tf[7] = 0;
    tf[8] = 0;
    tf[9] = 0;
    tf[10] = 1;
    tf[11] = 0;
    tf[12] = 0;
    tf[13] = 0;
    tf[14] = 0;
    tf[15] = 1;

    // dataMask: 0 (no optional fields)
    buf.setUint16(OFF.DataMask, 0, true);

    // motionType: 0 = Dynamic
    buf.setUint8(OFF.MotionType, 0);

    // mass (default 1.0)
    buf.setFloat32(OFF.Mass, overrides?.mass ?? 1.0, true);

    // localInertia: leave as 0 (auto-calculate from shape)

    // linear/angular damping
    buf.setFloat32(OFF.LinearDamping, 0.0, true);
    buf.setFloat32(OFF.AngularDamping, 0.0, true);

    // friction / restitution
    buf.setFloat32(OFF.Friction, 0.5, true);
    buf.setFloat32(OFF.Restitution, 0.0, true);

    // sleeping thresholds
    buf.setFloat32(OFF.LinearSleepingThreshold, 0.0, true);
    buf.setFloat32(OFF.AngularSleepingThreshold, 1.0, true);

    // collision group / mask
    buf.setUint16(OFF.CollisionGroup, 1, true);
    buf.setUint16(OFF.CollisionMask, 0xffff, true);

    // flags
    buf.setUint8(OFF.AdditionalDamping, 0);
    buf.setUint8(OFF.NoContactResponse, 0);
    buf.setUint8(OFF.DisableDeactivation, overrides?.disableDeactivation ? 1 : 0);

    return infoPtr;
}

/** 读取刚体线速度（返回 [vx, vy, vz]） */
function readLinearVelocity(bodyPtr: number): [number, number, number] {
    // 分配 12 字节输出缓冲区（3 个 float32）
    const outPtr = api.allocateBuffer(12);
    try {
        api.rigidBodyGetLinearVelocity(bodyPtr, outPtr);
        const view = new Float32Array(memory.buffer, outPtr, 3);
        return [view[0], view[1], view[2]];
    } finally {
        api.deallocateBuffer(outPtr, 12);
    }
}

// ======== 测试套件 ========

describe('WASM 物理契约测试', () => {
    describe('1. 模块加载', () => {
        it('WASM 模块成功加载，createPhysicsWorld 不抛异常', () => {
            const world = api.createPhysicsWorld();
            expect(world).toBeGreaterThan(0);
            api.destroyPhysicsWorld(world);
        });

        it('initSync 返回的 memory 可用（buffer 非空）', () => {
            expect(memory.buffer.byteLength).toBeGreaterThan(0);
        });
    });

    describe('2. 物理世界生命周期', () => {
        it('createPhysicsWorld 返回非零指针', () => {
            const world = api.createPhysicsWorld();
            expect(world).toBeGreaterThan(0);
            api.destroyPhysicsWorld(world);
        });

        it('destroyPhysicsWorld 不抛异常', () => {
            const world = api.createPhysicsWorld();
            expect(() => api.destroyPhysicsWorld(world)).not.toThrow();
        });

        it('physicsWorldSetGravity 不抛异常', () => {
            const world = api.createPhysicsWorld();
            expect(() => api.physicsWorldSetGravity(world, 0, -9.8, 0)).not.toThrow();
            api.destroyPhysicsWorld(world);
        });

        it('physicsWorldStepSimulation 不抛异常（空世界步进）', () => {
            const world = api.createPhysicsWorld();
            expect(() => api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60)).not.toThrow();
            api.destroyPhysicsWorld(world);
        });
    });

    describe('3. 形状生命周期', () => {
        it('createBoxShape 返回非零指针', () => {
            const shape = api.createBoxShape(1, 1, 1);
            expect(shape).toBeGreaterThan(0);
            api.destroyShape(shape);
        });

        it('createSphereShape 返回非零指针', () => {
            const shape = api.createSphereShape(1);
            expect(shape).toBeGreaterThan(0);
            api.destroyShape(shape);
        });

        it('createCapsuleShape 返回非零指针', () => {
            const shape = api.createCapsuleShape(0.5, 1.5);
            expect(shape).toBeGreaterThan(0);
            api.destroyShape(shape);
        });

        it('createStaticPlaneShape 返回非零指针', () => {
            const shape = api.createStaticPlaneShape(0, 1, 0, 0);
            expect(shape).toBeGreaterThan(0);
            api.destroyShape(shape);
        });

        it('destroyShape 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            expect(() => api.destroyShape(shape)).not.toThrow();
        });
    });

    describe('4. 内存管理', () => {
        it('allocateBuffer 返回非零指针', () => {
            const ptr = api.allocateBuffer(64);
            expect(ptr).toBeGreaterThan(0);
            api.deallocateBuffer(ptr, 64);
        });

        it('allocateBuffer 分配的 buffer 可读写', () => {
            const ptr = api.allocateBuffer(16);
            const view = new Float32Array(memory.buffer, ptr, 4);
            view[0] = 3.14;
            view[1] = 2.72;
            expect(view[0]).toBeCloseTo(3.14);
            expect(view[1]).toBeCloseTo(2.72);
            api.deallocateBuffer(ptr, 16);
        });

        it('deallocateBuffer 不抛异常', () => {
            const ptr = api.allocateBuffer(32);
            expect(() => api.deallocateBuffer(ptr, 32)).not.toThrow();
        });
    });

    describe('5. MmdRuntime', () => {
        it('createMmdRuntime 返回非零指针', () => {
            const runtime = api.createMmdRuntime();
            expect(runtime).not.toBeNull();
            // MmdRuntime 是对象而非裸指针，free 释放
            runtime.free();
        });

        it('MmdRuntime.free() 不抛异常', () => {
            const runtime = api.createMmdRuntime();
            expect(() => runtime.free()).not.toThrow();
        });
    });

    describe('6. 刚体物理 — 端到端验证', () => {
        it('创建刚体 → 施力 → 步进 → 速度非零（物理真的在动）', () => {
            // 1. 创建物理世界
            const world = api.createPhysicsWorld();

            // 2. 创建形状
            const shape = api.createBoxShape(1, 1, 1);

            // 3. 构造刚体信息
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });

            // 4. 创建刚体
            const body = api.createRigidBody(infoPtr);
            expect(body).toBeGreaterThan(0);

            // 5. 添加到世界
            api.physicsWorldAddRigidBody(world, body);

            // 6. 验证初始速度为 0
            const [vx0, vy0, vz0] = readLinearVelocity(body);
            expect(vx0).toBe(0);
            expect(vy0).toBe(0);
            expect(vz0).toBe(0);

            // 7. 施加力 (0, 100, 0) — 向上
            api.rigidBodyApplyCentralForce(body, 0, 100, 0);

            // 8. 步进（1/60 秒，1 个子步）
            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            // 9. 读取速度 — 应该非零
            const [vx1, vy1, vz1] = readLinearVelocity(body);
            // 力 = 质量 × 加速度 → 加速度 = 100/1 = 100
            // deltaV = 100 × (1/60) ≈ 1.667
            // 加上重力 (-9.8)，vy ≈ 1.667 - 0.163 ≈ 1.5
            expect(vy1).toBeGreaterThan(0.1); // 至少向上动了
            // 水平方向无外力，应为 0
            expect(vx1).toBe(0);
            expect(vz1).toBe(0);

            // 10. 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('重力影响：无外力情况下刚体在重力作用下下落', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);
            api.physicsWorldAddRigidBody(world, body);

            // 初始速度为零
            const [, vy0] = readLinearVelocity(body);
            expect(vy0).toBe(0);

            // 步进 1 秒（60 帧 × 1/60）
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            const [, vy1] = readLinearVelocity(body);
            // 1 秒后 vy ≈ -9.8（忽略阻尼）
            expect(vy1).toBeLessThan(-1); // 至少在下落

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('rigidBodyGetMass 返回构造时设置的质量', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 3.5 });
            const body = api.createRigidBody(infoPtr);

            const mass = api.rigidBodyGetMass(body);
            expect(mass).toBeCloseTo(3.5, 1);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodySetLinearVelocity 可设置速度', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetLinearVelocity(body, 1, 2, 3);
            const [vx, vy, vz] = readLinearVelocity(body);
            expect(vx).toBeCloseTo(1, 4);
            expect(vy).toBeCloseTo(2, 4);
            expect(vz).toBeCloseTo(3, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });
    });

    describe('7. RigidBodyBundle — 批量刚体（对齐 wind-physics 实际场景）', () => {
        /**
         * 在 WASM 内存中构造 count 个连续的 RigidBodyConstructionInfo，
         * 返回 info 列表指针（调用方负责 deallocateBuffer）。
         * 所有刚体共用同一个形状，但可指定不同质量。
         */
        function buildBundleInfoList(
            shapePtr: number,
            count: number,
            masses?: number[],
        ): number {
            const totalSize = INFO_SIZE * count;
            const listPtr = api.allocateBuffer(totalSize);

            for (let i = 0; i < count; i++) {
                const offset = i * INFO_SIZE;
                const buf = new DataView(memory.buffer, listPtr + offset, INFO_SIZE);

                // shape pointer
                buf.setUint32(OFF.Shape, shapePtr, true);

                // identity matrix
                const tf = new Float32Array(memory.buffer, listPtr + offset + OFF.InitialTransform, 16);
                tf[0] = 1; tf[1] = 0; tf[2] = 0; tf[3] = 0;
                tf[4] = 0; tf[5] = 1; tf[6] = 0; tf[7] = 0;
                tf[8] = 0; tf[9] = 0; tf[10] = 1; tf[11] = 0;
                tf[12] = 0; tf[13] = 0; tf[14] = 0; tf[15] = 1;

                buf.setUint16(OFF.DataMask, 0, true);
                buf.setUint8(OFF.MotionType, 0); // Dynamic

                const mass = masses?.[i] ?? 1.0;
                buf.setFloat32(OFF.Mass, mass, true);

                buf.setFloat32(OFF.LinearDamping, 0.0, true);
                buf.setFloat32(OFF.AngularDamping, 0.0, true);
                buf.setFloat32(OFF.Friction, 0.5, true);
                buf.setFloat32(OFF.Restitution, 0.0, true);
                buf.setFloat32(OFF.LinearSleepingThreshold, 0.0, true);
                buf.setFloat32(OFF.AngularSleepingThreshold, 1.0, true);
                buf.setUint16(OFF.CollisionGroup, 1, true);
                buf.setUint16(OFF.CollisionMask, 0xFFFF, true);
                buf.setUint8(OFF.AdditionalDamping, 0);
                buf.setUint8(OFF.NoContactResponse, 0);
                buf.setUint8(OFF.DisableDeactivation, 1); // 始终禁用休眠，避免测试不稳定
            }

            return listPtr;
        }

        /** 读取 bundle 中第 index 个刚体的线速度 */
        function readBundleLinearVelocity(
            bundlePtr: number,
            index: number,
        ): [number, number, number] {
            const outPtr = api.allocateBuffer(12);
            try {
                api.rigidBodyBundleGetLinearVelocity(bundlePtr, index, outPtr);
                const view = new Float32Array(memory.buffer, outPtr, 3);
                return [view[0], view[1], view[2]];
            } finally {
                api.deallocateBuffer(outPtr, 12);
            }
        }

        it('createRigidBodyBundle 创建 3 个刚体的束，返回非零指针', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 3);
            const bundle = api.createRigidBodyBundle(listPtr, 3);
            expect(bundle).toBeGreaterThan(0);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 3);
            api.destroyShape(shape);
        });

        it('bundle 中每个刚体的质量独立（0.5 / 1.0 / 2.0）', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 3, [0.5, 1.0, 2.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 3);

            expect(api.rigidBodyBundleGetMass(bundle, 0)).toBeCloseTo(0.5, 1);
            expect(api.rigidBodyBundleGetMass(bundle, 1)).toBeCloseTo(1.0, 1);
            expect(api.rigidBodyBundleGetMass(bundle, 2)).toBeCloseTo(2.0, 1);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 3);
            api.destroyShape(shape);
        });

        it('批量施力后每个刚体都有速度（轻的飘得更多）', () => {
            const world = api.createPhysicsWorld();
            // 无重力，纯粹看风力效果
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 3, [0.5, 1.0, 2.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 3);
            api.physicsWorldAddRigidBodyBundle(world, bundle);

            // 初始速度全为零
            for (let i = 0; i < 3; i++) {
                const [, vy] = readBundleLinearVelocity(bundle, i);
                expect(vy).toBe(0);
            }

            // 对每个刚体施加相同的向上力 (0, 10, 0)
            for (let i = 0; i < 3; i++) {
                api.rigidBodyBundleApplyCentralForce(bundle, i, 0, 10, 0);
            }

            // 步进
            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            // 读取速度：质量越轻，速度越大
            const [, vy0] = readBundleLinearVelocity(bundle, 0); // mass 0.5
            const [, vy1] = readBundleLinearVelocity(bundle, 1); // mass 1.0
            const [, vy2] = readBundleLinearVelocity(bundle, 2); // mass 2.0

            expect(vy0).toBeGreaterThan(0);
            expect(vy1).toBeGreaterThan(0);
            expect(vy2).toBeGreaterThan(0);
            // 轻的（mass 0.5）比重的（mass 2.0）速度更大
            expect(vy0).toBeGreaterThan(vy2);

            // 清理
            api.physicsWorldRemoveRigidBodyBundle(world, bundle);
            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 3);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('bundleSetMassProps 可修改质量', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 2, [1.0, 1.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 2);

            // 把第 0 个刚体质量改为 5.0
            api.rigidBodyBundleSetMassProps(bundle, 0, 5.0, 1, 1, 1);
            expect(api.rigidBodyBundleGetMass(bundle, 0)).toBeCloseTo(5.0, 1);
            // 第 1 个不受影响
            expect(api.rigidBodyBundleGetMass(bundle, 1)).toBeCloseTo(1.0, 1);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 2);
            api.destroyShape(shape);
        });

        it('bundleTranslate 移动刚体位置', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            // 移动前获取世界变换
            const tfPtr = api.rigidBodyBundleGetWorldTransformPtr(bundle, 0);
            expect(tfPtr).toBeGreaterThan(0);

            // 平移到 (0, 5, 0)
            api.rigidBodyBundleTranslate(bundle, 0, 0, 5, 0);

            // 验证平移后的位置
            const afterTf = new Float32Array(memory.buffer, tfPtr, 16);
            expect(afterTf[12]).toBeCloseTo(0, 4);
            expect(afterTf[13]).toBeCloseTo(5, 4);
            expect(afterTf[14]).toBeCloseTo(0, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleSetLinearVelocity 设置速度，bundleGetLinearVelocity 读取一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 2);
            const bundle = api.createRigidBodyBundle(listPtr, 2);

            api.rigidBodyBundleSetLinearVelocity(bundle, 0, 1, 2, 3);
            api.rigidBodyBundleSetLinearVelocity(bundle, 1, -1, -2, -3);

            const [vx0, vy0, vz0] = readBundleLinearVelocity(bundle, 0);
            const [vx1, vy1, vz1] = readBundleLinearVelocity(bundle, 1);

            expect(vx0).toBeCloseTo(1, 4);
            expect(vy0).toBeCloseTo(2, 4);
            expect(vz0).toBeCloseTo(3, 4);
            expect(vx1).toBeCloseTo(-1, 4);
            expect(vy1).toBeCloseTo(-2, 4);
            expect(vz1).toBeCloseTo(-3, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 2);
            api.destroyShape(shape);
        });

        it('destroyRigidBodyBundle 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);
            expect(() => api.destroyRigidBodyBundle(bundle)).not.toThrow();

            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });
    });
});
