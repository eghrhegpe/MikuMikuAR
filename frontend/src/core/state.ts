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

// [doc:adr-137] 从 schema 派生默认值，不再手写逐字段初始化。
import { ENV_STATE_SCHEMA } from './env-state-schema';

/** 从 schema 读取默认值构造初始 state。tuple3 字段用 slice() 创建新引用以确保 reactive 深层追踪。 */
function buildDefaultEnvState(): EnvState {
    const s = ENV_STATE_SCHEMA;
    return {
        skyMode:              s.skyMode.default,
        skyColorTop:          s.skyColorTop.default.slice() as [number, number, number],
        skyColorMid:          s.skyColorMid.default.slice() as [number, number, number],
        skyColorBot:          s.skyColorBot.default.slice() as [number, number, number],
        skyTexture:           s.skyTexture.default,
        skyRotationY:         s.skyRotationY.default,
        skyRotationSpeed:     s.skyRotationSpeed.default,
        skyBrightness:        s.skyBrightness.default,
        starsEnabled:         s.starsEnabled.default,
        starsTexture:         s.starsTexture.default,
        envIntensity:         s.envIntensity.default,
        groundVisible:        s.groundVisible.default,
        groundType:           s.groundType.default,
        groundStyle:          s.groundStyle.default,
        groundDecoStyle:      s.groundDecoStyle.default,
        groundColor:          s.groundColor.default.slice() as [number, number, number],
        groundAlpha:          s.groundAlpha.default,
        groundTexture:        s.groundTexture.default,
        groundTextureEnabled: s.groundTextureEnabled.default,
        groundTextureScale:   s.groundTextureScale.default,
        groundTextureRotation:s.groundTextureRotation.default,
        groundGridSize:       s.groundGridSize.default,
        groundLineColor:      s.groundLineColor.default.slice() as [number, number, number],
        groundTerrainHeight:  s.groundTerrainHeight.default,
        groundTerrainScale:   s.groundTerrainScale.default,
        groundTerrainSeed:    s.groundTerrainSeed.default,
        groundTerrainOctaves: s.groundTerrainOctaves.default,
        groundPitch:          s.groundPitch.default,
        groundRoll:           s.groundRoll.default,
        groundScrollSpeedX:   s.groundScrollSpeedX.default,
        groundScrollSpeedZ:   s.groundScrollSpeedZ.default,
        groundPattern:        s.groundPattern.default,
        groundReflectionBlend:   s.groundReflectionBlend.default,
        groundReflectionQuality:s.groundReflectionQuality.default,
        groundNormalTexture:     s.groundNormalTexture.default,
        groundNormalStrength:    s.groundNormalStrength.default,
        groundElevationColoring: s.groundElevationColoring.default,
        groundInfinite:          s.groundInfinite.default,
        groundPbrEnabled:        s.groundPbrEnabled.default,
        groundProceduralTexture: s.groundProceduralTexture.default,
        groundProceduralSeed:    s.groundProceduralSeed.default,
        groundProceduralScale:   s.groundProceduralScale.default,
        groundRoughness:         s.groundRoughness.default,
        groundMetallic:          s.groundMetallic.default,
        groundReflectionBlur:    s.groundReflectionBlur.default,
        groundReflectionDistort: s.groundReflectionDistort.default,
        groundContactShadowEnabled:   s.groundContactShadowEnabled.default,
        groundContactShadowIntensity: s.groundContactShadowIntensity.default,
        groundContactShadowDistance:  s.groundContactShadowDistance.default,
        groundLevel:       s.groundLevel.default,
        groundSize:        s.groundSize.default,
        groundEdgeFade:    s.groundEdgeFade.default,
        windEnabled:       s.windEnabled.default,
        windDirection:     s.windDirection.default.slice() as [number, number, number],
        windSpeed:         s.windSpeed.default,
        particleEnabled:       s.particleEnabled.default,
        particleType:          s.particleType.default,
        particleEmitRate:      s.particleEmitRate.default,
        particleSize:          s.particleSize.default,
        particleSpeed:         s.particleSpeed.default,
        particleSplash:        s.particleSplash.default,
        particleCustomTexture: s.particleCustomTexture.default,
        waterEnabled:       s.waterEnabled.default,
        waterLevel:         s.waterLevel.default,
        waterFlip:          s.waterFlip.default,
        waterColor:         s.waterColor.default.slice() as [number, number, number],
        waterTransparency:  s.waterTransparency.default,
        waterWaveHeight:    s.waterWaveHeight.default,
        bigWaveHeight:      s.bigWaveHeight.default,
        smallWaveHeight:    s.smallWaveHeight.default,
        waterSize:          s.waterSize.default,
        waterAnimSpeed:     s.waterAnimSpeed.default,
        planarReflectBlend: s.planarReflectBlend.default,
        reflectionQuality:  s.reflectionQuality.default,
        qualityProfile:     s.qualityProfile.default,
        waterFogColor:           s.waterFogColor.default.slice() as [number, number, number],
        waterFogDensity:         s.waterFogDensity.default,
        waterFogOpacityInfluence:s.waterFogOpacityInfluence.default,
        waterHorizonFade:        s.waterHorizonFade.default,
        waterSkyColorBlend:      s.waterSkyColorBlend.default,
        fresnelBias:             s.fresnelBias.default,
        fresnelPower:            s.fresnelPower.default,
        diffuseStrength:         s.diffuseStrength.default,
        ambientStrength:         s.ambientStrength.default,
        rippleNormalStrength:    s.rippleNormalStrength.default,
        rippleGlintStrength:     s.rippleGlintStrength.default,
        waterNormalStrength:     s.waterNormalStrength.default,
        waterGlintStrength:      s.waterGlintStrength.default,
        causticIntensity:        s.causticIntensity.default,
        causticColor1:           s.causticColor1.default.slice() as [number, number, number],
        causticColor2:           s.causticColor2.default.slice() as [number, number, number],
        causticScrollX:          s.causticScrollX.default,
        causticScrollY:          s.causticScrollY.default,
        fresnelAlphaInfluence:   s.fresnelAlphaInfluence.default,
        underwaterFogDensity:      s.underwaterFogDensity.default,
        underwaterChromaticAmount: s.underwaterChromaticAmount.default,
        underwaterToneIntensity:   s.underwaterToneIntensity.default,
        underwaterFogMultiplier:   s.underwaterFogMultiplier.default,
        underwaterTintStrength:    s.underwaterTintStrength.default,
        cloudsEnabled:        s.cloudsEnabled.default,
        debugClouds:          s.debugClouds.default,
        cloudCover:           s.cloudCover.default,
        cloudScale:           s.cloudScale.default,
        cloudHeight:          s.cloudHeight.default,
        cloudThickness:       s.cloudThickness.default,
        cloudVisibility:      s.cloudVisibility.default,
        cloudGap:             s.cloudGap.default,
        cloudErosion:         s.cloudErosion.default,
        cloudWeatherStrength: s.cloudWeatherStrength.default,
        cloudBacklight:       s.cloudBacklight.default,
        cloudPowder:          s.cloudPowder.default,
        cloudQuality:         s.cloudQuality.default,
        mirrorEnabled:        s.mirrorEnabled.default,
        fogEnabled:           s.fogEnabled.default,
        fogMode:              s.fogMode.default,
        fogColor:             s.fogColor.default.slice() as [number, number, number],
        fogDensity:           s.fogDensity.default,
        fogStart:             s.fogStart.default,
        fogEnd:               s.fogEnd.default,
        collisionEnabled:       s.collisionEnabled.default,
        bodyCollisionEnabled:   s.bodyCollisionEnabled.default,
        groundCollisionEnabled: s.groundCollisionEnabled.default,
        sunAngle:         s.sunAngle.default,
        azimuth:          s.azimuth.default,
        lightingPresetName: s.lightingPresetName.default,
        timeOfDayActive:  s.timeOfDayActive.default,
        timeOfDaySpeed:   s.timeOfDaySpeed.default,
    } as EnvState;
}

export const envState: EnvState = reactive<EnvState>(buildDefaultEnvState());
