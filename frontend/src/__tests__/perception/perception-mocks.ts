// perception/perception-mocks.ts — perception 系测试共享桩（ADR-204 P3，上抬自旧 perception.test.ts 前导）
//
// 关键约束：旧 perception.test.ts 在 beforeEach 里 `vi.resetModules()` 后动态重导 SUT，
// 以保证用例间模块级状态隔离。resetModules 会清空模块缓存，若 mockState/mockPipeline 放在本模块，
// 重导时本模块被重新求值 → 生成「新实例」，与测试文件持有的 mockState 脱节（SUT 调新实例的 vi.fn，
// 断言看旧实例 → 误报 0 调用）。故 mockState/mockPipeline 必须用 vi.hoisted 留在各测试文件内，
// 本模块只导出「纯工厂函数」接收测试文件的 mockState，resetModules 重导时引用仍一致。
//
// 用法（每个拆分测试文件顶部）：
//   import { vi } from 'vitest';
//   const mockState = vi.hoisted(() => createMockState());
//   const mockPipeline = vi.hoisted(() => createMockPipeline());
//   vi.mock('../../scene/scene', () => sceneModuleFactory(mockState));
//   ...（其余 17 个 vi.mock 同理）
// 断言/共享助手（setupPerceptionTest / makeMockMorphManager 等）从本模块正常 import。
//
// NOTE: vi.mock specifier 必须与 SUT 导入解析到同一绝对路径；
// 拆分文件位于 src/__tests__/perception/，相对前缀为 '../../'（= src/）。

import { vi } from 'vitest';

export function createMockState() {
    return {
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
        // Lip-sync 依赖 mock（audio 管道 + 口型算法）
        isAudioPlaying: vi.fn(() => false),
        getAudioPath: vi.fn(() => ''),
        getProcBeatDetector: vi.fn(() => null),
        findLipMorph: vi.fn(() => null),
        findAllLipMorphs: vi.fn(() => ({ open: null, close: null, pucker: null, smile: null })),
        amplitudeToWeight: vi.fn(() => 0),
    };
}

// ADR-147 管线 mock：perception 通过 getMotionPipeline().register() 注册帧回调
export function createMockPipeline() {
    return {
        register: vi.fn(),
        unregister: vi.fn(),
        lastRunCallback: null as null | ((ctx?: any) => void),
    };
}

// ── vi.mock 工厂函数（接收测试文件的 mockState / mockPipeline）──

export function sceneModuleFactory(ms: any) {
    return {
        get focusedModelId() {
            return ms.focusedModelId;
        },
        modelManager: ms.modelManager,
        scene: ms.scene,
        triggerAutoSave: ms.triggerAutoSave,
    };
}

export const arCameraModuleMock = { isARActive: () => false };

// scene-serialize 重依赖：全部空 mock（仅在函数体内使用，模块加载期不触发）
export const wailsBindingsModuleMock = {};
export const i18nTModuleMock = { t: (k: string) => k };
export const standardMaterialModuleMock = {};

export function configModuleFactory(ms: any) {
    return {
        get focusedModelId() {
            return ms.focusedModelId;
        },
    };
}

export const cameraModuleMock = {};
export const vmdLoaderModuleMock = {};

export function outfitAudioModuleFactory(ms: any) {
    return {
        isAudioPlaying: ms.isAudioPlaying,
        getAudioPath: ms.getAudioPath,
    };
}
export const outfitModuleMock = {};
export const envPropsModuleMock = {};

export const envBridgeModuleMock = {
    registerEnvStateMiddleware: vi.fn(),
    setPresetAnimActive: vi.fn(),
    applyEnvStateFacade: vi.fn(),
    setEnvState: vi.fn(),
};

// perception.ts 通过 getScene() 延迟获取 scene 实例（避免与 scene.ts 形成静态循环依赖），
// 测试侧用 mockState.scene 复用同一份 mock，与 vi.mock('../../scene/scene') 行为一致
export function envImplModuleFactory(ms: any) {
    return {
        getScene: () => ms.scene,
    };
}

