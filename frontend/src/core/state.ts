/**
 * [doc:architecture] Shared mutable state for MikuMikuAR.
 * Extracted from config.ts — global variables, setters, runtime state.
 *
 * @remarks 状态访问规约（[fix:ghost-state] P3 防御）
 * - 本文件中所有 `export let` 变量**仅供读取**，外部模块禁止直接赋值。
 * - 修改必须通过对应的 `setXxx()` setter，以保证状态变更点可追踪（单一写入点原则）。
 * - 引用类型变量（Map/Set/数组）的**内容**可被 mutate（如 `modelRegistry.set(...)`），
 *   但**引用本身**的替换必须通过 setter（如 `setModelRegistry(newMap)`）。
 * - 已 grep 验证：生产代码无绕过 setter 的直接赋值，风险为理论性。
 */

import { reactive } from './reactivity';
import { logWarn } from './utils';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type {
    ModelInstance,
    PropInstance,
    OverridePaths,
    LibraryModel,
    UIState,
    EnvState,
    PendingVmd,
    RecentMotion,
    DisplayNamePriority,
    CameraMode,
    LibrarySortMode,
    FeetState,
} from './types';

// ======== MMD Runtime ========

export let mmdRuntime: IMmdRuntime | null = null;
export function setMmdRuntime(r: IMmdRuntime | null): void {
    mmdRuntime = r;
}

// ======== MMD Runtime Type Switch (WASM 物理 / JS 调试) ========
// [doc:adr-105] Fail-Fast：localStorage 不可用直接抛错，不再静默回落 env

const MMD_RUNTIME_TYPE_KEY = 'mmdRuntimeType';

export function getMmdRuntimeType(): 'wasm' | 'js' {
    const v = localStorage.getItem(MMD_RUNTIME_TYPE_KEY);
    if (v === 'js' || v === 'wasm') {
        return v;
    }
    return import.meta.env.VITE_MMD_RUNTIME === 'js' ? 'js' : 'wasm';
}

export function setMmdRuntimeType(v: 'wasm' | 'js'): void {
    localStorage.setItem(MMD_RUNTIME_TYPE_KEY, v);
}

// ======== Model Registry ========

export let modelRegistry = new Map<string, ModelInstance>();
export function setModelRegistry(m: Map<string, ModelInstance>): void {
    modelRegistry = m;
}

// ======== Feet Adjustment (ADR-085) Default ========

/** [doc:adr-085] 脚部地面跟随默认状态（Phase A 参数） */
export function createDefaultFeetState(): FeetState {
    return {
        enabled: false,
        intensity: 1,
        soleHeight: 0,
        jumpThreshold: 0.5,
        bodySmooth: 0.5,
        footSmooth: 0.5,
        maxAngle: 30,
        reachAngle: 15,
    };
}

// ======== Prop Registry ========

export let propRegistry = new Map<string, PropInstance>();
export function setPropRegistry(m: Map<string, PropInstance>): void {
    propRegistry = m;
}

// ======== Focused Model ========

export let focusedModelId: string | null = null;
export function setFocusedModelId(id: string | null): void {
    focusedModelId = id;
}

// ======== Port ========

export let currentPort = 0;
export function setCurrentPort(p: number): void {
    currentPort = p;
}

// ======== Playback State ========

export let isPlaying = false;
export function setIsPlaying(v: boolean): void {
    isPlaying = v;
}

export let autoLoop = true;
export function setAutoLoop(v: boolean): void {
    autoLoop = v;
}

// ======== Pending VMD ========
// 注：isLoadingModel / isLoadingVmd / isLoadingProp 已在 ADR-046 (Phase 2B) 移除。
// 加载串行化现由 LoadManager 队列统一保障，各加载器内部锁已删除，此处不再保留冗余状态。

// Note: pendingVmd/setPendingVmd removed in ADR-121 P1 — replaced by SceneMotionIntent + motionAssignment

// ======== Seek ========

export let seekDragging = false;
export function setSeekDragging(v: boolean): void {
    seekDragging = v;
}

// ======== Library Paths ========

export let libraryRoot = '';
export function setLibraryRoot(r: string): void {
    libraryRoot = r;
}

export let resourceRoot = '';
export function setResourceRoot(r: string): void {
    resourceRoot = r;
    libraryRoot = r;
}

export let overridePaths: OverridePaths = {};
export function setOverridePaths(p: OverridePaths): void {
    overridePaths = p;
}

