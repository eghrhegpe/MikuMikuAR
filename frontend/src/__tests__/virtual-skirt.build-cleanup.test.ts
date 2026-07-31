// virtual-skirt.build-cleanup.test.ts — P3a build 异常清理（ADR-084，拆自 virtual-skirt.test.ts §P3a build 异常清理）
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

describe('VirtualSkirtController — P3a build 异常清理', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('注入中途异常 → 部分资源被 dispose 且无泄漏, build 返回 false', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        // 锚定体 addRigidBody 成功（第 1 次），第一个骨节 addRigidBody 抛异常（第 2 次）
        let calls = 0;
        impl.addRigidBody.mockImplementation(() => {
            calls++;
            if (calls >= 2) {
                throw new Error('boom');
            }
            return true;
        });

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
        // 锚定体 + 已 push 的第一个骨节（add 抛异常前已分配）均被 remove + dispose，无悬空资源
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(2);
        expect(hoisted.callOrder.filter((c) => c === 'rb.dispose').length).toBe(2);
        expect(hoisted.callOrder.filter((c) => c === 'info.dispose').length).toBe(2);
        expect(hoisted.callOrder.filter((c) => c === 'shape.dispose').length).toBe(2);
        // 清理后再次 build 直接返回 false（已 dispose，避免重复分配）
        expect(ctrl.build()).toBe(false);
    });

    it('addRigidBody 返回 false（非抛异常）→ build 返回 false 且清理已分配资源', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        // 锚定体 addRigidBody 成功（第 1 次），第一个骨节 addRigidBody 返回 false
        let calls = 0;
        impl.addRigidBody.mockImplementation(() => {
            calls++;
            return calls < 2;
        });

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
        // 锚定体 + 第一个骨节（已 push）被 remove + dispose
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(2);
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
    });
});
