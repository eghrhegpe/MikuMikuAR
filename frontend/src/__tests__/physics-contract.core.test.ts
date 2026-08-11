// @vitest-environment node
/**
 * [doc:adr-204] physics-contract.test.ts 拆分：模块加载 / 世界生命周期 / 形状 / 内存 / MmdRuntime
 *
 * 在 Node.js 环境下通过 initSync 加载 babylon-mmd SPR WASM 模块，
 * 验证 Bullet 物理引擎的底层 API 契约。全部测试不依赖 Babylon.js，只依赖 raw WASM API。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createMinimalPhysicsImpl } from './helpers/minimal-physics-impl';
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
});
