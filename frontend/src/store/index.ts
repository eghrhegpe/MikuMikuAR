/**
 * MikuMikuAR 单例状态核心 – Store (Zustand-like 微核心)
 * Immutable + Single Dispatch + Selector tools
 * 0 依赖；保留兼容导出符号；外部只读；只能通过 setState 闭包写
 */

import { reactive, readonly } from './reactivity';
import type {
  IMmdRuntime,
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
  MmdRuntimeType,
} from './types';

// ---------- 基础类型 ----------

type RootState = {
  // 模型运行时
  mmdRuntime: IMmdRuntime | null;

  // 注册表
  modelRegistry: Map<string, ModelInstance>;
  propRegistry: Map<string, PropInstance>;

  // 焦点
  focusedModelId: string | null;
  motionBindingTargetId: string | null;
  layerBindingTargetId: string | null;

  // 端口 / 播放
  currentPort: number;
  isPlaying: boolean;
  autoLoop: boolean;

  // 加载
  pendingVmd: PendingVmd | null;
  seekDragging: boolean;

  // 路径
  libraryRoot: string;
  resourceRoot: string;
  overridePaths: OverridePaths;
  externalPaths: { path: string; name: string }[];

  allModels: LibraryModel[];

  // UI 预置状态 (参考原 envState 内嵌 UIState)
  uiState: UIState;

  // 缓存
  thumbnailCache: Map<string, string>;
  modelMetaCache: Map<
    string,
    { name_jp: string; name_en: string; comment: string }
  >;

  // 集合型 Status
  recentModels: string[];
  expandedFolders: Set<string>;

  // 相机与展示
  cameraMode: CameraMode;
  displayNamePriority: DisplayNamePriority;
  librarySortMode: LibrarySortMode;

  // MMDRuntime 类型切换
  mmdRuntimeType: MmdRuntimeType;

  // 环境状态  (保持 reactive 原 envState 属性同步)
  envState: EnvState;

  // 其他现存状态已清理
  loadingLocks: Record<string, boolean>; // 原有加载锁已废弃
};

// ---------- 单例派发核心 ----------

let _state: RootState;
let _uiPersistCb: (() => void) | null = null;

function _createInitialState(): RootState {
  return {
    mmdRuntime: null,
    mmdRuntimeType: import.meta.env.VITE_MMD_RUNTIME === 'js' ? 'js' : 'wasm',
    modelRegistry: new Map(),
    propRegistry: new Map(),
    focusedModelId: null,
    motionBindingTargetId: null,
    layerBindingTargetId: null,
    currentPort: 0,
    isPlaying: false,
    autoLoop: true,
    pendingVmd: null,
    seekDragging: false,
    libraryRoot: '',
    resourceRoot: '',
    overridePaths: {},
    externalPaths: [],
    allModels: [],

    uiState: {
      // 替代原 uiState 开放字段，和原 env-bridge 一致
    },

    thumbnailCache: new Map(),
    modelMetaCache: new Map(),
    recentModels: [],
    expandedFolders: new Set(),
    cameraMode: 'orbit',
    displayNamePriority: 'filename',
    librarySortMode: 'default',

    envState: reactive({
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
      clothEnabled: false,
      clothConfig: {
        // placeholder, 原 DEFAULT_CLOTH_CONFIG 会在 UI patch 时被 override
        iterations: 4,
        mass: 0.5,
        stiffness: 0.8,
        damping: 0.03,
      },
      clothDebugParticles: false,
      clothDebugConstraints: false,
      clothDebugColliders: false,
      solverSubsteps: 4,
      solverTimeScale: 1.0,
      collisionEnabled: true,
      bodyCollisionEnabled: true,
      groundCollisionEnabled: true,
      sunAngle: 45,
      azimuth: -45,
      timeOfDayActive: false,
      timeOfDaySpeed: 3,
    }),

    loadingLocks: {},
  };
}

// 保证单例只初始化一次 —— 生产环境隔离
const IS_PROD = import.meta.env.PROD === true;
if (IS_PROD) {
  // 在生产环境，把 state 冻结，防止外部篡改；但在此之前必须先具现一次
  _state = _createInitialState();
  Object.freeze(_state.envState);
} else {
  _state = _createInitialState();
}

