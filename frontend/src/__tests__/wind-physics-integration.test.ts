/**
 * wind-physics-integration.test.ts — L1.5 集成契约测试
 *
 * 在真实 WASM Bullet 物理世界上模拟 wind-physics 的 _onPhysicsSync 风力施加逻辑，
 * 验证 L1（API 正确性）和 L2（状态机逻辑）之间的衔接：
 *   - 风力向量 → scale → 施加到 bundle → 步进 → 速度变化
 *   - 风力与重力叠加
 *   - 风力停止后恢复自由落体
 *   - 风力方向独立
 *   - 不同质量刚体对风力的响应差异
 *
 * 不依赖 Babylon.js / MmdRuntime，只依赖 raw WASM API。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    createMinimalPhysicsImpl,
    buildRigidBodyInfo as _buildRigidBodyInfo,
    buildBundleInfoList as _buildBundleInfoList,
    readLinearVelocity as _readLinearVelocity,
    readBundleLinearVelocity as _readBundleLinearVelocity,
    PHYSICS_INFO_SIZE,
} from './helpers/minimal-physics-impl';
import type { MinimalPhysicsImpl } from './helpers/minimal-physics-impl';
import type * as sprWasm from 'babylon-mmd/esm/Runtime/Optimized/wasm/spr';

// ======== 全局 WASM 实例 ========
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
const buildRigidBodyInfo = (shapePtr: number, overrides?: Parameters<typeof _buildRigidBodyInfo>[2]) =>
    _buildRigidBodyInfo(phys, shapePtr, overrides);
const buildBundleInfoList = (shapePtr: number, count: number, masses?: number[]) =>
    _buildBundleInfoList(phys, shapePtr, count, masses);
const readBundleLinearVelocity = (bundlePtr: number, index: number) =>
    _readBundleLinearVelocity(phys, bundlePtr, index);
const readLinearVelocity = (bodyPtr: number) => _readLinearVelocity(phys, bodyPtr);

// ======== 风力常量（对齐 wind-physics.ts） ========
const WIND_FORCE_SCALE = 1.0;

// ======== 测试套件 ========

describe('wind-physics 集成契约 — 真实 WASM 世界上模拟风力施加', () => {
    describe('1. 风力施加后 bundle 刚体速度变化', () => {
        it('风力向上 → 无重力下刚体获得向上速度', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0); // 无重力

            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 3, [0.5, 1.0, 2.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 3);
            api.physicsWorldAddRigidBodyBundle(world, bundle);

            // 模拟 wind-physics._onPhysicsSync 的风力施加逻辑：
            // wind = getWindVector() → scale(1.0) → applyCentralForce
            const windForceY = 10; // 模拟风速 10
            for (let i = 0; i < 3; i++) {
                api.rigidBodyBundleApplyCentralForce(bundle, i, 0, windForceY, 0);
            }

            // 步进一帧
            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            // 所有刚体应获得向上速度
            const [, vy0] = readBundleLinearVelocity(bundle, 0);
            const [, vy1] = readBundleLinearVelocity(bundle, 1);
            const [, vy2] = readBundleLinearVelocity(bundle, 2);

            expect(vy0).toBeGreaterThan(0);
            expect(vy1).toBeGreaterThan(0);
            expect(vy2).toBeGreaterThan(0);

            // 轻的（0.5）比重的（2.0）速度更大
            expect(vy0).toBeGreaterThan(vy2);

            // 清理
            api.physicsWorldRemoveRigidBodyBundle(world, bundle);
            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 3);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('风力向上 + 重力向下 → 净速度方向取决于风力大小', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 2, [1.0, 1.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 2);
            api.physicsWorldAddRigidBodyBundle(world, bundle);

            // 强风：向上 100N，远超重力 9.8N
            api.rigidBodyBundleApplyCentralForce(bundle, 0, 0, 100, 0);
            // 弱风：向上 5N，小于重力 9.8N
            api.rigidBodyBundleApplyCentralForce(bundle, 1, 0, 5, 0);

            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            const [, vyStrong] = readBundleLinearVelocity(bundle, 0);
            const [, vyWeak] = readBundleLinearVelocity(bundle, 1);

            // 强风：加速度 = (100 - 9.8) / 1 = 90.2 → 向上
            expect(vyStrong).toBeGreaterThan(0);
            // 弱风：加速度 = (5 - 9.8) / 1 = -4.8 → 向下
            expect(vyWeak).toBeLessThan(0);

            // 清理
            api.physicsWorldRemoveRigidBodyBundle(world, bundle);
            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE * 2);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });
    });

    describe('2. 风力停止后恢复自由落体', () => {
        it('持续施风后停风 → 刚体在重力作用下从上升转为下落', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const info = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(info);
            api.physicsWorldAddRigidBody(world, body);

            // 阶段 1：持续向上施风 30 帧（0.5 秒）
            for (let i = 0; i < 30; i++) {
                if (i < 30) {
                    api.rigidBodyApplyCentralForce(body, 0, 20, 0); // 20N 向上
                }
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // 阶段 1 结束后应该有向上速度
            const [, vyAfterWind] = readLinearVelocity(body);
            expect(vyAfterWind).toBeGreaterThan(0);

            // 阶段 2：停风，继续步进 30 帧
            for (let i = 0; i < 30; i++) {
                // 不施加风力
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // 停风后，重力会使向上速度减小
            const [, vyAfterStop] = readLinearVelocity(body);
            expect(vyAfterStop).toBeLessThan(vyAfterWind);

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(info, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });
    });

    describe('3. 风力方向独立', () => {
        it('X 轴方向风力只影响 X 轴速度', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const info = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(info);
            api.physicsWorldAddRigidBody(world, body);

            // 施加纯 X 轴风力
            api.rigidBodyApplyCentralForce(body, 15, 0, 0);

            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            const [vx, vy, vz] = readLinearVelocity(body);

            // X 轴应有速度
            expect(vx).toBeGreaterThan(0);
            // Y/Z 轴应为 0（无重力、无外力）
            expect(vy).toBe(0);
            expect(vz).toBe(0);

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(info, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('斜向风力（X+Z）只影响 X 和 Z 轴速度', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const info = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(info);
            api.physicsWorldAddRigidBody(world, body);

            // 施加斜向风力 (X=10, Z=5)
            api.rigidBodyApplyCentralForce(body, 10, 0, 5);

            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            const [vx, vy, vz] = readLinearVelocity(body);

            expect(vx).toBeGreaterThan(0);
            expect(vy).toBe(0);
            expect(vz).toBeGreaterThan(0);

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(info, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });
    });

    describe('4. 单数刚体风力施加（对齐 wind-physics 路径 1b）', () => {
        it('对单数刚体施风 → 速度变化', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const info = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(info);
            api.physicsWorldAddRigidBody(world, body);

            // 模拟 wind-physics 路径 1b：对单数刚体施风
            // body.applyCentralForce(_tmpWind)
            api.rigidBodyApplyCentralForce(body, 0, 10, 0);

            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            const [, vy] = readLinearVelocity(body);
            expect(vy).toBeGreaterThan(0);

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(info, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('多刚体独立施风 → 各自独立响应', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);

            // 刚体 A：质量 0.5
            const infoA = buildRigidBodyInfo(shape, { mass: 0.5, disableDeactivation: true });
            const bodyA = api.createRigidBody(infoA);
            api.physicsWorldAddRigidBody(world, bodyA);

            // 刚体 B：质量 2.0
            const infoB = buildRigidBodyInfo(shape, { mass: 2.0, disableDeactivation: true });
            const bodyB = api.createRigidBody(infoB);
            api.physicsWorldAddRigidBody(world, bodyB);

            // 施加相同风力
            api.rigidBodyApplyCentralForce(bodyA, 0, 10, 0);
            api.rigidBodyApplyCentralForce(bodyB, 0, 10, 0);

            api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);

            const [, vyA] = readLinearVelocity(bodyA);
            const [, vyB] = readLinearVelocity(bodyB);

            // 轻的（0.5）比重的（2.0）速度更大
            expect(vyA).toBeGreaterThan(vyB);

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
    });

    describe('5. 持续风力 → 稳态速度积累', () => {
        it('持续施风 60 帧 → 速度线性增长', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, 0, 0);

            const shape = api.createBoxShape(1, 1, 1);
            const info = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(info);
            api.physicsWorldAddRigidBody(world, body);

            // 持续施风 60 帧
            const forceY = 10; // 10N
            for (let i = 0; i < 60; i++) {
                api.rigidBodyApplyCentralForce(body, 0, forceY, 0);
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            const [, vy] = readLinearVelocity(body);
            // 60 帧后理论速度 = forceY * 60 * (1/60) / mass = 10 * 1 / 1 = 10
            // 留 ±20% 容差
            expect(vy).toBeGreaterThan(8);
            expect(vy).toBeLessThan(12);

            // 清理
            api.physicsWorldRemoveRigidBody(world, body);
            api.destroyRigidBody(body);
            api.deallocateBuffer(info, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });
    });
});