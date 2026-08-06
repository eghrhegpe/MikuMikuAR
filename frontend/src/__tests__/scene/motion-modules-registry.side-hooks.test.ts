// [round-12 P1 回归] 左右脚/左右手帧钩子独立注册 —
// 修复：共享帧钩子管理器按 modelId 键控，createEnsureActive 的 has(modelId) 幂等检查
// 无法区分左右侧模块，导致后启用一侧的位置偏移帧钩子永不注册（功能静默失效）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    shared,
    mockState,
    mockBoneOverride,
    mockPerception,
    mockMotionIntent,
    mockMotionHistory,
} from './motion-modules-registry-mocks';
import { makeModelWithBones, setActiveMotionWithModules } from './motion-modules-registry-helpers';
import {
    initMotionModules,
    createModule,
    setTargetModel,
} from '@/scene/motion/motion-modules/registry';

vi.mock('@/core/state', () => mockState());
vi.mock('@/scene/motion/bone-override', () => mockBoneOverride());
vi.mock('@/scene/motion/perception', () => mockPerception());
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

    it('左右手同时启用：两侧手臂位置偏移帧钩子均注册，且各写对侧肩骨', async () => {
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

        const { setBoneOverridePosition } = await import('@/scene/motion/bone-override');
        const posSpy = setBoneOverridePosition as ReturnType<typeof vi.fn>;
        posSpy.mockClear();

        (leftHook![0] as (t: number, mid: string) => void)(0, 'm1');
        (rightHook![0] as (t: number, mid: string) => void)(0, 'm1');

        const bones = posSpy.mock.calls.map((c) => c[0]);
        expect(bones).toContain('左肩');
        expect(bones).toContain('右肩');
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
