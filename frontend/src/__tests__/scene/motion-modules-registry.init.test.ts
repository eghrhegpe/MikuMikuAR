// @vitest-environment node
// [doc:adr-129] registry 单测拆分 — initMotionModules / getRegisteredModules
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
    getRegisteredModules,
    getModuleState,
    setModuleEnabled,
    setTargetModel,
    registerModule,
    unregisterModule,
    createModule,
    claimBones,
    releaseOwnedBones,
} from '@/scene/motion/motion-modules/registry';
import { getBoneOverrideStore } from '@/scene/motion/bone-override-store';

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

describe('initMotionModules', () => {
    it('幂等：重复调用不重复注册', () => {
        initMotionModules();
        const count1 = getRegisteredModules().length;
        initMotionModules();
        const count2 = getRegisteredModules().length;
        expect(count2).toBe(count1);
        expect(count1).toBeGreaterThanOrEqual(2); // body-posture + left-hand + right-hand + riding-model + left-foot + right-foot
    });

    it('注册 body-posture、left-hand、right-hand 等内置模块', () => {
        initMotionModules();
        const ids = getRegisteredModules().map((m) => m.id);
        expect(ids).toContain('body-posture');
        expect(ids).toContain('left-hand');
        expect(ids).toContain('right-hand');
    });
});

describe('getRegisteredModules', () => {
    it('按 priority 排序返回', () => {
        initMotionModules();
        const mods = getRegisteredModules();
        for (let i = 1; i < mods.length; i++) {
            expect(mods[i].priority).toBeGreaterThanOrEqual(mods[i - 1].priority);
        }
    });

    it('registerModule / unregisterModule 增删', () => {
        initMotionModules();
        const before = getRegisteredModules().length;
        registerModule(
            'test-mod',
            { labelKey: 'test' },
            5,
            () =>
                ({
                    id: 'test-mod',
                    meta: { labelKey: 'test' },
                    priority: 5,
                    managedBones: [],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-mod', enabled: false, params: {} }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {},
                    disable: () => {},
                }) as any
        );
        expect(getRegisteredModules().map((m) => m.id)).toContain('test-mod');
        unregisterModule('test-mod');
        expect(getRegisteredModules().map((m) => m.id)).not.toContain('test-mod');
        const after = getRegisteredModules().length;
        expect(after).toBe(before);
    });

    it('unregisterModule 释放该模块已 claim 的 ownedBones（round-12 P2）', () => {
        initMotionModules();
        registerModule(
            'test-claim',
            { labelKey: 'test' },
            5,
            () =>
                ({
                    id: 'test-claim',
                    meta: { labelKey: 'test' },
                    priority: 5,
                    managedBones: ['上半身'],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-claim', enabled: false, params: {} }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {
                        claimBones('m1', 'test-claim', ['上半身']);
                    },
                    disable: () => {
                        releaseOwnedBones('m1', 'test-claim');
                    },
                }) as any
        );

        const mod = createModule('test-claim', 'm1')!;
        mod.enable();
        expect(getBoneOverrideStore().getOwnedBones('m1', 'test-claim').has('上半身')).toBe(true);

        unregisterModule('test-claim');
        expect(getBoneOverrideStore().getOwnedBones('m1', 'test-claim').size).toBe(0);
    });

    it('unregisterModule 清理无 ownedBones 但已启用/挂帧钩子的模块，并清除回退状态', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        let disabled = false;
        registerModule(
            'test-hook-only',
            { labelKey: 'test' },
            5,
            () =>
                ({
                    id: 'test-hook-only',
                    meta: { labelKey: 'test' },
                    priority: 5,
                    managedBones: [],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-hook-only', enabled: true, params: {} }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {
                        disabled = false;
                    },
                    disable: () => {
                        disabled = true;
                    },
                }) as any
        );

        // 无 activeMotion 时启用会写入回退状态；该模块不 claim 任何骨骼，因此 store 中无 ownedBones
        setModuleEnabled('m1', 'test-hook-only', true);
        expect(getModuleState('m1', 'test-hook-only').enabled).toBe(true);

        unregisterModule('test-hook-only');

        // 即使 ownedBones 为空，也要对 modelRegistry 中的模型执行 disable（清理帧钩子等运行时资源）
        expect(disabled).toBe(true);
        // 回退存储中的旧状态同步清除，重注册后不会读到残留 enabled
        expect(getModuleState('m1', 'test-hook-only').enabled).toBe(false);
        expect(getRegisteredModules().map((m) => m.id)).not.toContain('test-hook-only');
    });
});

describe('getModuleState 旧状态兼容', () => {
    it('已存在但缺少默认参数的旧 state 读取时补默认值（不覆盖已有值）', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        // 模拟旧动作存档：只保存了 tilt，缺少 bend/twist/bodyHeight/bodyDepth
        shared.mockActiveMotion.value.motionModules = [
            { id: 'body-posture', enabled: false, params: { tilt: 3 } },
        ];

        const state = getModuleState('m1', 'body-posture');
        expect(state.params.tilt).toBe(3); // 已有值不被覆盖
        expect(state.params.bend).toBe(0);
        expect(state.params.twist).toBe(0);
        expect(state.params.bodyHeight).toBe(0);
        expect(state.params.bodyDepth).toBe(0);
    });
});
