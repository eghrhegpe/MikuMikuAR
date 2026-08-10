// @vitest-environment node
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

    it('切换新模型时从场景级配置启用模块（round-12 P2#3 单次 setState 路径）', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        shared.mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();
        // 场景级配置含已启用模块（随动作走）
        shared.mockActiveMotion.value = {
            vmdPath: 'test.vmd',
            vmdName: 'test',
            vmdLayers: [],
            source: 'vmd',
            motionModules: [
                { id: 'body-posture', enabled: true, params: { tilt: 12, bend: -3, twist: 5 } },
            ],
        };
        setTargetModel('m2');

        // 新模型模块被启用（setState 单次调用：enabled + params 一次写入并 bake）
        expect(getModuleState('m2', 'body-posture').enabled).toBe(true);
        expect(getModuleState('m2', 'body-posture').params.tilt).toBe(12);
        expect(shared.setBoneOverrideSpy).toHaveBeenCalled();
    });

    it('切换 null 目标时清理旧模型已启用模块', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        setTargetModel('m1'); // 先设当前模型，使切换 null 时走清理路径
        const mod = createModule('body-posture', 'm1')!;
        mod.enable();

        shared.clearBoneOverrideSpy.mockClear();
        setTargetModel(null);

        // 旧模型模块被 disable → clearBoneOverride 被调用
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalled();
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
