// [doc:adr-204] model-detail-ui-mocks.ts — 共享 vi.mock 工厂（拆自 model-detail-ui.test.ts）
// 通用 Babylon/babylon-mmd 工厂复用 model-preset-mocks.ts，此处只补缺口 + 应用模块桩。
// 规矩同前：工厂同步 + Mock 类静态 import（禁 vi.importActual，hoist 期 TDZ）。
// mockModelManager 为普通 const 单例——vitest 每测试文件独立模块图，天然隔离；
// 各测试文件 beforeEach 里 cleanup() 复位（mockReset get）。
import { vi } from 'vitest';
import {
    MockShadowGenerator,
    MockGPUParticleSystem,
    MockParticleSystem,
    MockGridMaterial,
    MockBaseTexture,
    MockTexture,
    MockCubeTexture,
} from './mocks/babylon-classes';
import { sceneMockSuperset } from './mocks/scene-superset';

// ---- babylon.js 补缺工厂（model-preset-mocks 未覆盖的部分） ----
export const mockShadowGenerator = () => ({ ShadowGenerator: MockShadowGenerator });
export const mockGpuParticleSystem = () => ({ GPUParticleSystem: MockGPUParticleSystem });
export const mockParticleSystem = () => ({ ParticleSystem: MockParticleSystem });
export const mockGridMaterial = () => ({ GridMaterial: MockGridMaterial });
export const mockBaseTexture = () => ({ BaseTexture: MockBaseTexture });
export const mockTexture = () => ({ Texture: MockTexture });
export const mockCubeTexture = () => ({ CubeTexture: MockCubeTexture });
export const mockEmpty = () => ({});

// ---- 应用模块桩 ----
export const mockModelManager = {
    get: vi.fn(),
    focus: vi.fn(),
    arrange: vi.fn(),
    setVisibility: vi.fn(),
    setOpacity: vi.fn(),
    setWireframe: vi.fn(),
    setBoneLinesVis: vi.fn(),
    setBoneJointsVis: vi.fn(),
    setPhysics: vi.fn(),
    getPhysicsCategories: vi.fn().mockReturnValue([]),
    getPhysicsCatState: vi.fn().mockReturnValue(null),
    isPhysicsCategoryEnabled: vi.fn().mockReturnValue(false),
    setPhysicsCategory: vi.fn(),
    setScaling: vi.fn(),
    setRotationY: vi.fn(),
    setPosition: vi.fn(),
    getPosition: vi.fn().mockReturnValue([0, 0, 0]),
    setOrbit: vi.fn(),
    getOrbit: vi.fn().mockReturnValue(null),
    setPositionMode: vi.fn(),
    getPositionMode: vi.fn().mockReturnValue('cartesian'),
    resetTransform: vi.fn(),
    clearVmdData: vi.fn(),
    getMorphs: vi.fn().mockReturnValue([]),
    setMorphWeight: vi.fn(),
    getMorphWeight: vi.fn().mockReturnValue(0),
    resetMorphs: vi.fn(),
    remove: vi.fn(),
};

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
    DEFAULT_PROC_STATE: { mode: 'off', intensity: 0.5, speed: 1 },
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
