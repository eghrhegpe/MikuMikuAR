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
    linkedBone?: { getSkeleton?: () => { _markAsDirty?: () => void } };
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

function makeModel(
    opts: {
        lY?: number;
        rY?: number;
        solver?: { solve: ReturnType<typeof vi.fn> };
        /** 沿 IK parent 链加大腿骨（左足/右足，y=1.0），触发 _findHip 腿长估算 */
        hips?: boolean;
        /** 自定义骨骼名 [センター, 左足IK, 右足IK]（用于无 IK 骨场景） */
        names?: [string, string, string];
        /** 附加到 IK 骨的 linkedBone（骨架脏标记），验证 JS 模式 _markAsDirty 接线 */
        linkedDirty?: () => void;
    } = {}
) {
    const [cName, lName, rName] = opts.names ?? ['センター', '左足IK', '右足IK'];
    const center = makeBone(cName, 0);
    const hipL = opts.hips ? makeBone('左足', 1.0, center) : null;
    const hipR = opts.hips ? makeBone('右足', 1.0, center) : null;
    const lIk = makeBone(lName, opts.lY ?? -0.2, hipL ?? center);
    const rIk = makeBone(rName, opts.rY ?? -0.2, hipR ?? center);
    if (opts.solver) {
        lIk.ikSolver = opts.solver;
        rIk.ikSolver = opts.solver;
    }
    if (opts.linkedDirty) {
        const dirty = opts.linkedDirty;
        lIk.linkedBone = { getSkeleton: () => ({ _markAsDirty: dirty }) };
        rIk.linkedBone = { getSkeleton: () => ({ _markAsDirty: dirty }) };
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
    getWasmIkResolver.mockReturnValue(null);
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

    it('左右脚各触发一次落地事件', () => {
        const landed = vi.fn();
        setOnFootLand(landed);
        const model = makeModel({ lY: -0.2, rY: -0.2 });
        startFor(model);
        runFrame();
        expect(landed).toHaveBeenCalledTimes(2);
        const feet = landed.mock.calls.map((c) => c[0].foot).sort();
        expect(feet).toEqual(['L', 'R']);
    });

    it('用户手动覆盖时贴地不触发落地事件（事件在覆盖检查之后）', () => {
        const landed = vi.fn();
        setOnFootLand(landed);
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        getModuleState.mockReturnValue({
            params: { pitch: 10, yaw: 0, roll: 0, footPosX: 0, footPosY: 0, footPosZ: 0 },
        });
        startFor(model);
        runFrame();
        expect(landed).not.toHaveBeenCalled();
    });

    it('上升沿：离地→贴地才触发，连续贴地帧不重复', () => {
        const landed = vi.fn();
        setOnFootLand(landed);
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
        try {
            const model = makeModel({ lY: -0.2, rY: -0.2 });
            startFor(model);
            runFrame(); // 首帧贴地 → 首次落地
            expect(landed).toHaveBeenCalledTimes(2);
            landed.mockClear();
            nowSpy.mockReturnValue(1200);
            runFrame(); // 仍贴地 → 无上升沿
            expect(landed).not.toHaveBeenCalled();
            nowSpy.mockReturnValue(1300);
            model.runtimeBones[1].world.y = 2;
            model.runtimeBones[2].world.y = 2;
            runFrame(); // 脚在空中 → skip
            expect(landed).not.toHaveBeenCalled();
            nowSpy.mockReturnValue(1600);
            model.runtimeBones[1].world.y = -0.2;
            model.runtimeBones[2].world.y = -0.2;
            runFrame(); // 新上升沿（距首次 >120ms）→ 再次触发
            expect(landed).toHaveBeenCalledTimes(2);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('去抖：两次落地间隔 <120ms 时第二次不触发', () => {
        const landed = vi.fn();
        setOnFootLand(landed);
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
        try {
            const model = makeModel({ lY: -0.2, rY: -0.2 });
            startFor(model);
            runFrame(); // t=1000 贴地 → 首次落地
            expect(landed).toHaveBeenCalledTimes(2);
            // 脚抬起再落下（50ms 去抖期内）
            nowSpy.mockReturnValue(1030);
            model.runtimeBones[1].world.y = 2;
            model.runtimeBones[2].world.y = 2;
            runFrame(); // skip → grounded=false
            nowSpy.mockReturnValue(1050);
            model.runtimeBones[1].world.y = -0.2;
            model.runtimeBones[2].world.y = -0.2;
            runFrame(); // 上升沿但 50ms < 120ms → 不触发
            expect(landed).toHaveBeenCalledTimes(2);
            // 再抬起、越过去抖窗后落地（距首次 250ms）→ 触发第二次
            nowSpy.mockReturnValue(1200);
            model.runtimeBones[1].world.y = 2;
            model.runtimeBones[2].world.y = 2;
            runFrame();
            nowSpy.mockReturnValue(1250);
            model.runtimeBones[1].world.y = -0.2;
            model.runtimeBones[2].world.y = -0.2;
            runFrame();
            expect(landed).toHaveBeenCalledTimes(4);
        } finally {
            nowSpy.mockRestore();
        }
    });
});

describe('边界与降级路径（反推源码补齐）', () => {
    it('stop 注销后 runFrame 不再调整脚', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0);
        stopFeetAdjustment();
        solver.solve.mockClear();
        model.runtimeBones[1].world.y = -0.2;
        model.runtimeBones[2].world.y = -0.2;
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('模型无 IK 骨（matchBone 未命中）时静默跳过不崩溃', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({
            lY: -0.2,
            rY: -0.2,
            solver,
            names: ['センター', '左足首', '右足首'],
        });
        startFor(model);
        expect(() => runFrame()).not.toThrow();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('JS 模式 ikSolver 缺失时仍写目标 Y 但不崩溃', () => {
        const model = makeModel({ lY: -0.2, rY: -0.2 }); // 无 solver
        startFor(model);
        expect(() => runFrame()).not.toThrow();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(0);
    });

    it('JS 模式重解后调用 linkedBone.getSkeleton()._markAsDirty', () => {
        const solver = { solve: vi.fn() };
        const dirty = vi.fn();
        const model = makeModel({ lY: -0.2, rY: -0.2, solver, linkedDirty: dirty });
        startFor(model);
        runFrame();
        expect(dirty).toHaveBeenCalledTimes(2); // L/R 各一次
    });

    it('feet.enabled=false 时跳过（不清 IK、不重解）', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        model.feet.enabled = false;
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('feet.intensity<=0 时跳过', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        model.feet.intensity = 0;
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(-0.2);
        expect(solver.solve).not.toHaveBeenCalled();
    });

    it('地形地面（groundY 非零）时脚贴到该高度', () => {
        getGroundHeightAt.mockReturnValue(1.5);
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(1.5);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(1.5);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });

    it('params 含 NaN/缺失字段时不被误判为手动覆盖（仍自动贴地）', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        getModuleState.mockReturnValue({
            params: { pitch: NaN, yaw: undefined, roll: 0, footPosX: 0, footPosY: 0, footPosZ: 0 },
        } as never);
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });

    it('maxAngle 钳制单帧下拉量（_findHip 沿 parent 链估算腿长）', () => {
        const solver = { solve: vi.fn() };
        // hips=true：大腿骨 y=1.0，IK 骨动画 y=0.4 → legLength=0.6 → maxDrop=sin(30°)*0.6=0.3
        // 需要下拉 0.4 → 钳到 0.4-0.3=0.1
        const model = makeModel({ lY: 0.4, rY: 0.4, solver, hips: true });
        startFor(model);
        runFrame();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0.1, 5);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(0.1, 5);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });

    it('WASM 模式 ikSolverIndex 缺失时不调用 resolver（不崩溃）', () => {
        isWasmRuntime.mockReturnValue(true);
        const resolver = vi.fn();
        getWasmIkResolver.mockReturnValue(resolver);
        const model = makeModel({ lY: -0.2, rY: -0.2 }); // 无 ikSolverIndex
        startFor(model);
        expect(() => runFrame()).not.toThrow();
        expect(resolver).not.toHaveBeenCalled();
    });

    it('WASM 模式 resolver 缺失时不崩溃（世界 Y 仍写入目标）', () => {
        isWasmRuntime.mockReturnValue(true);
        getWasmIkResolver.mockReturnValue(null);
        const model = makeModel({ lY: -0.2, rY: -0.2 });
        model.runtimeBones[1].ikSolverIndex = 0;
        model.runtimeBones[2].ikSolverIndex = 1;
        startFor(model);
        expect(() => runFrame()).not.toThrow();
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(0);
    });

    it('WASM 模式不调用 _markAsDirty（直写 buffer，无需重算蒙皮）', () => {
        isWasmRuntime.mockReturnValue(true);
        const resolver = vi.fn();
        getWasmIkResolver.mockReturnValue(resolver);
        const dirty = vi.fn();
        const model = makeModel({ lY: -0.2, rY: -0.2, linkedDirty: dirty });
        model.runtimeBones[1].ikSolverIndex = 0;
        model.runtimeBones[2].ikSolverIndex = 1;
        startFor(model);
        runFrame();
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(dirty).not.toHaveBeenCalled();
    });

    it('getGroundHeightAt 携带 IK 骨世界 X/Z 查询地面', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: -0.2, rY: -0.2, solver });
        model.runtimeBones[1].world.x = 3;
        model.runtimeBones[1].world.z = 4;
        model.runtimeBones[2].world.x = -5;
        model.runtimeBones[2].world.z = 6;
        startFor(model);
        runFrame();
        expect(getGroundHeightAt).toHaveBeenCalledWith(3, 4);
        expect(getGroundHeightAt).toHaveBeenCalledWith(-5, 6);
    });

    it('模型抬高（center 世界 Y 非零）时以自然脚高为基准，不硬拽到 groundY', () => {
        const solver = { solve: vi.fn() };
        const model = makeModel({ lY: 0.5, rY: 0.5, solver, hips: true });
        model.runtimeBones[0].world.y = 1.0; // center 抬高
        startFor(model);
        runFrame();
        // centerY=1.0, hip=1.0 → legLength=0.5 → modelGroundY=max(0,1.0-0.5)=0.5
        // foot=0.5, 0.5-0.5=0 不 skip → desiredY=0 → maxDrop=sin30°*0.5=0.25 → target=0.25
        expect(model.runtimeBones[1].world.y).toBeCloseTo(0.25, 5);
        expect(model.runtimeBones[2].world.y).toBeCloseTo(0.25, 5);
    });

    it('_findHip 全量搜索：大腿骨不在 IK parent 链但存在于骨骼列表时仍能定位', () => {
        const solver = { solve: vi.fn() };
        // IK 骨 parent = center（非大腿），大腿骨作为独立根骨存在 → 触发全量搜索路径
        const center = makeBone('センター', 0);
        const hipL = makeBone('左足', 1.0, center);
        const hipR = makeBone('右足', 1.0, center);
        const lIk = makeBone('左足IK', 0.4, center);
        const rIk = makeBone('右足IK', 0.4, center);
        lIk.ikSolver = solver;
        rIk.ikSolver = solver;
        startFor({
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
            runtimeBones: [center, hipL, hipR, lIk, rIk],
        });
        runFrame();
        // legLength=|1.0-0.4|=0.6 → maxDrop=sin30°*0.6=0.3 → target=0.4-0.3=0.1
        expect(lIk.world.y).toBeCloseTo(0.1, 5);
        expect(rIk.world.y).toBeCloseTo(0.1, 5);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });

    it('_findHip 回退：无大腿骨时静默降级（第 3 级父为空）不崩溃仍贴地', () => {
        const solver = { solve: vi.fn() };
        const center = makeBone('センター', 0);
        const grand = makeBone('先祖', 2.0);
        const parent = makeBone('中骨', 1.0, grand);
        const lIk = makeBone('左足IK', 0.4, parent);
        const rIk = makeBone('右足IK', 0.4, parent);
        lIk.ikSolver = solver;
        rIk.ikSolver = solver;
        startFor({
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
            runtimeBones: [center, grand, parent, lIk, rIk],
        });
        expect(() => runFrame()).not.toThrow();
        // 无大腿骨 → legLength=1 默认 → 落到地面 0
        expect(lIk.world.y).toBeCloseTo(0);
        expect(rIk.world.y).toBeCloseTo(0);
        expect(solver.solve).toHaveBeenCalledTimes(2);
    });
});