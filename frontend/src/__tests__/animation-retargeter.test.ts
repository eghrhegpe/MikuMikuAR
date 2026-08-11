// @vitest-environment node
// animation-retargeter.test.ts — 外部动作重定向桥接模块单测
// 覆盖 loadAndRetargetAnimation（加载/骨骼映射/重定向/清理守卫）、
// playRetargetedAnimation（additive 播放 + stop 幂等）、stopCurrentRetarget、
// getRetargetPlayState、restoreRetargetAnimation（场景反序列化恢复）。
//
// mock 策略：babylon-mmd 的 AnimationRetargeter / 骨骼映射预设、sceneLoader 的
// ImportMeshAsync、@/core/config 的 modelRegistry、feedback/logger 全部用假对象，
// 绝不真实例化 Babylon.js 对象。被测文件仅把 Scene/Skeleton 当类型用，esbuild 会
// 剥离其 import，无需 mock。
//
// 未覆盖：_cleanupTempMeshes 为私有函数，仅通过 loadAndRetargetAnimation 的失败/
// 成功路径间接覆盖（mesh/skeleton/group 的 dispose 断言已覆盖其核心逻辑）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const shared = vi.hoisted(() => {
    const ImportMeshAsync = vi.fn();
    const feedbackInfo = vi.fn();
    const feedbackStatus = vi.fn();
    const logWarn = vi.fn();
    const modelRegistry = new Map();
    const retargeterInstances: Array<{
        setBoneMap: ReturnType<typeof vi.fn>;
        setSourceSkeleton: ReturnType<typeof vi.fn>;
        setTargetSkeleton: ReturnType<typeof vi.fn>;
        retargetAnimation: ReturnType<typeof vi.fn>;
    }> = [];
    // 用 getter/setter 让工厂闭包读取「当前」配置，便于按用例切换返回值/抛错
    let retargetedGroup: unknown = null;
    let retargetImpl: (...args: unknown[]) => unknown = () => retargetedGroup;
    const AnimationRetargeter = vi.fn(function (this: {
        setBoneMap: ReturnType<typeof vi.fn>;
        setSourceSkeleton: ReturnType<typeof vi.fn>;
        setTargetSkeleton: ReturnType<typeof vi.fn>;
        retargetAnimation: ReturnType<typeof vi.fn>;
    }) {
        this.setBoneMap = vi.fn();
        this.setSourceSkeleton = vi.fn();
        this.setTargetSkeleton = vi.fn();
        this.retargetAnimation = vi.fn((...args: unknown[]) => retargetImpl(...args));
        retargeterInstances.push(this);
    });
    return {
        ImportMeshAsync,
        feedbackInfo,
        feedbackStatus,
        logWarn,
        modelRegistry,
        AnimationRetargeter,
        retargeterInstances,
        get retargetedGroup() {
            return retargetedGroup;
        },
        set retargetedGroup(v: unknown) {
            retargetedGroup = v;
        },
        get retargetImpl() {
            return retargetImpl;
        },
        set retargetImpl(f: (...args: unknown[]) => unknown) {
            retargetImpl = f;
        },
    };
});

vi.mock('@babylonjs/core/Loading/sceneLoader', () => ({
    ImportMeshAsync: shared.ImportMeshAsync,
}));
vi.mock('babylon-mmd/esm/Loader/Util/animationRetargeter', () => ({
    AnimationRetargeter: shared.AnimationRetargeter,
}));
vi.mock('babylon-mmd/esm/Loader/Util/mmdHumanoidMapper', () => ({
    MixamoMmdHumanoidBoneMap: { mixBone: 'mmdBone' },
    VrmMmdHumanoidBoneMap: { vrmBone: 'mmdBone' },
}));
vi.mock('@/core/config', () => ({
    modelRegistry: shared.modelRegistry,
}));
vi.mock('@/core/feedback', () => ({
    feedbackInfo: shared.feedbackInfo,
    feedbackStatus: shared.feedbackStatus,
}));
vi.mock('@/core/logger', () => ({
    logWarn: shared.logWarn,
}));

