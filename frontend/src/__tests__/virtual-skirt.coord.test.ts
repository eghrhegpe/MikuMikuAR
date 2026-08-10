// @vitest-environment node
// virtual-skirt.coord.test.ts — 坐标转换纯函数（ADR-084 P1，拆自 virtual-skirt.test.ts §坐标转换纯函数）
import { describe, it, expect, vi } from 'vitest';
import {
    mockMmdWasmPhysicsRuntimeImpl,
    mockBackend,
    mockRigidBody,
    mockRigidBodyConstructionInfo,
    mockConstraint,
    mockPhysicsShape,
    mockMotionType,
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

import { localToWorld, worldDeltaToLocal } from '../scene/physics/virtual-skirt';
import { Matrix, Vector3 } from './virtual-skirt-helpers';

describe('坐标转换纯函数 (P1)', () => {
    it('localToWorld: 含平移的 mesh 世界矩阵 → 世界坐标', () => {
        const world = Matrix.Translation(10, 0, 0);
        const out = localToWorld(new Vector3(1, 2, 3), world, new Vector3());
        expect(out.x).toBeCloseTo(11, 5);
        expect(out.y).toBeCloseTo(2, 5);
        expect(out.z).toBeCloseTo(3, 5);
    });

    it('worldDeltaToLocal: 旋转矩阵逆 → 还原位移方向', () => {
        const rot = Matrix.RotationY(Math.PI / 2);
        const inv = rot.clone();
        inv.invert();
        const v = new Vector3(1, 2, 3);
        const world = localToWorld(v, rot, new Vector3()); // = rot * v（平移为 0）
        const back = worldDeltaToLocal(world, inv, new Vector3());
        expect(back.x).toBeCloseTo(v.x, 5);
        expect(back.y).toBeCloseTo(v.y, 5);
        expect(back.z).toBeCloseTo(v.z, 5);
    });

    it('worldDeltaToLocal: 纯平移 mesh → 位移方向不变（平移被忽略）', () => {
        const inv = Matrix.Translation(10, 0, 0);
        inv.invert(); // 仅平移 (-10,0,0)
        const d = worldDeltaToLocal(new Vector3(5, 6, 7), inv, new Vector3());
        expect(d.x).toBeCloseTo(5, 5);
        expect(d.y).toBeCloseTo(6, 5);
        expect(d.z).toBeCloseTo(7, 5);
    });

    it('端到端: 平移 mesh 下，写回局部偏移不含模型平移（裙摆随模型移动不漂移）', () => {
        // 局部 rest (1,0,0)，mesh 平移 (10,0,0)；物理使骨节世界位 = (10.5,0,0)（仅 +0.5 偏差）
        // 期望局部偏移 = -0.5（模型平移 +10 被抵消，仅保留物理偏差）
        const world = Matrix.Translation(10, 0, 0);
        const inv = world.clone();
        inv.invert();
        const worldRest = localToWorld(new Vector3(1, 0, 0), world, new Vector3()); // (11,0,0)
        const worldCurrent = new Vector3(10.5, 0, 0);
        const worldDelta = worldCurrent.subtract(worldRest); // (-0.5,0,0)
        const localSway = worldDeltaToLocal(worldDelta, inv, new Vector3()); // (-0.5,0,0)
        expect(localSway.x).toBeCloseTo(-0.5, 5);
    });
});
