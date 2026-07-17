// [doc:adr-116] registry 单测 — createModule/getState/setState 对称、per-model 隔离、ownedBones 仲裁
// ADR P0 验收要求：createModule 返回实例 getState()/setState() 对称，不影响其他模块状态

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks（vi.mock 提升到文件顶部，先于 import 执行） ──
// vi.mock 工厂在文件顶部执行，此时顶层 const 尚未初始化，
// 因此必须用 vi.hoisted 把变量提升到与 vi.mock 同一阶段。

const { mockModelRegistry, setBoneOverrideSpy, clearBoneOverrideSpy } = vi.hoisted(() => ({
    mockModelRegistry: new Map<string, any>(),
    setBoneOverrideSpy: vi.fn(),
    clearBoneOverrideSpy: vi.fn(),
}));

vi.mock('@/core/state', () => ({
    modelRegistry: mockModelRegistry,
    setUIPersistCallback: vi.fn(),
}));

vi.mock('@/scene/motion/bone-override', () => ({
    setBoneOverride: setBoneOverrideSpy,
    clearBoneOverride: clearBoneOverrideSpy,
    setBoneOverridePosition: vi.fn(),
}));

// head-tracking 引入 perception，perception 引入 scene.ts (顶层 new Scene)
// 单测环境无 engine，需 mock perception 避免触发 scene 初始化
vi.mock('@/scene/motion/perception', () => ({
    setHeadTrackingEnabled: vi.fn(),
}));

// ── 被测模块 ──

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
    setTargetModel,
    clearAllModulesForModel,
    registerModule,
    unregisterModule,
} from '@/scene/motion/motion-modules/registry';

// ── Helpers ──

function makeModel(id: string): any {
    return {
        id,
        name: id,
        motionOverrideModules: undefined as any,
        boneOverrides: [],
    };
}

function resetAll(): void {
    mockModelRegistry.clear();
    setBoneOverrideSpy.mockClear();
    clearBoneOverrideSpy.mockClear();
    // 重置 setTargetModel 内部 _currentModelId：通过切换到 null 再到目标
    setTargetModel(null);
}

// ═════════════════════════════════════════════════════════════════════
//  Tests
// ═════════════════════════════════════════════════════════════════════

describe('initMotionModules', () => {
    beforeEach(resetAll);

    it('幂等：重复调用不重复注册', () => {
        initMotionModules();
        const count1 = getRegisteredModules().length;
        initMotionModules();
        const count2 = getRegisteredModules().length;
        expect(count2).toBe(count1);
        expect(count1).toBeGreaterThanOrEqual(2); // body-posture + hand-symmetry
    });

    it('注册 body-posture 和 hand-symmetry 两个内置模块', () => {
        initMotionModules();
        const ids = getRegisteredModules().map((m) => m.id);
        expect(ids).toContain('body-posture');
        expect(ids).toContain('hand-symmetry');
    });
});

describe('getRegisteredModules', () => {
    beforeEach(resetAll);

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
});

describe('createModule', () => {
    beforeEach(resetAll);

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
    beforeEach(resetAll);

    it('首次获取自动创建状态并种入 defaults', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
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

describe('setModuleParam / setModuleEnabled', () => {
    beforeEach(resetAll);

    it('setModuleParam 写入参数', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setModuleParam('m1', 'body-posture', 'tilt', 10);
        const state = getModuleState('m1', 'body-posture');
        expect(state.params.tilt).toBe(10);
    });

    it('setModuleEnabled 写入启用状态', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        setModuleEnabled('m1', 'body-posture', true);
        const state = getModuleState('m1', 'body-posture');
        expect(state.enabled).toBe(true);
    });
});

describe('per-model 隔离', () => {
    beforeEach(resetAll);

    it('两个模型的模块状态互不串扰', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();

        setModuleParam('m1', 'body-posture', 'tilt', 15);
        setModuleParam('m2', 'body-posture', 'tilt', -5);
        setModuleEnabled('m2', 'body-posture', true);

        const s1 = getModuleState('m1', 'body-posture');
        const s2 = getModuleState('m2', 'body-posture');

        expect(s1.params.tilt).toBe(15);
        expect(s1.enabled).toBe(false);
        expect(s2.params.tilt).toBe(-5);
        expect(s2.enabled).toBe(true);
    });
});

describe('getState / setState 对称', () => {
    beforeEach(resetAll);

    it('getState 返回合并默认值的快照', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        const mod = createModule('body-posture', 'm1')!;
        setModuleParam('m1', 'body-posture', 'tilt', 8);
        const snap = mod.getState();
        expect(snap.params.tilt).toBe(8);
        expect(snap.params.bend).toBe(0); // 默认值兜底
    });

    it('setState 恢复后 getState 一致', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
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
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        const bp = createModule('body-posture', 'm1')!;
        const hs = createModule('hand-symmetry', 'm1')!;

        setModuleParam('m1', 'hand-symmetry', 'wristYaw', 30);
        bp.setState({ id: 'body-posture', enabled: true, params: { tilt: 1, bend: 2, twist: 3 } });

        const hsState = hs.getState();
        expect(hsState.params.wristYaw).toBe(30); // 未被影响
    });
});