import {
    getRetargetPlayState,
    stopCurrentRetarget,
    loadAndRetargetAnimation,
    playRetargetedAnimation,
    restoreRetargetAnimation,
} from '../scene/motion/animation-retargeter';

// ======== 假对象工厂 ========

function makeSkeleton(): { dispose: ReturnType<typeof vi.fn> } {
    return { dispose: vi.fn() };
}

function makeMesh(
    skeleton: { dispose: ReturnType<typeof vi.fn> } | null
): { skeleton: unknown; dispose: ReturnType<typeof vi.fn> } {
    return { skeleton, dispose: vi.fn() };
}

function makeAnimationGroup(): {
    isAdditive: boolean;
    weight: number;
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
} {
    return { isAdditive: false, weight: 0, play: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
}

function makeRetargetResult(animationGroup: unknown, boneMapName = 'mixamo') {
    return { animationGroup, boneMapName };
}

beforeEach(() => {
    vi.clearAllMocks();
    shared.modelRegistry.clear();
    shared.retargeterInstances.length = 0;
    shared.retargetedGroup = makeAnimationGroup();
    shared.retargetImpl = () => shared.retargetedGroup;
    shared.ImportMeshAsync.mockResolvedValue({ meshes: [], animationGroups: [] });
    stopCurrentRetarget();
});

// ======== loadAndRetargetAnimation ========

describe('loadAndRetargetAnimation（加载 + 重定向 + 清理）', () => {
    it('正常：加载并重定向成功，返回结果并清理临时资源', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        const retargeted = makeAnimationGroup();
        shared.retargetedGroup = retargeted;
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });

        const result = await loadAndRetargetAnimation({} as never, 'a.fbx', makeSkeleton() as never, 'mixamo');

        expect(result).not.toBeNull();
        expect(result!.animationGroup).toBe(retargeted);
        expect(result!.boneMapName).toBe('mixamo');
        expect(shared.feedbackInfo).toHaveBeenCalledWith('motion.retarget.success', undefined);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(skeleton.dispose).toHaveBeenCalled();
        expect(group.dispose).toHaveBeenCalled();
    });

    it('守卫：ImportMeshAsync 抛错 → 返回 null + loadFailed 反馈', async () => {
        shared.ImportMeshAsync.mockRejectedValue(new Error('load fail'));
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(result).toBeNull();
        expect(shared.logWarn).toHaveBeenCalled();
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.loadFailed', undefined, false);
    });

    it('守卫：无动画组 → 返回 null 并清理临时网格', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [] });
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(result).toBeNull();
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.noAnimation', undefined, false);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(skeleton.dispose).toHaveBeenCalled();
    });

    it('守卫：加载文件无骨骼 → 返回 null 并清理', async () => {
        const mesh = makeMesh(null);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(result).toBeNull();
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.noSkeleton', undefined, false);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(group.dispose).toHaveBeenCalled();
    });

    it('守卫：retargetAnimation 返回 null → 返回 null 并清理', async () => {
        shared.retargetedGroup = null;
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(result).toBeNull();
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.failed', undefined, false);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(group.dispose).toHaveBeenCalled();
    });

    it('守卫：retargetAnimation 抛错 → 返回 null 并清理', async () => {
        shared.retargetImpl = () => {
            throw new Error('retarget boom');
        };
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(result).toBeNull();
        expect(shared.logWarn).toHaveBeenCalled();
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.failed', undefined, false);
        expect(mesh.dispose).toHaveBeenCalled();
        expect(group.dispose).toHaveBeenCalled();
    });

    it('边界：custom 预设使用自定义骨骼映射', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const customMap = { customBone: 'mmdBone' };
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'custom', customMap);
        expect(result).not.toBeNull();
        const inst = shared.retargeterInstances[0];
        expect(inst.setBoneMap).toHaveBeenCalledWith(customMap);
        expect(inst.setSourceSkeleton).toHaveBeenCalledWith(skeleton);
        expect(inst.setTargetSkeleton).toHaveBeenCalled();
    });

    it('边界：vrm 预设使用 VrmMmdHumanoidBoneMap', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const result = await loadAndRetargetAnimation({} as never, 'a.vrm', makeSkeleton() as never, 'vrm');
        expect(result).not.toBeNull();
        const inst = shared.retargeterInstances[0];
        expect(inst.setBoneMap).toHaveBeenCalledWith({ vrmBone: 'mmdBone' });
    });

    it('正常：retargetAnimation 传入 cloneAnimation + removeBoneRotationOffset 选项', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        await loadAndRetargetAnimation({} as never, 'a.fbx', makeSkeleton() as never, 'mixamo');
        const inst = shared.retargeterInstances[0];
        expect(inst.retargetAnimation).toHaveBeenCalledWith(group, {
            cloneAnimation: true,
            removeBoneRotationOffset: false,
        });
    });

    it('正常：加载开始时发送 loading 反馈', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        await loadAndRetargetAnimation({} as never, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(shared.feedbackStatus).toHaveBeenCalledWith('motion.retarget.loading', undefined, false);
    });

    it('正常：多 mesh 共享同一 skeleton → skeleton 只 dispose 一次', async () => {
        const skeleton = makeSkeleton();
        const mesh1 = makeMesh(skeleton);
        const mesh2 = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({
            meshes: [mesh1, mesh2],
            animationGroups: [group],
        });
        await loadAndRetargetAnimation({} as never, 'a.fbx', makeSkeleton() as never, 'mixamo');
        expect(skeleton.dispose).toHaveBeenCalledTimes(1);
        expect(mesh1.dispose).toHaveBeenCalled();
        expect(mesh2.dispose).toHaveBeenCalled();
    });

    it('正常：多动画组仅使用第一个', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group1 = makeAnimationGroup();
        const group2 = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({
            meshes: [mesh],
            animationGroups: [group1, group2],
        });
        await loadAndRetargetAnimation({} as never, 'a.fbx', makeSkeleton() as never, 'mixamo');
        const inst = shared.retargeterInstances[0];
        expect(inst.retargetAnimation).toHaveBeenCalledWith(group1, expect.any(Object));
        expect(group1.dispose).toHaveBeenCalled();
        expect(group2.dispose).toHaveBeenCalled();
    });

    it('边界：custom 预设无自定义映射 → 回退 mixamo 预设', async () => {
        const skeleton = makeSkeleton();
        const mesh = makeMesh(skeleton);
        const group = makeAnimationGroup();
        shared.ImportMeshAsync.mockResolvedValue({ meshes: [mesh], animationGroups: [group] });
        const result = await loadAndRetargetAnimation({} as any, 'a.fbx', makeSkeleton() as never, 'custom');
        expect(result).not.toBeNull();
        const inst = shared.retargeterInstances[0];
        expect(inst.setBoneMap).toHaveBeenCalledWith({ mixBone: 'mmdBone' });
    });
});

