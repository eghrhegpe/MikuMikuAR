// @vitest-environment node
// [doc:adr-271] registry 拆分为 registry-core（状态机叶子）+ registry（内置模块装配层）。
// 本测试锁死拆分引入的加载顺序契约：状态机先被使用时挂起注册请求，装配层一加载即补执行。
// 若有人把 registerInitHook 的补执行去掉，或把 registry.ts 的 registerInitHook 调用删掉，
// 这里会失败——而不是等到线上出现「模块列表为空、覆盖面板全灰」才发现。
import { describe, it, expect, vi } from 'vitest';
import {
    mockState,
    mockBoneOverride,
    mockPerception,
    mockMotionIntent,
    mockMotionHistory,
} from './motion-modules-registry-mocks';

vi.mock('@/core/state', () => mockState());
vi.mock('@/scene/motion/bone-override', () => mockBoneOverride());
vi.mock('@/scene/motion/perception', () => mockPerception());
vi.mock('@/scene/motion/motion-intent', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/scene/motion/motion-intent')>();
    return { ...actual, ...mockMotionIntent() };
});
vi.mock('@/scene/motion/motion-modules/motion-history', () => mockMotionHistory());

describe('registry-core 加载顺序契约（ADR-271）', () => {
    it('状态机先于装配层被使用时，装配层加载后注册请求被补执行', async () => {
        // 全新模块图：只取状态机，模拟「module-base / preset-types 先行」的加载顺序
        vi.resetModules();
        const core = await import('@/scene/motion/motion-modules/registry-core');

        // 状态机此刻还没有 DEF 可注册
        expect(core.getRegisteredModules()).toEqual([]);

        // 触发一次幂等兜底（getModuleState 内部会调 _ensureInit）→ 挂起注册请求
        core.getModuleState('m1', 'left-foot');

        // 装配层加载：注入钩子时挂起的请求必须立即补执行。
        // 注意这里**不调用** initMotionModules()，也不调用任何会走 _ensureInit 的状态机函数——
        // 否则「钩子已注入后任一次 _ensureInit 都能注册」会把补执行的缺失掩盖掉。
        await import('@/scene/motion/motion-modules/registry');

        const ids = core.getRegisteredModules().map((m) => m.id);
        expect(ids).toContain('left-foot');
        expect(ids).toContain('right-foot');
        expect(ids).toContain('left-hand');
        expect(ids).toContain('right-hand');
        expect(ids).toContain('body-posture');
        expect(ids).toContain('riding-model');
    });

    it('registry 对外 API 与拆分前一致（状态机函数经 export * 转发）', async () => {
        vi.resetModules();
        const registry = await import('@/scene/motion/motion-modules/registry');
        for (const name of [
            'registerModule',
            'unregisterModule',
            'getRegisteredModules',
            'createModule',
            'getModuleState',
            'setModuleParam',
            'setModuleEnabled',
            'claimBones',
            'getOwnedBones',
            'releaseOwnedBones',
            'getModuleConflicts',
            'getAllConflicts',
            'getConflictCount',
            'setTargetModel',
            'clearAllModulesForModel',
            'applyMotionModulesToModel',
            'applyProcMotionModulesToModel',
            'getModuleDefaultParam',
            'PROC_ACTION_PREFIX',
            'getBuiltinModuleDefs',
            'initMotionModules',
        ]) {
            expect(registry, `registry 应转发 ${name}`).toHaveProperty(name);
        }
    });
});
