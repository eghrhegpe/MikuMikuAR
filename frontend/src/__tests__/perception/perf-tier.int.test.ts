// perception/perf-tier.int.test.ts — ADR-164 全员感知 + PerceptionPerfMonitor 性能档位（ADR-204 P3，拆自旧 perception.test.ts）
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockState = vi.hoisted(() => ({
    focusedModelId: null as string | null,
    triggerAutoSave: vi.fn(),
    modelManager: {
        get: vi.fn(),
        modelRegistry: new Map<string, any>(),
    },
    scene: {
        onBeforeRenderObservable: {
            add: vi.fn(() => ({})),
            remove: vi.fn(),
        },
        activeCamera: null,
        isDisposed: false,
    },
    isAudioPlaying: vi.fn(() => false),
    getAudioPath: vi.fn(() => ''),
    getProcBeatDetector: vi.fn(() => null),
    findLipMorph: vi.fn(() => null),
    findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
    amplitudeToWeight: vi.fn(() => 0),
}));
const mockPipeline = vi.hoisted(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    lastRunCallback: null as null | ((ctx?: any) => void),
}));

vi.mock('../../scene/scene', () => sceneModuleFactory(mockState));
vi.mock('../../ar/ar-camera', () => arCameraModuleMock);
vi.mock('../../core/wails-bindings', () => wailsBindingsModuleMock);
vi.mock('../../core/i18n/t', () => i18nTModuleMock);
vi.mock('@babylonjs/core/Materials/standardMaterial', () => standardMaterialModuleMock);
vi.mock('../../core/config', () => configModuleFactory(mockState));
vi.mock('../../scene/camera/camera', () => cameraModuleMock);
vi.mock('../../scene/motion/vmd-loader', () => vmdLoaderModuleMock);
vi.mock('@/core/audio', () => outfitAudioModuleFactory(mockState));
vi.mock('@/scene/manager/outfit', () => outfitModuleMock);
vi.mock('../../scene/env/props', () => envPropsModuleMock);
vi.mock('../../scene/env/_bridge/env-bridge', () => envBridgeModuleMock);
vi.mock('../../scene/env/env-impl', () => envImplModuleFactory(mockState));
vi.mock('../../scene/motion/motion-pipeline', () => motionPipelineModuleFactory(mockPipeline));
vi.mock('../../scene/motion/proc-motion-bridge', () => procMotionBridgeModuleFactory(mockState));
vi.mock('../../scene/motion/lipsync-bridge', () => lipsyncBridgeModuleMock);
vi.mock('../../motion-algos/procedural-motion', () => proceduralMotionModuleMock);
vi.mock('../../motion-algos/lipsync', () => lipsyncAlgosModuleFactory(mockState));

import {
    setupPerceptionTest,
    sceneModuleFactory,
    arCameraModuleMock,
    wailsBindingsModuleMock,
    i18nTModuleMock,
    standardMaterialModuleMock,
    configModuleFactory,
    cameraModuleMock,
    vmdLoaderModuleMock,
    outfitAudioModuleFactory,
    outfitModuleMock,
    envPropsModuleMock,
    envBridgeModuleMock,
    envImplModuleFactory,
    motionPipelineModuleFactory,
    procMotionBridgeModuleFactory,
    lipsyncBridgeModuleMock,
    proceduralMotionModuleMock,
    lipsyncAlgosModuleFactory,
    makeMockMorphManager,
    makeMockModelWithMorphManager,
    triggerLastObserver,
    type PerceptionSut,
} from './perception-mocks';
// 惰性加载：静态 import perception-observer 会拖 env/env → DefaultRenderingPipeline
// 重渲染管线（实测 import 2.57s）；改 beforeAll 运行时动态 import，不计入加载时依赖图
// （与 vitest.config.ts 注释的「源码模块惰性化解锁」同款手法）。
// 类型用 Awaited<typeof import(...)> 推断——类型层不触发运行时加载。
let PerceptionPerfMonitor: Awaited<
    typeof import('../../scene/motion/perception-shared')
>['PerceptionPerfMonitor'];
let feetDebug: Awaited<
    typeof import('../../scene/motion/perception-shared')