// ======== playRetargetedAnimation ========

describe('playRetargetedAnimation（additive 播放 + stop 幂等）', () => {
    it('正常：设置 additive/weight/play 并保存播放状态', () => {
        const group = makeAnimationGroup();
        const result = makeRetargetResult(group, 'mixamo');
        const stop = playRetargetedAnimation({} as never, result as never, 'file.fbx', true);
        expect(group.isAdditive).toBe(true);
        expect(group.weight).toBe(1);
        expect(group.play).toHaveBeenCalledWith(true);
        expect(getRetargetPlayState()).toEqual({ filePath: 'file.fbx', boneMapPreset: 'mixamo' });
        expect(typeof stop).toBe('function');
    });

    it('守卫：stop 幂等（二次调用只清理一次）', () => {
        const group = makeAnimationGroup();
        const result = makeRetargetResult(group, 'vrm');
        const stop = playRetargetedAnimation({} as never, result as any, 'f.fbx');
        stop();
        stop();
        expect(group.stop).toHaveBeenCalledTimes(1);
        expect(group.dispose).toHaveBeenCalledTimes(1);
        expect(getRetargetPlayState()).toBeNull();
    });

    it('守卫：stop 后清理当前状态', () => {
        const group = makeAnimationGroup();
        const result = makeRetargetResult(group);
        playRetargetedAnimation({} as never, result as any, 'f.fbx');
        stopCurrentRetarget();
        expect(group.stop).toHaveBeenCalled();
        expect(group.dispose).toHaveBeenCalled();
        expect(getRetargetPlayState()).toBeNull();
    });

    it('边界：播放新 retarget 自动停止前一个', () => {
        const group1 = makeAnimationGroup();
        const result1 = makeRetargetResult(group1, 'mixamo');
        playRetargetedAnimation({} as never, result1 as never, 'f1.fbx');

        const group2 = makeAnimationGroup();
        const result2 = makeRetargetResult(group2, 'vrm');
        playRetargetedAnimation({} as never, result2 as never, 'f2.fbx');

        expect(group1.stop).toHaveBeenCalledTimes(1);
        expect(group1.dispose).toHaveBeenCalledTimes(1);
        expect(group2.isAdditive).toBe(true);
        expect(getRetargetPlayState()).toEqual({ filePath: 'f2.fbx', boneMapPreset: 'vrm' });
    });
});

