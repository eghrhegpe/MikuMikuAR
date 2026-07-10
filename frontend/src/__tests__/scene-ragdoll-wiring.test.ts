import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ──────────────────────────────────────────────────────────────────────────
// 该测试只验证 "scene.ts 模块的装配 (wiring) 顺序"：
//   - 用例1：scene.ts 在无 WebGL 的 headless 环境下能正常加载（顶层不触碰真实 Scene/Engine）
//   - 用例2：initScene() 体中 initRagdoll 必须注册在 startBoneOverride 之后
// 因此所有 Babylon / babylon-mmd / 项目内部模块一律 stub，使测试与渲染环境无关。
// ──────────────────────────────────────────────────────────────────────────

// ── Babylon.js core：阻止真实 Scene/Engine 构造触碰 WebGL ──
vi.mock('@babylonjs/core/Engines/engine', () => ({ Engine: class { constructor() {} } }));
vi.mock('@babylonjs/core/scene', () => ({ Scene: class { constructor() {} } }));
vi.mock('@babylonjs/core/Maths/math.color', () => ({ Color4: class { constructor() {} } }));
vi.mock('@babylonjs/core/Events/pointerEvents', () => ({ PointerEventTypes: { POINTERDOWN: 0 } }));
vi.mock('@babylonjs/core/Physics/v2/physicsEngineComponent', () => ({}));
vi.mock('@babylonjs/core/Particles/webgl2ParticleSystem', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader', () => ({}));
vi.mock('@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader', () => ({}));

// ── babylon-mmd：仅副作用 / 类型 import，全部 stub ──
vi.mock('babylon-mmd/esm/Loader/dynamic', () => ({ RegisterMmdModelLoaders: vi.fn() }));
vi.mock('babylon-mmd/esm/Loader/registerDxBmpTextureLoader', () => ({ RegisterDxBmpTextureLoader: vi.fn() }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance', () => ({ GetMmdWasmInstance: vi.fn() }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease', () => ({ MmdWasmInstanceTypeSPR: class {} }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime', () => ({ MmdWasmRuntime: class {} }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics', () => ({ MmdWasmPhysics: class {} }));
vi.mock('babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation', () => ({}));
vi.mock('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy', () => ({ MmdStandardMaterialProxy: class {} }));
vi.mock('babylon-mmd/esm/Runtime/mmdRuntimeShared', () => ({ MmdRuntimeShared: class {} }));
vi.mock('babylon-mmd/esm/Runtime/mmdRuntime', () => ({ MmdRuntime: class {} }));
vi.mock('babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation', () => ({}));
vi.mock('babylon-mmd/esm/Loader/mmdModelLoader.default', () => ({}));
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex', () => ({}));
vi.mock('babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment', () => ({}));

// ── 项目内部模块 ──
vi.mock('../core/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/config')>();
  return { ...actual, dom: { canvas: {} } };
});

vi.mock('../scene/camera/camera', () => ({
  initCameraSystem: vi.fn(),
  autoFrame: vi.fn(),
  getCameraState: vi.fn(),
  setCameraState: vi.fn(),
  animateCameraVmd: vi.fn(),
  loadCameraVmd: vi.fn(),
  clearCameraVmd: vi.fn(),
  hasCameraVmd: vi.fn(),
  getCameraVmdName: vi.fn(),
  getCameraVmdPath: vi.fn(),
  switchCameraMode: vi.fn(),
  getCameraMode: vi.fn(),
}));

vi.mock('../scene/env/env', () => ({
  initEnvFacade: vi.fn(),
  applyEnvState: vi.fn(),
  _envSys: {},
  refreshWaterRenderList: vi.fn(),
  addRipple: vi.fn(),
}));

vi.mock('../scene/manager/material', () => ({}));
vi.mock('../scene/motion/playback', () => ({ updatePlaybackUI: vi.fn(), initPlaybackObservables: vi.fn() }));
vi.mock('../scene/render/lighting', () => ({ initLighting: vi.fn(), _updateSunDisc: vi.fn() }));
vi.mock('../scene/render/renderer', () => ({ initRenderer: vi.fn(), rebuildOutlineState: vi.fn(), pipeline: {} }));
vi.mock('../scene/manager/model-loader', () => ({ initLoader: vi.fn() }));
vi.mock('../scene/manager/model-manager', () => ({ ModelManager: class { constructor() {} } }));
vi.mock('../scene/motion/proc-motion-bridge', () => ({
  updateProcMotion: vi.fn(),
  createProcBeatDetector: vi.fn(),
  getProcBeatDetector: vi.fn(),
  onModelRemoved: vi.fn(),
}));
vi.mock('../scene/motion/lipsync-bridge', () => ({ updateLipSync: vi.fn(), initLipSync: vi.fn() }));
vi.mock('../scene/scene-serialize', () => ({ triggerAutoSaveImpl: vi.fn() }));
vi.mock('../scene/ar/ar-scene', () => ({
  setARMode: vi.fn(),
  takeARScreenshot: vi.fn(),
  isARModeActive: vi.fn(() => false),
}));
vi.mock('../core/wails-bindings', () => ({
  SaveThumbnail: vi.fn(),
  SaveLastScene: vi.fn(),
  LoadLastScene: vi.fn(),
  SetEnvState: vi.fn(),
}));
vi.mock('../outfit/outfit', () => ({ loadOutfits: vi.fn(() => Promise.resolve()) }));
vi.mock('../outfit/audio', () => ({
  attachBeatDetector: vi.fn(),
  createProcBeatDetector: vi.fn(),
  disposeAudio: vi.fn(),
  isAudioPlaying: vi.fn(),
  loadAudioFile: vi.fn(),
  syncAudioPlayback: vi.fn(),
}));
vi.mock('../menus/model-preset', () => ({ tryAutoApplyPreset: vi.fn() }));
vi.mock('../scene/env/props', () => ({}));
vi.mock('../scene/env/env-bridge', () => ({
  applyEnvState: vi.fn(),
  _updateSunDisc: vi.fn(),
  refreshWaterRenderList: vi.fn(),
  rebuildOutlineState: vi.fn(),
  envState: {},
}));
vi.mock('../scene/env/accessory', () => ({ detachModelAccessories: vi.fn() }));
vi.mock('../scene/motion/wasm-layers-blender', () => ({ teardownWasmLayersBlender: vi.fn() }));
vi.mock('../scene/motion/vmd-loader', () => ({
  loadVMDMotion: vi.fn(),
  loadVMDFromPath: vi.fn(),
  loadCameraVmdFromPath: vi.fn(),
  loadVPDPose: vi.fn(),
}));
vi.mock('../core/fileservice', () => ({ resolveFileUrl: vi.fn(), normPath: vi.fn() }));
vi.mock('../core/model-registry', () => ({ modelRegistry: new Map() }));
vi.mock('../core/focused-model', () => ({ focusedModelId: 'mock-id' }));
vi.mock('../menus/motion-popup', () => ({ syncPlaybackSpeedToRuntime: vi.fn() }));
vi.mock('../scene/motion/bone-override', () => ({ startBoneOverride: vi.fn() }));
vi.mock('../physics/ragdoll-manager', () => ({ initRagdoll: vi.fn() }));
vi.mock('../physics/xpbd-cloth', () => ({
  createCloth: vi.fn(),
  buildClothUpdateFn: vi.fn(),
  disposeCloth: vi.fn(),
  DEFAULT_CLOTH_CONFIG: {},
}));
vi.mock('../physics/xpbd-collider', () => ({ SdfCollider: class {}, DEFAULT_BODY_CAPSULES: [] }));

describe('scene.ts ragdoll wiring', () => {
  beforeEach(() => {
    // 仅清空调用记录，保留 getMmdRuntimeType 等 mock 实现（本测试不调用 initScene）
    vi.clearAllMocks();
  });

  it('should compile scene.ts without errors (module loads in headless env)', async () => {
    await expect(import('../scene/scene')).resolves.toBeDefined();
  });

  it('should register initRagdoll after startBoneOverride in scene setup flow', () => {
    // vitest 下 import.meta.url 非 file:// 协议，改用 cwd + 相对路径定位源文件
    const scenePath = resolve(process.cwd(), 'src/scene/scene.ts');
    const lines = readFileSync(scenePath, 'utf-8').split('\n');

    // 定位 initScene 函数体范围
    const startLine = lines.findIndex((l) => l.includes('export async function initScene'));
    expect(startLine, 'initScene should be exported').toBeGreaterThan(-1);
    const endLine = lines.findIndex(
      (l, i) => i > startLine && l.startsWith('export function getScene'),
    );
    expect(endLine, 'getScene should follow initScene').toBeGreaterThan(startLine);

    const body = lines.slice(startLine, endLine).join('\n');
    const boneIdx = body.indexOf('startBoneOverride(');
    const ragdollIdx = body.indexOf('initRagdoll(');

    expect(boneIdx, 'startBoneOverride call expected in initScene').toBeGreaterThan(-1);
    expect(ragdollIdx, 'initRagdoll call expected in initScene').toBeGreaterThan(-1);
    expect(ragdollIdx, 'initRagdoll must be registered AFTER startBoneOverride').toBeGreaterThan(boneIdx);
  });
});
