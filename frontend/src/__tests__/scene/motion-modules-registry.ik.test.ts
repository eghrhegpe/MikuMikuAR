// @vitest-environment node
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

describe('body-posture IK 位置保护', () => {
    beforeEach(() => {
        resetAll();
        shared.protectIkPositionSpy.mockClear();
    });

    it('帧钩子 bodyHeight≠0 时注册左右足 IK 保护', async () => {
        // 每个用例使用独立 modelId，避免 body-posture 模块级帧钩子/缓存按 modelId 残留造成串扰
        const modelId = 'm-ik-pos';
        shared.mockModelRegistry.set(modelId, makeModelWithBones(modelId));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', modelId)!;
        mod.setParam('bodyHeight', -2);
        mod.enable();

        // 从 mock 中捕获注册的帧钩子（取最近一次 body-posture 注册，避免历史用例累积干扰）
        const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
        const hookCalls = (registerBoneOverrideFrameHook as ReturnType<typeof vi.fn>).mock.calls;
        const bodyHooks = hookCalls.filter(
            (c: any[]) => c[1] === 5 // FRAME_HOOK_ORDER.BODY_POSITION
        );
        expect(bodyHooks.length).toBeGreaterThan(0);
        const bodyHook = bodyHooks[bodyHooks.length - 1];
        const hookFn = bodyHook[0] as (t: number, mid: string) => void;

        // 模拟帧回调触发
        hookFn(0, modelId);

        // 应注册左右足 IK 保护
        expect(shared.protectIkPositionSpy).toHaveBeenCalledTimes(2);
        const protectedBones = shared.protectIkPositionSpy.mock.calls.map((c: any[]) => c[0]);
        expect(protectedBones).toContain('左足IK');
        expect(protectedBones).toContain('右足IK');

        mod.disable(); // 清理帧钩子，避免跨用例残留
    });

    it('bodyHeight=0 且 bodyDepth=0 时不注册 IK 保护（无偏移无需保护）', async () => {
        const modelId = 'm-ik-zero';
        shared.mockModelRegistry.set(modelId, makeModelWithBones(modelId));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', modelId)!;
        // 保持默认值 bodyHeight=0, bodyDepth=0
        mod.enable();

        const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
        const hookCalls = (registerBoneOverrideFrameHook as ReturnType<typeof vi.fn>).mock.calls;
        const bodyHooks = hookCalls.filter((c: any[]) => c[1] === 5);
        expect(bodyHooks.length).toBeGreaterThan(0);
        const bodyHook = bodyHooks[bodyHooks.length - 1];
        const hookFn = bodyHook[0] as (t: number, mid: string) => void;

        hookFn(0, modelId);

        // 偏移为零时不应注册保护
        expect(shared.protectIkPositionSpy).not.toHaveBeenCalled();

        mod.disable(); // 清理帧钩子，避免跨用例残留
    });
});
