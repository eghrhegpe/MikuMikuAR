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
import { makeModel, makeModelWithBones, setActiveMotionWithModules } from './motion-modules-registry-helpers';
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
    });

    it('模型不存在时返回临时默认状态（不崩溃）', () => {
        initMotionModules();
        const state = getModuleState('nonexistent-model', 'body-posture');
        expect(state.id).toBe('body-posture');
        expect(state.enabled).toBe(false);
    });
});
