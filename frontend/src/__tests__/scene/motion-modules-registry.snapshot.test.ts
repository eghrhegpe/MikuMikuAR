// [doc:adr-125] registry 单测拆分 — applyModuleSnapshot + setParam 集成测试
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    shared,
    mockState,
    mockBoneOverride,
    mockPerception,
    mockMotionIntent,
    mockMotionHistory,
} from './motion-modules-registry-mocks';
import { makeModel, setActiveMotionWithModules } from './motion-modules-registry-helpers';
import {
    initMotionModules,
    createModule,
    getModuleState,
    setModuleEnabled,
    setTargetModel,
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

describe('applyModuleSnapshot', () => {
    beforeEach(resetAll);

    it('非空快照：启用模块并写入 params', () => {
        const mid = 'm-snapshot-nonempty';
        shared.mockModelRegistry.set(mid, makeModel(mid));
        initMotionModules();
        setActiveMotionWithModules();

        applyModuleSnapshot(mid, {
            'body-posture': { enabled: true, params: { tilt: 10, bend: 5, twist: 3 } },
        });

        const state = getModuleState(mid, 'body-posture');
        expect(state.enabled).toBe(true);
        expect(state.params.tilt).toBe(10);
        expect(state.params.bend).toBe(5);
        expect(shared.setBoneOverrideSpy).toHaveBeenCalled();
    });

    it('空快照：禁用所有已启用模块', () => {
        const mid = 'm-snapshot-empty';
        shared.mockModelRegistry.set(mid, makeModel(mid));
        initMotionModules();
        setActiveMotionWithModules();

        // 先启用 body-posture
        const mod = createModule('body-posture', mid)!;
        mod.enable();
        expect(getModuleState(mid, 'body-posture').enabled).toBe(true);

        // 应用空快照
        applyModuleSnapshot(mid, {});

        expect(getModuleState(mid, 'body-posture').enabled).toBe(false);
        // disable 应触发 clearBoneOverride
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalled();
    });

    it('快照中不存在的模块会被禁用（严格模式）', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        // 先启用 left-hand
        setModuleEnabled('m1', 'left-hand', true);

        // 应用只含 body-posture 的快照
        applyModuleSnapshot('m1', {
            'body-posture': { enabled: false, params: { tilt: 0, bend: 0, twist: 0 } },
        });

        // body-posture 应被禁用
        expect(getModuleState('m1', 'body-posture').enabled).toBe(false);
        // left-hand 应被禁用（不在快照中）
        expect(getModuleState('m1', 'left-hand').enabled).toBe(false);
    });
});

describe('setParam → pushHistory 集成', () => {
    beforeEach(() => {
        resetAll();
        shared.pushHistorySpy.mockClear();
    });

    it('setParam 调用 pushHistory 记录变更', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', 'm1')!;
        mod.setParam('tilt', 10);

        expect(shared.pushHistorySpy).toHaveBeenCalledTimes(1);
        expect(shared.pushHistorySpy).toHaveBeenCalledWith(
            'm1',
            'body-posture',
            'tilt',
            expect.any(Number), // prev (defaults.tilt)
            10,
            expect.any(Function) // buildSnapshot
        );
    });

    it('setParam 值未变化时不记录', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();

        const mod = createModule('body-posture', 'm1')!;
        mod.setParam('tilt', 0); // 默认值

        expect(shared.pushHistorySpy).not.toHaveBeenCalled();
    });
});
