// [doc:adr-129] registry 单测拆分 — body-posture IK 位置保护
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    shared,
    mockState,
    mockBoneOverride,
    mockPerception,
    mockMotionIntent,
    mockMotionHistory,
} from './motion-modules-registry-mocks';
import {
    makeModel,
    makeModelWithBones,
    setActiveMotionWithModules,
} from './motion-modules-registry-helpers';
import {
    initMotionModules,
    getRegisteredModules,
    createModule,
    getModuleState,
    setModuleParam,
    setModuleEnabled,
    claimBones,
    getOwnedBones,
    releaseOwnedBones,
    getModuleConflicts,
    getAllConflicts,
    getConflictCount,
    setTargetModel,
    clearAllModulesForModel,
    registerModule,
    unregisterModule,
} from '@/scene/motion/motion-modules/registry';
import { applyModuleSnapshot } from '@/scene/motion/motion-modules/module-base';

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

describe('body-posture IK 位置保护', () => {
    beforeEach(() => {
        resetAll();
        shared.protectIkPositionSpy.mockClear();
    });

    it('帧钩子 bodyHeight≠0 时注册左右足 IK 保护', async () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', 'm1')!;
        mod.setParam('bodyHeight', -2);
        mod.enable();

        // 从 mock 中捕获注册的帧钩子
        const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
        const hookCalls = (registerBoneOverrideFrameHook as ReturnType<typeof vi.fn>).mock.calls;
        const bodyHook = hookCalls.find(
            (c: any[]) => c[1] === 5 // FRAME_HOOK_ORDER.BODY_POSITION
        );
        expect(bodyHook).toBeTruthy();
        const hookFn = bodyHook[0] as (t: number, mid: string) => void;

        // 模拟帧回调触发
        hookFn(0, 'm1');

        // 应注册左右足 IK 保护
        expect(shared.protectIkPositionSpy).toHaveBeenCalledTimes(2);
        const protectedBones = shared.protectIkPositionSpy.mock.calls.map((c: any[]) => c[0]);
        expect(protectedBones).toContain('左足IK');
        expect(protectedBones).toContain('右足IK');
    });

    it('bodyHeight=0 且 bodyDepth=0 时不注册 IK 保护（无偏移无需保护）', async () => {
        shared.mockModelRegistry.set('m1', makeModelWithBones('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', 'm1')!;
        // 保持默认值 bodyHeight=0, bodyDepth=0
        mod.enable();

        const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
        const hookCalls = (registerBoneOverrideFrameHook as ReturnType<typeof vi.fn>).mock.calls;
        const bodyHook = hookCalls.find((c: any[]) => c[1] === 5);
        const hookFn = bodyHook[0] as (t: number, mid: string) => void;

        hookFn(0, 'm1');

        // 偏移为零时不应注册保护
        expect(shared.protectIkPositionSpy).not.toHaveBeenCalled();
    });
});