// ---------- 派发核心 ----------

export function getState(): RootState {
  return readonly(_state);
}

type SetState = (partial: Partial<RootState>) => void;

export function setState(partial: Partial<RootState>): void {
  _state = { ..._state, ...partial };
  if (IS_PROD) {
    // 生产还原免篡改的冻结
    Object.freeze(_state.envState);
  }
}

// ---------- UI 持久化回调 ----------

export function setUIPersistCallback(cb: () => void): void {
  _uiPersistCb = cb;
}

// ---------- 简易 selector 工具 (memoize 简版) ----------

const selectorCache = new Map<string, unknown>();

export function createSelector<T>(selectorFn: (s: RootState) => T, key?: string): () => T {
  return () => {
    const k = key ?? selectorFn.toString();
    if (selectorCache.has(k)) {
      return selectorCache.get(k) as T;
    }
    const res = selectorFn(readonly(_state));
    selectorCache.set(k, res);
    return res;
  };
}

// 立刻清掉脏缓存
setInterval(() => selectorCache.clear(), 5000);

// ---------- 向下兼容导出符号 ----------

// 导出名字保留和原来一模一样，仅内部换为 Store 支持

let mmdRuntime: IMmdRuntime | null = null;
export { mmdRuntime as mmdRuntime };

export function setMmdRuntime(r: IMmdRuntime | null): void {
  mmdRuntime = r;
  setState({ mmdRuntime: r });
}

let modelRegistry: Map<string, ModelInstance> = new Map();
export { modelRegistry as modelRegistry };

export function setModelRegistry(m: Map<string, ModelInstance>): void {
  modelRegistry = m;
  setState({ modelRegistry: m });
}

let propRegistry: Map<string, PropInstance> = new Map();
export { propRegistry as propRegistry };

export function setPropRegistry(m: Map<string, PropInstance>): void {
  propRegistry = m;
  setState({ propRegistry: m });
}

let focusedModelId: string | null = null;
export { focusedModelId as focusedModelId };

export function setFocusedModelId(id: string | null): void {
  focusedModelId = id;
  setState({ focusedModelId: id });
}

let currentPort = 0;
export { currentPort as currentPort };

export function setCurrentPort(p: number): void {
  currentPort = p;
  setState({ currentPort: p });
}

let isPlaying = false;
export { isPlaying as isPlaying };

export function setIsPlaying(v: boolean): void {
  isPlaying = v;
  setState({ isPlaying: v });
}

let autoLoop = true;
export { autoLoop as autoLoop };

export function setAutoLoop(v: boolean): void {
  autoLoop = v;
  setState({ autoLoop: v });
}

let pendingVmd: PendingVmd | null = null;
export { pendingVmd as pendingVmd };

export function setPendingVmd(v: PendingVmd | null): void {
  pendingVmd = v;
  setState({ pendingVmd: v });
}

let seekDragging = false;
export { seekDragging as seekDragging };

export function setSeekDragging(v: boolean): void {
  seekDragging = v;
  setState({ seekDragging: v });
}

let libraryRoot = '';
export { libraryRoot as libraryRoot };

export function setLibraryRoot(r: string): void {
  libraryRoot = r;
  setState({ libraryRoot: r, resourceRoot: r });
}

let resourceRoot = '';
export { resourceRoot as resourceRoot };

export function setResourceRoot(r: string): void {
  resourceRoot = r;
  setState({ resourceRoot: r });
}

let overridePaths: OverridePaths = {};
export { overridePaths as overridePaths };

export function setOverridePaths(p: OverridePaths): void {
  overridePaths = p;
  setState({ overridePaths: p });
}

let allModels: LibraryModel[] = [];
export { allModels as allModels };

export function setAllModels(m: LibraryModel[]): void {
  allModels = m;
  setState({ allModels: m });
}

let externalPaths: { path: string; name: string }[] = [];
export { externalPaths as externalPaths };

export function setExternalPaths(e: { path: string; name: string }[]): void {
  externalPaths = e;
  setState({ externalPaths: e });
}

let popupOpen = false;
export { popupOpen as popupOpen };

export function setPopupOpen(v: boolean): void {
  popupOpen = v;
  setState({ popupOpen: v });
}

