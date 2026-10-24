import { describe, expect, it, vi } from 'vitest';
import {
    BootPlanError,
    defineBootStep,
    runBootPlan,
    validateBootPlan,
    type BootStep,
    type BootResource,
} from '@/scene/boot-plan';
import { buildBootPlan, type BootHooks } from '@/scene/boot-steps';

/** 造一份"会记账"的钩子：记录调用顺序，其余行为最小化（不碰 Babylon）。 */
function createHooks(): { hooks: BootHooks; calls: string[] } {
    const calls: string[] = [];
    const record =
        <T>(name: string, value: T) =>
        () => {
            calls.push(name);
            return value;
        };
    // [doc:adr-276] 异步步钩子签名是 () => Promise<void>，同步 record 返回 undefined 不兼容
    const recordAsync = (name: string) => async (): Promise<void> => {
        calls.push(name);
    };
    const runtime = { __tag: 'runtime' } as unknown as Awaited<
        ReturnType<BootHooks['initMmdRuntime']>
    >;
    const manager = { __tag: 'manager' } as unknown as ReturnType<BootHooks['initModelManager']>;
    const beat = { __tag: 'beat' } as unknown as ReturnType<BootHooks['createBeatDetector']>;
    const hooks: BootHooks = {
        initMmdLoaders: recordAsync('initMmdLoaders'),
        initMmdRuntime: async () => {
            calls.push('initMmdRuntime');
            return runtime;
        },
        startWindPhysics: (rt) => {
            calls.push('startWindPhysics');
            expect(rt).toBe(runtime);
        },
        applyGroundCollision: record('applyGroundCollision', undefined),
        initLighting: record('initLighting', undefined),
        initRenderer: record('initRenderer', undefined),
        initEnvFacade: record('initEnvFacade', undefined),
        createBeatDetector: record('createBeatDetector', beat),
        attachBeatDetector: (b) => {
            calls.push('attachBeatDetector');
            expect(b).toBe(beat);
        },
        bindSceneEvents: record('bindSceneEvents', undefined),
        injectRuntimeCallbacks: async (r) => {
            calls.push('injectRuntimeCallbacks');
            expect(r).toBe(runtime);
        },
        initModelManager: (r) => {
            calls.push('initModelManager');
            expect(r).toBe(runtime);
            return manager;
        },
        injectModelCallbacks: record('injectModelCallbacks', undefined),
        initLoader: (r, m) => {
            calls.push('initLoader');
            expect(r).toBe(runtime);
            expect(m).toBe(manager);
        },
        initPlayback: () => {
            calls.push('initPlayback');
            return () => {};
        },
        initFeetAdjustment: recordAsync('initFeetAdjustment'),
        initFootstep: recordAsync('initFootstep'),
        initBoneOverride: recordAsync('initBoneOverride'),
        initWasmIkResolver: recordAsync('initWasmIkResolver'),
        initMotionModules: recordAsync('initMotionModules'),
        applyEnvState: record('applyEnvState', undefined),
        updateSunDisc: record('updateSunDisc', undefined),
        registerRenderBridge: record('registerRenderBridge', undefined),
        registerAiBridge: record('registerAiBridge', undefined),
    };
    return { hooks, calls };
}

describe('buildBootPlan / validateBootPlan', () => {
    it('真实 plan 通过静态校验，且没有任何步骤重复提供同一资源', () => {
        const { hooks } = createHooks();
        expect(validateBootPlan(buildBootPlan(hooks))).toEqual([]);
    });

    it('按声明顺序执行，且资源真的从提供方流到消费方', async () => {
        const { hooks, calls } = createHooks();
        const satisfied = await runBootPlan(buildBootPlan(hooks));

        expect(calls).toEqual([
            'initMmdLoaders',
            'initMmdRuntime',
            'startWindPhysics',
            'applyGroundCollision',
            'initLighting',
            'initRenderer',
            'initEnvFacade',
            'createBeatDetector',
            'attachBeatDetector',
            'bindSceneEvents',
            'injectRuntimeCallbacks',
            'initModelManager',
            'injectModelCallbacks',
            'initLoader',
            'initPlayback',
            'initFeetAdjustment',
            'initFootstep',
            'initBoneOverride',
            'initWasmIkResolver',
            'initMotionModules',
            'applyEnvState',
            'updateSunDisc',
            'registerRenderBridge',
            'registerAiBridge',
        ]);
        expect(satisfied.get('model-manager')).toBeDefined();
        expect(satisfied.get('mmd-runtime')).toBeDefined();
    });

    it('五条曾被注释藏着的顺序契约现在写在 requires 里，可被断言', () => {
        const { hooks } = createHooks();
        const requires = new Map(buildBootPlan(hooks).map((s) => [s.id, s.requires]));
        // 加载器/材质构建器注册必须早于任何一次模型加载
        expect(requires.get('loader')).toContain('mmd-loaders');
        // 脚步声消费脚部跟随的落地事件
        expect(requires.get('footstep')).toEqual(['feet-adjustment']);
        // WASM IK 重解回调会被 stopBoneOverride 清空，且要读已设好的 mmdRuntime
        expect(requires.get('wasm-ik-resolver')).toEqual(['bone-override', 'mmd-runtime']);
        // 早于 setMmdRuntime 时 getPhysicsImpl() 返回 null，地板静默消失
        expect(requires.get('ground-collision')).toEqual(['mmd-runtime']);
        // 风物理的参数类型已是门禁，这里的 requires 只为可读/可观测
        expect(requires.get('wind-physics')).toEqual(['mmd-runtime']);
    });

    it('每次执行都产生独立的资源表（HMR 重入不会因"已提供"而跳过步骤）', async () => {
        const { hooks, calls } = createHooks();
        await runBootPlan(buildBootPlan(hooks));
        calls.length = 0;
        await runBootPlan(buildBootPlan(hooks));
        expect(calls[0]).toBe('initMmdLoaders');
        expect(calls).toHaveLength(24);
    });
});

