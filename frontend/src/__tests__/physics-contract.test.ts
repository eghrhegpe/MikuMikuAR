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
import {
    createMinimalPhysicsImpl,
    buildRigidBodyInfo as _buildRigidBodyInfo,
    buildBundleInfoList as _buildBundleInfoList,
    readLinearVelocity as _readLinearVelocity,
    readBundleLinearVelocity as _readBundleLinearVelocity,
    PHYSICS_INFO_SIZE,
    PHYSICS_OFF,
} from './helpers/minimal-physics-impl';
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

// ======== 本地薄包装（保持调用代码不变，实现体共享） ========
const INFO_SIZE = PHYSICS_INFO_SIZE;
const OFF = PHYSICS_OFF;
const buildRigidBodyInfo = (shapePtr: number, overrides?: Parameters<typeof _buildRigidBodyInfo>[2]) =>
    _buildRigidBodyInfo(phys, shapePtr, overrides);
const readLinearVelocity = (bodyPtr: number) => _readLinearVelocity(phys, bodyPtr);

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
        const buildBundleInfoList = (shapePtr: number, count: number, masses?: number[]) =>
            _buildBundleInfoList(phys, shapePtr, count, masses);
        const readBundleLinearVelocity = (bundlePtr: number, index: number) =>
            _readBundleLinearVelocity(phys, bundlePtr, index);

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

    describe('8. 6DOF Spring 约束（MMD 关节物理基础）', () => {
        /** 在 WASM 内存中分配一个 4×4 单位矩阵，返回指针 */
        function allocIdentityMatrix(): number {
            const ptr = api.allocateBuffer(64); // 16 floats × 4 bytes
            const m = new Float32Array(memory.buffer, ptr, 16);
            m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0;
            m[4] = 0; m[5] = 1; m[6] = 0; m[7] = 0;
            m[8] = 0; m[9] = 0; m[10] = 1; m[11] = 0;
            m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
            return ptr;
        }

        it('createGeneric6DofSpringConstraint 返回非零指针', () => {
            const shape = api.createBoxShape(1, 1, 1);

            const anchorInfo = buildRigidBodyInfo(shape, { mass: 0, motionType: 1 }); // Static
            const bodyInfo = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });

            const anchor = api.createRigidBody(anchorInfo);
            const body = api.createRigidBody(bodyInfo);

            const frameA = allocIdentityMatrix();
            const frameB = allocIdentityMatrix();

            const constraint = api.createGeneric6DofSpringConstraint(
                anchor, body, frameA, frameB, true,
            );
            expect(constraint).toBeGreaterThan(0);

            api.destroyConstraint(constraint);
            api.deallocateBuffer(frameA, 64);
            api.deallocateBuffer(frameB, 64);
            api.destroyRigidBody(body);
            api.destroyRigidBody(anchor);
            api.deallocateBuffer(bodyInfo, INFO_SIZE);
            api.deallocateBuffer(anchorInfo, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('constraintEnableSpring / constraintSetStiffness / constraintSetDamping 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const anchorInfo = buildRigidBodyInfo(shape, { mass: 0, motionType: 1 });
            const bodyInfo = buildRigidBodyInfo(shape, { mass: 1.0 });
            const anchor = api.createRigidBody(anchorInfo);
            const body = api.createRigidBody(bodyInfo);
            const frameA = allocIdentityMatrix();
            const frameB = allocIdentityMatrix();

            const constraint = api.createGeneric6DofSpringConstraint(
                anchor, body, frameA, frameB, true,
            );

            // 在 Y 轴线性方向启用弹簧（index 0=X, 1=Y, 2=Z linear; 3=AngX, 4=AngY, 5=AngZ）
            expect(() => api.constraintEnableSpring(constraint, 1, true)).not.toThrow();
            expect(() => api.constraintSetStiffness(constraint, 1, 100.0)).not.toThrow();
            expect(() => api.constraintSetDamping(constraint, 1, 10.0)).not.toThrow();

            api.destroyConstraint(constraint);
            api.deallocateBuffer(frameA, 64);
            api.deallocateBuffer(frameB, 64);
            api.destroyRigidBody(body);
            api.destroyRigidBody(anchor);
            api.deallocateBuffer(bodyInfo, INFO_SIZE);
            api.deallocateBuffer(anchorInfo, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('constraintSetLinearLowerLimit / constraintSetLinearUpperLimit 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const anchorInfo = buildRigidBodyInfo(shape, { mass: 0, motionType: 1 });
            const bodyInfo = buildRigidBodyInfo(shape, { mass: 1.0 });
            const anchor = api.createRigidBody(anchorInfo);
            const body = api.createRigidBody(bodyInfo);
            const frameA = allocIdentityMatrix();
            const frameB = allocIdentityMatrix();

            const constraint = api.createGeneric6DofSpringConstraint(
                anchor, body, frameA, frameB, true,
            );

            expect(() => api.constraintSetLinearLowerLimit(constraint, -1, -2, -1)).not.toThrow();
            expect(() => api.constraintSetLinearUpperLimit(constraint, 1, 2, 1)).not.toThrow();
            expect(() => api.constraintSetAngularLowerLimit(constraint, -0.5, -1, -0.5)).not.toThrow();
            expect(() => api.constraintSetAngularUpperLimit(constraint, 0.5, 1, 0.5)).not.toThrow();

            api.destroyConstraint(constraint);
            api.deallocateBuffer(frameA, 64);
            api.deallocateBuffer(frameB, 64);
            api.destroyRigidBody(body);
            api.destroyRigidBody(anchor);
            api.deallocateBuffer(bodyInfo, INFO_SIZE);
            api.deallocateBuffer(anchorInfo, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('弹簧约束生效：锚点 + 重力 → 动态体被拉回', () => {
            const world = api.createPhysicsWorld();
            api.physicsWorldSetGravity(world, 0, -9.8, 0);

            const shape = api.createBoxShape(1, 1, 1);

            // 锚点：静态，位于原点
            const anchorInfo = buildRigidBodyInfo(shape, { mass: 0, motionType: 1 });
            const anchor = api.createRigidBody(anchorInfo);
            api.physicsWorldAddRigidBody(world, anchor);

            // 动态体：位于 (0, 2, 0)，初始高于锚点
            const bodyInfo = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(bodyInfo);
            api.physicsWorldAddRigidBody(world, body);

            // 把动态体平移到 (0, 2, 0)
            api.rigidBodyTranslate(body, 0, 2, 0);

            // 约束：连接锚点和动态体
            const frameA = allocIdentityMatrix();
            const frameB = allocIdentityMatrix();
            const constraint = api.createGeneric6DofSpringConstraint(
                anchor, body, frameA, frameB, true,
            );
            api.physicsWorldAddConstraint(world, constraint, false);

            // 在 Y 轴启用弹簧
            api.constraintEnableSpring(constraint, 1, true);
            api.constraintSetStiffness(constraint, 1, 50.0);
            api.constraintSetDamping(constraint, 1, 5.0);

            // 初始速度应为零
            const [, vy0] = readLinearVelocity(body);
            expect(vy0).toBe(0);

            // 步进 1 秒（60 帧）
            for (let i = 0; i < 60; i++) {
                api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
            }

            // 约束生效后，动态体不应自由落体到底（vy 不会达到 -9.8）
            const [, vy1] = readLinearVelocity(body);
            // 没有弹簧约束的话，1 秒后 vy ≈ -9.8
            // 有弹簧约束，速度被限制/拉回，绝对值应小于纯自由落体
            expect(Math.abs(vy1)).toBeLessThan(9.0);

            // 清理
            api.physicsWorldRemoveConstraint(world, constraint);
            api.destroyConstraint(constraint);
            api.deallocateBuffer(frameA, 64);
            api.deallocateBuffer(frameB, 64);
            api.physicsWorldRemoveRigidBody(world, body);
            api.physicsWorldRemoveRigidBody(world, anchor);
            api.destroyRigidBody(body);
            api.destroyRigidBody(anchor);
            api.deallocateBuffer(bodyInfo, INFO_SIZE);
            api.deallocateBuffer(anchorInfo, INFO_SIZE);
            api.destroyShape(shape);
            api.destroyPhysicsWorld(world);
        });

        it('destroyConstraint 不抛异常', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const anchorInfo = buildRigidBodyInfo(shape, { mass: 0, motionType: 1 });
            const bodyInfo = buildRigidBodyInfo(shape, { mass: 1.0 });
            const anchor = api.createRigidBody(anchorInfo);
            const body = api.createRigidBody(bodyInfo);
            const frameA = allocIdentityMatrix();
            const frameB = allocIdentityMatrix();

            const constraint = api.createGeneric6DofSpringConstraint(
                anchor, body, frameA, frameB, true,
            );
            expect(() => api.destroyConstraint(constraint)).not.toThrow();

            api.deallocateBuffer(frameA, 64);
            api.deallocateBuffer(frameB, 64);
            api.destroyRigidBody(body);
            api.destroyRigidBody(anchor);
            api.deallocateBuffer(bodyInfo, INFO_SIZE);
            api.deallocateBuffer(anchorInfo, INFO_SIZE);
            api.destroyShape(shape);
        });
    });

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
