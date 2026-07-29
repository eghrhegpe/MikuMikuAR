// virtual-skirt.waist-cache.test.ts — P3e 腰骨缓存（ADR-084，拆自 virtual-skirt.test.ts §P3e 腰骨缓存）
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

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl', () => mockMmdWasmPhysicsRuntimeImpl());
vi.mock('../../core/backend', () => mockBackend());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody', () => mockRigidBody());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo', () => mockRigidBodyConstructionInfo());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constraint', () => mockConstraint());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape', () => mockPhysicsShape());
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType', () => mockMotionType());

import { VirtualSkirtController } from '../scene/physics/virtual-skirt';
import { createOpenBottomCylinder, makeModel, makeRuntime, makePhysics, makeScene, testConfig } from './virtual-skirt-helpers';

describe('VirtualSkirtController — P3e 腰骨缓存', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('build 后缓存腰骨, runtimeBones 被清空仍跟随（不每帧重查）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const waistMatrix = new Float32Array(16);
        waistMatrix[0] = 1;
        waistMatrix[5] = 1;
        waistMatrix[10] = 1;
        waistMatrix[15] = 1;
        waistMatrix[12] = 0.5;
        waistMatrix[13] = 1.0;
        waistMatrix[14] = -0.2;
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: waistMatrix }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene, getCb } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        ctrl.build();

        // 模拟运行时骨骼表被清空（如模型重载），但缓存仍持有原腰骨引用
        (model as unknown as { runtimeBones: unknown[] }).runtimeBones = [];

        hoisted.callOrder.length = 0; // 仅统计本次 _update 的行为
        getCb()();

        // 锚定体仍跟随原腰骨（缓存命中）→ setTransformMatrix 被调用
        expect(hoisted.callOrder).toContain('rb.setTransformMatrix');
    });
});
