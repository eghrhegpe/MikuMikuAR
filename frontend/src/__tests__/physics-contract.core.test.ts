// @vitest-environment node
/**
 * [doc:adr-204] physics-contract.test.ts 拆分：模块加载 / 世界生命周期 / 形状 / 内存 / MmdRuntime
 *
 * 在 Node.js 环境下通过 initSync 加载 babylon-mmd SPR WASM 模块，
 * 验证 Bullet 物理引擎的底层 API 契约。全部测试不依赖 Babylon.js，只依赖 raw WASM API。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMinimalPhysicsImpl, buildRigidBodyInfo, readLinearVelocity, PHYSICS_INFO_SIZE } from './helpers/minimal-physics-impl';
import type { MinimalPhysicsImpl } from './helpers/minimal-physics-impl';
import type * as sprWasm from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

// ======== 全局 WASM 实例（本文件所有测试共享） ========
// [audit:round5] 资源释放：本文件用例均为单资源「创建→断言→销毁」短链，断言失败
// 泄漏单指针由 vitest worker 进程退出统一回收，影响可接受；多资源端到端场景
// （collision-worlds / rigidbody）已用 try/finally + finally 空值守卫防护。
let phys: MinimalPhysicsImpl;
let api: typeof sprWasm;
let memory: WebAssembly.Memory;

beforeAll(() => {
    phys = createMinimalPhysicsImpl();
    api = phys.api;
    memory = phys.memory;
});

describe('WASM 物理契约测试', () => {
    describe('1. 模块加载', () => {
        it('WASM 模块成功加载，createPhysicsWorld 不抛异常', () => {
            const world = api.createPhysicsWorld();
            try {
                expect(world).toBeGreaterThan(0);
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });

        it('initSync 返回的 memory 可用（buffer 非空）', () => {
            expect(memory.buffer.byteLength).toBeGreaterThan(0);
        });

        it('memory.buffer 为 ArrayBuffer 或 SharedArrayBuffer', () => {
            const b: unknown = memory.buffer;
            expect(
                b instanceof ArrayBuffer ||
                (typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer)
            ).toBe(true);
        });
    });

    describe('2. 物理世界生命周期', () => {
        it('createPhysicsWorld 返回非零指针', () => {
            const world = api.createPhysicsWorld();
            try {
                expect(world).toBeGreaterThan(0);
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });

        it('destroyPhysicsWorld 不抛异常', () => {
            const world = api.createPhysicsWorld();
            expect(() => api.destroyPhysicsWorld(world)).not.toThrow();
        });

        it('physicsWorldSetGravity 不抛异常', () => {
            const world = api.createPhysicsWorld();
            try {
                expect(() => api.physicsWorldSetGravity(world, 0, -9.8, 0)).not.toThrow();
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });

        it('physicsWorldStepSimulation 不抛异常（空世界步进）', () => {
            const world = api.createPhysicsWorld();
            try {
                expect(() => api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60)).not.toThrow();
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });

        it('多个物理世界真正隔离：A 世界重力不影响 B 世界静止体', () => {
            const worldA = api.createPhysicsWorld();
            const worldB = api.createPhysicsWorld();
            try {
                expect(worldA).toBeGreaterThan(0);
                expect(worldB).toBeGreaterThan(0);
                expect(worldA).not.toBe(worldB);

                // A 世界：dynamic body + 重力，应下落
                api.physicsWorldSetGravity(worldA, 0, -9.8, 0);
                const shapeA = api.createBoxShape(1, 1, 1);
                const infoA = buildRigidBodyInfo(phys, shapeA, { mass: 1.0, disableDeactivation: true });
                const bodyA = api.createRigidBody(infoA);
                api.physicsWorldAddRigidBody(worldA, bodyA);
                api.deallocateBuffer(infoA, PHYSICS_INFO_SIZE);

                // B 世界：static body（mass 0），无重力，应保持静止
                api.physicsWorldSetGravity(worldB, 0, 0, 0);
                const shapeB = api.createBoxShape(1, 1, 1);
                const infoB = buildRigidBodyInfo(phys, shapeB, { mass: 0, disableDeactivation: true });
                const bodyB = api.createRigidBody(infoB);
                api.physicsWorldAddRigidBody(worldB, bodyB);
                api.deallocateBuffer(infoB, PHYSICS_INFO_SIZE);

                // 步进两个世界各 30 次
                for (let i = 0; i < 30; i++) {
                    api.physicsWorldStepSimulation(worldA, 1 / 60, 1, 1 / 60);
                    api.physicsWorldStepSimulation(worldB, 1 / 60, 1, 1 / 60);
                }

                const velA = readLinearVelocity(phys, bodyA);
                const velB = readLinearVelocity(phys, bodyB);
                // A 世界的 dynamic body 受重力应获得向下速度
                expect(velA[1]).toBeLessThan(-0.1);
                // B 世界的 static body 不受任何力，速度恒为 0（隔离验证）
                expect(velB[0]).toBeCloseTo(0);
                expect(velB[1]).toBeCloseTo(0);
                expect(velB[2]).toBeCloseTo(0);

                api.destroyShape(shapeA);
                api.destroyShape(shapeB);
                api.destroyRigidBody(bodyA);
                api.destroyRigidBody(bodyB);
            } finally {
                api.destroyPhysicsWorld(worldA);
                api.destroyPhysicsWorld(worldB);
            }
        });

        it('连续多步模拟不抛异常', () => {
            const world = api.createPhysicsWorld();
            try {
                api.physicsWorldSetGravity(world, 0, -9.8, 0);
                for (let i = 0; i < 60; i++) {
                    api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
                }
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });

        it('physicsWorldUseMotionStateBuffer 不抛异常', () => {
            const world = api.createPhysicsWorld();
            try {
                expect(() => api.physicsWorldUseMotionStateBuffer(world, true)).not.toThrow();
                expect(() => api.physicsWorldUseMotionStateBuffer(world, false)).not.toThrow();
            } finally {
                api.destroyPhysicsWorld(world);
            }
        });
    });

    describe('3. 形状生命周期', () => {
        it('createBoxShape 返回非零指针', () => {
            const shape = api.createBoxShape(1, 1, 1);
            try {
                expect(shape).toBeGreaterThan(0);
            } finally {
                api.destroyShape(shape);
            }
        });

        it('createSphereShape 返回非零指针', () => {
            const shape = api.createSphereShape(1);
            try {
                expect(shape).toBeGreaterThan(0);
            } finally {
                api.destroyShape(shape);
            }
        });

        it('createCapsuleShape 返回非零指针', () => {
            const shape = api.createCapsuleShape(0.5, 1.5);
            try {
                expect(shape).toBeGreaterThan(0);
            } finally {
                api.destroyShape(shape);
            }
        });

        it('createStaticPlaneShape 返回非零指针', () => {
            const shape = api.createStaticPlaneShape(0, 1, 0, 0);
            try {
                expect(shape).toBeGreaterThan(0);
            } finally {
                api.destroyShape(shape);
            }
        });

        it('destroyShape 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            expect(() => api.destroyShape(shape)).not.toThrow();
        });

        it('极小尺寸形状不抛异常', () => {
            const shape = api.createBoxShape(0.001, 0.001, 0.001);
            try {
                expect(shape).toBeGreaterThan(0);
            } finally {
                api.destroyShape(shape);
            }
        });
    });

    describe('4. 内存管理', () => {
        it('allocateBuffer 返回非零指针', () => {
            const ptr = api.allocateBuffer(64);
            try {
                expect(ptr).toBeGreaterThan(0);
            } finally {
                api.deallocateBuffer(ptr, 64);
            }
        });

        it('allocateBuffer 分配的 buffer 可读写', () => {
            const ptr = api.allocateBuffer(16);
            try {
                const view = new Float32Array(memory.buffer, ptr, 4);
                view[0] = 3.14;
                view[1] = 2.72;
                expect(view[0]).toBeCloseTo(3.14);
                expect(view[1]).toBeCloseTo(2.72);
            } finally {
                api.deallocateBuffer(ptr, 16);
            }
        });

        it('deallocateBuffer 不抛异常', () => {
            const ptr = api.allocateBuffer(32);
            expect(() => api.deallocateBuffer(ptr, 32)).not.toThrow();
        });

        it('零尺寸分配返回有效指针或零', () => {
            const ptr = api.allocateBuffer(0);
            // WASM malloc(0) 行为：返回有效指针或 0，不应崩溃
            expect(typeof ptr).toBe('number');
            if (ptr > 0) {
                api.deallocateBuffer(ptr, 0);
            }
        });

        it('多次分配-释放不崩溃', () => {
            for (let i = 0; i < 10; i++) {
                const ptr = api.allocateBuffer(128);
                expect(ptr).toBeGreaterThan(0);
                api.deallocateBuffer(ptr, 128);
            }
        });
    });

    describe('5. MmdRuntime', () => {
        it('createMmdRuntime 返回有效对象', () => {
            const runtime = api.createMmdRuntime();
            try {
                expect(runtime).toBeTruthy();
                expect(typeof runtime.free).toBe('function');
            } finally {
                runtime.free();
            }
        });

        it('MmdRuntime.free() 不抛异常', () => {
            const runtime = api.createMmdRuntime();
            expect(() => runtime.free()).not.toThrow();
        });
    });
});
