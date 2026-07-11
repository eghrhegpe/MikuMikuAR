/**
 * [doc:architecture] Shared mutable state for MikuMikuAR.
 * Extracted from config.ts — global variables, setters, runtime state.
 */

import { reactive } from './reactivity';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type {
    ModelInstance,
    PropInstance,
    OverridePaths,
    LibraryModel,
    UIState,
    EnvState,
    MmdRuntimeType,
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

const MMD_RUNTIME_TYPE_KEY = 'mmdRuntimeType';

export function getMmdRuntimeType(): MmdRuntimeType {
    try {
        const v = localStorage.getItem(MMD_RUNTIME_TYPE_KEY);
        if (v === 'js' || v === 'wasm') {
            return v;
        }
    } catch {
        /* localStorage 不可用时回落 env */
    }
    return import.meta.env.VITE_MMD_RUNTIME === 'js' ? 'js' : 'wasm';
}

export function setMmdRuntimeType(v: MmdRuntimeType): void {
    try {
        localStorage.setItem(MMD_RUNTIME_TYPE_KEY, v);
    } catch {
        /* 忽略 localStorage 写入失败 */
    }
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

export let pendingVmd: PendingVmd | null = null;
export function setPendingVmd(v: PendingVmd | null): void {
    pendingVmd = v;
}

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

export let externalPaths: { path: string; name: string }[] = [];
export function setExternalPaths(e: { path: string; name: string }[]): void {
    externalPaths = e;
}

// ======== Popup State ========

export let popupOpen = false;
export function setPopupOpen(v: boolean): void {
    popupOpen = v;
}

// ======== Thumbnail Cache ========

export let thumbnailCache = new Map<string, string>();
export function setThumbnailCache(m: Map<string, string>): void {
    thumbnailCache = m;
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

// ======== Motion Binding Target ========

export let motionBindingTargetId: string | null = null;
export function setMotionBindingTargetId(v: string | null): void {
    motionBindingTargetId = v;
}

// ======== Layer Binding Target (Motion Layers) ========

export let layerBindingTargetId: string | null = null;
export function setLayerBindingTargetId(v: string | null): void {
    layerBindingTargetId = v;
}

// ======== Model Replace Target (Model Detail → Replace) ========

export let modelReplaceTargetId: string | null = null;
export function setModelReplaceTargetId(v: string | null): void {
    modelReplaceTargetId = v;
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
    envIntensity: 2,

    groundVisible: true,
    groundMode: 'solid',
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

    groundReflectionBlend: 0,
    groundReflectionQuality: 'off',
    groundNormalTexture: '',
    groundNormalStrength: 1,
    groundElevationColoring: false,
    groundFollowCamera: false,

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
    groundSize: 60,
    groundEdgeFade: 0,

    waterEnabled: false,
    waterLevel: 0,
    waterFlip: false,
    waterColor: [0.2, 0.4, 0.6],
    waterTransparency: 0.8,
    waterWaveHeight: 0.5,
    waterSize: 50,
    waterAnimSpeed: 1,

    foamThreshold: 0.1,
    foamIntensity: 0.5,
    foamOpacity: 0.8,
    waterFogColor: [0.45, 0.48, 0.58],
    waterFogDensity: 0.012,
    waterFogOpacityInfluence: 0,

    fresnelBias: 0.02,
    fresnelPower: 3.0,
    diffuseStrength: 0.15,
    ambientStrength: 0.15,
    foamTransitionRange: 0.15,
    rippleNormalStrength: 0.15,
    rippleGlintStrength: 0.25,
    causticColor1: [1.0, 0.9, 0.6],
    causticColor2: [1.0, 1.0, 0.8],
    causticScrollX: 0.1,
    causticScrollY: 0.15,
    fresnelAlphaInfluence: 0.5,
    underwaterFogDensity: 0.05,
    underwaterChromaticAmount: 20,
    underwaterToneIntensity: 0.5,
    underwaterFogMultiplier: 2,
    underwaterTintStrength: 0.5,

    cloudsEnabled: false,
    debugClouds: false,
    cloudCover: 0.5,
    cloudScale: 0.55,
    cloudHeight: 325,
    cloudThickness: 15,
    cloudVisibility: 3000,
    cloudGap: 0.5,

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
});
