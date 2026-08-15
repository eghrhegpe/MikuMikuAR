// @vitest-environment node
// [doc:adr-129] registry 单测拆分 — createModule / getModuleState
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
    // 先按注册表里的模型清掉 SUT 的 per-model 回退状态/ownedBones，再重置共享 mock
    for (const modelId of shared.mockModelRegistry.keys()) {
        clearAllModulesForModel(modelId);
    }
    shared.reset();
    setTargetModel(null);
}

beforeEach(resetAll);

describe('createModule', () => {
    it('返回模块实例', () => {
        initMotionModules();
        const inst = createModule('body-posture', 'm1');
        expect(inst).not.toBeNull();
        expect(inst!.id).toBe('body-posture');
        expect(inst!.managedBones).toContain('上半身');
    });

    it('未知 id 返回 null', () => {
        initMotionModules();
        const inst = createModule('nonexistent', 'm1');
        expect(inst).toBeNull();
    });
});

describe('getModuleState — 默认值种入', () => {
    it('首次获取自动创建状态并种入 defaults', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules(); // 需要先有 activeMotion
        const state = getModuleState('m1', 'body-posture');
        expect(state.id).toBe('body-posture');
        expect(state.enabled).toBe(false);
        expect(state.params.tilt).toBe(0);
        expect(state.params.bend).toBe(0);
        expect(state.params.twist).toBe(0);
        expect(state.params.bodyHeight).toBe(0);
        expect(state.params.bodyDepth).toBe(0);
    });

    it('模型不存在时返回临时默认状态（不崩溃）', () => {
        initMotionModules();
        const state = getModuleState('nonexistent-model', 'body-posture');
        expect(state.id).toBe('body-posture');
        expect(state.enabled).toBe(false);
        expect(state.params.tilt).toBe(0);
    });

    it('无 activeMotion 时不同模型的回退状态互不串扰', () => {
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true);
        const m2State = getModuleState('m2', 'body-posture');
        expect(getModuleState('m1', 'body-posture').enabled).toBe(true);
        expect(m2State.enabled).toBe(false);
    });
});

describe('setTargetModel — 场景级配置隔离', () => {
    it('切换模型只清理旧模型运行时，不把场景级 enabled 改成 false', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        shared.mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();
        setActiveMotionWithModules();
        setModuleEnabled('m1', 'body-posture', true);
        setTargetModel('m1');
        shared.setBoneOverrideSpy.mockClear();

        setTargetModel('m2');

        // 配置随动作走，切换模型不应抹掉已保存的 enabled
        expect(getModuleState('m1', 'body-posture').enabled).toBe(true);
        expect(getModuleState('m2', 'body-posture').enabled).toBe(true);
        // 新模型应读到同一份配置并尝试启用
        expect(shared.setBoneOverrideSpy).toHaveBeenCalled();
    });
});
