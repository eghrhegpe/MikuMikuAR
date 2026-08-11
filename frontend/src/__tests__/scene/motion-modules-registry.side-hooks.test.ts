// @vitest-environment node
// [round-12 P1 回归] 左右脚/左右手帧钩子独立注册 —
// 修复：共享帧钩子管理器按 modelId 键控，createEnsureActive 的 has(modelId) 幂等检查
// 无法区分左右侧模块，导致后启用一侧的位置偏移帧钩子永不注册（功能静默失效）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    shared,
    mockState,
    mockBoneOverride,
    mockPerception,
    mockPerceptionShared,
    mockMotionIntent,
    mockMotionHistory,
} from './motion-modules-registry-mocks';
import { makeModelWithBones, makeModelWithBonesWasm, setActiveMotionWithModules } from './motion-modules-registry-helpers';
import {
    initMotionModules,
    createModule,
    setTargetModel,
} from '@/scene/motion/motion-modules/registry';
import { getModuleActionId } from '@/scene/motion/motion-modules/module-base';

vi.mock('@/core/state', () => mockState());
vi.mock('@/scene/motion/bone-override', () => mockBoneOverride());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/perception-shared', () => mockPerceptionShared());
vi.mock('@/scene/motion/motion-intent', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/scene/motion/motion-intent')>();
    return { ...actual, ...mockMotionIntent() };
});
vi.mock('@/scene/motion/motion-modules/motion-history', () => mockMotionHistory());

function resetAll(): void {
    shared.reset();
    setTargetModel(null);
}

beforeEach(resetAll);

/** 动态取 mock 的 registerBoneOverrideFrameHook 调用记录（第 3 参为 moduleId） */
async function hookRegistrations(): Promise<Array<[(t: number, mid: string) => void, number, string]>> {
    const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
    return (
        registerBoneOverrideFrameHook as unknown as {
            mock: { calls: Array<[(t: number, mid: string) => void, number, string]> };
        }
    ).mock.calls;
}