>['feetDebug'];
let _getActiveContextsByTier: Awaited<
    typeof import('../../scene/motion/perception-observer')
>['_getActiveContextsByTier'];

beforeAll(async () => {
    const shared = await import('../../scene/motion/perception-shared');
    PerceptionPerfMonitor = shared.PerceptionPerfMonitor;
    feetDebug = shared.feetDebug;
    ({ _getActiveContextsByTier } = await import('../../scene/motion/perception-observer'));
});

let sut: PerceptionSut;

beforeEach(async () => {
    sut = await setupPerceptionTest(mockState, mockPipeline);
});

describe('ADR-164 enableAllPerception / disableAllPerception', () => {
    it('1. enableAllPerception 后所有已加载模型有 context', () => {
        const inst = { mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] } };
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' || id === 'm2' ? inst : null
        );
        mockState.modelManager.modelRegistry.set('m1', inst);
        mockState.modelManager.modelRegistry.set('m2', inst);
        mockState.focusedModelId = 'm1';
        sut.activatePerception('m1');
        sut.enableAllPerception();

        // m2 也应被激活（全员感知）
        expect(sut.getPerceptionStateFor('m2').breathEnabled).toBe(true);
    });

    it('2. disableAllPerception 后仅焦点保留', () => {
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' || id === 'm2'
                ? { mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] } }
                : null
        );
        mockState.focusedModelId = 'm1';
        sut.activatePerception('m1');
        sut.pinPerception('m2');
        sut.disableAllPerception();

        // 焦点 m1 和 pinned m2 保留，其他关闭
        expect(sut.getPerceptionStateFor('m1').breathEnabled).toBe(true);
        expect(sut.getPerceptionStateFor('m2').breathEnabled).toBe(true);
    });

    it('3. enable→disable→enable toggle 后 lastOffsets 正确重置', () => {
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mockMmdModel = makeMockModelWithMorphManager(mockMorphManager);
        // 给 mock 模型一个上半身骨，让 _applyBreathing 真正写入 lastOffsets
        mockMmdModel.runtimeBones = [
            {
                name: '上半身',
                linkedBone: { rotationQuaternion: { copyFrom: vi.fn(), setAll: vi.fn() } },
                childBones: [],
            },
        ];
        const inst = { mmdModel: mockMmdModel };
        mockState.modelManager.get.mockImplementation(() => inst);
        mockState.modelManager.modelRegistry.set('m1', inst);
        mockState.modelManager.modelRegistry.set('m2', inst);
        mockState.focusedModelId = 'm1';

        // 第 1 步：激活 m1
        sut.activatePerception('m1');
        expect(sut.__testOnlyGetContext('m1')?.lastOffsets.breath).toBe(0);

        // 第 2 步：全员开启，m2 也激活
        sut.enableAllPerception();
        expect(sut.__testOnlyGetContext('m2')?.lastOffsets.breath).toBe(0);

        // 第 3 步：触发 observer，m2 的 lastOffsets.breath 应被写入非 0 值
        vi.spyOn(performance, 'now').mockReturnValue(1000);
        triggerLastObserver(mockPipeline);
        const ctxBefore = sut.__testOnlyGetContext('m2');
        expect(ctxBefore?.lastOffsets.breath).not.toBe(0);

        // 第 4 步：disableAll，m2 的 offsets 应被重置
        sut.disableAllPerception();
        expect(sut.__testOnlyGetContext('m2')?.lastOffsets.breath).toBe(0);

        // 第 5 步：再次 enableAll，m2 offsets 仍为 0（toggle 正确重置）
        sut.enableAllPerception();
        expect(sut.__testOnlyGetContext('m2')?.lastOffsets.breath).toBe(0);

        vi.restoreAllMocks();
    });
});

