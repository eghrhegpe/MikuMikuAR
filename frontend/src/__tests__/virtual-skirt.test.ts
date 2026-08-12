// virtual-skirt 系列合并（build-cleanup/coord/coordspace/dispose/inject/quality/update/waist-cache 8 文件 → 1）
// [2026-08] 同系列合并以省 isolate 单文件 import 成本（vitest.config 同款先例）。
// 8 文件结构完全同构：全 node 环境 + 相同 7 条 vi.mock（WASM 物理绑定层 + core/backend）+ 
// 共享 virtual-skirt-mocks 工厂 / virtual-skirt-helpers fixture + beforeEach(resetHoisted)，
// 共享样板原在 8 文件重复 8 份，现收敛为一份。各 describe 按原主题分区保留，行为不变。
// 例外：coord 分区为纯函数测试（localToWorld/worldDeltaToLocal），原文件即无
// beforeEach(resetHoisted)，保持原样。
// @vitest-environment node
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

import {
    VirtualSkirtController,
    localToWorld,
    worldDeltaToLocal,
    resolveVirtualSkirtQuality,
    QUALITY_PRESETS,
} from '../scene/physics/virtual-skirt';
import {
    createOpenBottomCylinder,
    makeModel,
    makeRuntime,
    makePhysics,
    makeScene,
    testConfig,
    Matrix,
    Vector3,
} from './virtual-skirt-helpers';

// 封闭立方体 mesh：每条边被 2 个三角形共享，无 boundary edge → analyzer 判定无裙摆
function closedCubeMeshData(): { positions: Float32Array; indices: Uint32Array } {
    const positions = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, // 背面
        -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, // 正面
    ]);
    const indices = new Uint32Array([
        0, 2, 1, 0, 3, 2, // 背面
        4, 5, 6, 4, 6, 7, // 正面
        0, 7, 3, 0, 4, 7, // 左面
        1, 2, 6, 1, 6, 5, // 右面
        0, 5, 1, 0, 4, 5, // 底面
        3, 7, 6, 3, 6, 2, // 顶面
    ]);
    return { positions, indices };
}

// ======== 坐标转换纯函数（原 virtual-skirt.coord.test.ts） ========
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

// ======== P1 坐标空间一致性（原 virtual-skirt.coordspace.test.ts） ========
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

        // setInitialTransform 按 build 顺序：第 1 个为锚定体，其余为链身骨节
        const anchorTransform = hoisted.initialTransforms[0];
        const segTransforms = hoisted.initialTransforms.slice(1);
        expect(segTransforms.length).toBe(ctrl.segmentCount);
        // 锚定体初始位也经 localToWorld：腰骨局部位 (0,0,0) + mesh 平移 (10,0,0) → 世界 (10,0,0)，
        // 与骨节同处世界坐标系（验证锚定体（世界）与骨节（世界）处于同一坐标系）
        expect(anchorTransform[0]).toBeCloseTo(10, 5);
        expect(anchorTransform[1]).toBeCloseTo(0, 5);
        expect(anchorTransform[2]).toBeCloseTo(0, 5);
        // 所有骨节 transform 的 x 应被 mesh 平移 +10 推到 [9,11]（局部 x∈[-1,1]）
        const xs = segTransforms.map((t) => t[0]);
        expect(Math.min(...xs)).toBeGreaterThan(9);
        expect(Math.max(...xs)).toBeLessThan(11);
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

// ======== Phase 2 注入（原 virtual-skirt.inject.test.ts） ========
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

    it('dispose 后重建复用 worldId（nextWorldId 不单调增长）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl1 = new VirtualSkirtController(model, scene, runtime, testConfig());
        expect(ctrl1.build()).toBe(true);
        expect(physics.nextWorldId).toBe(6); // 5 → 6
        ctrl1.dispose();

        // freeList 归还 5，重建时复用，nextWorldId 不再递增
        const ctrl2 = new VirtualSkirtController(model, scene, runtime, testConfig());
        expect(ctrl2.build()).toBe(true);
        expect(physics.nextWorldId).toBe(6);
        ctrl2.dispose();
    });

    it('build 成功后再次 build() 返回 false（防重复注入/资源泄漏）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        expect(ctrl.build()).toBe(true);
        const rbCalls = 1 + ctrl.segmentCount;
        const conCalls = ctrl.segmentCount;

        expect(ctrl.build()).toBe(false);
        // 不重复注入：addRigidBody/addConstraint 次数保持首次注入的计数
        expect(impl.addRigidBody).toHaveBeenCalledTimes(rbCalls);
        expect(impl.addConstraint).toHaveBeenCalledTimes(conCalls);
    });

    it('封闭 mesh（无裙摆边界边）→ build() 返回 false', () => {
        const model = makeModel(
            createOpenBottomCylinder(1.0, 2.0, 12, 6),
            [{ name: 'Waist', worldMatrix: new Float32Array(16) }]
        );
        const cube = closedCubeMeshData();
        const meshAny = model.mesh as unknown as {
            getVerticesData: () => Float32Array;
            getIndices: () => Uint32Array;
        };
        meshAny.getVerticesData = () => cube.positions;
        meshAny.getIndices = () => cube.indices;

        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        expect(ctrl.build()).toBe(false);
        expect(impl.addRigidBody).not.toHaveBeenCalled();
    });
});