describe('validateBootPlan 静态规则', () => {
    it('依赖出现在提供之前 → 报错并点名两个步骤', () => {
        const plan = [
            defineBootStep({
                id: 'consumer',
                requires: ['loader'],
                provides: [],
                run: () => ({}),
            }),
            defineBootStep({
                id: 'producer',
                requires: [],
                provides: ['loader'],
                run: () => ({ loader: undefined }),
            }),
        ];
        const problems = validateBootPlan(plan);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('"consumer"');
        expect(problems[0]).toContain('"loader"');
    });

    it('重复 provide 同一资源 → 报错（谁是权威不允许含糊）', () => {
        const plan = [
            defineBootStep({
                id: 'a',
                requires: [],
                provides: ['loader'],
                run: () => ({ loader: undefined }),
            }),
            defineBootStep({
                id: 'b',
                requires: [],
                provides: ['loader'],
                run: () => ({ loader: undefined }),
            }),
        ];
        expect(validateBootPlan(plan).join('\n')).toContain('provided by both "a" and "b"');
    });

    it('步骤 require 自己 provide 的东西 → 自环报错', () => {
        const plan = [
            defineBootStep({ id: 'self', requires: ['beat'], provides: ['beat'], run: () => ({}) }),
        ];
        expect(validateBootPlan(plan).join('\n')).toContain('self-dependency');
    });

    it('重复步骤 id → 报错', () => {
        const plan = [
            defineBootStep({ id: 'dup', requires: [], provides: [], run: () => ({}) }),
            defineBootStep({ id: 'dup', requires: [], provides: [], run: () => ({}) }),
        ];
        expect(validateBootPlan(plan).join('\n')).toContain('duplicate step id "dup"');
    });
});

describe('runBootPlan 运行时断言', () => {
    it('plan 非法时不执行任何步骤', async () => {
        const run = vi.fn(() => ({}));
        const plan: BootStep<BootResource>[] = [
            defineBootStep({ id: 'consumer', requires: ['loader'], provides: [], run }),
            defineBootStep({
                id: 'producer',
                requires: [],
                provides: ['loader'],
                run: () => ({ loader: undefined }),
            }),
        ];
        await expect(runBootPlan(plan)).rejects.toBeInstanceOf(BootPlanError);
        expect(run).not.toHaveBeenCalled();
    });

    it('声明了 provides 却没在返回值里给出 → 立刻抛错，报出步 id 与资源名', async () => {
        const plan = [
            defineBootStep({ id: 'liar', requires: [], provides: ['loader'], run: () => ({}) }),
        ];
        await expect(runBootPlan(plan)).rejects.toThrow(/step "liar" declares provides "loader"/);
    });

    it('返回了未声明的资源 → 抛错提醒补 provides', async () => {
        const plan = [
            defineBootStep({
                id: 'extra',
                requires: [],
                provides: [],
                run: () => ({ loader: undefined }),
            }),
        ];
        await expect(runBootPlan(plan)).rejects.toThrow(/undeclared resource "loader"/);
    });

    it('顺序违约在执行前就被拦下，错误里带步 id、位置与资源名', async () => {
        // 真实报错现场（2026-10）：把 loader 挪到 model-manager 之前，tsc/vitest 都不会报，
        // 只有首次加载模型时崩。现在 validateBootPlan 直接点名双方。
        const plan = [
            defineBootStep({
                id: 'model-manager',
                requires: [],
                provides: ['model-manager'],
                run: () => ({ 'model-manager': { __tag: 'm' } as never }),
            }),
            defineBootStep({
                id: 'loader',
                requires: ['mmd-runtime'],
                provides: [],
                run: () => ({}),
            }),
        ];
        await expect(runBootPlan(plan)).rejects.toThrow(
            /step "loader" \(position 1\) requires "mmd-runtime", but no earlier step provides it/
        );
    });
});
