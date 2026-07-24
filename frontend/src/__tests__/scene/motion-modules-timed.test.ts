// [doc:adr-116 P3] 时间驱动模块接线单测 — 验证 riding 的每帧钩子真正写入骨骼覆盖。

import { describe, it, expect, beforeEach, vi } from 'vitest';

const data = vi.hoisted(() => {
    const mockModelRegistry = new Map<string, any>();
    const setBoneOverrideSpy = vi.fn();
    const clearBoneOverrideSpy = vi.fn();
    const frameHooks: Array<(t: number, mid: string) => void> = [];
    const registerFrameHookSpy = vi.fn((hook: (t: number, mid: string) => void) => {
        frameHooks.push(hook);
        return () => {
            const i = frameHooks.indexOf(hook);
            if (i >= 0) {
                frameHooks.splice(i, 1);
            }
        };
    });
    const setBoneOverridePositionSpy = vi.fn();
    return {
        mockModelRegistry,
        setBoneOverrideSpy,
        clearBoneOverrideSpy,
        frameHooks,
        registerFrameHookSpy,
        setBoneOverridePositionSpy,
    };
});

vi.mock('@/core/state', () => ({
    modelRegistry: data.mockModelRegistry,
    setUIPersistCallback: vi.fn(),
}));

vi.mock('@/scene/motion/bone-override', () => ({
    setBoneOverride: data.setBoneOverrideSpy,
    clearBoneOverride: data.clearBoneOverrideSpy,
    setBoneOverridePosition: data.setBoneOverridePositionSpy,
    registerBoneOverrideFrameHook: data.registerFrameHookSpy,
    FRAME_HOOK_ORDER: { RIDING: 10, SWAY: 20, HAND_SYMMETRY: 30 },
    // [doc:adr-122 P1] IK 感知覆盖（mock 中降级为 setBoneOverride，忽略 getRuntimeBones）
    applyBoneOverrideIK: (
        boneName: string,
        euler: [number, number, number],
        weight: number,
        enabled: boolean,
        modelId?: string
    ) => data.setBoneOverrideSpy(boneName, euler, weight, enabled, modelId),
}));

vi.mock('@/scene/motion/perception', () => ({
    setHeadTrackingEnabled: vi.fn(),
}));

// [doc:adr-129] mock motion-intent（场景级配置）
const mockActiveMotion = { value: null as any };
vi.mock('@/scene/motion/motion-intent', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/scene/motion/motion-intent')>();
    return {
        ...actual,
        getActiveMotion: () => mockActiveMotion.value,
    };
});

import { createRidingModelModule } from '@/scene/motion/motion-modules/riding-model';
import { setTargetModel } from '@/scene/motion/motion-modules/registry';

function makeModel(id: string): any {
    return { id, name: id, motionOverrideModules: undefined as any, boneOverrides: [] };
}

function resetAll(): void {
    data.mockModelRegistry.clear();
    data.frameHooks.length = 0;
    data.setBoneOverrideSpy.mockClear();
    data.clearBoneOverrideSpy.mockClear();
    data.registerFrameHookSpy.mockClear();
    mockActiveMotion.value = {
        vmdPath: 'test.vmd',
        vmdName: 'test',
        vmdLayers: [],
        source: 'vmd',
        motionModules: [],
    };
    setTargetModel(null);
}

describe('riding-model 自动踏板', () => {
    beforeEach(resetAll);

    it('autoPedal=true 时注册钩子；quarter 周期左足 +20 / 右足 -20', () => {
        const m = makeModel('ride-auto');
        data.mockModelRegistry.set('ride-auto', m);
        const riding = createRidingModelModule('ride-auto');
        riding.setParam('autoPedal', true); // 触发 ensureActive + 注册钩子

        expect(data.registerFrameHookSpy).toHaveBeenCalledTimes(1);
        // 清掉 bake 写入的静态骨（腰/膝），单独验证钩子驱动足骨
        data.setBoneOverrideSpy.mockClear();

        const _pedalSpeed = 0.5;
        const t = 0.5; // phase = 0.5*0.5*360 = 90°
        data.frameHooks[0](t, 'ride-auto');

        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            '左足',
            [20, 0, 0],
            1,
            true,
            'ride-auto'
        );
        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            '右足',
            [-20, 0, 0],
            1,
            true,
            'ride-auto'
        );
    });

    it('autoPedal=false（默认）时不注册钩子，足部走静态 pedalAngle', () => {
        const m = makeModel('ride-static');
        data.mockModelRegistry.set('ride-static', m);
        const riding = createRidingModelModule('ride-static');
        riding.setParam('pedalAngle', 90); // 静态相位，不开启 autoPedal

        expect(data.registerFrameHookSpy).not.toHaveBeenCalled();
        // bake 直接写静态足骨：左足 sin(90)*20=20，右足 sin(270)*20=-20
        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            '左足',
            [20, 0, 0],
            1,
            true,
            'ride-static'
        );
        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            '右足',
            [-20, 0, 0],
            1,
            true,
            'ride-static'
        );
    });
});
