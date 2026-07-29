// [doc:adr-129] registry 单测拆分 — ownedBones 冲突仲裁
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

describe('ownedBones 冲突仲裁', () => {
    it('claimBones 首次声明返回全部骨骼', () => {
        initMotionModules();
        const claimed = claimBones('m1', 'body-posture', ['上半身']);
        expect(claimed).toEqual(['上半身']);
    });

    it('claimBones 幂等：重复声明同一模块的同一骨骼仍返回', () => {
        initMotionModules();
        claimBones('m1', 'body-posture', ['上半身']);
        const claimed = claimBones('m1', 'body-posture', ['上半身']);
        expect(claimed).toEqual(['上半身']);
    });

    it('claimBones 冲突：已被其他模块占用的骨骼被跳过并 warn', () => {
        initMotionModules();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        claimBones('m1', 'body-posture', ['上半身']);
        const claimed = claimBones('m1', 'left-hand', ['上半身', '左手首']);
        expect(claimed).toEqual(['左手首']); // 上半身 被跳过
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('claimBones priority 抢占：高优先级模块可抢占低优先级模块的骨骼', () => {
        initMotionModules();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // 注册一个 priority=3 的低优先级模块用于测试
        registerModule(
            'test-low-priority',
            { labelKey: 'test', icon: 'test', defaults: {} },
            3,
            () =>
                ({
                    id: 'test-low-priority',
                    meta: { labelKey: 'test', icon: 'test', defaults: {} },
                    priority: 3,
                    managedBones: ['センター'],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-low-priority', enabled: false, params: {} }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {},
                    disable: () => {},
                }) as any
        );

        // 使用独立 modelId 避免污染其他测试的 _ownedBones
        const testModel = 'm-priority-test';

        // 低优先级先 claim
        claimBones(testModel, 'test-low-priority', ['センター']);
        expect(getOwnedBones(testModel, 'test-low-priority').has('センター')).toBe(true);

        // 高优先级（left-hand, priority=1）抢占
        const claimed = claimBones(testModel, 'left-hand', ['センター']);
        expect(claimed).toEqual(['センター']);

        // 验证：低优先级的 owned 被清除，引擎 slot 被清除
        expect(getOwnedBones(testModel, 'test-low-priority').has('センター')).toBe(false);
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalledWith('センター', testModel);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('抢占'));

        warnSpy.mockRestore();
        unregisterModule('test-low-priority'); // 清理测试模块
    });

    it('getOwnedBones 返回当前 owned 集合', () => {
        initMotionModules();
        claimBones('m1', 'body-posture', ['上半身']);
        const owned = getOwnedBones('m1', 'body-posture');
        expect(owned.has('上半身')).toBe(true);
        expect(owned.size).toBe(1);
    });

    it('releaseOwnedBones 返回并释放骨骼集合', () => {
        initMotionModules();
        claimBones('m1', 'body-posture', ['上半身']);
        const released = releaseOwnedBones('m1', 'body-posture');
        expect(released.has('上半身')).toBe(true);
        // 释放后 getOwnedBones 为空
        expect(getOwnedBones('m1', 'body-posture').size).toBe(0);
    });

    it('[conflict-visibility] 落败模块记录被抢占骨骼', () => {
        initMotionModules();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // body-posture 先占 上半身；left-hand 落败（上半身被跳过）
        claimBones('m1', 'body-posture', ['上半身']);
        claimBones('m1', 'left-hand', ['上半身', '左手首']);

        const conflicts = getModuleConflicts('m1', 'left-hand');
        expect(conflicts).toEqual([
            { bone: '上半身', byModule: 'body-posture', winnerPriority: 1, loserPriority: 1 },
        ]);
        expect(getConflictCount('m1')).toBe(1);
        // 全部模型冲突快照
        expect(getAllConflicts('m1')).toEqual([
            {
                moduleId: 'left-hand',
                conflicts: [
                    {
                        bone: '上半身',
                        byModule: 'body-posture',
                        winnerPriority: 1,
                        loserPriority: 1,
                    },
                ],
            },
        ]);

        releaseOwnedBones('m1', 'body-posture');
        releaseOwnedBones('m1', 'left-hand');
        vi.restoreAllMocks();
    });

    it('[conflict-visibility] 抢占方无冲突记录，落败方记录被谁抢占', () => {
        initMotionModules();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerModule(
            'test-low-priority',
            { labelKey: 'test', icon: 'test', defaults: {} },
            3,
            () =>
                ({
                    id: 'test-low-priority',
                    meta: { labelKey: 'test', icon: 'test', defaults: {} },
                    priority: 3,
                    managedBones: ['センター'],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-low-priority', enabled: false, params: {} }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {},
                    disable: () => {},
                }) as any
        );
        const testModel = 'm-conflict-test';
        claimBones(testModel, 'test-low-priority', ['センター']);
        claimBones(testModel, 'left-hand', ['センター']);

        // 落败方 test-low-priority 记录被 left-hand 抢占
        expect(getModuleConflicts(testModel, 'test-low-priority')).toEqual([
            { bone: 'センター', byModule: 'left-hand', winnerPriority: 1, loserPriority: 3 },
        ]);
        // 抢占方 left-hand 自身无冲突记录
        expect(getModuleConflicts(testModel, 'left-hand')).toEqual([]);

        unregisterModule('test-low-priority');
        releaseOwnedBones(testModel, 'left-hand');
        releaseOwnedBones(testModel, 'test-low-priority');
        vi.restoreAllMocks();
    });
});