// ======== Model Cache / List ========

export let allModels: LibraryModel[] = [];
export function setAllModels(m: LibraryModel[]): void {
    allModels = m;
}

// ======== Popup State ========

export let popupOpen = false;
export function setPopupOpen(v: boolean): void {
    popupOpen = v;
}

// ======== Thumbnail Cache ========

export const thumbnailCache = new Map<string, string>();
export function setThumbnailCache(m: Map<string, string>): void {
    // [fix:thumbnail] 原地 mutate 而非替换 Map 对象，保证所有持有 live 引用的
    // 面板（createResourcePanel / IntersectionObserver）能感知缓存更新。
    thumbnailCache.clear();
    for (const [k, v] of m) {
        thumbnailCache.set(k, v);
    }
    // 通知所有活跃面板刷新缩略图 DOM（解决冷缓存首次加载不显示缩略图的问题）
    import('./ui-resource-panel')
        .then((mod) => mod.notifyThumbnailUpdate())
        .catch((err) => logWarn('state', 'notifyThumbnailUpdate failed:', err));
}

// ======== Recent Models ========

export let recentModels: string[] = [];
export function setRecentModels(r: string[]): void {
    recentModels = r;
}

// ======== Camera Mode ========

export let cameraMode: CameraMode = 'orbit';
export function setCameraMode(m: CameraMode): void {
    cameraMode = m;
}

// ======== Display Name Priority ========

export let displayNamePriority: DisplayNamePriority = 'filename';
export function setDisplayNamePriority(p: DisplayNamePriority): void {
    displayNamePriority = p;
}

// ======== Library Sort Mode ========

export let librarySortMode: LibrarySortMode = 'default';
export function setLibrarySortMode(m: LibrarySortMode): void {
    librarySortMode = m;
}

// ======== Recent Motions (memory only, not persisted) ========

const MAX_RECENT_MOTIONS = 10;
let _recentMotions: RecentMotion[] = [];

export function addRecentMotion(path: string, name: string): void {
    _recentMotions = _recentMotions.filter((r) => r.path !== path);
    _recentMotions.unshift({ path, name, timestamp: Date.now() });
    if (_recentMotions.length > MAX_RECENT_MOTIONS) {
        _recentMotions.length = MAX_RECENT_MOTIONS;
    }
}

export function getRecentMotions(): RecentMotion[] {
    return _recentMotions;
}

// ======== Model Metadata Cache ========

export let modelMetaCache = new Map<
    string,
    { name_jp: string; name_en: string; comment: string }
>();
export function setModelMetaCache(
    m: Map<string, { name_jp: string; name_en: string; comment: string }>
): void {
    modelMetaCache = m;
}

// ======== Tree Expand State ========

export let expandedFolders = new Set<string>();
export function setExpandedFolders(s: Set<string>): void {
    expandedFolders = s;
}

export function toggleExpandedFolder(path: string): void {
    if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
    } else {
        expandedFolders.add(path);
    }
}

// ======== UI State ========

export const uiState: UIState = {};

/** 持久化回调。由 env-bridge.ts 在初始化时注册，避免循环依赖。 */
let _uiPersistCb: (() => void) | null = null;
export function setUIPersistCallback(cb: () => void): void {
    _uiPersistCb = cb;
}

export function setUIState(state: UIState): void {
    Object.assign(uiState, state);
    _uiPersistCb?.();
}

// ======== UI 派生记忆态 ========

/** 当前选中的 time-of-day 预设 key。预设芯片高亮唯一来源，env-menu 顶层与 sky 子菜单共享同一状态。 */
export let activeTimeOfDayPreset = 'noon';
export function setActiveTimeOfDayPreset(v: string): void {
    activeTimeOfDayPreset = v;
}

// ======== Environment State ========

