// [doc:adr-129] registry 单测拆分 — disable 精确清除 / setTargetModel 作用域切换 / clearAllModulesForModel
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
    clearAllModulesForModel,
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

beforeEach(resetAll);

describe('disable 精确清除（P2-1）', () => {
    it('disable 仅清 ownedBones，不误伤手动覆盖', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;

        // 模块 enable 时 claim 并写入 上半身/上半身2/センター
        mod.enable();
        shared.setBoneOverrideSpy.mockClear();

        // 模块 disable 时应只清 ownedBones（上半身/上半身2/センター）
        mod.disable();

        // disable 应调用 clearBoneOverride 3 次（上半身/上半身2/センター）
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalledTimes(3);
        const clearedBones = shared.clearBoneOverrideSpy.mock.calls.map((c) => c[0]);
        expect(clearedBones).toContain('上半身');
        expect(clearedBones).toContain('上半身2');
        expect(clearedBones).toContain('センター');
    });
});

describe('setTargetModel 作用域切换', () => {
    it('切换到新模型时禁用旧模型 enabled 模块', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        shared.mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();
        setActiveMotionWithModules();

        // m1 启用 body-posture
        setModuleEnabled('m1', 'body-posture', true);
        setTargetModel('m1');
        shared.setBoneOverrideSpy.mockClear();

        // 切换到 m2（m1 的 body-posture 应被 disable）
        setTargetModel('m2');

        // m1 的 body-posture disable 应触发 clearBoneOverride
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalled();
    });

    it('场景级配置在模型切换时保持不变', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        shared.mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();
        setActiveMotionWithModules();

        // 设置 body-posture 的 enabled 状态（存储在场景级配置）
        setModuleEnabled('m1', 'body-posture', true);

        // 验证状态已存储（所有模型共享配置）
        expect(getModuleState('m1', 'body-posture').enabled).toBe(true);
        expect(getModuleState('m2', 'body-posture').enabled).toBe(true);
    });
});

describe('clearAllModulesForModel', () => {
    it('清除所有 ownedBones', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;
        mod.enable();

        clearAllModulesForModel('m1');

        // [doc:adr-129] motionModules 已移至场景级，不再在 ModelInstance 上
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalled();
    });
});
