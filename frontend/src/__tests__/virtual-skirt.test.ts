import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import type { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import {
    VirtualSkirtController,
    defaultVirtualSkirtConfig,
    resolveVirtualSkirtQuality,
    QUALITY_PRESETS,
    localToWorld,
    worldDeltaToLocal,
    type VirtualSkirtConfig,
} from '../scene/physics/virtual-skirt';

// ============================================================================
// Mock babylon-mmd 物理模块（无需 WASM 即可验证编排逻辑）
// ============================================================================

const hoisted = vi.hoisted(() => {
    const callOrder: string[] = [];
    // P1: 捕获 RigidBodyConstructionInfo.setInitialTransform 传入的平移分量（m[12..14]）
    const initialTransforms: number[][] = [];
    return { callOrder, initialTransforms };
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
        setTransformMatrix = vi.fn(() => {
            hoisted.callOrder.push('rb.setTransformMatrix');
        });
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
        setInitialTransform = (m: { m: number[] }) => {
            hoisted.initialTransforms.push([m.m[12], m.m[13], m.m[14]]);
        };
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
    meshWorldMatrix?: Matrix,
): IMmdModel {
    const updateVerticesData = vi.fn();
    const model: Record<string, unknown> = {
        mesh: {
            getVerticesData: () => mesh.positions,
            getIndices: () => mesh.indices,
            updateVerticesData,
            getWorldMatrix: () => meshWorldMatrix ?? Matrix.Identity(),
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
        hoisted.initialTransforms.length = 0;
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
        hoisted.initialTransforms.length = 0;
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
        hoisted.initialTransforms.length = 0;
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

describe('VirtualSkirtController — Phase 5 性能/LOD/降频', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
        hoisted.initialTransforms.length = 0;
    });

    it('resolveVirtualSkirtQuality: auto 桌面→high / Android→low, 固定档直透', () => {
        expect(resolveVirtualSkirtQuality('auto', false)).toBe('high');
        expect(resolveVirtualSkirtQuality('auto', true)).toBe('low');
        expect(resolveVirtualSkirtQuality('high', false)).toBe('high');
        expect(resolveVirtualSkirtQuality('medium', true)).toBe('medium');
        expect(resolveVirtualSkirtQuality('low', false)).toBe('low');
    });

    it('QUALITY_PRESETS: LOD 上限随档位递减, low 降频最激进', () => {
        expect(QUALITY_PRESETS.high).toEqual({ chainsCap: 32, segmentsCap: 16, throttleEvery: 1, maxVertices: 4000 });
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
            model, scene, runtime, testConfig({ quality: 'low', chains: 32, segmentsPerChain: 16 }),
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
            model, scene, runtime, testConfig({ quality: 'high', chains: 6, segmentsPerChain: 3 }),
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
        const ctrlLow = new VirtualSkirtController(model, sceneLow, runtimeLow, testConfig({ quality: 'low' }));
        expect(ctrlLow.build()).toBe(false);

        const { physics: physicsHigh } = makePhysics();
        const runtimeHigh = makeRuntime(physicsHigh);
        const { scene: sceneHigh } = makeScene();
        const ctrlHigh = new VirtualSkirtController(model, sceneHigh, runtimeHigh, testConfig({ quality: 'high' }));
        expect(ctrlHigh.build()).toBe(true);
    });

    it('降频: low(throttle=3) 每 6 帧写回 2 次, high(throttle=1) 写回 6 次', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);

        const modelL = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics: pl } = makePhysics();
        const rl = makeRuntime(pl);
        const { scene: sl, getCb: getCbL } = makeScene();
        const ctrlL = new VirtualSkirtController(modelL, sl, rl, testConfig({ quality: 'low' }));
        ctrlL.build();
        for (let i = 0; i < 6; i++) getCbL()();
        const meshL = modelL.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshL.updateVerticesData.mock.calls.length).toBe(2); // 帧 0, 3

        const modelH = makeModel(mesh, [{ name: 'Waist', worldMatrix: new Float32Array(16) }]);
        const { physics: ph } = makePhysics();
        const rh = makeRuntime(ph);
        const { scene: sh, getCb: getCbH } = makeScene();
        const ctrlH = new VirtualSkirtController(modelH, sh, rh, testConfig({ quality: 'high' }));
        ctrlH.build();
        for (let i = 0; i < 6; i++) getCbH()();
        const meshH = modelH.mesh as unknown as { updateVerticesData: ReturnType<typeof vi.fn> };
        expect(meshH.updateVerticesData.mock.calls.length).toBe(6);
    });
});

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

describe('VirtualSkirtController — P1 坐标空间一致性', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
        hoisted.initialTransforms.length = 0;
    });

    it('骨节初始位置在世界空间（含 mesh 平移），而非局部原点', () => {
        const mesh = createOpenBottomCylinder(1.0, 2.0, 12, 6);
        const waistMatrix = new Float32Array(16); // 全零 → 腰骨世界位 (0,0,0)
        const model = makeModel(
            mesh,
            [{ name: 'Waist', worldMatrix: waistMatrix }],
            true,
            Matrix.Translation(10, 0, 0), // mesh 整体平移 +10
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
        waistMatrix[0] = 1; waistMatrix[5] = 1; waistMatrix[10] = 1; waistMatrix[15] = 1;
        const model = makeModel(
            mesh,
            [{ name: 'Waist', worldMatrix: waistMatrix }],
            true,
            Matrix.Translation(3, 0, -2),
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

describe('VirtualSkirtController — P3a build 异常清理', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
        hoisted.initialTransforms.length = 0;
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
            if (calls >= 2) throw new Error('boom');
            return true;
        });

        const ctrl = new VirtualSkirtController(model, scene, runtime, testConfig());
        const ok = ctrl.build();

        expect(ok).toBe(false);
        expect(ctrl.segmentCount).toBe(0);
        expect(ctrl.constraintCount).toBe(0);
        // 锚定体（唯一成功加入的刚体）被 remove + dispose，无悬空资源
        expect(impl.removeRigidBody).toHaveBeenCalledTimes(1);
        expect(hoisted.callOrder.filter((c) => c === 'rb.dispose').length).toBe(1);
        expect(hoisted.callOrder.filter((c) => c === 'info.dispose').length).toBe(1);
        expect(hoisted.callOrder.filter((c) => c === 'shape.dispose').length).toBe(1);
        // 清理后再次 build 直接返回 false（已 dispose，避免重复分配）
        expect(ctrl.build()).toBe(false);
    });
});

describe('VirtualSkirtController — P3e 腰骨缓存', () => {
    beforeEach(() => {
        hoisted.callOrder.length = 0;
        hoisted.initialTransforms.length = 0;
    });

    it('build 后缓存腰骨, runtimeBones 被清空仍跟随（不每帧重查）', () => {
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

        // 模拟运行时骨骼表被清空（如模型重载），但缓存仍持有原腰骨引用
        (model as unknown as { runtimeBones: unknown[] }).runtimeBones = [];

        hoisted.callOrder.length = 0; // 仅统计本次 _update 的行为
        getCb()();

        // 锚定体仍跟随原腰骨（缓存命中）→ setTransformMatrix 被调用
        expect(hoisted.callOrder).toContain('rb.setTransformMatrix');
    });
});
