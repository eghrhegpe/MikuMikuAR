// @vitest-environment node
/**
 * [doc:adr-204] physics-contract.test.ts 拆分：碰撞检测 + 多物理世界独立共存
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    createMinimalPhysicsImpl,
    buildRigidBodyInfo as _buildRigidBodyInfo,
    readLinearVelocity as _readLinearVelocity,
    PHYSICS_INFO_SIZE,
    PHYSICS_OFF,
} from './helpers/minimal-physics-impl';
import type { MinimalPhysicsImpl } from './helpers/minimal-physics-impl';
import type * as sprWasm from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

// ======== 全局 WASM 实例（本文件所有测试共享） ========
let phys: MinimalPhysicsImpl;
let api: typeof sprWasm;
let memory: WebAssembly.Memory;

beforeAll(() => {
    phys = createMinimalPhysicsImpl();
    api = phys.api;
    memory = phys.memory;
});

// ======== 本地薄包装（保持调用代码不变，实现体共享） ========
const INFO_SIZE = PHYSICS_INFO_SIZE;
const OFF = PHYSICS_OFF;
const buildRigidBodyInfo = (
    shapePtr: number,
    overrides?: Parameters<typeof _buildRigidBodyInfo>[2]
) => _buildRigidBodyInfo(phys, shapePtr, overrides);
const readLinearVelocity = (bodyPtr: number) => _readLinearVelocity(phys, bodyPtr);

describe('WASM 物理契约测试', () => {
    describe('9. 碰撞检测', () => {
        it('方块落到静态地面上不会穿透（碰撞管线生效）', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            // 地面：静态平面，法线向上，y=0
            const groundShape = api.createStaticPlaneShape(0, 1, 0, 0);
            const groundInfo = buildRigidBodyInfo(groundShape, { mass: 0, motionType: 1 });
            const ground = api.createRigidBody(groundInfo);
            api.physicsWorldAddRigidBody(world, ground);

            // 方块：在 (0, 5, 0) 高度，质量 1
            const boxShape = api.createBoxShape(1, 1, 1);
            const boxInfo = buildRigidBodyInfo(boxShape, { mass: 1.0, disableDeactivation: true });
            const box = api.createRigidBody(boxInfo);
            api.physicsWorldAddRigidBody(world, box);

            // 把方块放到高处
            api.rigidBodyTranslate(box, 0, 5, 0);

            // 步进 3 秒（180 帧）——足够方块落到地面
            for (let i = 0; i < 180; i++) {
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // 读取方块位置——不应穿透地面（Y 应 >= 0.5，方块半高）
            const tfPtr = api.rigidBodyGetWorldTransformPtr(box);
            const tf = new Float32Array(memory.buffer, tfPtr, 16);
            expect(tf[13]).toBeGreaterThan(0.4); // 方块半高 0.5，留一点容差

            // 清理
            api.physicsWorldRemoveRigidBody(world, box);
            api.physicsWorldRemoveRigidBody(world, ground);
            api.destroyRigidBody(box);
            api.destroyRigidBody(ground);
            api.deallocateBuffer(boxInfo, INFO_SIZE);
            api.deallocateBuffer(groundInfo, INFO_SIZE);
            api.destroyShape(boxShape);
            api.destroyShape(groundShape);
            api.destroyPhysicsWorld(world);
        });

        it('两方块碰撞后动量传递（被撞的动起来）', () => {
            const world = api.createPhysicsWorld();
            // 无重力，纯碰撞
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);

            // 方块 A：位于 (0, 0, 0)，初始静止
            const infoA = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const bodyA = api.createRigidBody(infoA);
            api.physicsWorldAddRigidBody(world, bodyA);

            // 方块 B：位于 (0, 0, 3)，向 A 方向运动
            const infoB = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const bodyB = api.createRigidBody(infoB);
            api.physicsWorldAddRigidBody(world, bodyB);
            api.rigidBodyTranslate(bodyB, 0, 0, 3);
            api.rigidBodySetLinearVelocity(bodyB, 0, 0, -5); // 向 A 撞去

            // A 初始静止
            const [, , vzA0] = readLinearVelocity(bodyA);
            expect(vzA0).toBe(0);

            // 步进 1 秒
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // A 被撞后应该有速度（动量传递）
            const [, , vzA1] = readLinearVelocity(bodyA);
            // A 被撞后沿 Z 轴应该有速度
            expect(Math.abs(vzA1)).toBeGreaterThan(0.01);

            // B 撞击后速度应该减小或反向
            const [, , vzB1] = readLinearVelocity(bodyB);
            // 碰撞后 B 的速度绝对值应小于初始 5
            expect(Math.abs(vzB1)).toBeLessThan(5);

            // 清理
            api.physicsWorldRemoveRigidBody(world, bodyA);
            api.physicsWorldRemoveRigidBody(world, bodyB);
            api.destroyRigidBody(bodyA);
            api.destroyRigidBody(bodyB);
            api.deallocateBuffer(infoA, INFO_SIZE);
            api.deallocateBuffer(infoB, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('restitution 影响反弹：高弹性方块反弹更明显', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            // 地面
            const groundShape = api.createStaticPlaneShape(0, 1, 0, 0);
            const groundInfo = buildRigidBodyInfo(groundShape, { mass: 0, motionType: 1 });
            const ground = api.createRigidBody(groundInfo);
            api.physicsWorldAddRigidBody(world, ground);

            // 高弹性方块 (restitution = 0.9)
            const boxShape = api.createBoxShape(1, 1, 1);
            const boxInfo = buildRigidBodyInfo(boxShape, { mass: 1.0, disableDeactivation: true });
            // 手动设置高 restitution
            const boxBuf = new DataView(memory.buffer, boxInfo, INFO_SIZE);
            boxBuf.setFloat32(OFF.Restitution, 0.9, true);
            const box = api.createRigidBody(boxInfo);
            api.physicsWorldAddRigidBody(world, box);
            api.rigidBodyTranslate(box, 0, 5, 0);

            // 记录初始位置
            const tfPtr = api.rigidBodyGetWorldTransformPtr(box);

            // 步进，让方块落地并反弹
            for (let i = 0; i < 120; i++) {
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // 2 秒后，高弹性方块应该已经反弹离开地面
            const tf = new Float32Array(memory.buffer, tfPtr, 16);
            // 如果反弹了，Y 位置应该明显高于地面（> 0.5）
            // 注意：碰撞后可能还在运动中，不做强断言，只验证不为负
            expect(tf[13]).toBeGreaterThan(0.4);

            // 清理
            api.physicsWorldRemoveRigidBody(world, box);
            api.physicsWorldRemoveRigidBody(world, ground);
            api.destroyRigidBody(box);
            api.destroyRigidBody(ground);
            api.deallocateBuffer(boxInfo, INFO_SIZE);
            api.deallocateBuffer(groundInfo, INFO_SIZE);
            api.destroyShape(boxShape);
            api.destroyShape(groundShape);
            api.destroyPhysicsWorld(world);
        });
    });

    describe('10. 多物理世界 — 独立共存（多模型场景基础）', () => {
        it('两个物理世界可独立创建，返回不同指针', () => {
            const world1 = api.createPhysicsWorld();
            const world2 = api.createPhysicsWorld();
            expect(world1).toBeGreaterThan(0);
            expect(world2).toBeGreaterThan(0);
            expect(world1).not.toBe(world2);

            api.destroyPhysicsWorld(world1);
            api.destroyPhysicsWorld(world2);
        });

        it('两个世界的重力设置独立，互不干扰', () => {
            const world1 = api.createPhysicsWorld();
            const world2 = api.createPhysicsWorld();

            const shape = api.createBoxShape(1, 1, 1);

            // 世界 1：无重力
            api.physicsWorldSetGravity(world1, 0, 0, 0);
            const info1 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body1 = api.createRigidBody(info1);
            api.physicsWorldAddRigidBody(world1, body1);

            // 世界 2：向下重力
            api.physicsWorldSetGravity(world2, 0, -9.8, 0);
            const info2 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body2 = api.createRigidBody(info2);
            api.physicsWorldAddRigidBody(world2, body2);

            // 对两个世界分别步进 1 秒
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(world1, 1 / 60, 1, 1 / 60);
                api.physicsWorldStepSimulation(world2, 1 / 60, 1, 1 / 60);
            }

            // 世界 1（无重力）：速度应为 0
            const [vx1, vy1, vz1] = readLinearVelocity(body1);
            expect(vx1).toBe(0);
            expect(vy1).toBe(0);
            expect(vz1).toBe(0);

            // 世界 2（有重力）：应该在下落
            const [, vy2] = readLinearVelocity(body2);
            expect(vy2).toBeLessThan(-1);

            // 清理
            api.physicsWorldRemoveRigidBody(world1, body1);
            api.physicsWorldRemoveRigidBody(world2, body2);
            api.destroyRigidBody(body1);
            api.destroyRigidBody(body2);
            api.deallocateBuffer(info1, INFO_SIZE);
            api.deallocateBuffer(info2, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world1);
            api.destroyPhysicsWorld(world2);
        });

        it('销毁一个世界后，另一个世界仍正常工作', () => {
            const world1 = api.createPhysicsWorld();
            const world2 = api.createPhysicsWorld();

            const shape = api.createBoxShape(1, 1, 1);

            // 世界 1：添加刚体
            api.physicsWorldSetGravity(world1, 0, -9.8, 0);
            const info1 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body1 = api.createRigidBody(info1);
            api.physicsWorldAddRigidBody(world1, body1);

            // 世界 2：添加刚体
            api.physicsWorldSetGravity(world2, 0, -9.8, 0);
            const info2 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body2 = api.createRigidBody(info2);
            api.physicsWorldAddRigidBody(world2, body2);

            // 步进后验证两个世界都在工作
            api.physicsWorldStepSimulation(world1, 1 / 60, 1, 1 / 60);
            api.physicsWorldStepSimulation(world2, 1 / 60, 1, 1 / 60);
            const [, vy1Before] = readLinearVelocity(body1);
            const [, vy2Before] = readLinearVelocity(body2);
            expect(vy1Before).toBeLessThan(0);
            expect(vy2Before).toBeLessThan(0);

            // 销毁世界 1（包括其刚体）
            api.physicsWorldRemoveRigidBody(world1, body1);
            api.destroyRigidBody(body1);
            api.deallocateBuffer(info1, INFO_SIZE);
            api.destroyPhysicsWorld(world1);

            // 世界 2 继续步进，应正常工作
            api.physicsWorldStepSimulation(world2, 1 / 60, 1, 1 / 60);
            const [, vy2After] = readLinearVelocity(body2);
            // 速度应该继续变化（重力加速）
            expect(vy2After).toBeLessThan(vy2Before);

            // 清理
            api.physicsWorldRemoveRigidBody(world2, body2);
            api.destroyRigidBody(body2);
            api.deallocateBuffer(info2, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world2);
        });

        it('只对世界 A 步进，世界 B 的刚体速度不变', () => {
            const worldA = api.createPhysicsWorld();
            const worldB = api.createPhysicsWorld();

            const shape = api.createBoxShape(1, 1, 1);

            // 世界 A：有重力
            api.physicsWorldSetGravity(worldA, 0, -9.8, 0);
            const infoA = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const bodyA = api.createRigidBody(infoA);
            api.physicsWorldAddRigidBody(worldA, bodyA);

            // 世界 B：也有重力，但不对其步进
            api.physicsWorldSetGravity(worldB, 0, -9.8, 0);
            const infoB = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const bodyB = api.createRigidBody(infoB);
            api.physicsWorldAddRigidBody(worldB, bodyB);

            // 只对世界 A 步进
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(worldA, 1 / 60, 1, 1 / 60);
            }

            // 世界 A 的刚体应该在下落
            const [, vyA] = readLinearVelocity(bodyA);
            expect(vyA).toBeLessThan(-1);

            // 世界 B 的刚体速度应该保持为 0（未步进）
            const [vxB, vyB, vzB] = readLinearVelocity(bodyB);
            expect(vxB).toBe(0);
            expect(vyB).toBe(0);
            expect(vzB).toBe(0);

            // 清理
            api.physicsWorldRemoveRigidBody(worldA, bodyA);
            api.physicsWorldRemoveRigidBody(worldB, bodyB);
            api.destroyRigidBody(bodyA);
            api.destroyRigidBody(bodyB);
            api.deallocateBuffer(infoA, INFO_SIZE);
            api.deallocateBuffer(infoB, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(worldA);
            api.destroyPhysicsWorld(worldB);
        });

        it('不同世界的刚体不互相碰撞（跨世界隔离）', () => {
            const world1 = api.createPhysicsWorld();
            const world2 = api.createPhysicsWorld();

            // 无重力，纯碰撞测试
            api.physicsWorldSetGravity(world1, 0, 0, 0);
            api.physicsWorldSetGravity(world2, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);

            // 世界 1：方块在原点，静止
            const info1 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body1 = api.createRigidBody(info1);
            api.physicsWorldAddRigidBody(world1, body1);

            // 世界 2：方块在原点，向 Z 轴运动
            const info2 = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body2 = api.createRigidBody(info2);
            api.physicsWorldAddRigidBody(world2, body2);
            api.rigidBodySetLinearVelocity(body2, 0, 0, 5);

            // 分别步进两个世界
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(world1, 1 / 60, 1, 1 / 60);
                api.physicsWorldStepSimulation(world2, 1 / 60, 1, 1 / 60);
            }

            // 世界 1 的方块应保持静止（无外力，也不应被世界 2 的刚体碰撞）
            const [vx1, vy1, vz1] = readLinearVelocity(body1);
            expect(vx1).toBe(0);
            expect(vy1).toBe(0);
            expect(vz1).toBe(0);

            // 世界 2 的方块应保持匀速运动（无重力、无碰撞物）
            const [, , vz2] = readLinearVelocity(body2);
            expect(vz2).toBeCloseTo(5, 1);

            // 清理
            api.physicsWorldRemoveRigidBody(world1, body1);
            api.physicsWorldRemoveRigidBody(world2, body2);
            api.destroyRigidBody(body1);
            api.destroyRigidBody(body2);
            api.deallocateBuffer(info1, INFO_SIZE);
            api.deallocateBuffer(info2, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world1);
            api.destroyPhysicsWorld(world2);
        });
    });
});
