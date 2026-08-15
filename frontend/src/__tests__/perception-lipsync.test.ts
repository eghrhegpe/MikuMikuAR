// @vitest-environment node
// [doc:adr-164] 感知层 — Lip-sync per-model 隔离回归测试
// 锁定：多模型全员感知下 lip-sync 增量状态按模型隔离——
//  1) 关闭时每个模型只复位自己的 morph（修复前模块级单态导致非最后模型 morph 残留冻结）
//  2) 各模型 morph 缓存独立构建（不因交替渲染每帧重建，O(M) 扫描）
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBeat = vi.hoisted(() => ({ level: 1.0 }));

vi.mock('../scene/motion/proc-motion-bridge', () => ({
    getProcBeatDetector: () => ({ getLevel: () => mockBeat.level }),
}));
vi.mock('@/core/scene-action-bridge', () => ({
    getSceneAction: (key: string) => {
        if (key === 'isAudioPlaying') {
            return () => true;
        }
        if (key === 'getAudioPath') {
            return () => 'test.mp3';
        }
        return undefined;
    },
}));

type Sut = typeof import('../scene/motion/perception-lipsync');
let sut: Sut;

/** 最小 MorphTargetManager（名 → influence 映射，influence 可断言） */
function makeMorphManager(names: string[]) {
    const targets = names.map((name) => ({ name, influence: 0 }));
    return {
        numTargets: targets.length,
        getTarget: (i: number) => targets[i],
        getTargetByName: (name: string) => targets.find((t) => t.name === name) ?? null,
        targets,
    };
}

/** 构造最小 MmdModelLike（仅含 lip-sync 所需的 morphTargetManager） */
function makeModel(names: string[]) {
    const mm = makeMorphManager(names);
    return { model: { mesh: { morphTargetManager: mm } } as never, mm };
}

/** lip-sync 所需最小参数（其余字段不影响 _applyLipSync） */
const _state = {
    lipSyncSensitivity: 0.2,
    lipSyncIntensity: 0.8,
    lipSyncMultiMorphEnabled: false,
} as never;

beforeEach(async () => {
    mockBeat.level = 1.0;
    vi.resetModules();
    sut = await import('../scene/motion/perception-lipsync');
});

describe('_applyLipSync per-model 隔离', () => {
    it('关闭时仅复位自身 morph，不影响另一模型（修复多模型 morph 残留冻结）', () => {
        const a = makeModel(['あ', '笑み']);
        const b = makeModel(['あ', '笑み']);

        // 两个模型交替启用（全员感知场景）
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        sut._applyLipSync(b.model, 1, true, 'modelB', _state, 'high');

        const openA = a.mm.targets.find((t) => t.name === 'あ')!.influence;
        const openB = b.mm.targets.find((t) => t.name === 'あ')!.influence;
        expect(openA).toBeGreaterThan(0);
        expect(openB).toBeGreaterThan(0);

        // 关闭 A：只复位 A，B 保持
        sut._applyLipSync(a.model, 1, false, 'modelA', _state, 'high');
        expect(a.mm.targets.find((t) => t.name === 'あ')!.influence).toBe(0);
        expect(b.mm.targets.find((t) => t.name === 'あ')!.influence).toBeGreaterThan(0);

        // 再关闭 B：B 也复位（修复前模块级单态此时已为 null → B 残留冻结）
        sut._applyLipSync(b.model, 1, false, 'modelB', _state, 'high');
        expect(b.mm.targets.find((t) => t.name === 'あ')!.influence).toBe(0);
    });

    it('per-model 缓存独立：不同 morph 表的两模型交替渲染不触发对方缓存重建', () => {
        const a = makeModel(['あ', '笑み']);
        const b = makeModel(['ア', 'え']);
        const getTargetASpy = vi.spyOn(a.mm, 'getTarget');
        const getTargetBSpy = vi.spyOn(b.mm, 'getTarget');

        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        sut._applyLipSync(b.model, 1, true, 'modelB', _state, 'high');
        const aCallsAfterFirstRound = getTargetASpy.mock.calls.length;
        const bCallsAfterFirstRound = getTargetBSpy.mock.calls.length;
        expect(aCallsAfterFirstRound).toBeGreaterThan(0);
        expect(bCallsAfterFirstRound).toBeGreaterThan(0);

        // 再次交替渲染：各模型缓存已建，不应再调用 getTarget
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        sut._applyLipSync(b.model, 1, true, 'modelB', _state, 'high');
        expect(getTargetASpy.mock.calls.length).toBe(aCallsAfterFirstRound);
        expect(getTargetBSpy.mock.calls.length).toBe(bCallsAfterFirstRound);
    });

    it('dispose 后删除 per-model 运行时，下次调用会重建缓存', () => {
        const a = makeModel(['あ', '笑み']);
        const getTargetSpy = vi.spyOn(a.mm, 'getTarget');

        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        const callsAfterBuild = getTargetSpy.mock.calls.length;
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        expect(getTargetSpy.mock.calls.length).toBe(callsAfterBuild);

        sut._disposeLipSyncRuntime('modelA');
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        expect(getTargetSpy.mock.calls.length).toBeGreaterThan(callsAfterBuild);
    });

    it('BeatDetector 返回 NaN/Infinity 时不会污染平滑状态，恢复有限值后继续工作', () => {
        const a = makeModel(['あ']);

        mockBeat.level = Number.NaN;
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        expect(a.mm.targets[0].influence).toBe(0);

        mockBeat.level = Number.POSITIVE_INFINITY;
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        expect(a.mm.targets[0].influence).toBe(0);

        mockBeat.level = 1.0;
        sut._applyLipSync(a.model, 1, true, 'modelA', _state, 'high');
        expect(a.mm.targets[0].influence).toBeGreaterThan(0);
    });
});
