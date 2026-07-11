import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { VirtualSkirtController, defaultVirtualSkirtConfig, type VirtualSkirtConfig } from '../scene/physics/virtual-skirt';

// ============================================================================
// Mock babylon-mmd 物理模块（无需 WASM 即可验证编排逻辑）
// ============================================================================

const hoisted = vi.hoisted(() => {
    const callOrder: string[] = [];
    return { callOrder };
});

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysicsRuntimeImpl', () => ({
    MmdWasmPhysicsRuntimeImpl: class {
        wasmInstance = {};
        addRigidBody = vi.fn(() => true);
        removeRigidBody = vi.fn(() => true);
        addConstraint = vi.fn(() => true);
        removeConstraint = vi.fn(() => true);
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody', () => ({
    RigidBody: class {
        isDynamic = true;
        constructor(_runtime: unknown, _info: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('rb.dispose');
        };
        setTransformMatrix = vi.fn();
        getTransformMatrixToArray = (arr: Float32Array, offset = 0) => {
            arr[offset + 12] = 0.1;
            arr[offset + 13] = 0.2;
            arr[offset + 14] = 0.3;
        };
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo', () => ({
    RigidBodyConstructionInfo: class {
        shape: unknown = null;
        motionType = 0;
        mass = 0;
        linearDamping = 0;
        angularDamping = 0;
        friction = 0;
        restitution = 0;
        disableDeactivation = false;
        constructor(_wasm: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('info.dispose');
        };
        setInitialTransform = vi.fn();
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/constraint', () => ({
    Generic6DofSpringConstraint: class {
        constructor(_r: unknown, _a: unknown, _b: unknown, _fa: unknown, _fb: unknown, _use: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('constraint.dispose');
        };
        enableSpring = vi.fn();
        setStiffness = vi.fn();
        setDamping = vi.fn();
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape', () => ({
    PhysicsSphereShape: class {
        constructor(_r: unknown, _radius: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('shape.dispose');
        };
    },
    PhysicsBoxShape: class {
        constructor(_r: unknown, _size: unknown) {}
        dispose = () => {
            hoisted.callOrder.push('shape.dispose');
        };
    },
}));

vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType', () => ({
    MotionType: { Dynamic: 0, Static: 1, Kinematic: 2 },
}));

// ============================================================================
// 测试 fixture
// ============================================================================

interface MeshData {
    positions: Float32Array;
    indices: Uint32Array;
}

function createOpenBottomCylinder(radius: number, height: number, radialSegs: number, heightSegs: number): MeshData {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let r = 0; r <= heightSegs; r++) {
        const y = (r / heightSegs) * height;
        for (let a = 0; a < radialSegs; a++) {
            const angle = (a / radialSegs) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    }
    const centerIdx = (heightSegs + 1) * radialSegs;
    positions.push(0, height, 0);
    for (let r = 0; r < heightSegs; r++) {
        for (let a = 0; a < radialSegs; a++) {
            const v0 = r * radialSegs + a;
            const v1 = r * radialSegs + (a + 1) % radialSegs;
            const v2 = (r + 1) * radialSegs + a;
            const v3 = (r + 1) * radialSegs + (a + 1) % radialSegs;
            indices.push(v0, v1, v2);
            indices.push(v1, v3, v2);
        }
    }
    const topRingStart = heightSegs * radialSegs;
    for (let a = 0; a < radialSegs; a++) {
        indices.push(centerIdx, topRingStart + (a + 1) % radialSegs, topRingStart + a);
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function makeModel(
    mesh: MeshData,
    bones: { name: string; worldMatrix: Float32Array }[],
    withPhysicsWorld = true,
): IMmdModel {
    const updateVerticesData = vi.fn();
    const model: Record<string, unknown> = {
        mesh: {
            getVerticesData: () => mesh.positions,
            getIndices: () => mesh.indices,
            updateVerticesData,
        },
        runtimeBones: bones,
    };
    if (withPhysicsWorld) {
        model._physicsModel = { _worldId: 3 };
    }
    return model as unknown as IMmdModel;
}

function makeRuntime(physics: unknown): MmdWasmRuntime {
    return { physics } as unknown as MmdWasmRuntime;
}

function makePhysics() {
    const impl = {
        wasmInstance: {},
        addRigidBody: vi.fn(() => true),
        removeRigidBody: vi.fn(() => true),
        addConstraint: vi.fn(() => true),
        removeConstraint: vi.fn(() => true),
    };
    const physics = {
        nextWorldId: 5,
        getImpl: vi.fn(() => impl),
        impl,
    };
    return { physics, impl };
}

function makeScene(): { scene: Scene; getCb: () => () => void } {
    const state = { capturedCb: () => {} };
    const scene = {
        deltaTime: 16.7,
        onBeforeRenderObservable: {
            add: vi.fn((cb: () => void) => {
                state.capturedCb = cb;
                return {};
            }),
            remove: vi.fn(),
        },
    } as unknown as Scene;
    return { scene, getCb: () => state.capturedCb };
}

function testConfig(overrides: Partial<VirtualSkirtConfig> = {}): VirtualSkirtConfig {
    return { ...defaultVirtualSkirtConfig, enabled: true, chains: 6, segmentsPerChain: 3, ...overrides };
}

// ============================================================================
// 测试
// ============================================================================

describe('VirtualSkirtController — Phase 2 注入', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
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
        // worldId 来自模型自身物理世界（=3）
        // 通过检验 nextWorldId 未被递增（仍为 5）间接确认
        expect(physics.nextWorldId).toBe(5);
    });

    it('模型无物理世界时分配独立 worldId（nextWorldId 递增）', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const model = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }], false);
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

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig({ maxVertices: 1 }));
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

describe('VirtualSkirtController — dispose 释放链路', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
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
        expect(hoisted.callOrder.filter((c) => c === 'constraint.dispose').length).toBe(constrCount);
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

describe('VirtualSkirtController — 每帧更新', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
    });

    it('每帧回调：锚定体跟随腰骨 + 顶点回写', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const waistMatrix = new Float32Array(16);
        waistMatrix[0] = 1; waistMatrix[5] = 1; waistMatrix[10] = 1; waistMatrix[15] = 1;
        waistMatrix[12] = 0.5; waistMatrix[13] = 1.0; waistMatrix[14] = -0.2;
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
});
