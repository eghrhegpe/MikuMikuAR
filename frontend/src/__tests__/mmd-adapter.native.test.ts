/**
 * 验证 applyForceToModelRigidBodiesNative（P2 / ADR-201）的**真实**逻辑：
 *
 * 从 model.ptr 经 fork 新增的 wasm 导出向模型原生刚体施力，
 * FollowBone 由 wasm 侧跳过（JS 不碰 bundle ptr，避开 destroyRigidBodyBundle 析构隐患）。
 *
 * 这是 e2e（wailsPage 需运行中的 Go+Wails+WebGL 后端）在本沙箱无法启动时的
 * 最强验证：直接断言真实桥接函数按预期调用 wasm 导出 + 三处守卫。
 *
 * 守卫（绝不静默失效）：
 * - wasm 实例缺两个导出 → 返回 0，仅打一次 dev 警告；
 * - model.ptr 缺失（非 WASM 模型）→ 返回 0；
 * - len<=0 → 返回 0 且不施力。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    applyForceToModelRigidBodiesNative,
    solveIkNative,
    applyWindForceToModelRigidBodiesNative,
} from '@/core/mmd-adapter';
import { logWarn } from '@/core/logger';

vi.mock('@/core/logger', () => ({
    logWarn: vi.fn(),
}));

type NativeFn = typeof applyForceToModelRigidBodiesNative;
type ModelArg = Parameters<NativeFn>[1];

function makeWasmInstance(len: number): Record<string, unknown> {
    return {
        getMmdModelRigidBodyBundleLen: vi.fn((_p: number) => len),
        mmdModelRigidBodyApplyCentralForce: vi.fn(),
    };
}

describe('applyForceToModelRigidBodiesNative (P2 / ADR-201)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('正常：导出齐全 + model.ptr → 遍历 len 次施力并返回计数', () => {
        const wi = makeWasmInstance(5);
        const model = { ptr: 4242 } as unknown as ModelArg;
        const force = { x: 1.5, y: 0, z: -2.5 } as never;

        const r = applyForceToModelRigidBodiesNative(wi, model, force as any);

        expect(r).toBe(5);
        expect(wi.getMmdModelRigidBodyBundleLen).toHaveBeenCalledTimes(1);
        expect(wi.getMmdModelRigidBodyBundleLen).toHaveBeenCalledWith(4242);
        expect(wi.mmdModelRigidBodyApplyCentralForce).toHaveBeenCalledTimes(5);
        expect(wi.mmdModelRigidBodyApplyCentralForce).toHaveBeenNthCalledWith(
            1,
            4242,
            0,
            1.5,
            0,
            -2.5
        );
        expect(wi.mmdModelRigidBodyApplyCentralForce).toHaveBeenNthCalledWith(
            5,
            4242,
            4,
            1.5,
            0,
            -2.5
        );
    });

    it('守卫：wasm 实例缺导出 → 返回 0 并仅警告一次（绝不静默失效）', () => {
        const wi = {} as Record<string, unknown>;
        const model = { ptr: 1 } as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r1 = applyForceToModelRigidBodiesNative(wi, model, force as any);
        const r2 = applyForceToModelRigidBodiesNative(wi, model, force as any);

        expect(r1).toBe(0);
        expect(r2).toBe(0);
        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(wi.mmdModelRigidBodyApplyCentralForce).toBeUndefined();
    });

    it('守卫：model.ptr 缺失（非 WASM 模型）→ 返回 0 且不读导出', () => {
        const wi = makeWasmInstance(3);
        const model = {} as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r = applyForceToModelRigidBodiesNative(wi, model, force as any);

        expect(r).toBe(0);
        expect(wi.getMmdModelRigidBodyBundleLen).not.toHaveBeenCalled();
    });

    it('守卫：len<=0 → 返回 0 且不施力', () => {
        const wi = makeWasmInstance(0);
        const model = { ptr: 9 } as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r = applyForceToModelRigidBodiesNative(wi, model, force as any);

        expect(r).toBe(0);
        expect(wi.mmdModelRigidBodyApplyCentralForce).not.toHaveBeenCalled();
    });
});

describe('solveIkNative (ADR-202 A-class)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('正常：导出齐全 + ptr + ikSolverIndex>=0 → 调 mmdModelSolveIk 并返回 true', () => {
        const solve = vi.fn();
        const wi = { mmdModelSolveIk: solve };
        const model = { ptr: 777 } as unknown as ModelArg;

        const r = solveIkNative(wi, model, 3, false);

        expect(r).toBe(true);
        expect(solve).toHaveBeenCalledTimes(1);
        expect(solve).toHaveBeenCalledWith(777, 3, false);
    });

    it('正常：usePhysics=true 透传第三个参数', () => {
        const solve = vi.fn();
        const wi = { mmdModelSolveIk: solve };
        const model = { ptr: 1 } as unknown as ModelArg;

        const r = solveIkNative(wi, model, 0, true);

        expect(r).toBe(true);
        expect(solve).toHaveBeenCalledWith(1, 0, true);
    });

    it('守卫：wasm 实例缺 mmdModelSolveIk 导出 → 返回 false 并仅警告一次', () => {
        const wi = {} as Record<string, unknown>;
        const model = { ptr: 1 } as unknown as ModelArg;

        const r1 = solveIkNative(wi, model, 2, false);
        const r2 = solveIkNative(wi, model, 2, false);

        expect(r1).toBe(false);
        expect(r2).toBe(false);
        expect(logWarn).toHaveBeenCalledTimes(1);
    });

    it('守卫：ikSolverIndex<0（哨兵 -1，无求解器）→ 返回 false 且不调导出', () => {
        const solve = vi.fn();
        const wi = { mmdModelSolveIk: solve };
        const model = { ptr: 5 } as unknown as ModelArg;

        const r = solveIkNative(wi, model, -1, false);

        expect(r).toBe(false);
        expect(solve).not.toHaveBeenCalled();
    });

    it('守卫：model.ptr 缺失（非 WASM 模型）→ 返回 false 且不调导出', () => {
        const solve = vi.fn();
        const wi = { mmdModelSolveIk: solve };
        const model = {} as unknown as ModelArg;

        const r = solveIkNative(wi, model, 1, false);

        expect(r).toBe(false);
        expect(solve).not.toHaveBeenCalled();
    });
});

describe('applyWindForceToModelRigidBodiesNative (ADR-200 wind mass-aware)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeWindWasm(len: number): Record<string, unknown> {
        return {
            getMmdModelRigidBodyBundleLen: vi.fn((_p: number) => len),
            mmdModelRigidBodyApplyWindForce: vi.fn(),
        };
    }

    it('正常：导出齐全 + model.ptr + len>0 → 调 wind 导出并返回 len', () => {
        const wi = makeWindWasm(4);
        const model = { ptr: 88 } as unknown as ModelArg;
        const force = { x: 2, y: -1, z: 0.5 } as never;

        const r = applyWindForceToModelRigidBodiesNative(wi, model, force as any, 1.0, 0.2);

        expect(r).toBe(4);
        expect(wi.getMmdModelRigidBodyBundleLen).toHaveBeenCalledWith(88);
        expect(wi.mmdModelRigidBodyApplyWindForce).toHaveBeenCalledTimes(1);
        expect(wi.mmdModelRigidBodyApplyWindForce).toHaveBeenCalledWith(88, 2, -1, 0.5, 1.0, 0.2);
    });

    it('守卫：wasm 实例缺 mmdModelRigidBodyApplyWindForce 导出 → 返回 0 并仅警告一次', () => {
        const wi = {} as Record<string, unknown>;
        const model = { ptr: 1 } as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r1 = applyWindForceToModelRigidBodiesNative(wi, model, force as any, 1, 0.2);
        const r2 = applyWindForceToModelRigidBodiesNative(wi, model, force as any, 1, 0.2);

        expect(r1).toBe(0);
        expect(r2).toBe(0);
        expect(logWarn).toHaveBeenCalledTimes(1);
    });

    it('守卫：model.ptr 缺失 → 返回 0 且不读导出', () => {
        const wi = makeWindWasm(3);
        const model = {} as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r = applyWindForceToModelRigidBodiesNative(wi, model, force as any, 1, 0.2);

        expect(r).toBe(0);
        expect(wi.getMmdModelRigidBodyBundleLen).not.toHaveBeenCalled();
    });

    it('守卫：len<=0 → 返回 0 且不调施力导出', () => {
        const wi = makeWindWasm(0);
        const model = { ptr: 9 } as unknown as ModelArg;
        const force = { x: 1, y: 0, z: 1 } as never;

        const r = applyWindForceToModelRigidBodiesNative(wi, model, force as any, 1, 0.2);

        expect(r).toBe(0);
        expect(wi.mmdModelRigidBodyApplyWindForce).not.toHaveBeenCalled();
    });
});
