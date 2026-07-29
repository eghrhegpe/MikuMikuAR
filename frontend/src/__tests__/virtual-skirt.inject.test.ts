// virtual-skirt.inject.test.ts — Phase 2 注入（ADR-084，拆自 virtual-skirt.test.ts §Phase 2 注入）
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    mockMmdWasmPhysicsRuntimeImpl,
    mockBackend,
    mockRigidBody,
    mockRigidBodyConstructionInfo,
    mockConstraint,
    mockPhysicsShape,
    mockMotionType,
    resetHoisted,
} from './virtual-skirt-mocks';

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl', () => mockMmdWasmPhysicsRuntimeImpl());
vi.mock('../../core/backend', () => mockBackend());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody', () => mockRigidBody());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo', () => mockRigidBodyConstructionInfo());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constraint', () => mockConstraint());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape', () => mockPhysicsShape());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType', () => mockMotionType());

import { VirtualSkirtController } from '../scene/physics/virtual-skirt';
import { createOpenBottomCylinder, makeModel, makeRuntime, makePhysics, makeScene, testConfig } from './virtual-skirt-helpers';

describe('VirtualSkirtController — Phase 2 注入', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('build() 成功注入：锚定体 + 每骨节一个刚体 + 每骨节一个约束', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(true);
        // 约束数 = 骨节总数
        expect(ctrl.constraintCount).toBe(ctrl.segmentCount);
        expect(ctrl.segmentCount).toBeGreaterThan(0);
        // addRigidBody: 1 锚定 + N 骨节
        expect(impl.addRigidBody).toHaveBeenCalledTimes(1 + ctrl.segmentCount);
        // addConstraint: N 骨节
        expect(impl.addConstraint).toHaveBeenCalledTimes(ctrl.segmentCount);
        // worldId：P1 改为始终分配专用 world（不与 PMX 刚体同 world）
        // 通过检验 nextWorldId 被递增（5 → 6）确认
        expect(physics.nextWorldId).toBe(6);
    });

    it('模型无物理世界时分配独立 worldId（nextWorldId 递增）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(
            mesh,
            [{ name: 'Waist', worldMatrix: new Float32Array(16) }],
            false
        );
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(true);
        expect(physics.nextWorldId).toBe(6); // 5++ = 6
    });

    it('模型已有裙骨 → build() 返回 false（不注入）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [
            { name: 'Waist', worldMatrix: new Float32Array(16) },
            { name: 'skirt_01', worldMatrix: new Float32Array(16) },
        ]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
        expect(impl.addRigidBody).not.toHaveBeenCalled();
        expect(impl.addConstraint).not.toHaveBeenCalled();
    });

    it('顶点数超过 maxVertices 上限 → build() 返回 false', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(
            model,
            scene,
            runtime,
            testConfig({ maxVertices: 1 })
        );
        const ok = ctrl.build();

        expect(ok).toBe(false);
        expect(impl.addRigidBody).not.toHaveBeenCalled();
    });

    it('物理运行时不可用（physics=null）→ build() 返回 false', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const runtime = makeRuntime(null);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
    });
});
