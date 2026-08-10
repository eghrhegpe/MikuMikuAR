// @vitest-environment node
// virtual-skirt.dispose.test.ts — dispose 释放链路（ADR-084，拆自 virtual-skirt.test.ts §dispose 释放链路）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    mockMmdWasmPhysicsRuntimeImpl,
    mockBackend,
    mockRigidBody,
    mockRigidBodyConstructionInfo,
    mockConstraint,
    mockPhysicsShape,
    mockMotionType,
    hoisted,
    resetHoisted,
} from './virtual-skirt-mocks';

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl', () =>
    mockMmdWasmPhysicsRuntimeImpl()
);
vi.mock('../../core/backend', () => mockBackend());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody', () => mockRigidBody());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo', () =>
    mockRigidBodyConstructionInfo()
);
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constraint', () => mockConstraint());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape', () => mockPhysicsShape());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType', () => mockMotionType());

import { VirtualSkirtController } from '../scene/physics/virtual-skirt';
import {
    createOpenBottomCylinder,
    makeModel,
    makeRuntime,
    makePhysics,
    makeScene,
    testConfig,
} from './virtual-skirt-helpers';

describe('VirtualSkirtController — dispose 释放链路', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('dispose 顺序：constraint → rb → info → shape', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        ctrl.build();
        const segCount = ctrl.segmentCount;
        const constrCount = ctrl.constraintCount;

        ctrl.dispose();

        // impl.removeX 调用次数
        expect(impl.removeConstraint).toHaveBeenCalledTimes(constrCount);
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(1 + segCount); // 锚定 + 骨节

        // dispose 调用顺序
        const firstConstraint = hoisted.callOrder.indexOf('constraint.dispose');
        const firstRb = hoisted.callOrder.indexOf('rb.dispose');
        const firstInfo = hoisted.callOrder.indexOf('info.dispose');
        const firstShape = hoisted.callOrder.indexOf('shape.dispose');

        expect(firstConstraint).toBeGreaterThanOrEqual(0);
        expect(firstRb).toBeGreaterThan(firstConstraint);
        expect(firstInfo).toBeGreaterThan(firstRb);
        expect(firstShape).toBeGreaterThan(firstInfo);

        // 每个约束/刚体/构造信息/形状都各 dispose 一次
        expect(hoisted.callOrder.filter((c) => c === 'constraint.dispose').length).toBe(
            constrCount
        );
        expect(hoisted.callOrder.filter((c) => c === 'rb.dispose').length).toBe(1 + segCount);
        expect(hoisted.callOrder.filter((c) => c === 'info.dispose').length).toBe(1 + segCount);
        expect(hoisted.callOrder.filter((c) => c === 'shape.dispose').length).toBe(1 + segCount);
    });

    it('dispose 幂等（重复调用不报错/不重复释放）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        ctrl.build();
        ctrl.dispose();
        const afterFirst = impl.removeConstraint.mock.calls.length;

        ctrl.dispose(); // 第二次

        // 第二次不应再调用 removeConstraint
        expect(impl.removeConstraint.mock.calls.length).toBe(afterFirst);
    });
});