export const envState: EnvState = reactive<EnvState>({
    skyMode: 'color',
    skyColorTop: [0.3, 0.5, 0.8],
    skyColorMid: [0.8, 0.8, 0.9],
    skyColorBot: [0.2, 0.2, 0.25],
    skyTexture: '',
    skyRotationY: 0,
    skyRotationSpeed: 0,
    skyBrightness: 1,
    starsEnabled: false,
    starsTexture: '',
    envIntensity: 2,

    groundVisible: true,
    groundType: 'flat',
    groundStyle: 'solid',
    groundDecoStyle: 'none',
    groundColor: [0.15, 0.15, 0.18],
    groundAlpha: 0.6,
    groundTexture: '',
    groundTextureEnabled: false,
    groundTextureScale: 1,
    groundTextureRotation: 0,
    groundGridSize: 1,
    groundLineColor: [0.5, 0.5, 0.55],

    groundTerrainHeight: 4,
    groundTerrainScale: 0.06,
    groundTerrainSeed: 1337,
    groundTerrainOctaves: 5,

    groundPitch: 0,
    groundRoll: 0,
    groundScrollSpeedX: 0,
    groundScrollSpeedZ: 0,
    groundPattern: 'checker',

    groundReflectionBlend: 0.3,
    groundReflectionQuality: 'medium',
    groundNormalTexture: '',
    groundNormalStrength: 1,
    groundElevationColoring: false,
    groundInfinite: false,

    // ADR-114: PBR 材质 + 程序化纹理
    groundPbrEnabled: false,
    groundProceduralTexture: 'none',
    groundProceduralSeed: 42,
    groundProceduralScale: 1.0,
    groundRoughness: 0.6,
    groundMetallic: 0.0,
    // ADR-114 Phase 2: 反射模糊 + 法线扭曲
    groundReflectionBlur: 0.0,
    groundReflectionDistort: 0.3,
    // ADR-114 Phase 3: 接触阴影
    groundContactShadowEnabled: false,
    groundContactShadowIntensity: 0.5,
    groundContactShadowDistance: 0.5,

    windEnabled: true,
    windDirection: [0, 0, 1],
    windSpeed: 5,

    particleEnabled: false,
    particleType: 'none',
    particleEmitRate: 1,
    particleSize: 1,
    particleSpeed: 1,
    particleSplash: false,
    particleCustomTexture: '',

    groundLevel: 0,
    groundSize: 500,
    groundEdgeFade: 0,

    waterEnabled: false,
    waterLevel: 0,
    waterFlip: false,
    waterColor: [0.15, 0.4, 0.6],
    waterTransparency: 0.88,
    waterWaveHeight: 0.15,
    bigWaveHeight: 1.0,
    smallWaveHeight: 1.0,
    waterSize: 50,
    waterAnimSpeed: 0.2,

    waterFogColor: [0.5, 0.52, 0.62],
    waterFogDensity: 0.006,
    waterFogOpacityInfluence: 0,
    waterHorizonFade: 0.8,
    waterSkyColorBlend: 0.2,

    fresnelBias: 0.02,
    fresnelPower: 3.0,
    diffuseStrength: 0.15,
    ambientStrength: 0.06,
    rippleNormalStrength: 0.35,
    rippleGlintStrength: 0.5,
    waterNormalStrength: 0.35,
    waterGlintStrength: 0.1,
    causticIntensity: 0.1,
    causticColor1: [1.0, 0.9, 0.6],
    causticColor2: [1.0, 1.0, 0.8],
    causticScrollX: 0.1,
    causticScrollY: 0.15,
    fresnelAlphaInfluence: 0.35,
    underwaterFogDensity: 0.05,
    underwaterChromaticAmount: 20,
    underwaterToneIntensity: 0.5,
    underwaterFogMultiplier: 2,
    underwaterTintStrength: 0.5,

    cloudsEnabled: false,
    debugClouds: false,
    cloudCover: 0.5,
    cloudScale: 0.55,
    cloudHeight: 300,
    cloudThickness: 60,
    cloudVisibility: 8000,
    cloudGap: 0.1,
    cloudErosion: 0.4,
    cloudWeatherStrength: 0.6,
    cloudBacklight: 0.5,
    cloudPowder: 0.8,
    cloudQuality: 'high',

    mirrorEnabled: false,

    fogEnabled: false,
    fogMode: 'exp2',
    fogColor: [0.5, 0.5, 0.6],
    fogDensity: 0.01,
    fogStart: 10,
    fogEnd: 100,

    collisionEnabled: true,
    bodyCollisionEnabled: true,
    groundCollisionEnabled: true,

    sunAngle: 45,
    azimuth: -45,

    timeOfDayActive: false,
    timeOfDaySpeed: 3,

    // [adr-074] 平面反射孤儿字段（当前无消费方，仅满足 EnvState 类型约束）
    planarReflectBlend: 0.5,
    reflectionQuality: 'off',
    qualityProfile: 'high',
});
