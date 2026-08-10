// @vitest-environment node
// virtual-skirt.quality.test.ts — Phase 5 性能/LOD/降频（ADR-084，拆自 virtual-skirt.test.ts §Phase 5）
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
} from './virtual-skirt-helpers';

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
