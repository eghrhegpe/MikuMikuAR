// [doc:adr-129] registry 单测拆分 — setModuleParam/enabled / per-motion 配置 / getState-setState 对称
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
    setModuleParam,
    setModuleEnabled,
    setTargetModel,
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

describe('setModuleParam / setModuleEnabled', () => {
    it('setModuleParam 写入参数', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules(); // 需要先有 activeMotion
        setModuleParam('m1', 'body-posture', 'tilt', 10);
        const state = getModuleState('m1', 'body-posture');
        expect(state.params.tilt).toBe(10);
    });

    it('setModuleEnabled 写入启用状态', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules(); // 需要先有 activeMotion
        setModuleEnabled('m1', 'body-posture', true);
        const state = getModuleState('m1', 'body-posture');
        expect(state.enabled).toBe(true);
    });
});

describe('per-motion 配置（随动作走）', () => {
    it('所有模型共享同一套模块配置（随动作走）', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        shared.mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();
        setActiveMotionWithModules();

        // 对 m1 设置参数，m2 应该看到相同值（因为配置随动作）
        setModuleParam('m1', 'body-posture', 'tilt', 15);
        setModuleEnabled('m1', 'body-posture', true);

        const s1 = getModuleState('m1', 'body-posture');
        const s2 = getModuleState('m2', 'body-posture');

        // 配置随动作，所以两个模型看到相同的配置
        expect(s1.params.tilt).toBe(15);
        expect(s1.enabled).toBe(true);
        expect(s2.params.tilt).toBe(15);
        expect(s2.enabled).toBe(true);
    });
});

describe('getState / setState 对称', () => {
    it('getState 返回合并默认值的快照', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;
        setModuleParam('m1', 'body-posture', 'tilt', 8);
        const snap = mod.getState();
        expect(snap.params.tilt).toBe(8);
        expect(snap.params.bend).toBe(0); // 默认值兜底
    });

    it('setState 恢复后 getState 一致', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;

        const snapshot = {
            id: 'body-posture',
            enabled: true,
            params: { tilt: 12, bend: -3, twist: 5 },
        };
        mod.setState(snapshot);

        const restored = mod.getState();
        expect(restored.enabled).toBe(true);
        expect(restored.params.tilt).toBe(12);
        expect(restored.params.bend).toBe(-3);
        expect(restored.params.twist).toBe(5);
    });

    it('一个模块的 setState 不影响其他模块状态', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const bp = createModule('body-posture', 'm1')!;
        const lh = createModule('left-hand', 'm1')!;

        setModuleParam('m1', 'left-hand', 'pitch', 30);
        bp.setState({ id: 'body-posture', enabled: true, params: { tilt: 1, bend: 2, twist: 3 } });

        const lhState = lh.getState();
        expect(lhState.params.pitch).toBe(30); // 未被影响
    });
});
