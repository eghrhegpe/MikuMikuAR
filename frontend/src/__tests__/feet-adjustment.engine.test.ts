// @vitest-environment node
// [round-12 P1] feet-adjustment 引擎本体单测 —
// 覆盖 startFeetAdjustment/_adjustFoot/IK 重解（JS+WASM 分支）/落地事件接线/手动覆盖跳过。
// 此前仅 solveFootTarget 纯数学有测试，引擎本体零直接测试。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { FeetState } from '@/core/types';
import {
    startFeetAdjustment,
    stopFeetAdjustment,
    setOnFootLand,
    isFeetAdjustmentRunning,
} from '@/scene/motion/feet-adjustment';
import { getMotionPipeline } from '@/scene/motion/motion-pipeline';

const {
    getGroundHeightAt,
    getWasmIkResolver,
    getOverride,
    getModuleState,
    isWasmRuntime,
    feetDebug,
} = vi.hoisted(() => ({
    getGroundHeightAt: vi.fn(() => 0),
    getWasmIkResolver: vi.fn(() => null),
    getOverride: vi.fn(() => null),
    getModuleState: vi.fn(() => undefined),
    isWasmRuntime: vi.fn(() => false),
    feetDebug: { value: false },
}));

vi.mock('@/scene/env/env-impl', () => ({ getGroundHeightAt }));
vi.mock('@/scene/motion/bone-override', () => ({ getWasmIkResolver, getOverride }));
vi.mock('@/scene/motion/motion-modules/registry', () => ({ getModuleState }));
vi.mock('@/scene/motion/perception-shared', () => ({ isWasmRuntime, feetDebug }));

interface FakeBone {
    name: string;
    parentBone: FakeBone | null;
    world: Vector3;
    ikSolver?: { solve: ReturnType<typeof vi.fn> };
    ikSolverIndex?: number;
    getWorldTranslationToRef(ref: Vector3): void;
    setWorldTranslation(v: Vector3): void;
}

function makeBone(name: string, y: number, parent: FakeBone | null = null): FakeBone {
    return {
        name,
        parentBone: parent,
        world: new Vector3(0, y, 0),
        getWorldTranslationToRef(ref: Vector3) {
            ref.copyFrom(this.world);
        },
        setWorldTranslation(v: Vector3) {
            this.world.copyFrom(v);
        },
    };
}

function makeModel(opts: { lY?: number; rY?: number; solver?: { solve: ReturnType<typeof vi.fn> } } = {}) {
    const center = makeBone('センター', 0);
    const lIk = makeBone('左足IK', opts.lY ?? -0.2, center);
    const rIk = makeBone('右足IK', opts.rY ?? -0.2, center);
    if (opts.solver) {
        lIk.ikSolver = opts.solver;
        rIk.ikSolver = opts.solver;
    }
    return {
        id: 'm1',
        feet: {
            enabled: true,
            intensity: 1,
            soleHeight: 0,
            jumpThreshold: 0.5,
            bodySmooth: 0.5,
            footSmooth: 0.5,
            maxAngle: 30,
            reachAngle: 15,
        },
        runtimeBones: [center, lIk, rIk],
    };
}

function runFrame(): void {
    getMotionPipeline().runFrame({ scene: {} as never });
}

/** 把 FakeBone 模型 cast 成 FeetModelProvider 元素类型（FakeBone 是 IMmdRuntimeBone 子集） */
function startFor(model: ReturnType<typeof makeModel>): void {
    startFeetAdjustment(() => [
        model as unknown as { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] },
    ]);
}

beforeEach(() => {
    vi.clearAllMocks();
    getGroundHeightAt.mockReturnValue(0);
    getModuleState.mockReturnValue(undefined);
    getOverride.mockReturnValue(null);
    isWasmRuntime.mockReturnValue(false);
});

afterEach(() => {
    stopFeetAdjustment();
    setOnFootLand(null);
});

describe('startFeetAdjustment / stopFeetAdjustment 生命周期', () => {
    it('start 注册管线层，stop 注销并清空缓存', () => {
        startFeetAdjustment(() => []);
        expect(isFeetAdjustmentRunning()).toBe(true);
        expect(getMotionPipeline().size).toBe(1);
        stopFeetAdjustment();
        expect(isFeetAdjustmentRunning()).toBe(false);
        expect(getMotionPipeline().size).toBe(0);
    });

    it('重复 start 幂等（不重复注册）', () => {
        startFeetAdjustment(() => []);
        startFeetAdjustment(() => []);
        expect(getMotionPipeline().size).toBe(1);
    });
});

describe('_adjustFoot 引擎（JS 模式）', () => {
    it('脚低于地面时上推到地面，并调用 ikSolver.solve 重解左右腿 IK', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        startFor(model);
        runFrame();
        // 左右足 IK 世界 Y 被上推到地面 0
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(0);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });

    it('脚高于跳跃阈值时跳过（不写 IK、不重解）', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: 2, rY: 2, solver });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(2);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('用户手动覆盖（模块参数非零）时跳过自动贴地', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        getModuleState.mockReturnValue({
            params: { pitch: 10, yaw: 0, roll: 0, footPosX: 0, footPosY: 0, footPosZ: 0 },
        });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('IK 目标骨有激活的 bone override 时跳过自动贴地', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        getOverride.mockReturnValue({ enabled: true });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });
});

describe('_adjustFoot 引擎（WASM 模式）', () => {
    it('经 mmdModelSolveIk resolver 重解原生 IK 链', () => {
        isWasmRuntime.mockReturnValue(true);
        const resolver = vi.fn();
        getWasmIkResolver.mockReturnValue(resolver);
        const model = makeModel({ lY: -0.2, rY: -0.2 });
        model.runtimeBones[1].ikSolverIndex = 0;
        model.runtimeBones[2].ikSolverIndex = 1;
        startFor(model);
        runFrame();
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(resolver).toHaveBeenCalledWith('m1', 0, false);
        expect(resolver).toHaveBeenCalledWith('m1', 1, false);
    });
});

describe('落地事件接线（ADR-088）', () => {
    it('脚贴地上升沿触发 onFootLand，携带模型/脚/地面信息', () => {
        const landed = vi.fn();
        setOnFootLand(landed);
        const model = makeModel({ lY: -0.2, rY: -0.2 });
        startFor(model);
        runFrame();
        expect(landed).toHaveBeenCalled();
        const e = landed.mock.calls[0][0];
        expect(e.modelId).toBe('m1');
        expect(e.foot).toBe('L');
        expect(e.groundY).toBe(0);
        expect(e.impactSpeed).toBeGreaterThan(0);
    });
});