// ======== P3a build 异常清理（原 virtual-skirt.build-cleanup.test.ts） ========
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

    it('addConstraint 返回 false → build 返回 false 且清理已注入刚体', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        // 第一个约束 add 即失败（锚定体 + 首个骨节已注入成功）
        impl.addConstraint.mockReturnValue(false);

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
        // 已注入的锚定体 + 首个骨节被 remove；已 push 的约束被 remove + dispose
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(2);
        expect(impl.removeConstraint).toHaveBeenCalledTimes(1);
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
    });

    it('mesh.getWorldMatrix 抛错（mesh 已销毁）→ build() 返回 false 而非向上抛异常', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const meshAny = model.mesh as unknown as { getWorldMatrix: () => Matrix };
        meshAny.getWorldMatrix = () => {
            throw new Error('mesh disposed');
        };

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        expect(() => ctrl.build()).not.toThrow();
        expect(ctrl.build()).toBe(false);
    });
});

// ======== dispose 释放链路（原 virtual-skirt.dispose.test.ts） ========
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

// ======== 每帧更新（原 virtual-skirt.update.test.ts） ========
describe('VirtualSkirtController — 每帧更新', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('每帧回调：锚定体跟随腰骨 + 顶点回写', () => {
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

        // 触发每帧回调
        getCb()();

        // 顶点回写被调用
        const meshAny = model.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshAny.updateVerticesData).toHaveBeenCalled();
        // 锚定体 setTransformMatrix 被调用（跟随腰骨）
        // 通过场景的 onBeforeRenderObservable.add 捕获的回调已执行，无异常
    });

    it('mesh 已销毁（模型卸载）→ 每帧 self-dispose 释放物理资源', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics, impl } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene, getCb } = makeScene();

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        ctrl.build();
        const segCount = ctrl.segmentCount;
        expect(segCount).toBeGreaterThan(0);

        // 模拟 mesh 被外部销毁（模型卸载/切换场景）
        (model.mesh as unknown as { isDisposed: () => boolean }).isDisposed = () => true;

        expect(() => getCb()()).not.toThrow();
        // self-dispose：锚定 + 骨节刚体全部移除，不再悬空回写
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(1 + segCount);
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
    });
});

// ======== P3e 腰骨缓存（原 virtual-skirt.waist-cache.test.ts） ========
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