let thumbnailCache: Map<string, string> = new Map();
export { thumbnailCache as thumbnailCache };

export function setThumbnailCache(m: Map<string, string>): void {
  thumbnailCache = m;
  setState({ thumbnailCache: m });
}

let recentModels: string[] = [];
export { recentModels as recentModels };

export function setRecentModels(r: string[]): void {
  recentModels = r;
  setState({ recentModels: r });
}

let cameraMode: CameraMode = 'orbit';
export { cameraMode as cameraMode };

export function setCameraMode(m: CameraMode): void {
  cameraMode = m;
  setState({ cameraMode: m });
}

let displayNamePriority: DisplayNamePriority = 'filename';
export { displayNamePriority as displayNamePriority };

export function setDisplayNamePriority(p: DisplayNamePriority): void {
  displayNamePriority = p;
  setState({ displayNamePriority: p });
}

let librarySortMode: LibrarySortMode = 'default';
export { librarySortMode as librarySortMode };

export function setLibrarySortMode(m: LibrarySortMode): void {
  librarySortMode = m;
  setState({ librarySortMode: m });
}

const MAX_RECENT_MOTIONS = 10;
let _recentMotions: RecentMotion[] = [];

export function addRecentMotion(path: string, name: string): void {
  _recentMotions = _recentMotions.filter((r) => r.path !== path);
  _recentMotions.unshift({ path, name, timestamp: Date.now() });
  if (_recentMotions.length > MAX_RECENT_MOTIONS) {
    _recentMotions.length = MAX_RECENT_MOTIONS;
  }
  setState({ _recentMotions });
}

export function getRecentMotions(): RecentMotion[] {
  return readonly({ value: [..._recentMotions] }).value; // 不可变返回
}

let motionBindingTargetId: string | null = null;
export { motionBindingTargetId as motionBindingTargetId };

export function setMotionBindingTargetId(v: string | null): void {
  motionBindingTargetId = v;
  setState({ motionBindingTargetId: v });
}

let layerBindingTargetId: string | null = null;
export { layerBindingTargetId as layerBindingTargetId };

export function setLayerBindingTargetId(v: string | null): void {
  layerBindingTargetId = v;
  setState({ layerBindingTargetId: v });
}

let modelMetaCache: Map<
  string,
  { name_jp: string; name_en: string; comment: string }
> = new Map();
export { modelMetaCache as modelMetaCache };

export function setModelMetaCache(
  m: Map<string, { name_jp: string; name_en: string; comment: string }>,
): void {
  modelMetaCache = m;
  setState({ modelMetaCache: m });
}

let expandedFolders: Set<string> = new Set();
export { expandedFolders as expandedFolders };

export function setExpandedFolders(s: Set<string>): void {
  expandedFolders = s;
  setState({ expandedFolders: new Set(s) }); // 持久化 copy
}

export function toggleExpandedFolder(path: string): void {
  expandedFolders = new Set(expandedFolders);
  if (expandedFolders.has(path)) {
    expandedFolders.delete(path);
  } else {
    expandedFolders.add(path);
  }
  setState({ expandedFolders });
}

// UI State stub (现在被放在 RootState.uiState 内了)
// 原 env-bridge 需要 uiState，我们用新 store 透出即可
export const uiState: UIState = {};

export function setUIState(state: UIState): void {
  setState({ uiState: { ...getState().uiState, ...state } });
  _uiPersistCb?.();
}

// envState 已迁移为 RootState.envState，只读透出
export const envState: EnvState = readonly(getState().envState);

// MMD Runtime Type switch
const MMD_RUNTIME_TYPE_KEY = 'mmdRuntimeType';

export function getMmdRuntimeType(): MmdRuntimeType {
  try {
    const v = localStorage.getItem(MMD_RUNTIME_TYPE_KEY);
    if (v === 'js' || v === 'wasm') {
      return v;
    }
  } catch {
    /* ignore */
  }
  return import.meta.env.VITE_MMD_RUNTIME === 'js' ? 'js' : 'wasm';
}

export function setMmdRuntimeType(v: MmdRuntimeType): void {
  try {
    localStorage.setItem(MMD_RUNTIME_TYPE_KEY, v);
  } catch {
    /* ignore */
  }
  setState({ mmdRuntimeType: v });
}