// ======== stopCurrentRetarget / getRetargetPlayState ========

describe('stopCurrentRetarget / getRetargetPlayState', () => {
    it('边界：无活跃 stop 时 stopCurrentRetarget 不崩', () => {
        expect(() => stopCurrentRetarget()).not.toThrow();
        expect(getRetargetPlayState()).toBeNull();
    });

    it('边界：无活跃状态时 getRetargetPlayState 返回 null', () => {
        expect(getRetargetPlayState()).toBeNull();
    });
});

// ======== restoreRetargetAnimation ========

describe('restoreRetargetAnimation（场景反序列化恢复）', () => {
    it('守卫：model 不存在 → 返回 false', async () => {
        const ok = await restoreRetargetAnimation('f.fbx', 'mixamo', 'missing');
        expect(ok).toBe(false);
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：model 无 mmdModel → 返回 false', async () => {
        shared.modelRegistry.set('m1', {});
        const ok = await restoreRetargetAnimation('f.fbx', 'mixamo', 'm1');
        expect(ok).toBe(false);
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：mesh 无 skeleton → 返回 false', async () => {
        shared.modelRegistry.set('m1', { mmdModel: { mesh: { getScene: vi.fn() } } });
        const ok = await restoreRetargetAnimation('f.fbx', 'mixamo', 'm1');
        expect(ok).toBe(false);
        expect(shared.logWarn).toHaveBeenCalled();
    });

    it('守卫：loadAndRetargetAnimation 内部失败 → 返回 false，不更新播放状态', async () => {
        const targetSkeleton = makeSkeleton();
        const targetMesh = { skeleton: targetSkeleton, getScene: vi.fn(() => ({})) };
        shared.modelRegistry.set('m1', { mmdModel: { mesh: targetMesh } });
        shared.retargetedGroup = null;
        shared.ImportMeshAsync.mockResolvedValue({
            meshes: [makeMesh(makeSkeleton())],
            animationGroups: [makeAnimationGroup()],
        });
        const ok = await restoreRetargetAnimation('f.fbx', 'mixamo', 'm1');
        expect(ok).toBe(false);
        expect(getRetargetPlayState()).toBeNull();
    });

    it('正常：成功恢复并播放 → 返回 true', async () => {
        const targetSkeleton = makeSkeleton();
        const targetMesh = { skeleton: targetSkeleton, getScene: vi.fn(() => ({})) };
        shared.modelRegistry.set('m1', { mmdModel: { mesh: targetMesh } });
        const srcSkeleton = makeSkeleton();
        const srcMesh = makeMesh(srcSkeleton);
        shared.ImportMeshAsync.mockResolvedValue({
            meshes: [srcMesh],
            animationGroups: [makeAnimationGroup()],
        });
        const ok = await restoreRetargetAnimation('f.fbx', 'mixamo', 'm1');
        expect(ok).toBe(true);
        expect(getRetargetPlayState()).toEqual({ filePath: 'f.fbx', boneMapPreset: 'mixamo' });
    });
});