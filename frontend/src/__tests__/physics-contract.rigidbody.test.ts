// @vitest-environment node
/**
 * [doc:adr-204] physics-contract.test.ts 拆分：刚体端到端 + RigidBodyBundle 批量刚体
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
const buildRigidBodyInfo = (
    shapePtr: number,
    overrides?: Parameters<typeof _buildRigidBodyInfo>[2]
) => _buildRigidBodyInfo(phys, shapePtr, overrides);
const readLinearVelocity = (bodyPtr: number) => _readLinearVelocity(phys, bodyPtr);

/**
 * 通用 Vec3 读取器：分配 12 字节 out 缓冲，调用 getter 写入，读取 3 个 float 后释放。
 * 覆盖角速度/总力/总力矩/冲量速度/局部惯量等「out 指针」型 getter，与 helper 中
 * readLinearVelocity 的释放惯例一致（try/finally）。
 */
const readVec3 = (getter: (outPtr: number) => void): [number, number, number] => {
    const outPtr = api.allocateBuffer(12);
    try {
        getter(outPtr);
        const view = new Float32Array(memory.buffer, outPtr, 3);
        return [view[0], view[1], view[2]];
    } finally {
        api.deallocateBuffer(outPtr, 12);
    }
};

describe('WASM 物理契约测试', () => {
    describe('6. 刚体物理 — 端到端验证', () => {
        it('创建刚体 → 施力 → 步进 → 速度非零（物理真的在动）', () => {
            const world = api.createPhysicsWorld();
            // 资源声明提升到 try 外：finally 需引用（try 内 const 块级不可见）
            let shape: number, infoPtr: number, body: number;
            try {
                // 2. 创建形状
                shape = api.createBoxShape(1, 1, 1);

                // 3. 构造刚体信息
                infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });

                // 4. 创建刚体
                body = api.createRigidBody(infoPtr);
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
            } finally {
                // 清理（断言失败也执行，避免 WASM 指针泄漏）；空值守卫防 try 中途抛错
                if (body !== undefined) api.physicsWorldRemoveRigidBody(world, body);
                if (body !== undefined) api.destroyRigidBody(body);
                if (infoPtr !== undefined) api.deallocateBuffer(infoPtr, INFO_SIZE);
                if (shape !== undefined) api.destroyShape(shape);
                api.destroyPhysicsWorld(world);
            }
        });

        it('重力影响：无外力情况下刚体在重力作用下下落', () => {
            const world = api.createPhysicsWorld();
            let shape: number, infoPtr: number, body: number;
            try {
                api.physicsWorldSetGravity(world, 0, -9.8, 0);

                shape = api.createBoxShape(1, 1, 1);
                infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
                body = api.createRigidBody(infoPtr);
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
            } finally {
                // 清理（断言失败也执行，避免 WASM 指针泄漏）；空值守卫防 try 中途抛错
                if (body !== undefined) api.physicsWorldRemoveRigidBody(world, body);
                if (body !== undefined) api.destroyRigidBody(body);
                if (infoPtr !== undefined) api.deallocateBuffer(infoPtr, INFO_SIZE);
                if (shape !== undefined) api.destroyShape(shape);
                api.destroyPhysicsWorld(world);
            }
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

        it('rigidBodySetDamping 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetDamping(body, 0.3, 0.7);
            expect(api.rigidBodyGetLinearDamping(body)).toBeCloseTo(0.3, 4);
            expect(api.rigidBodyGetAngularDamping(body)).toBeCloseTo(0.7, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodySetMassProps 更新质量与局部惯量', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetMassProps(body, 5.0, 1, 2, 3);
            expect(api.rigidBodyGetMass(body)).toBeCloseTo(5.0, 1);
            const [ix, iy, iz] = readVec3((p) => api.rigidBodyGetLocalInertia(body, p));
            expect(ix).toBeCloseTo(1, 4);
            expect(iy).toBeCloseTo(2, 4);
            expect(iz).toBeCloseTo(3, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodySetAngularVelocity / rigidBodyGetAngularVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetAngularVelocity(body, 1, 2, 3);
            const [wx, wy, wz] = readVec3((p) => api.rigidBodyGetAngularVelocity(body, p));
            expect(wx).toBeCloseTo(1, 4);
            expect(wy).toBeCloseTo(2, 4);
            expect(wz).toBeCloseTo(3, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyApplyCentralImpulse 立即改变线速度（Δv = I/m）', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);

            // 冲量 I = m·Δv；m=1，I=(0,10,0) → Δv_y = 10（对 body 直接生效，无需步进）
            api.rigidBodyApplyCentralImpulse(body, 0, 10, 0);
            const [, vy] = readLinearVelocity(body);
            expect(vy).toBeGreaterThan(5);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyApplyTorqueImpulse 立即改变角速度', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodyApplyTorqueImpulse(body, 0, 0, 5);
            const [, , wz] = readVec3((p) => api.rigidBodyGetAngularVelocity(body, p));
            expect(wz).not.toBe(0);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodySetPushVelocity / rigidBodyGetPushVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetPushVelocity(body, 4, 5, 6);
            const [pvx, pvy, pvz] = readVec3((p) => api.rigidBodyGetPushVelocity(body, p));
            expect(pvx).toBeCloseTo(4, 4);
            expect(pvy).toBeCloseTo(5, 4);
            expect(pvz).toBeCloseTo(6, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodySetTurnVelocity / rigidBodyGetTurnVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0 });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodySetTurnVelocity(body, -1, -2, -3);
            const [tvx, tvy, tvz] = readVec3((p) => api.rigidBodyGetTurnVelocity(body, p));
            expect(tvx).toBeCloseTo(-1, 4);
            expect(tvy).toBeCloseTo(-2, 4);
            expect(tvz).toBeCloseTo(-3, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyTranslate 更新世界变换指针（平移 Y=5）', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);

            const tfPtr = api.rigidBodyGetWorldTransformPtr(body);
            expect(tfPtr).toBeGreaterThan(0);

            api.rigidBodyTranslate(body, 0, 5, 0);
            const tf = new Float32Array(memory.buffer, tfPtr, 16);
            expect(tf[12]).toBeCloseTo(0, 4);
            expect(tf[13]).toBeCloseTo(5, 4);
            expect(tf[14]).toBeCloseTo(0, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyGetMotionStatePtr 返回非零（wrapper 依赖）', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);

            expect(api.rigidBodyGetMotionStatePtr(body)).toBeGreaterThan(0);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyClearForces 清零累积总力', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
            const body = api.createRigidBody(infoPtr);

            api.rigidBodyApplyCentralForce(body, 0, 100, 0);
            const [, fyBefore] = readVec3((p) => api.rigidBodyGetTotalForce(body, p));
            expect(fyBefore).toBeGreaterThan(0);

            api.rigidBodyClearForces(body);
            const [, fyAfter] = readVec3((p) => api.rigidBodyGetTotalForce(body, p));
            expect(fyAfter).toBeCloseTo(0, 4);

            api.destroyRigidBody(body);
            api.deallocateBuffer(infoPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('rigidBodyApplyTorque 经步进累积出角速度（世界内）', () => {
            const world = api.createPhysicsWorld();
            let shape: number, infoPtr: number, body: number;
            try {
                api.physicsWorldSetGravity(world, 0, 0, 0);
                shape = api.createBoxShape(1, 1, 1);
                infoPtr = buildRigidBodyInfo(shape, { mass: 1.0, disableDeactivation: true });
                body = api.createRigidBody(infoPtr);
                api.physicsWorldAddRigidBody(world, body);

                api.rigidBodyApplyTorque(body, 0, 0, 5);
                for (let i = 0; i < 60; i++) {
                    api.physicsWorldStepSimulation(world, 1 / 60, 1, 1 / 60);
                }

                const [, , wz] = readVec3((p) => api.rigidBodyGetAngularVelocity(body, p));
                expect(wz).not.toBe(0);
            } finally {
                // 清理（断言失败也执行，避免 WASM 指针泄漏）；空值守卫防 try 中途抛错
                if (body !== undefined) api.physicsWorldRemoveRigidBody(world, body);
                if (body !== undefined) api.destroyRigidBody(body);
                if (infoPtr !== undefined) api.deallocateBuffer(infoPtr, INFO_SIZE);
                if (shape !== undefined) api.destroyShape(shape);
                api.destroyPhysicsWorld(world);
            }
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
            // 资源声明提升到 try 外：finally 需引用（try 内 const 块级不可见）
            let shape: number, listPtr: number, bundle: number;
            try {
                // 无重力，纯粹看风力效果
                api.physicsWorldSetGravity(world, 0, 0, 0);

                shape = api.createBoxShape(1, 1, 1);
                listPtr = buildBundleInfoList(shape, 3, [0.5, 1.0, 2.0]);
                bundle = api.createRigidBodyBundle(listPtr, 3);
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
            } finally {
                // 清理（断言失败也执行，避免 WASM 指针泄漏）；空值守卫防 try 中途抛错
                if (bundle !== undefined) api.physicsWorldRemoveRigidBodyBundle(world, bundle);
                if (bundle !== undefined) api.destroyRigidBodyBundle(bundle);
                if (listPtr !== undefined) api.deallocateBuffer(listPtr, INFO_SIZE * 3);
                if (shape !== undefined) api.destroyShape(shape);
                api.destroyPhysicsWorld(world);
            }
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

        it('bundleSetDamping 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleSetDamping(bundle, 0, 0.3, 0.7);
            expect(api.rigidBodyBundleGetLinearDamping(bundle, 0)).toBeCloseTo(0.3, 4);
            expect(api.rigidBodyBundleGetAngularDamping(bundle, 0)).toBeCloseTo(0.7, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleSetAngularVelocity / bundleGetAngularVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleSetAngularVelocity(bundle, 0, 1, 2, 3);
            const [wx, wy, wz] = readVec3((p) =>
                api.rigidBodyBundleGetAngularVelocity(bundle, 0, p)
            );
            expect(wx).toBeCloseTo(1, 4);
            expect(wy).toBeCloseTo(2, 4);
            expect(wz).toBeCloseTo(3, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleApplyCentralImpulse 立即改变线速度', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1, [1.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleApplyCentralImpulse(bundle, 0, 0, 10, 0);
            const [, vy] = readBundleLinearVelocity(bundle, 0);
            expect(vy).toBeGreaterThan(5);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleSetPushVelocity / bundleGetPushVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleSetPushVelocity(bundle, 0, 4, 5, 6);
            const [pvx, pvy, pvz] = readVec3((p) =>
                api.rigidBodyBundleGetPushVelocity(bundle, 0, p)
            );
            expect(pvx).toBeCloseTo(4, 4);
            expect(pvy).toBeCloseTo(5, 4);
            expect(pvz).toBeCloseTo(6, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleSetTurnVelocity / bundleGetTurnVelocity 往返一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleSetTurnVelocity(bundle, 0, -1, -2, -3);
            const [tvx, tvy, tvz] = readVec3((p) =>
                api.rigidBodyBundleGetTurnVelocity(bundle, 0, p)
            );
            expect(tvx).toBeCloseTo(-1, 4);
            expect(tvy).toBeCloseTo(-2, 4);
            expect(tvz).toBeCloseTo(-3, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleGetLocalInertia 与 setMassProps 的局部惯量一致', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1, [1.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleSetMassProps(bundle, 0, 4.0, 1, 2, 3);
            const [ix, iy, iz] = readVec3((p) =>
                api.rigidBodyBundleGetLocalInertia(bundle, 0, p)
            );
            expect(ix).toBeCloseTo(1, 4);
            expect(iy).toBeCloseTo(2, 4);
            expect(iz).toBeCloseTo(3, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });

        it('bundleClearForces 清零累积总力', () => {
            const shape = api.createBoxShape(1, 1, 1);
            const listPtr = buildBundleInfoList(shape, 1, [1.0]);
            const bundle = api.createRigidBodyBundle(listPtr, 1);

            api.rigidBodyBundleApplyCentralForce(bundle, 0, 0, 50, 0);
            const [, fyBefore] = readVec3((p) =>
                api.rigidBodyBundleGetTotalForce(bundle, 0, p)
            );
            expect(fyBefore).toBeGreaterThan(0);

            api.rigidBodyBundleClearForces(bundle, 0);
            const [, fyAfter] = readVec3((p) =>
                api.rigidBodyBundleGetTotalForce(bundle, 0, p)
            );
            expect(fyAfter).toBeCloseTo(0, 4);

            api.destroyRigidBodyBundle(bundle);
            api.deallocateBuffer(listPtr, INFO_SIZE);
            api.destroyShape(shape);
        });
    });
});
