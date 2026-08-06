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
import {} from './motion-modules-registry-helpers';
import {
    initMotionModules,
    getRegisteredModules,
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
});
