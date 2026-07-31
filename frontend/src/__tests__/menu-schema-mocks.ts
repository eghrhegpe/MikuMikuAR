// menu-schema-mocks.ts — 共享 vi.mock 工厂
// 工厂函数供各测试文件以 `vi.mock('...', () => factory())` 引用，避免重复书写。
// 仅 mock 渲染链路依赖的副作用模块；@/core/state 保持真实（部分用例直接断言其 getter/setter）。
import { vi } from 'vitest';

// —— 通用默认值 ——
const DEFAULT_RENDER_STATE = {
    bloomEnabled: false, bloomWeight: 1, bloomThreshold: 0.7, bloomKernel: 'box',
    outlineEnabled: false, outlineColor: '#000000',
    fxaaEnabled: true, msaaSamples: 4,
    toneMapping: 'aces', exposure: 1, contrast: 1,
    dofEnabled: false, dofAperture: 0, dofFocusDistance: 1, dofFocalLength: 50,
    vignetteEnabled: false, vignetteDarkness: 0,
    chromaticAberrationEnabled: false, chromaticAberrationAmount: 0,
    grainEnabled: false, grainIntensity: 0,
    sharpenAmount: 0, glowEnabled: false, glowIntensity: 0,
    ssaoEnabled: false, ssaoStrength: 1, ssaoRadius: 1, ssaoSamples: 8,
    celShadingMode: 'none', celColorLevels: 4, celEdgeThreshold: 0.1, celEdgeStrength: 1,
};

const DEFAULT_PERCEPTION_STATE = {
    gazeEnabled: false, gazeIntensity: 1, gazeSpeed: 1,
    gazeHeadEnabled: false, gazeHeadIntensity: 1, gazeHeadSpeed: 1,
    gazeEyeEnabled: false, gazeEyeIntensity: 1, gazeEyeSpeed: 1,
    blinkEnabled: false, blinkRate: 30, blinkIntensity: 1, blinkSpeed: 1,
    breathEnabled: false, breathRate: 0.2, breathIntensity: 1,
    balanceEnabled: false, balanceIntensity: 1,
    centerEnabled: false, centerIntensity: 1,
    upperEnabled: false, upperIntensity: 1,
    waistEnabled: false, waistIntensity: 1,
    lipSyncEnabled: false, lipSyncMultiMorphEnabled: false,
};

// —— 现有工厂（保持兼容，同时扩展以支持快照生成需求） ——
export const mockScene = () => ({
    setEnvState: vi.fn(),
    setRenderState: vi.fn(),
    getRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    defaultRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    transitionRenderState: vi.fn(),
    triggerAutoSave: vi.fn(),
    deserializeScene: vi.fn(),
    serializeScene: vi.fn(),
    popUndoSnapshot: vi.fn(),
    restoreUndoSnapshot: vi.fn(),
});

export const mockLighting = () => ({
    getLightState: vi.fn(() => ({})),
    setLightState: vi.fn(),
});

export const mockPerception = () => ({
    getPerceptionState: vi.fn(() => DEFAULT_PERCEPTION_STATE),
    getPerceptionStateFor: vi.fn(() => ({})),
    setPerceptionState: vi.fn(),
    setPerceptionStateFor: vi.fn(),
    activatePerception: vi.fn(),
    pinPerception: vi.fn(),
    unpinPerception: vi.fn(),
    enableAllPerception: vi.fn(),
    disableAllPerception: vi.fn(),
    getPinnedModelIds: vi.fn(() => []),
    getPerceptionPerfTier: vi.fn(() => 'medium'),
    getPerceptionPerfManualTier: vi.fn(() => 'medium'),
    setPerceptionPerfTier: vi.fn(),
    isAllPerceptionEnabled: vi.fn(() => false),
});

export const mockRegistry = () => ({
    getModuleDefaultParam: vi.fn(),
    getModuleConflicts: vi.fn(() => []),
});

// —— 新增工厂：供 schema-snapshot.test.ts 等使用 ——
export const mockCoreConfig = () => ({
    envState: { value: {} },
    uiState: { value: {} },
    cardContainer: vi.fn((container: HTMLElement, render: (c: HTMLElement) => void) => {
        container.innerHTML = '';
        render(container);
    }),
    applyHudVisibility: vi.fn(),
});

export const mockCoreAsync = () => ({
    swallowError: vi.fn(),
    fireAndForget: vi.fn(),
    delay: vi.fn(() => Promise.resolve()),
    waitForFrame: vi.fn(() => Promise.resolve()),
    makeLazyLoader: vi.fn(<T>(loader: T) => loader),
    LoadingGuard: vi.fn(),
    DebouncedTimer: vi.fn(),
    Abortable: vi.fn(),
});

export const mockCoreToast = () => ({
    showInfoToast: vi.fn(),
    showErrorToast: vi.fn(),
});

export const mockCoreRenderLoop = () => ({
    calcHardwareScaling: vi.fn(() => 1),
});

export const mockCoreAutoSave = () => ({
    triggerAutoSave: vi.fn(),
});

export const mockCoreStatusHelpers = () => ({
    tryCatchStatus: vi.fn(async (fn: () => unknown) => fn()),
});

export const mockCoreWailsBindings = () => ({
    GetPresetScenes: vi.fn(),
    GetPresetScenesDir: vi.fn(() => '/tmp/mock'),
    DeletePresetScene: vi.fn(),
    LoadSceneFile: vi.fn(),
    SaveScenePreset: vi.fn(),
});

export const mockRenderer = () => ({
    getRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    setRenderState: vi.fn(),
    defaultRenderState: vi.fn(() => DEFAULT_RENDER_STATE),
    registerCelGroundCoupling: vi.fn(),
    initRenderer: vi.fn(),
    isRendererReady: vi.fn(() => true),
    disposeRenderer: vi.fn(),
    reattachPipeline: vi.fn(),
    isSSRActive: vi.fn(() => false),
    setSSRFromReflection: vi.fn(),
    rebuildOutlineState: vi.fn(),
    ToneMappingMode: {},
    pipeline: undefined,
});

export const mockRenderPerformance = () => ({
    setPerformanceMode: vi.fn(),
    getPerformanceMode: vi.fn(() => 'auto'),
    resetPerformanceSnapshot: vi.fn(),
});

export const mockSceneMenuState = () => ({
    getSceneMenu: vi.fn(() => null),
});

export const mockMotionPopup = () => ({
    getMotionMenu: vi.fn(() => null),
});

export const mockSettingsMenuState = () => ({
    getSettingsMenu: vi.fn(() => null),
});

export const mockMenu = () => ({
    getCurrentRenderingMenu: vi.fn(() => null),
});

export const mockMotionModuleRegistry = () => ({
    getModuleConflicts: vi.fn(() => []),
});

export const mockPresetListViewer = () => ({
    presetListContent: vi.fn(),
});

export const mockSceneRenderPresets = () => ({
    FILTER_PRESET_LABELS: {},
    getFilterPreset: vi.fn(),
});

export const mockSceneBundle = () => ({
    exportSceneBundle: vi.fn(),
    importSceneBundle: vi.fn(),
});