export function motionPipelineModuleFactory(mp: any) {
    return {
        getMotionPipeline: () => mp,
    };
}

export function procMotionBridgeModuleFactory(ms: any) {
    return {
        getProcBeatDetector: ms.getProcBeatDetector,
    };
}

export const lipsyncBridgeModuleMock = {};
export const proceduralMotionModuleMock = {};

export function lipsyncAlgosModuleFactory(ms: any) {
    return {
        findLipMorph: ms.findLipMorph,
        findAllLipMorphs: ms.findAllLipMorphs,
        amplitudeToWeight: ms.amplitudeToWeight,
    };
}

// ── 共享 setup：vi.resetModules + 动态重导 SUT + 重置共享状态 ──
// 注意：mockState / mockPipeline 由调用方通过 vi.hoisted 提供（见上方约束）
export type PerceptionSut = typeof import('../../scene/motion/perception');

export async function setupPerceptionTest(
    mockState: ReturnType<typeof createMockState>,
    mockPipeline: ReturnType<typeof createMockPipeline>
): Promise<PerceptionSut> {
    vi.resetModules();
    const sut = await import('../../scene/motion/perception');

    mockState.focusedModelId = null;
    mockState.triggerAutoSave.mockReset();
    mockState.modelManager.get.mockReset();
    mockState.scene.isDisposed = false;
    // ADR-147 管线 mock 重置：register 返回 unregister 函数，记录 run 回调供 triggerLastObserver 触发
    mockPipeline.register.mockReset();
    mockPipeline.unregister.mockReset();
    mockPipeline.lastRunCallback = null;
    mockPipeline.register.mockImplementation((layer: any) => {
        mockPipeline.lastRunCallback = layer.run;
        return () => mockPipeline.unregister(layer.id);
    });
    // Lip-sync mock 默认值：无音频、无 morph（各测试按需覆盖）
    mockState.isAudioPlaying.mockReset();
    mockState.isAudioPlaying.mockReturnValue(false);
    mockState.getAudioPath.mockReset();
    mockState.getAudioPath.mockReturnValue('');
    mockState.getProcBeatDetector.mockReset();
    mockState.getProcBeatDetector.mockReturnValue(null);
    mockState.findLipMorph.mockReset();
    mockState.findLipMorph.mockReturnValue(null);
    mockState.findAllLipMorphs.mockReset();
    mockState.findAllLipMorphs.mockReturnValue({
        open: null,
        close: null,
        pucker: null,
        smile: null,
    });
    mockState.amplitudeToWeight.mockReset();
    mockState.amplitudeToWeight.mockReturnValue(0);
    return sut;
}

// ── 共享 morph 助手（micro-expression / lipSync / perf-tier 用例复用）──

// Mock morphTargetManager（与 Babylon.js MorphTargetManager API 一致）
export function makeMockMorphManager(names: string[]) {
    const influences = new Map<string, number>();
    for (const n of names) {
        influences.set(n, 0);
    }
    return {
        numTargets: names.length,
        getTarget: (i: number) => ({
            name: names[i],
            set influence(v: number) {
                influences.set(names[i], v);
            },
        }),
        getTargetByName: (name: string) =>
            influences.has(name)
                ? {
                      set influence(v: number) {
                          influences.set(name, v);
                      },
                  }
                : null,
        getInfluence: (name: string) => influences.get(name) ?? 0,
    };
}

export function makeMockModelWithMorphManager(
    morphManager: ReturnType<typeof makeMockMorphManager>
) {
    return {
        mesh: { morphTargetManager: morphManager, isDisposed: () => false },
        runtimeBones: [],
    };
}

// 触发 perception 管线层回调（ADR-147 管线架构）
export function triggerLastObserver(mockPipeline: ReturnType<typeof createMockPipeline>): void {
    mockPipeline.lastRunCallback?.();
}

// 取与 SUT 同一次模块求值的骨覆盖 store（ADR-163 claimBones / ADR-166 隔离用例复用）
export async function getBoneOverrideStoreForTest() {
    const mod = await import('../../scene/motion/bone-override-store');
    return mod.getBoneOverrideStore();
}
