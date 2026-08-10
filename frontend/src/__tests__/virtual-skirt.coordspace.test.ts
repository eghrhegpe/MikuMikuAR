// @vitest-environment node
// virtual-skirt.coordspace.test.ts — P1 坐标空间一致性（ADR-084，拆自 virtual-skirt.test.ts §P1 坐标空间一致性）
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
    Matrix,
} from './virtual-skirt-helpers';

describe('VirtualSkirtController — P1 坐标空间一致性', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('骨节初始位置在世界空间（含 mesh 平移），而非局部原点', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const waistMatrix = new Float32Array(16); // 全零 → 腰骨世界位 (0,0,0)
        const model = makeModel(
            mesh,
            [{ name: 'Waist', worldMatrix: waistMatrix }],
            true,
            Matrix.Translation(10, 0, 0) // mesh 整体平移 +10
        );
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();
        expect(ok).toBe(true);

        // 所有骨节 transform 的 x 应被 mesh 平移 +10 推到 [9,11]（局部 x∈[-1,1]）
        const segTransforms = hoisted.initialTransforms.filter((t) => t[0] > 5);
        expect(segTransforms.length).toBe(ctrl.segmentCount);
        // 锚定体在世界原点附近（腰骨世界位 (0,0,0)），其 x 不被 mesh 平移影响：
        // 验证锚定体（世界）与骨节（世界）处于同一坐标系
        const anchorTransforms = hoisted.initialTransforms.filter((t) => t[0] <= 5);
        expect(anchorTransforms.length).toBe(1);
        expect(anchorTransforms[0][0]).toBeCloseTo(0, 5);
        expect(anchorTransforms[0][1]).toBeCloseTo(0, 5);
        expect(anchorTransforms[0][2]).toBeCloseTo(0, 5);
    });

    it('每帧写回在平移 mesh 下不抛错，且顶点 Buffer 被更新', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const waistMatrix = new Float32Array(16);
        waistMatrix[0] = 1;
        waistMatrix[5] = 1;
        waistMatrix[10] = 1;
        waistMatrix[15] = 1;
        const model = makeModel(
            mesh,
            [{ name: 'Waist', worldMatrix: waistMatrix }],
            true,
            Matrix.Translation(3, 0, -2)
        );
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene, getCb } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        ctrl.build();
        expect(() => getCb()()).not.toThrow();

        const meshAny = model.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshAny.updateVerticesData).toHaveBeenCalled();
    });
});
