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
import { makeModel, makeModelWithBones, setActiveMotionWithModules } from './motion-modules-registry-helpers';
import {
    initMotionModules,
    createModule,
    getModuleState,
    setModuleParam,
    setModuleEnabled,
    setTargetModel,
    applyProcMotionModulesToModel,
    registerModule,
    unregisterModule,
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
    // 帧钩子相关 spy 不在 shared.reset 中清理（side-hooks 依赖跨用例累积快照），
    // 本文件自行清空避免用例间误读；模块级帧钩子由各用例 disable 时注销。
    shared.registerBoneOverrideFrameHookSpy.mockClear();
    shared.setBoneOverridePositionSpy.mockClear();
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

    it('setModuleParam 拒绝 NaN/Infinity，落库为模块默认值', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        setModuleParam('m1', 'body-posture', 'tilt', NaN);
        setModuleParam('m1', 'body-posture', 'bend', Infinity);
        setModuleParam('m1', 'body-posture', 'twist', -Infinity);
        const state = getModuleState('m1', 'body-posture');
        expect(state.params.tilt).toBe(0);
        expect(state.params.bend).toBe(0);
        expect(state.params.twist).toBe(0);
    });
});

describe('程序化动作模块配置（proc:actionId 持久化，fix:proc-override）', () => {
    // 无 activeMotion（mockActiveMotion 默认 null）= 程序化动作场景，走 per-model+per-proc 存储
    it('无 activeMotion 时 proc:idle 写入 per-model 持久化存储', () => {
        const m1 = makeModel('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true, 'proc:idle');
        setModuleParam('m1', 'body-posture', 'tilt', 10, 'proc:idle');
        const state = getModuleState('m1', 'body-posture', 'proc:idle');
        expect(state.enabled).toBe(true);
        expect(state.params.tilt).toBe(10);
        // 状态落到 ModelInstance.procMotionModules.idle（可序列化）
        expect(m1.procMotionModules?.idle).toBeDefined();
        expect(m1.procMotionModules.idle.find((s: any) => s.id === 'body-posture')?.enabled).toBe(true);
    });

    it('不同 procRole（idle vs autodance）互不串扰', () => {
        const m1 = makeModel('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true, 'proc:idle');
        setModuleParam('m1', 'body-posture', 'tilt', 10, 'proc:idle');
        // autodance 模式保持默认（未启用、参数默认）
        const autodance = getModuleState('m1', 'body-posture', 'proc:autodance');
        expect(autodance.enabled).toBe(false);
        expect(autodance.params.tilt).toBe(0);
        // idle 不受影响
        expect(getModuleState('m1', 'body-posture', 'proc:idle').enabled).toBe(true);
    });

    it('不同模型（m1 vs m2）互不串扰', () => {
        const m1 = makeModel('m1');
        const m2 = makeModel('m2');
        shared.mockModelRegistry.set('m1', m1);
        shared.mockModelRegistry.set('m2', m2);
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true, 'proc:idle');
        setModuleParam('m1', 'body-posture', 'tilt', 10, 'proc:idle');
        // m2 的 idle 保持默认
        const m2State = getModuleState('m2', 'body-posture', 'proc:idle');
        expect(m2State.enabled).toBe(false);
        expect(m2State.params.tilt).toBe(0);
        // m1 不受影响
        expect(getModuleState('m1', 'body-posture', 'proc:idle').enabled).toBe(true);
    });

    it('applyProcMotionModulesToModel 将持久化状态应用到运行时（setState 生效）', () => {
        const m1 = makeModelWithBones('m1'); // 含 上半身 骨骼，使 body-posture bake 可认领
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true, 'proc:idle');
        setModuleParam('m1', 'body-posture', 'tilt', 10, 'proc:idle');
        shared.setBoneOverrideSpy.mockClear();
        // 应用：body-posture 启用 → bake 触发 setBoneOverride('上半身', ...)
        applyProcMotionModulesToModel('m1', 'idle');
        expect(shared.setBoneOverrideSpy.mock.calls.length).toBeGreaterThan(0);
        createModule('body-posture', 'm1', 'proc:idle')?.disable(); // 清理帧钩子/ownedBones
    });

    it('applyProcMotionModulesToModel 无存储时静默跳过', () => {
        const m1 = makeModel('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        shared.setBoneOverrideSpy.mockClear();
        applyProcMotionModulesToModel('m1', 'idle');
        expect(shared.setBoneOverrideSpy).not.toHaveBeenCalled();
    });

    it('applyProcMotionModulesToModel 对禁用状态清理运行时覆盖', () => {
        const m1 = makeModelWithBones('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true, 'proc:idle');
        setModuleParam('m1', 'body-posture', 'tilt', 10, 'proc:idle');
        applyProcMotionModulesToModel('m1', 'idle');
        expect(shared.setBoneOverrideSpy).toHaveBeenCalled();

        shared.clearBoneOverrideSpy.mockClear();
        setModuleEnabled('m1', 'body-posture', false, 'proc:idle');
        applyProcMotionModulesToModel('m1', 'idle');
        expect(shared.clearBoneOverrideSpy).toHaveBeenCalled();
        createModule('body-posture', 'm1', 'proc:idle')?.disable();
    });

    it('applyProcMotionModulesToModel 幂等：重复应用不重复注册帧钩子', async () => {
        const modelId = 'm-apply-idem';
        const m1 = makeModelWithBones(modelId);
        shared.mockModelRegistry.set(modelId, m1);
        initMotionModules();
        setModuleEnabled(modelId, 'body-posture', true, 'proc:idle');
        setModuleParam(modelId, 'body-posture', 'bodyHeight', -2, 'proc:idle');

        const { registerBoneOverrideFrameHook } = await import('@/scene/motion/bone-override');
        const hookSpy = registerBoneOverrideFrameHook as ReturnType<typeof vi.fn>;
        hookSpy.mockClear();

        applyProcMotionModulesToModel(modelId, 'idle');
        const first = hookSpy.mock.calls.filter((c: any[]) => c[2] === 'body-posture').length;
        applyProcMotionModulesToModel(modelId, 'idle');
        const second = hookSpy.mock.calls.filter((c: any[]) => c[2] === 'body-posture').length;

        expect(second).toBe(first);
        expect(first).toBeGreaterThan(0);
        createModule('body-posture', modelId, 'proc:idle')?.disable();
    });

    it('applyProcMotionModulesToModel 旧 proc 存档 NaN/Infinity 不写回状态', () => {
        const m1 = makeModelWithBones('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        m1.procMotionModules = {
            idle: [{ id: 'body-posture', enabled: true, params: { tilt: NaN, bend: Infinity } }],
        };

        applyProcMotionModulesToModel('m1', 'idle');

        expect(m1.procMotionModules.idle[0].params.tilt).toBe(0);
        expect(m1.procMotionModules.idle[0].params.bend).toBe(0);
        createModule('body-posture', 'm1', 'proc:idle')?.disable();
    });

    it('unregisterModule 清理 procMotionModules 残留状态', () => {
        const m1 = makeModel('m1');
        shared.mockModelRegistry.set('m1', m1);
        initMotionModules();
        registerModule(
            'test-proc-cleanup',
            { labelKey: 'test', defaults: { x: 0 } },
            99,
            () =>
                ({
                    id: 'test-proc-cleanup',
                    meta: { labelKey: 'test', defaults: { x: 0 } },
                    priority: 99,
                    managedBones: [],
                    buildSchema: () => [],
                    getState: () => ({ id: 'test-proc-cleanup', enabled: false, params: { x: 0 } }),
                    setState: () => {},
                    setParam: () => {},
                    enable: () => {},
                    disable: () => {},
                }) as any
        );
        setModuleEnabled('m1', 'test-proc-cleanup', true, 'proc:idle');
        expect(m1.procMotionModules.idle.some((s: any) => s.id === 'test-proc-cleanup')).toBe(true);

        unregisterModule('test-proc-cleanup');

        expect(m1.procMotionModules.idle.some((s: any) => s.id === 'test-proc-cleanup')).toBe(false);
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

    it('旧状态中的 NaN/Infinity 读取时兜底为默认值', () => {
        shared.mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setActiveMotionWithModules();
        shared.mockActiveMotion.value.motionModules = [
            { id: 'body-posture', enabled: false, params: { tilt: NaN, bend: Infinity } },
        ];
        const state = getModuleState('m1', 'body-posture');
        expect(state.params.tilt).toBe(0);
        expect(state.params.bend).toBe(0);
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
