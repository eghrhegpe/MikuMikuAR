// [doc:adr-204] model-detail-ui-mocks.ts — 共享 vi.mock 工厂（拆自 model-detail-ui.test.ts）
// 通用 Babylon/babylon-mmd 工厂复用 babylon-factories.ts（单一规范源），此处只留
// 应用模块桩。规矩同前：工厂同步 + Mock 类静态 import（禁 vi.importActual，hoist 期 TDZ）。
// mockModelManager 为普通 const 单例——vitest 每测试文件独立模块图，天然隔离；
// 各测试文件 beforeEach 里 cleanup() 复位（mockReset get）。
import { vi } from 'vitest';
import { sceneMockSuperset, mockModelManagerBase } from './mocks/scene-superset';

// ---- babylon.js 补缺工厂（单一规范源：babylon-factories.ts，此处 re-export 防双源漂移） ----
export {
    mockShadowGenerator,
    mockGpuParticleSystem,
    mockParticleSystem,
    mockGridMaterial,
    mockBaseTexture,
    mockTexture,
    mockCubeTexture,
    mockEmpty,
} from './mocks/babylon-factories';

// ---- 应用模块桩 ----
// 收敛单一源：与 scene-superset.mockModelManagerBase 同构，不再各自内联（防增键漂移）
export const mockModelManager = mockModelManagerBase();

export const mockSceneScene = () => ({
    ...sceneMockSuperset({ modelManager: mockModelManager }),
    get modelManager() {
        return mockModelManager;
    },
    getModelMorphs: vi.fn().mockReturnValue([]),
    setModelMorphWeight: vi.fn(),
    resetModelMorphs: vi.fn(),
    setModelVisibility: vi.fn(),
    setModelOpacity: vi.fn(),
    removeModel: vi.fn(),
    getModelPosition: vi.fn().mockReturnValue([0, 0, 0]),
    setModelPosition: vi.fn(),
    setModelOrbit: vi.fn(),
    getModelOrbit: vi.fn().mockReturnValue(null),
    setModelPositionMode: vi.fn(),
    getModelPositionMode: vi.fn().mockReturnValue('cartesian'),
    setModelScaling: vi.fn(),
    setModelRotationY: vi.fn(),
    resetModelTransform: vi.fn(),
    scene: { onBeforeRenderObservable: { add: vi.fn(), remove: vi.fn() } },
});

export const mockSceneMenu = () => ({
    getSceneMenu: () => null,
});

export const mockOutfitModule = () => ({
    loadOutfits: async () => null,
    applyOutfitVariant: () => {},
    resetOutfit: () => {},
});

export const mockLipsync = () => ({
    LipSyncState: {},
    DEFAULT_LIPSYNC_STATE: { mode: 'off', intensity: 0.5, phonemeMap: {} },
    findLipMorph: () => null,
    amplitudeToWeight: () => 0,
});

export const mockProceduralMotion = () => ({
    ProcMotionState: {},
    ProcMotionMode: {},
    ProcModeKey: {},
    ProcMotionParams: {},
    DEFAULT_PROC_STATE: {
        mode: 'off',
        bpmQuantizeEnabled: true,
        eyeTrackingEnabled: true,
        headTrackingEnabled: true,
        params: {
            idle: {
                intensity: 0.5,
                speed: 1,
                boneToggles: {},
                vpdApplyEnabled: false,
                interpOverride: 'auto',
            },
            autodance: {
                intensity: 0.5,
                speed: 1,
                boneToggles: {},
                vpdApplyEnabled: false,
                interpOverride: 'auto',
            },
        },
    },
    migrateProcState: (raw: Record<string, unknown>) => ({
        mode: 'off',
        bpmQuantizeEnabled: true,
        eyeTrackingEnabled: true,
        headTrackingEnabled: true,
        params: {
            idle: {
                intensity: (raw?.intensity as number) ?? 0.5,
                speed: (raw?.speed as number) ?? 1,
                boneToggles: {},
                vpdApplyEnabled: false,
                interpOverride: 'auto',
            },
            autodance: {
                intensity: (raw?.intensity as number) ?? 0.5,
                speed: (raw?.speed as number) ?? 1,
                boneToggles: {},
                vpdApplyEnabled: false,
                interpOverride: 'auto',
            },
        },
    }),
    generateIdleVmd: () => new ArrayBuffer(100),
    generateAutoDanceVmd: () => new ArrayBuffer(100),
    shouldAutoDance: () => false,
    shouldIdle: () => false,
});

export const mockBeatDetectorModule = () => ({
    BeatDetector: class MockBeatDetector {
        detectBeatsFromEnergies() {
            return [];
        }
        bpmFromIntervals() {
            return 120;
        }
        reset() {}
        getBPM() {
            return 120;
        }
        getBeatPhase() {
            return 0;
        }
    },
});

export const mockAudioModule = () => ({
    syncAudioPlayback: () => {},
    loadAudioFile: async () => {},
    setVolume: () => {},
    setAudioOffset: () => {},
    getAudioPath: () => '',
    getAudioName: () => '',
    getVolume: () => 1,
    getAudioOffset: () => 0,
    isAudioPlaying: () => false,
    resumeAudio: () => {},
    pauseAudio: () => {},
    attachBeatDetector: () => {},
    loadAndPlayAudio: async () => {},
    stopAudio: () => {},
    clearAudio: () => {},
});
