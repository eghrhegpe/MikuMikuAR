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

        // --- perception mocks ---
        setGazeConfig: vi.fn(),
        onPerceptionModelRemoved: vi.fn(),
        activatePerception: vi.fn(),

        // --- motion-intent mock ---
        getActiveMotion: vi.fn(() => null),

        // --- beat-detector mock ---
        beatDetectorInst: {
            _bpmQEnabled: false,
            getBPM: vi.fn(() => 0),
            getBpmQuantizeEnabled: vi.fn(),
            setBpmQuantizeEnabled: vi.fn(),
            dispose: vi.fn(),
        } as any,

        // --- procedural-motion mocks (vi.fn 实例跨 resetModules 持久) ---
        generateIdleVmd: vi.fn(() => new ArrayBuffer(0)),
        generateAutoDanceVmd: vi.fn(() => new ArrayBuffer(0)),
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

    // perception
    s.setGazeConfig.mockReset();
    s.onPerceptionModelRemoved.mockReset();
    s.activatePerception.mockReset();

    // motion-intent
    s.getActiveMotion.mockReset();
    s.getActiveMotion.mockReturnValue(null);

    // beat-detector
    s.beatDetectorInst._bpmQEnabled = false;
    s.beatDetectorInst.getBPM.mockReset();
    s.beatDetectorInst.getBPM.mockReturnValue(0);
    s.beatDetectorInst.getBpmQuantizeEnabled.mockReset();
    s.beatDetectorInst.getBpmQuantizeEnabled.mockImplementation(() => s.beatDetectorInst._bpmQEnabled);
    s.beatDetectorInst.setBpmQuantizeEnabled.mockReset();
    s.beatDetectorInst.setBpmQuantizeEnabled.mockImplementation((v: boolean) => { s.beatDetectorInst._bpmQEnabled = v; });
    s.beatDetectorInst.dispose.mockReset();

    // procedural-motion
    s.generateIdleVmd.mockReset();
    s.generateIdleVmd.mockReturnValue(new ArrayBuffer(0));
    s.generateAutoDanceVmd.mockReset();
    s.generateAutoDanceVmd.mockReturnValue(new ArrayBuffer(0));
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

// --- 以下为切断传递依赖链新增的 mock 工厂（ADR-206 后续优化） ---

type ProcMockState = ReturnType<typeof createProcMockState>;

// perception — 3 个 void 函数，bridge 只调用不读返回值
// 注意：真实 setGazeConfig 内部调用 triggerAutoSave，mock 须保持此行为
export function mockPerception(s: ProcMockState) {
    return {
        setGazeConfig: ((..._args: any[]) => { s.triggerAutoSave(); }) as any,
        onPerceptionModelRemoved: ((...args: any[]) => (s.onPerceptionModelRemoved as any)(...args)) as any,
        activatePerception: ((...args: any[]) => (s.activatePerception as any)(...args)) as any,
    };
}

// motion-intent — 1 个函数，bridge 读取返回值的 procMotion 字段
export function mockMotionIntent(s: ProcMockState) {
    return {
        getActiveMotion: ((...args: any[]) => (s.getActiveMotion as any)(...args)) as any,
    };
}

// beat-detector — 类 mock（单例模式：所有 new 返回同一 mock 实例）
export function mockBeatDetector(s: ProcMockState) {
    class MockBeatDetector {
        constructor() {
            return s.beatDetectorInst as any;
        }
    }
    return { BeatDetector: MockBeatDetector as any };
}

// procedural-motion — 常量 + 纯函数 + vi.fn 代理混合
// shouldAutoDance/shouldIdle 提供真实实现（纯函数，无外部依赖，bridge 用返回值做分支控制）
export function mockProceduralMotion(s: ProcMockState) {
    return {
        // 常量（从 proc-motion-shared.ts 复制，已确认）
        PROC_VMD_NAME_IDLE: 'IdleMotion',
        PROC_VMD_NAME_AUTODANCE: 'AutoDance',
        PROC_MOTION_BONE_CATEGORIES: [
            'center', 'upper', 'upper2', 'waist', 'head', 'arm',
            'groove', 'shoulder', 'allParent', 'wrist', 'footIk', 'blink', 'emotion',
        ] as const,
        get DEFAULT_PROC_STATE() {
            return {
                mode: 'off' as const,
                intensity: 0.5,
                speed: 1.0,
                boneToggles: {
                    center: true, upper: true, upper2: true, waist: true,
                    head: true, arm: true, groove: true, shoulder: true,
                    allParent: true, wrist: true, footIk: true, blink: true, emotion: true,
                },
                bpmQuantizeEnabled: true,
                vpdApplyEnabled: false,
                interpOverride: 'auto' as const,
                multiMorphEnabled: false,
                eyeTrackingEnabled: true,
                headTrackingEnabled: true,
            };
        },
        // 纯函数 — 真实实现
        shouldAutoDance(audioPlaying: boolean, mode: string): boolean {
            if (mode === 'idle') return false;
            if (mode === 'autodance') return true;
            return audioPlaying;
        },
        shouldIdle(audioPlaying: boolean, hasUserVmd: boolean, mode: string): boolean {
            return !audioPlaying && !hasUserVmd && (mode === 'idle' || mode === 'off' || mode === 'autodance');
        },
        // vi.fn 代理（测试可通过 mockState 配置返回值 + 断言调用）
        get generateIdleVmd() { return s.generateIdleVmd; },
        get generateAutoDanceVmd() { return s.generateAutoDanceVmd; },
    };
}