describe('ADR-164 PerceptionPerfMonitor tier', () => {
    it('3. getPerceptionPerfTier 默认返回 high', () => {
        expect(sut.getPerceptionPerfTier()).toBe('high');
    });

    it('4. setPerceptionPerfTier 手动设置覆盖 auto', () => {
        sut.setPerceptionPerfTier('low');
        expect(sut.getPerceptionPerfTier()).toBe('low');
        sut.setPerceptionPerfTier('medium');
        expect(sut.getPerceptionPerfTier()).toBe('medium');
        sut.setPerceptionPerfTier('auto');
        // 切回 auto 后，因无场景/模型数 ≤20，应恢复 high
        expect(sut.getPerceptionPerfTier()).toBe('high');
    });

    it('5. 手动 tier=low 时 gaze/balance/expression/lipsync 在 observer 中跳过', () => {
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        mockState.focusedModelId = 'm1';
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');

        // 强制 low 档
        sut.setPerceptionPerfTier('low');

        // 触发 observer
        triggerLastObserver(mockPipeline);

        // low 档下 expression 应被跳过（morph 权重为 0）
        expect(mockMorphManager.getInfluence('笑み')).toBe(0);
        nowSpy.mockRestore();
    });

    it('6. 手动 tier=medium 时 gaze 每 2 帧一次、expression 每 4 帧一次', () => {
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
        const mockMorphManager = makeMockMorphManager(['笑み']);
        const mmdModel = makeMockModelWithMorphManager(mockMorphManager);
        mockState.modelManager.get.mockReturnValue({ mmdModel });
        mockState.focusedModelId = 'm1';
        sut.setPerceptionState({ emotion: 'happy', microExpressionEnabled: true });
        sut.activatePerception('m1');

        sut.setPerceptionPerfTier('medium');

        // 第 1 帧（frameCounter=1）：expression 不运行（1%4!==0）
        triggerLastObserver(mockPipeline);
        const inf1 = mockMorphManager.getInfluence('笑み');

        // 第 4 帧（frameCounter=4）：expression 运行（4%4===0）
        // 需要再触发 3 次 observer 使 frameCounter 增加到 4
        for (let i = 0; i < 3; i++) {
            triggerLastObserver(mockPipeline);
        }
        const inf4 = mockMorphManager.getInfluence('笑み');

        // 第 1 帧应为 0，第 4 帧应 >0
        expect(inf1).toBe(0);
        expect(inf4).toBeGreaterThan(0);
        nowSpy.mockRestore();
    });

    it('7. pinPerception + tier=low 时 pinned 模型保留感知', () => {
        mockState.modelManager.get.mockImplementation((id: string) =>
            id === 'm1' || id === 'm2'
                ? { mmdModel: { mesh: { isDisposed: () => false }, runtimeBones: [] } }
                : null
        );
        mockState.focusedModelId = 'm1';
        sut.activatePerception('m1');
        sut.pinPerception('m2');
        sut.setPerceptionPerfTier('low');

        // low 档下仅焦点 + pinned 保留
        const tier = sut.getPerceptionPerfTier();
        expect(tier).toBe('low');
        expect(sut.getPinnedModelIds()).toContain('m2');

        // [fix:2026-08] 补全行为断言：low 档 _getActiveContextsByTier 只保留
        // focused(m1) + pinned(m2)，非 pinned 非焦点模型被剔除。
        // （微表情在 low 档整体跳过，故不可用 morph 权重断言，见 perception-observer.ts）
        const contexts = new Map<string, { modelId: string; isActive: boolean; isPinned: boolean }>([
            ['m1', { modelId: 'm1', isActive: true, isPinned: false }],
            ['m2', { modelId: 'm2', isActive: true, isPinned: true }],
            ['m3', { modelId: 'm3', isActive: true, isPinned: false }],
        ]);
        const active = _getActiveContextsByTier('low', contexts as any, 'm1');
        expect(active.map((c) => c.modelId).sort()).toEqual(['m1', 'm2']);
    });

    // ════════════════════════════════════════════════
    // ADR-164 审核补测：自动降级 6 分支
    // ════════════════════════════════════════════════

    it('A. 自动降级：fps<45 持续 60 帧→high→medium', () => {
        const monitor = new PerceptionPerfMonitor();
        const fpsMock = { getFps: () => 44 };
        const sceneMock = { getEngine: () => fpsMock };

        // 初始为 high
        expect(monitor.getTier()).toBe('high');

        // 前 29 帧：未到采样边界，tier 不变
        for (let i = 0; i < 29; i++) {
            monitor.update(sceneMock, 30);
            expect(monitor.getTier()).toBe('high');
        }
        // 第 30 帧（首次采样）：fps=44 < 45 → _lowStreak=30，但未达 60
        monitor.update(sceneMock, 30);
        expect(monitor.getTier()).toBe('high');

        // 再 30 帧（第 60 帧）：_lowStreak=60 ≥ 60 → stepDown: high→medium
        for (let i = 0; i < 29; i++) {
            monitor.update(sceneMock, 30);
            expect(monitor.getTier()).toBe('high');
        }
        monitor.update(sceneMock, 30);
        expect(monitor.getTier()).toBe('medium');
    });

    it('B. 自动升级：fps>55 持续 120 帧→medium→high', () => {
        const monitor = new PerceptionPerfMonitor();
        const lowFpsMock = { getFps: () => 44 };
        const highFpsMock = { getFps: () => 60 };
        const sceneLow = { getEngine: () => lowFpsMock };
        const sceneHigh = { getEngine: () => highFpsMock };

        // 先降级到 medium
        for (let i = 0; i < 60; i++) {
            monitor.update(sceneLow, 30);
        }
        expect(monitor.getTier()).toBe('medium');

        // 切到高 fps 累积 120 帧 → medium→high
        for (let i = 0; i < 120; i++) {
            monitor.update(sceneHigh, 30);
        }
        expect(monitor.getTier()).toBe('high');
    });

    it('C. 模型数>50 强制 low', () => {
        const monitor = new PerceptionPerfMonitor();
        const sceneMock = { getEngine: () => ({ getFps: () => 60 }) };

        monitor.update(sceneMock, 51);
        expect(monitor.getTier()).toBe('low');
    });

    it('D. 模型数≤20 强制 high', () => {
        const monitor = new PerceptionPerfMonitor();
        const sceneMock = { getEngine: () => ({ getFps: () => 30 }) };

        // 即使 fps=30（本应降级），模型数≤20 强制 high
        monitor.update(sceneMock, 5);
        expect(monitor.getTier()).toBe('high');
    });

    it('E. medium 档最多 10 个非焦点模型', () => {
        const contexts = new Map<string, any>();
        for (let i = 1; i <= 15; i++) {
            const id = `m${i}`;
            contexts.set(id, {
                modelId: id,
                isActive: true,
                isPinned: false,
            });
        }

        // 焦点 m1 也 active
        const _focused = contexts.get('m1')!;
        const result = _getActiveContextsByTier('medium', contexts, 'm1');

        // 应包含焦点 + pinned(0) + 前 10 个其他 = 11 个
        expect(result.length).toBe(11);
        expect(result[0].modelId).toBe('m1');
        // m1 排首位，其余按 Map 序遍历顺序取前 10
        for (let i = 2; i <= 11; i++) {
            expect(result.some((c) => c.modelId === `m${i}`)).toBe(true);
        }
        // m12-m15 被截断
        expect(result.some((c) => c.modelId === 'm12')).toBe(false);
    });

    it('F. 手动档 + fps 偏低 + 模型数多时 warn', () => {
        feetDebug.value = true;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const monitor = new PerceptionPerfMonitor();
        const lowFpsMock = { getFps: () => 25 };
        const sceneMock = { getEngine: () => lowFpsMock };

        // 先让 monitor 在 auto 模式下采样到低 fps（第 30 帧采样）
        monitor.update(sceneMock, 30);
        for (let i = 0; i < 29; i++) {
            monitor.update(sceneMock, 30);
        }

        // ADR-248 帧节流：预热 _warnThrottleFrame 到 59，使下次 update 恰好命中 % 60 === 0
        (monitor as any)._warnThrottleFrame = 59;

        // 此时 this.fps = 25（已采样）+ 模型数 30 > 20
        // 切手动后，下次 update 应命中 fps<30 + modelCount>20 条件
        monitor.setManualTier('low');
        monitor.update(sceneMock, 30);

        expect(warnSpy).toHaveBeenCalled();
        const callArg = warnSpy.mock.calls[0][0] as string;
        expect(callArg).toContain('手动档');
        expect(callArg).toContain('fps');
        warnSpy.mockRestore();
        feetDebug.value = false;
    });
});