describe('左右侧模块帧钩子独立注册（round-12 P1 回归）', () => {
    it('左右脚同时启用：两侧位置偏移帧钩子均注册，且各写对侧足 IK 骨骼', async () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const leftFoot = createModule('left-foot', 'm1')!;
        const rightFoot = createModule('right-foot', 'm1')!;
        leftFoot.setParam('footPosX', 1);
        rightFoot.setParam('footPosX', 2);
        leftFoot.enable();
        rightFoot.enable();

        const calls = await hookRegistrations();
        const leftHook = calls.find((c) => c[2] === 'left-foot');
        const rightHook = calls.find((c) => c[2] === 'right-foot');
        // 修复前：后启用一侧的钩子永不注册（共享 Map has('m1') 误判）
        expect(leftHook).toBeTruthy();
        expect(rightHook).toBeTruthy();

        const { setBoneOverridePosition } = await import('@/scene/motion/bone-override');
        const posSpy = setBoneOverridePosition as ReturnType<typeof vi.fn>;
        posSpy.mockClear();

        (leftHook![0] as (t: number, mid: string) => void)(0, 'm1');
        (rightHook![0] as (t: number, mid: string) => void)(0, 'm1');

        const bones = posSpy.mock.calls.map((c) => c[0]);
        expect(bones).toContain('左足IK');
        expect(bones).toContain('右足IK');
    });

    it('左右手同时启用：两侧手臂位置偏移帧钩子均注册', async () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const leftHand = createModule('left-hand', 'm1')!;
        const rightHand = createModule('right-hand', 'm1')!;
        leftHand.setParam('handPosX', 1);
        rightHand.setParam('handPosX', 2);
        leftHand.enable();
        rightHand.enable();

        const calls = await hookRegistrations();
        const leftHook = calls.find((c) => c[2] === 'left-hand');
        const rightHook = calls.find((c) => c[2] === 'right-hand');
        expect(leftHook).toBeTruthy();
        expect(rightHook).toBeTruthy();
    });

    it('左右手同时启用：手臂IK重解路径被调用（ikSolver.solve）', async () => {
        const model = makeModelWithBones('m1');
        const solveSpy = vi.fn();
        model.mmdModel.runtimeBones.find((b: any) => b.name === '左腕IK').ikSolver.solve = solveSpy;
        model.mmdModel.runtimeBones.find((b: any) => b.name === '右腕IK').ikSolver.solve = solveSpy;
        shared.mockModelRegistry.set('m1', model);
        initMotionModules();
        setActiveMotionWithModules();

        const leftHand = createModule('left-hand', 'm1')!;
        const rightHand = createModule('right-hand', 'm1')!;
        leftHand.setParam('handPosX', 1);
        rightHand.setParam('handPosX', 2);
        leftHand.enable();
        rightHand.enable();

        const calls = await hookRegistrations();
        const leftHook = calls.find((c) => c[2] === 'left-hand');
        const rightHook = calls.find((c) => c[2] === 'right-hand');

        solveSpy.mockClear();
        (leftHook![0] as (t: number, mid: string) => void)(0, 'm1');
        (rightHook![0] as (t: number, mid: string) => void)(0, 'm1');

        // IK重解路径：ikSolver.solve 应被调用（每侧各一次）
        expect(solveSpy).toHaveBeenCalledTimes(2);
    });

    it('WASM模式：左右手IK重解通过getWasmIkResolver调用', async () => {
        // 切换到 WASM 模式
        shared.wasmRuntime = true;

        const model = makeModelWithBonesWasm('m1');
        shared.mockModelRegistry.set('m1', model);
        initMotionModules();
        setActiveMotionWithModules();

        const leftHand = createModule('left-hand', 'm1')!;
        const rightHand = createModule('right-hand', 'm1')!;
        leftHand.setParam('handPosX', 1);
        rightHand.setParam('handPosX', 2);
        leftHand.enable();
        rightHand.enable();

        const calls = await hookRegistrations();
        const leftHook = calls.find((c) => c[2] === 'left-hand');
        const rightHook = calls.find((c) => c[2] === 'right-hand');

        shared.wasmIkResolverSpy.mockClear();
        (leftHook![0] as (t: number, mid: string) => void)(0, 'm1');
        (rightHook![0] as (t: number, mid: string) => void)(0, 'm1');

        // WASM模式：wasmIkResolver 应被调用（每侧各一次）
        expect(shared.wasmIkResolverSpy).toHaveBeenCalledTimes(2);
    });

    it('左右脚同时启用后，禁用其中一侧不影响另一侧钩子', async () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const leftFoot = createModule('left-foot', 'm1')!;
        const rightFoot = createModule('right-foot', 'm1')!;
        leftFoot.setParam('footPosX', 1);
        rightFoot.setParam('footPosX', 2);
        leftFoot.enable();
        rightFoot.enable();
        leftFoot.disable();

        const calls = await hookRegistrations();
        const rightHook = calls.find((c) => c[2] === 'right-foot');
        expect(rightHook).toBeTruthy();

        // 禁用左侧后，右侧钩子仍可独立写 右足IK
        const { setBoneOverridePosition } = await import('@/scene/motion/bone-override');
        const posSpy = setBoneOverridePosition as ReturnType<typeof vi.fn>;
        posSpy.mockClear();

        (rightHook![0] as (t: number, mid: string) => void)(0, 'm1');
        expect(posSpy.mock.calls.map((c) => c[0])).toEqual(['右足IK']);
    });
});

describe('帧钩子 actionId 作用域（fix:audit-P1 残留清理）', () => {
    it('proc 作用域启用后 getModuleActionId 记 proc:xxx；VMD 路径（无 actionId）启用后清除', () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        // proc 作用域：createModule 带 proc actionId → 记录 proc:idle
        const procMod = createModule('left-foot', 'm1', 'proc:idle')!;
        procMod.enable();
        expect(getModuleActionId('m1')).toBe('proc:idle');

        // VMD 路径：createModule 无 actionId → enable 应清除残留，避免帧钩子读到过期 proc 作用域
        const vmdMod = createModule('left-foot', 'm1')!;
        vmdMod.enable();
        expect(getModuleActionId('m1')).toBeUndefined();
    });
});
