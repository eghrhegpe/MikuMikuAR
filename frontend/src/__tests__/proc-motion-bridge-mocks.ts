// proc-motion-bridge 拆分共享 mock
//
// 关键约束（沿用 motion-modules-registry 已验证模式 + 适配 resetModules）：
//  - 原 God 文件用 vi.hoisted 在**同文件**定义 mockState，但 vi.hoisted 结果**不能 export 跨文件**。
//  - 本 SUT 测试使用 vi.resetModules() + 动态 import 取 fresh 模块，若把 mockState 做成跨文件共享单例，
//    resetModules 可能重算 mocks 模块导致引用错位。故改为：每个测试文件调用 createProcMockState()
//    生成本地 mockState（普通 const，不经 resetModules 重置），工厂函数以参数接收 state 保持纯净。
//  - vi.mock 工厂均为**延迟调用**（() => mockConfig(mockState)），import 完成后 SUT 求值时才执行，规避 hoisting 问题。
import { vi } from 'vitest';

export function createProcMockState() {
    return {
        // --- config mocks ---
        focusedModelId: null as string | null,
        mmdRuntime: null as any,
        triggerAutoSave: vi.fn(),

        // --- audio mocks ---
        isAudioPlaying: vi.fn(() => false),

        // --- scene mocks ---
        modelManager: {
            get: vi.fn(),
        } as any,
        focusedMmdModel: vi.fn(() => null),
        focusedModel: vi.fn(() => null),
        loadVMDMotion: vi.fn().mockResolvedValue(undefined),
        scene: {
            onBeforeRenderObservable: {
                add: vi.fn(),
                remove: vi.fn(),
            },
            activeCamera: null,
        } as any,
    };
}

export function resetProcMockState(s: ReturnType<typeof createProcMockState>): void {
    s.focusedModelId = null;
    s.mmdRuntime = null;
    s.triggerAutoSave.mockReset();
    s.isAudioPlaying.mockReset();
    s.isAudioPlaying.mockReturnValue(false);
    s.modelManager.get.mockReset();
    s.focusedMmdModel.mockReset();
    s.focusedMmdModel.mockReturnValue(null);
    s.focusedModel.mockReset();
    s.focusedModel.mockReturnValue(null);
    s.loadVMDMotion.mockReset();
    s.loadVMDMotion.mockResolvedValue(undefined);
    s.scene.onBeforeRenderObservable.add.mockReset();
    s.scene.onBeforeRenderObservable.remove.mockReset();
}

export function mockConfig(s: ReturnType<typeof createProcMockState>) {
    return {
        get focusedModelId() {
            return s.focusedModelId;
        },
        get mmdRuntime() {
            return s.mmdRuntime;
        },
        triggerAutoSave: s.triggerAutoSave,
        setUIState: (..._args: unknown[]) => undefined,
    };
}

export function mockAudio(s: ReturnType<typeof createProcMockState>) {
    return {
        isAudioPlaying: () => s.isAudioPlaying(),
    };
}

export function mockScene(s: ReturnType<typeof createProcMockState>) {
    return {
        get focusedModelId() {
            return s.focusedModelId;
        },
        modelManager: s.modelManager,
        focusedMmdModel: ((...args: any[]) => (s.focusedMmdModel as any)(...args)) as any,
        focusedModel: ((...args: any[]) => (s.focusedModel as any)(...args)) as any,
        loadVMDMotion: ((...args: any[]) => (s.loadVMDMotion as any)(...args)) as any,
        scene: s.scene,
        triggerAutoSave: s.triggerAutoSave,
    };
}

// 注意：rebuildCompositeAnimation 无 spy 断言，每次工厂调用生成新 vi.fn 即可。
export function mockVmdLayers() {
    return {
        rebuildCompositeAnimation: vi.fn(),
    };
}
