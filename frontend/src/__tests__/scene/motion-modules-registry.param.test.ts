// @vitest-environment node
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
vi.mock('@/core/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/config')>();
    return { ...actual, triggerAutoSave: shared.triggerAutoSaveSpy };
});
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

describe('setParam 触发 re-bake（回归 91dbe42a / 2026-08-02）', () => {
    // 根因：ensureActive 早期 return 跳过 bake，导致首次启用后拖滑块不重烤，
    // 静态参数（旋转/预设）永远停在启用时刻。本组测试断言「启用后改参数 → setBoneOverride 被用新值重调」。
    // 任一模块若回到早退写法，此处断言即失败。
    function lastBoneCall(bone: string): readonly unknown[] | undefined {
        const calls = shared.setBoneOverrideSpy.mock.calls.filter((c) => c[0] === bone);
        return calls.length ? calls[calls.length - 1] : undefined;
    }

    it('body-posture: 启用后改 bend 重烤 上半身 覆盖', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;
        mod.enable();
        shared.setBoneOverrideSpy.mockClear(); // 清掉启用时的初始 bake
        mod.setParam('bend', 30);
        const call = lastBoneCall('上半身');
        expect(call).toBeDefined();
        expect(call![1]).toEqual([30, 0, 0]); // tilt+bend=30，复用当前参数重烤
        expect(call![4]).toBe('m1');
    });

    it('left-foot: 启用后改 pitch 重烤 左足IK 覆盖', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('left-foot', 'm1')!;
        mod.enable();
        shared.setBoneOverrideSpy.mockClear();
        mod.setParam('pitch', 45);
        const call = lastBoneCall('左足IK');
        expect(call).toBeDefined();
        expect(call![1]).toEqual([45, 0, 0]);
    });

    it('left-hand: 启用后改 pitch 重烤 左手首 覆盖', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('left-hand', 'm1')!;
        mod.enable();
        shared.setBoneOverrideSpy.mockClear();
        mod.setParam('pitch', 20);
        const call = lastBoneCall('左手首');
        expect(call).toBeDefined();
        expect(call![1]).toEqual([20, 0, 0]);
    });

    it('left-hand: 启用后改 fingerPreset 重烤手指骨骼覆盖', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('left-hand', 'm1')!;
        mod.enable();
        shared.setBoneOverrideSpy.mockClear();
        mod.setParam('fingerPreset', 'fist');
        const fingerCalls = shared.setBoneOverrideSpy.mock.calls.filter(
            (c) => typeof c[0] === 'string' && /^左.+[０１２第一第二第三]$/.test(c[0])
        );
        expect(fingerCalls.length).toBeGreaterThan(0);
        // fist 预设下手指应有明显弯曲（euler[0] ≠ 0），证明预设参数被重烤
        expect(fingerCalls.some((c) => (c[1] as number[])[0] !== 0)).toBe(true);
    });
});

describe('setParam 自动启用持久化（round-12 P2#11）', () => {
    it('禁用模块 setParam → 自动启用并持久化 enabled（走 setModuleEnabled 触发 autosave）', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;
        expect(mod.getState().enabled).toBe(false);

        shared.triggerAutoSaveSpy.mockClear();
        mod.setParam('tilt', 10);

        // 自动启用生效
        expect(mod.getState().enabled).toBe(true);
        // 参数写入 + enabled 写入各触发一次 autosave（旧实现直接改状态不落盘，仅 1 次）
        expect(shared.triggerAutoSaveSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('已启用模块 setParam 不重复触发 enabled 持久化', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        const mod = createModule('body-posture', 'm1')!;
        mod.enable();

        shared.triggerAutoSaveSpy.mockClear();
        mod.setParam('tilt', 10);

        // 已启用 → 仅参数写入触发 1 次 autosave，不额外写 enabled
        expect(shared.triggerAutoSaveSpy.mock.calls.length).toBe(1);
    });
});