describe('ownedBones 冲突仲裁', () => {
    beforeEach(resetAll);

    it('claimBones 首次声明返回全部骨骼', () => {
        initMotionModules();
        const claimed = claimBones('m1', 'body-posture', ['上半身', '腰']);
        expect(claimed).toEqual(['上半身', '腰']);
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
        const claimed = claimBones('m1', 'hand-symmetry', ['上半身', '左腕']);
        expect(claimed).toEqual(['左腕']); // 上半身 被跳过
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

        // 高优先级（body-posture, priority=1）抢占
        const claimed = claimBones(testModel, 'body-posture', ['センター']);
        expect(claimed).toEqual(['センター']);

        // 验证：低优先级的 owned 被清除，引擎 slot 被清除
        expect(getOwnedBones(testModel, 'test-low-priority').has('センター')).toBe(false);
        expect(clearBoneOverrideSpy).toHaveBeenCalledWith('センター', testModel);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('抢占'));

        warnSpy.mockRestore();
        unregisterModule('test-low-priority'); // 清理测试模块
    });

    it('getOwnedBones 返回当前 owned 集合', () => {
        initMotionModules();
        claimBones('m1', 'body-posture', ['上半身', '腰']);
        const owned = getOwnedBones('m1', 'body-posture');
        expect(owned.has('上半身')).toBe(true);
        expect(owned.has('腰')).toBe(true);
        expect(owned.size).toBe(2);
    });

    it('releaseOwnedBones 返回并释放骨骼集合', () => {
        initMotionModules();
        claimBones('m1', 'body-posture', ['上半身', '腰']);
        const released = releaseOwnedBones('m1', 'body-posture');
        expect(released.has('上半身')).toBe(true);
        expect(released.has('腰')).toBe(true);
        // 释放后 getOwnedBones 为空
        expect(getOwnedBones('m1', 'body-posture').size).toBe(0);
    });
});

describe('disable 精确清除（P2-1）', () => {
    beforeEach(resetAll);

    it('disable 仅清 ownedBones，不误伤手动覆盖', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        const mod = createModule('body-posture', 'm1')!;

        // 模拟用户在高级子页手动覆盖 上半身（不经过模块，不被 owned）
        // 模块 enable 时 claim 并写入 上半身/腰/上半身2
        mod.enable();
        setBoneOverrideSpy.mockClear();

        // 手动覆盖 腰（模拟用户在高级子页操作，模块不知情）
        // 注意：手动覆盖直接写 _overrideMap，不经模块系统
        // 模块 disable 时应只清 ownedBones（上半身/腰/上半身2），但 腰 是模块 owned 的
        // 这里验证 disable 调用 clearBoneOverride 的骨骼集合 = ownedBones
        mod.disable();

        // disable 应调用 clearBoneOverride 4 次（上半身/腰/上半身2/センター — P2-4 新增位置骨）
        expect(clearBoneOverrideSpy).toHaveBeenCalledTimes(4);
        const clearedBones = clearBoneOverrideSpy.mock.calls.map((c) => c[0]);
        expect(clearedBones).toContain('上半身');
        expect(clearedBones).toContain('腰');
        expect(clearedBones).toContain('上半身2');
        expect(clearedBones).toContain('センター');
    });
});

describe('setTargetModel 作用域切换', () => {
    beforeEach(resetAll);

    it('切换到新模型时禁用旧模型 enabled 模块', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();

        // m1 启用 body-posture
        setModuleEnabled('m1', 'body-posture', true);
        setTargetModel('m1');
        setBoneOverrideSpy.mockClear();

        // 切换到 m2（m1 的 body-posture 应被 disable）
        setTargetModel('m2');

        // m1 的 body-posture disable 应触发 clearBoneOverride
        expect(clearBoneOverrideSpy).toHaveBeenCalled();
    });

    it('切换到新模型时启用新模型已保存的 enabled 模块', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        mockModelRegistry.set('m2', makeModel('m2'));
        initMotionModules();

        // m2 已保存 enabled 的 body-posture
        setModuleEnabled('m2', 'body-posture', true);
        setTargetModel('m1');
        setBoneOverrideSpy.mockClear();

        // 切换到 m2（body-posture 应被 enable → bake → setBoneOverride）
        setTargetModel('m2');

        expect(setBoneOverrideSpy).toHaveBeenCalled();
    });
});

describe('clearAllModulesForModel', () => {
    beforeEach(resetAll);

    it('清除所有 ownedBones 并清空 motionOverrideModules', () => {
        mockModelRegistry.set('m1', makeModel('m1'));
        initMotionModules();
        const mod = createModule('body-posture', 'm1')!;
        mod.enable();

        clearAllModulesForModel('m1');

        const inst = mockModelRegistry.get('m1');
        expect(inst.motionOverrideModules).toEqual([]);
        expect(clearBoneOverrideSpy).toHaveBeenCalled();
    });
});