// ======== Phase 5 性能/LOD/降频（原 virtual-skirt.quality.test.ts） ========
describe('VirtualSkirtController — Phase 5 性能/LOD/降频', () => {
    beforeEach(() => {
        resetHoisted();
    });

    it('resolveVirtualSkirtQuality: auto 桌面→high / Android→low, 固定档直透', () => {
        expect(resolveVirtualSkirtQuality('auto', false)).toBe('high');
        expect(resolveVirtualSkirtQuality('auto', true)).toBe('low');
        expect(resolveVirtualSkirtQuality('high', false)).toBe('high');
        expect(resolveVirtualSkirtQuality('medium', true)).toBe('medium');
        expect(resolveVirtualSkirtQuality('low', false)).toBe('low');
    });

    it('QUALITY_PRESETS: LOD 上限随档位递减, low 降频最激进', () => {
        expect(QUALITY_PRESETS.high).toEqual({
            chainsCap: 32,
            segmentsCap: 16,
            throttleEvery: 1,
            maxVertices: 4000,
        });
        expect(QUALITY_PRESETS.medium.throttleEvery).toBe(2);
        expect(QUALITY_PRESETS.low.throttleEvery).toBe(3);
        expect(QUALITY_PRESETS.low.maxVertices).toBeLessThan(QUALITY_PRESETS.high.maxVertices);
        expect(QUALITY_PRESETS.low.chainsCap).toBeLessThan(QUALITY_PRESETS.high.chainsCap);
        expect(QUALITY_PRESETS.low.segmentsCap).toBeLessThan(QUALITY_PRESETS.high.segmentsCap);
    });

    it('quality=low 时 LOD 生效: 有效链/骨节被上限收紧, 降频=3', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        // 用户选高档参数, 但 quality=low 应强制收紧
        const ctrl = new VirtualSkirtController(
            model,
            scene,
            runtime,
            testConfig({ quality: 'low', chains: 32, segmentsPerChain: 16 })
        );
        const ok = ctrl.build();

        expect(ok).toBe(true);
        expect(ctrl.effectiveQuality).toBe('low');
        expect(ctrl.effectiveChains).toBe(QUALITY_PRESETS.low.chainsCap); // 10
        expect(ctrl.effectiveSegments).toBe(QUALITY_PRESETS.low.segmentsCap); // 6
        expect(ctrl.throttleEvery).toBe(3);
    });

    it('quality=high/auto(桌面) 不额外收紧用户参数, 降频=1', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(
            model,
            scene,
            runtime,
            testConfig({ quality: 'high', chains: 6, segmentsPerChain: 3 })
        );
        const ok = ctrl.build();

        expect(ok).toBe(true);
        expect(ctrl.effectiveQuality).toBe('high');
        expect(ctrl.effectiveChains).toBe(6);
        expect(ctrl.effectiveSegments).toBe(3);
        expect(ctrl.throttleEvery).toBe(1);
    });

    it('顶点数超过质量档位上限 → build() 返回 false (low 上限低于 high)', () => {
        // 约 1641 顶点的裙摆 mesh（高于 low 的 1500 上限, 低于 high 的 4000）
        const mesh = createOpenBottomCylinder(1.0, 2.0, 40, 40);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);

        const { physics: physicsLow } = makePhysics();
        const runtimeLow = makeRuntime(physicsLow);
        const { scene: sceneLow } = makeScene();
        const ctrlLow = new VirtualSkirtController(
            model,
            sceneLow,
            runtimeLow,
            testConfig({ quality: 'low' })
        );
        expect(ctrlLow.build()).toBe(false);

        const { physics: physicsHigh } = makePhysics();
        const runtimeHigh = makeRuntime(physicsHigh);
        const { scene: sceneHigh } = makeScene();
        const ctrlHigh = new VirtualSkirtController(
            model,
            sceneHigh,
            runtimeHigh,
            testConfig({ quality: 'high' })
        );
        expect(ctrlHigh.build()).toBe(true);
    });

    it('build 失败（顶点超限）不残留 LOD 状态: effective* 归零, throttle=默认', () => {
        // 约 1641 顶点 > low 上限 1500 → build 返回 false
        const mesh = createOpenBottomCylinder(1.0, 2.0, 40, 40);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(
            model,
            scene,
            runtime,
            testConfig({ quality: 'low', chains: 32, segmentsPerChain: 16 })
        );
        expect(ctrl.build()).toBe(false);
        // 未构建成功 → 不应残留 'low' 档的 LOD 状态（避免 UI 误判已注入）
        expect(ctrl.effectiveChains).toBe(0);
        expect(ctrl.effectiveSegments).toBe(0);
        // throttle 应回退默认（未生效），而非 low 档的 3
        expect(ctrl.throttleEvery).toBe(1);
    });

    it('build 失败（顶点超限）不残留 analysis 半初始化状态: 再次 build 仍可尝试', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 40, 40);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics } = makePhysics();
        const runtime = makeRuntime(physics);
        const { scene } = makeScene();

        const ctrl = new VirtualSkirtController(
            model,
            scene,
            runtime,
            testConfig({ quality: 'low', chains: 32, segmentsPerChain: 16 })
        );
        expect(ctrl.build()).toBe(false);
        // 失败后 dispose 语义：segmentCount/constraintCount 必须归零（无半初始化刚体）
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
    });

    it('降频: low(throttle=3) 每 6 帧写回 2 次, high(throttle=1) 写回 6 次', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);

        const modelL = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics: pl } = makePhysics();
        const rl = makeRuntime(pl);
        const { scene: sl, getCb: getCbL } = makeScene();
        const ctrlL = new VirtualSkirtController(modelL, sl, rl, testConfig({ quality: 'low' }));
        ctrlL.build();
        for (let i = 0; i < 6; i++) {
            getCbL()();
        }
        const meshL = modelL.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshL.updateVerticesData.mock.calls.length).toBe(2); // 帧 0, 3

        const modelH = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics: ph } = makePhysics();
        const rh = makeRuntime(ph);
        const { scene: sh, getCb: getCbH } = makeScene();
        const ctrlH = new VirtualSkirtController(modelH, sh, rh, testConfig({ quality: 'high' }));
        ctrlH.build();
        for (let i = 0; i < 6; i++) {
            getCbH()();
        }
        const meshH = modelH.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshH.updateVerticesData.mock.calls.length).toBe(6);
    });
});
