// @vitest-environment node
/**
 * [doc:adr-204] physics-contract.test.ts 拆分：6DOF Spring 约束（MMD 关节物理基础）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    createMinimalPhysicsImpl,
    buildRigidBodyInfo as _buildRigidBodyInfo,
    readLinearVelocity as _readLinearVelocity,
    PHYSICS_INFO_SIZE,
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
// [audit:round5] 资源释放：本文件用例为「创建→断言→清理」顺序链，断言失败会
// 泄漏单指针——由 vitest worker 进程退出时统一回收，影响可接受；多资源端到端
// 场景（collision-worlds / rigidbody）已用 try/finally + finally 空值守卫防护。
const INFO_SIZE = PHYSICS_INFO_SIZE;
const buildRigidBodyInfo = (
    shapePtr: number,
    overrides?: Parameters<typeof _buildRigidBodyInfo>[2]
) => _buildRigidBodyInfo(phys, shapePtr, overrides);
const readLinearVelocity = (bodyPtr: number) => _readLinearVelocity(phys, bodyPtr);

describe('WASM 物理契约测试', () => {
    describe('8. 6DOF Spring 约束（MMD 关节物理基础）', () => {
        /** 在 WASM 内存中分配一个 4×4 单位矩阵，返回指针 */
        function allocIdentityMatrix(): number {
            const ptr = api.allocateBuffer(64); // 16 floats × 4 bytes
            const m = new Float32Array(memory.buffer, ptr, 16);
            m[0] = 1;
            m[1] = 0;
            m[2] = 0;
            m[3] = 0;
            m[4] = 0;
            m[5] = 1;
            m[6] = 0;
            m[7] = 0;
            m[8] = 0;
            m[9] = 0;
            m[10] = 1;
            m[11] = 0;
            m[12] = 0;
            m[13] = 0;
            m[14] = 0;
            m[15] = 1;
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
                anchor,
                body,
                frameA,
                frameB,
                true
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
                anchor,
                body,
                frameA,
                frameB,
                true
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
                anchor,
                body,
                frameA,
                frameB,
                true
            );

            expect(() => api.constraintSetLinearLowerLimit(constraint, -1, -2, -1)).not.toThrow();
            expect(() => api.constraintSetLinearUpperLimit(constraint, 1, 2, 1)).not.toThrow();
            expect(() =>
                api.constraintSetAngularLowerLimit(constraint, -0.5, -1, -0.5)
            ).not.toThrow();
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
                anchor,
                body,
                frameA,
                frameB,
                true
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
                anchor,
                body,
                frameA,
                frameB,
                true
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
});
