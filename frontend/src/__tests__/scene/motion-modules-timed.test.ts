// [doc:adr-116 P3] 时间驱动模块接线单测 — 验证 sway/riding 的每帧钩子真正写入骨骼覆盖，
// 且 sway 在 position-offset 占用 センター 时正确让位（不争抢、无 warn 副作用）。

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
}));

vi.mock('@/scene/motion/perception', () => ({
    setHeadTrackingEnabled: vi.fn(),
}));

// [doc:adr-129] mock motion-intent（场景级配置）
const mockActiveMotion = { value: null as any };
vi.mock('@/scene/motion/motion-intent', () => ({
    getActiveMotion: () => mockActiveMotion.value,
    setActiveMotion: vi.fn((intent: any) => {
        mockActiveMotion.value = intent;
    }),
}));

import { createSwayMotionModule } from '@/scene/motion/motion-modules/sway-motion';
import { createRidingModelModule } from '@/scene/motion/motion-modules/riding-model';
import { createPositionOffsetModule } from '@/scene/motion/motion-modules/position-offset';
import { setTargetModel, getModuleState } from '@/scene/motion/motion-modules/registry';

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

describe('sway-motion 每帧钩子', () => {
    beforeEach(resetAll);

    it('enable 后注册帧钩子；quarter 周期写入峰值 yaw', () => {
        const m = makeModel('sway-q');
        data.mockModelRegistry.set('sway-q', m);
        const sway = createSwayMotionModule('sway-q');
        sway.enable();

        // 钩子已注册
        expect(data.registerFrameHookSpy).toHaveBeenCalledTimes(1);
        // bake 初始写入静态峰值（amplitude=5），清空后单独验证钩子效果
        data.setBoneOverrideSpy.mockClear();

        const hook = data.frameHooks[0];
        const freq = 0.5;
        const t = 0.25 / freq; // quarter 周期 → sin=1
        hook(t, 'sway-q');

        // yaw = 5*(1-0.3)*1 = 3.5
        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            'センター',
            [0, 3.5, 0],
            1,
            true,
            'sway-q'
        );
    });

    it('frequency/decay 改变由钩子实时反映（t=0 → yaw=0）', () => {
        const m = makeModel('sway-t0');
        data.mockModelRegistry.set('sway-t0', m);
        const sway = createSwayMotionModule('sway-t0');
        sway.enable();
        data.setBoneOverrideSpy.mockClear();

        data.frameHooks[0](0, 'sway-t0');
        expect(data.setBoneOverrideSpy).toHaveBeenCalledWith(
            'センター',
            [0, 0, 0],
            1,
            true,
            'sway-t0'
        );
    });

    it('position-offset 占用 センター 时 sway 让位（钩子不写入，不争抢）', () => {
        const m = makeModel('sway-yield');
        data.mockModelRegistry.set('sway-yield', m);
        // 先启用 position-offset（优先级 1，抢占 センター）
        const pos = createPositionOffsetModule('sway-yield');
        pos.enable();
        data.frameHooks.length = 0; // 清掉无关钩子（position-offset 无钩子，本就空）

        const sway = createSwayMotionModule('sway-yield');
        sway.enable(); // 仍会注册钩子，但 should yield
        data.setBoneOverrideSpy.mockClear();

        // 调用 sway 钩子，应让位（isBoneOwnedByOther 命中）
        data.frameHooks[0](0.5, 'sway-yield');

        // 不应写入 センター（让位）
        const wroteCenter = data.setBoneOverrideSpy.mock.calls.some((c) => c[0] === 'センター');
        expect(wroteCenter).toBe(false);
    });
});

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

        const pedalSpeed = 0.5;
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
