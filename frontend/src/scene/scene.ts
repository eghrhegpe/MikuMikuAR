// [doc:architecture] Scene — 3D 场景核心模块（纯组装器）
// 规范文档: docs/architecture.md §渲染环节
// 职责: 导入所有子系统，按正确顺序装配，提供唯一 initScene() 入口
// 注意: 具体逻辑已拆分到子模块，此文件仅负责组合。

import { Engine } from '@babylonjs/core/Engines/engine';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RenderingManager } from '@babylonjs/core/Rendering/renderingManager';
import { observe, type ObserverHandle } from '@/core/observer-handle';
import { safeDispose } from '@/core/dispose-helpers';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Particles/webgl2ParticleSystem';

import { RegisterMmdModelLoaders } from 'babylon-mmd/esm/Loader/dynamic';
import { RegisterDxBmpTextureLoader } from 'babylon-mmd/esm/Loader/registerDxBmpTextureLoader';
// MMD 原生描边：side-effect import，把 getMmdOutlineRenderer() 补丁挂到 Scene.prototype。
// 之后带描边(edge)标记的 PMX 材质在 renderOutline=true 时会惰性注册描边组件并渲染轮廓线。
import 'babylon-mmd/esm/Loader/mmdOutlineRenderer';
// SharedToonTextures：内建 toon 渐变纹理池（base64 常量），为无自定义 toon 贴图的模型提供默认渐变映射，
// 减少外部文件依赖和显存占用（多模型共享同一纹理实例）。
import 'babylon-mmd/esm/Loader/sharedToonTextures';
// SDEF 球面变形：显式挂载 SdefInjector。sdefInjector 模块仅导出类、无顶层 side-effect，
// 必须调用 OverrideEngineCreateEffect(engine) 改写 engine.createEffect，才能为含骨骼(mBones)
// 的着色器注入球面变形顶点代码；网格含 SDEF 顶点时关节弯曲更自然。
import { SdefInjector } from 'babylon-mmd/esm/Loader/sdefInjector';
import { GetMmdWasmInstance } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance';
import { MmdWasmInstanceTypeSPR } from 'babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease';
// MPR（多线程 WASM 物理）依赖 SharedArrayBuffer + COOP/COEP 跨源隔离，
// 仅当构建期 VITE_MMD_WASM_MT 定义时才动态拉入（与 Go 端 CoopCoepMiddleware 同轴门控）。
// 默认未定义 → 走 SPR 单线程，且 MPR worker 不被打包（保持 bundle 精简、构建零回归）。
// 注意：MmdWasmInstanceTypeMPR 必须动态 import，静态 import 会把 worker 拉进图导致构建失败。
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdWasmPhysics } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics';
import 'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation';
// ADR-188: 材质代理解析器（PBR 模式下仍用 MmdStandardMaterialProxy 做运行时 morph，
//         因 MmdStandardMaterialProxy 仅操作 diffuse/shininess，对 PBRMaterial 也兼容）
import { getMaterialMode, getStandardMaterialProxy } from './manager/material-proxy-resolver';
import { tryApplyPbrMaterialBuilder } from './manager/pbr-builder-init';
import { initWindPhysics, disposeWindPhysics } from '@/scene/physics/wind-physics';
import { applyGroundCollision } from './physics/ground-collision';
import { swallowError } from '../core/async';
import { logWarn } from '../core/logger';
import { t } from '../core/i18n/t';
import { MmdRuntimeShared } from 'babylon-mmd/esm/Runtime/mmdRuntimeShared';
// JS 版 runtime（无 WASM 双缓冲，worldMatrix 覆写可生效）
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { FeetState } from '@/core/types';
import { createDefaultFeetState } from '@/core/scene-state';
import { unsubscribeAll } from '@/core/reactivity';
import 'babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation';
// [doc:adr-202] babylon-mmd 1.3.0（-dist）纯/非纯模块拆分：createRuntimeCameraAnimation /
// createRuntimeModelAnimation 的原型 augmentation 需显式 import 对应副作用入口才生效
// （1.2.0 时随 .d.ts 全局附带，1.3.0 后拆为 .pure + .types，须走非纯入口注册）。
import 'babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimation';
import 'babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation';
import 'babylon-mmd/esm/Loader/mmdModelLoader';
import '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader';
// [doc:adr-189] KTX/KTX2 压缩纹理加载器：Babylon.js 9.16 中 _KTXTextureLoader 同时处理 KTX1 和 KTX2，
// 通过 KhronosTextureContainer2.IsValid() 自动分发。Phase 0 仅注册 loader，无代码路径触发 KTX2 加载；
// Phase 1 落地 Go 端 toktx 转码后由 model-loader 透明接入。
import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader';
// [doc:adr-189] Phase 3: KTX2 解码器自托管配置
// 默认从 cdn.babylonjs.com 加载 ktx2Decoder，离线环境需自托管
// 适用版本：@babylonjs/core 9.x（KhronosTextureContainer2.URLConfig 字段名随版本稳定；
// 升级若报 URLConfig 不存在，先核对该版本是否仍暴露此静态字段再删此段）。
import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2';
if (!KhronosTextureContainer2.URLConfig) {
    console.warn('[scene] KhronosTextureContainer2.URLConfig 缺失，KTX2 自托管配置跳过');
} else {
    KhronosTextureContainer2.URLConfig = {
        jsDecoderModule: '/lib/ktx2decoder/babylon.ktx2Decoder.js',
        wasmUASTCToASTC: '/lib/ktx2decoder/wasm/uastc_astc.wasm',
        wasmUASTCToBC7: '/lib/ktx2decoder/wasm/uastc_bc7.wasm',
        wasmUASTCToRGBA_UNORM: '/lib/ktx2decoder/wasm/uastc_rgba8_unorm_v2.wasm',
        wasmUASTCToRGBA_SRGB: '/lib/ktx2decoder/wasm/uastc_rgba8_srgb_v2.wasm',
        wasmUASTCToR8_UNORM: '/lib/ktx2decoder/wasm/uastc_r8_unorm.wasm',
        wasmUASTCToRG8_UNORM: '/lib/ktx2decoder/wasm/uastc_rg8_unorm.wasm',
        jsMSCTranscoder: null,
        wasmMSCTranscoder: null,
        wasmZSTDDecoder: null,
    };
}
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment';

import {
    initEnvFacade,
    applyEnvState,
    _envSys,
    refreshWaterRenderList,
    addRipple,
    disposeEnvUpdateObserver,
} from './env/env';
import { initCameraSystem, autoFrame, disposeCameraSystem } from './camera/camera';
import {
    dom,
    setMmdRuntime,
    mmdRuntime,
    modelRegistry,
    setModelRegistry,
    envState,
    uiState,
    getMmdRuntimeType,
    focusedModelId,
} from '../core/config';
import { triggerAutoSave, setTriggerAutoSave } from '../core/auto-save';
// [doc:adr-238] 音频功能经 scene-action-bridge（core/audio 注册），切断 scene→outfit
import { detectRuntimeMode, persistRuntimeMode, renderRuntimeBadge } from '../core/runtime-mode';
import { _catState, _matState, _matEnabled } from './manager/material';
import { updatePlaybackUI, initPlaybackObservables } from './motion/playback';
// [fix P1] 模型删除时清理动作历史（_historyMap/_mergeMap），否则条目累积 + ID 复用幽灵历史
import { clearHistory } from './motion/motion-modules/motion-history';
import { initLighting, _updateSunDisc, setLightState, getLightState } from './render/lighting';
import { attachPersonalLight, detachPersonalLight } from './render/lighting-follow';
import {
    initRenderer,
    rebuildOutlineState,
    pipeline,
    disposeRenderer,
    setRenderState,
    getRenderState,
} from './render/renderer';
import { registerRenderBridge, getPerformanceMode } from './render/performance';
import { onModelMeshesReady, disposeReflection } from './env/env-reflection';
import { initLoader, setOnMeshesReady, setOnModelLoaded } from './manager/model-loader';
import { isDragModeEnabled } from './transform/transform-mode';
import { tryAttachGizmoFromPick } from './transform/transform-pick';
import { isGizmoDragging, detachGizmo } from './transform/transform-adapter';
import { registerAiSnapshotBridge } from '@/core/ai/scene-snapshot';
import { detectKtx2Support } from '@/core/gpu-capabilities';

// Re-export material system (extracted to material.ts for file size)
export {
    _catState,
    _matState,
    _matEnabled,
    getMaterialCategory,
    _applyAll,
    isMatEnabled,
    setMatEnabled,
    getMatCatGroups,
    getMatCatParams,
    setMatCatParams,
    resetMatCatParams,
    getMatDetailList,
    getMatParams,
    setMatParams,
    resetSingleMatParams,
    resetPerMaterialParams,
    getMatState,
    applyMatState,
    isMatCategoryAllEnabled,
    setMatCategoryEnabled,
    DEFAULT_MAT_PARAMS,
    applyUnlitFallback,
} from './manager/material';
export type { MaterialCategoryParams, MaterialCategory, AlphaCtx } from './manager/material';
export { isPbrMaterial } from './manager/material';
export {
    getMatSssParams,
    setMatSssParams,
    applySss,
    disposeModelSssState,
    getMatSssState,
    applyMatSssState,
    type SssParams,
} from './manager/material-sss';

import { ModelManager } from './manager/model-manager';
import { resetMotionIntent } from './motion/motion-intent';
import {
    updateProcMotion,
    createProcBeatDetector,
    getProcBeatDetector,
    onModelRemoved,
    disposeProcMotion,
    activateGazeTracking,
} from './motion/proc-motion-bridge';
import { triggerAutoSaveImpl } from './scene-serialize';

// ======== Babylon.js ========
// alpha:true 让 WebGL drawing buffer 携带 alpha 通道，使 AR 模式下 scene.clearColor
// 的 a=0 生效（透明 canvas），从而透出底层 <video> 相机画面。非 AR 场景 clearColor
// 的 a=1.0 完全不透明，不受影响。
// [doc:test-isolation] 测试态隔离（审计项 scene.ts:126-131）：vitest 无 WebGL，
// 模块顶层 new Scene(engine) + 相机系统初始化会强制拉起真实 Babylon 场景图与 DOM 依赖，
// 迫使每个 transitively 导入 scene.ts 的测试铺设 engine-mock/babylon-classes。
// 测试态改用引擎无关 Scene（Babylon 官方 offline 模式：new Scene() 不绑定 engine），
// 并跳过相机初始化，使 scene.ts 可零成本导入。生产路径（MODE !== 'test'）完全不变。
const _isTestEnv = import.meta.env.MODE === 'test';

// [doc:adr-229] Headless E2E 模式：URL 带 ?e2e=1（vitePage fixture 导航时注入）即走 NullEngine，
// 不创建 WebGL 上下文，使 app 在 headless 无 GPU 的 CI 也能启动（DOM overlay 为 HTML/CSS，照常渲染）。
// 视觉断言（__capture/fingerprint）按 ADR-229 §2.3 仅 @webgl（真实 WebView2）跑。
// _isTestEnv 在前短路：vitest MODE==='test' 永不触发，@webgl 走真实 WebView2 URL 无 ?e2e=1 亦不触发。
const _isHeadless =
    !_isTestEnv &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('e2e');
export const isHeadless = _isHeadless;

/**
 * 创建渲染引擎。headless 模式返回 NullEngine（无 GPU/WebGL 依赖，纯 DOM 回归可用）；
 * 否则返回真实 WebGL Engine。NullEngine 沿用项目既有用法（vmd-evaluator 运行时同款），
 * 传入 renderingCanvas 以保持相机输入绑定、renderWidth/Height 避免固定 512 视口。
 */
function createEngine(): Engine {
    if (_isHeadless) {
        // [doc:adr-229] NullEngine 无 WebGL 依赖；项目既有用法（vmd-evaluator、各 __tests__）均用无参构造，
        // 相机输入经 engine.getInputElement() 取 canvas，Babylon 在 null 时忽略，DOM 回归无需真实交互。
        return new NullEngine();
    }
    return new Engine(dom.canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        alpha: true,
    });
}

export let engine = createEngine();
// 启用 SDEF 球面变形：改写 engine.createEffect，为含骨骼(mBones)的着色器注入球面变形顶点代码。
// 须在模型加载前、ShadowGenerator/后处理管线创建前调用，覆盖所有蒙皮材质。
// 测试态下 engine 为不完整的 mock（无 createEffect），跳过以避免 TypeError；生产路径始终挂载。
// headless（NullEngine）下 DOM 回归不需要 SDEF 蒙皮注入，且规避 createEffect 意外，同样跳过。
if (!_isTestEnv && !_isHeadless) {
    SdefInjector.OverrideEngineCreateEffect(engine);
}
// 扩展渲染组下限至 -2：天空盒(Group -2)先于体积云(Group -1)先于 Group 0（地面/角色）。
// Babylon 默认 MIN_RENDERINGGROUPS=0 会跳过负数 group，导致负组 mesh 不渲染。
RenderingManager.MIN_RENDERINGGROUPS = -2;
export let scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

/** disposeScene() 已调用标志，防止重复释放。 */
let _sceneDisposed = false;

/** initScene() 是否已至少执行过一次。首次调用时跳过 scene/engine 重建。 */
let _sceneInitialized = false;

/**
 * 统一应用帧率控制：帧率限制器开关 + 帧率上限。
 * - 限制器关闭（uiState.frameCapEnabled=false）：不施加任何人为限帧（engine.maxFPS=undefined），
 *   渲染以显示器刷新率运行。注意：浏览器/WebView 渲染循环由 requestAnimationFrame 驱动，
 *   天然与显示器刷新同步，Web 层无法真正关闭垂直同步。
 * - 限制器开启（默认）：应用帧率上限 fpsLimit（0=不限制=原生刷新同步）。
 */
export function applyFrameControl(): void {
    if (uiState.frameCapEnabled === false) {
        engine.maxFPS = undefined; // 关闭限制器：不限帧（0 会被 Babylon 视为"永不渲染"）
        return;
    }
    const limit = uiState.fpsLimit ?? 0;
    engine.maxFPS = limit > 0 ? limit : undefined;
}

/**
 * 级联释放 Scene → Engine 及其所有子资源。
 * - 同步操作，仅在 beforeunload（真正退出）或 initScene HMR 重入时调用。
 * - ⚠️ 禁止挂在 visibilitychange / pagehide —— hidden 在最小化/切后台即触发，
 *   会导致切回后渲染器冻结（见 buglog 2026-07-21-visibilitychange-dispose-scene-freeze）。
 * - 幂等：_sceneDisposed 标志防止重复释放。
 * - 释放顺序：子系统 observer → Scene → Engine（WebGL context 最后释放）。
 */
export function disposeScene(): void {
    if (_sceneDisposed) {
        return;
    }
    _sceneDisposed = true;

    // 1. 移除 scene.onDisposeObservable 订阅，避免 scene.dispose() 触发冗余回调
    if (_sceneDisposeObserverHandle) {
        _sceneDisposeObserverHandle = safeDispose(_sceneDisposeObserverHandle);
    }

    // 2. 清理播放相关 observer
    _disposePlaybackObservables?.();
    _disposePlaybackObservables = null;

    // 2.5 [code_review P3] 重置动作意图广播回调：initMotionIntent 的幂等守卫
    // （_callbackInitialized）在场景销毁/重建或 HMR 后永久阻断重注册，广播回调
    // 会残留绑定旧注册——disposeScene 时复位，使下次 initMotionBroadcast 可重新注册。
    resetMotionIntent();

    // 3. [fix:P3] 释放程序化动作模块（BeatDetector + perception observer）
    //    proc-motion-bridge 已静态导入，同步释放以保持 disposeScene 同步级联契约
    disposeProcMotion();

    // 3.5 [fix P2] 释放 Gizmo（含拖拽中 flush 回写）——layer 绑定在即将 dispose 的 scene 上，
    //    不释放会导致 initTransformGizmo 跨场景复用失效 layer
    detachGizmo();

    // 4. 释放反射系统、渲染管线、环境更新、物理风系统
    disposeReflection();
    disposeRenderer();
    disposeEnvUpdateObserver();
    disposeWindPhysics();
    // [audit:round13 P2] 级联释放相机系统（stop 各行为循环 + dispose 当前相机 + 清理运行时上下文）。
    // 此前 disposeCameraSystem 是全工程无调用点的死代码；HMR 重入 _reinitSceneForHMR 会再次
    // initCameraSystem(scene, canvas) 重建，故此处调用是安全且必须的（否则旧相机引用/触摸监听残留）。
    disposeCameraSystem();

    // 5. Scene → Engine 级联释放（WebGL 上下文最终释放）
    scene.dispose();
    engine.dispose();
}

export let modelManager: ModelManager;

/** 播放观察者 dispose 函数，场景销毁时调用以清理 observable。 */
let _disposePlaybackObservables: (() => void) | null = null;

/** scene.onDisposeObservable 订阅句柄，HMR 重入时需先移除旧订阅避免累积。 */
let _sceneDisposeObserverHandle: ObserverHandle | null = null;

// Dev debug helper — module-level export for Console inspection (no window pollution)
export const __envDebug = import.meta.env.DEV
    ? () => ({
          clearColor: `rgba(${scene.clearColor.r.toFixed(2)},${scene.clearColor.g.toFixed(2)},${scene.clearColor.b.toFixed(2)},${scene.clearColor.a})`,
          matType: _envSys.sky.skyMesh.material.getClassName() || 'none',
          skyMode: envState.skyMode,
      })
    : undefined;

// 相机系统不依赖 MMD runtime，模块顶层初始化（确保渲染循环启动时有 activeCamera）
// 测试态跳过：无 canvas / 无渲染循环，且降低导入期 DOM 依赖（见 _isTestEnv 注释）
if (!_isTestEnv) {
    initCameraSystem(scene, dom.canvas);
}

// scene-lighting.ts 提供 getLightState / setLightState
// scene-renderer.ts 提供 getRenderState / setRenderState / reattachPipeline

// ======== Convenience getters (delegated to model-ops) ========
export { focusedMmdModel, focusedModel } from './manager/model-ops';

// ======== Init Scene ========

/**
 * 读取 WebGL 渲染器厂商/型号信息（供 AI 诊断快照）。
 * Babylon Engine 未直接暴露 vendor/renderer，需从底层 GL 上下文读取；
 * 访问私有 `_gl` 属异常安全，headless/上下文缺失时回退 unknown。
 */
function _getRendererInfo(): { vendor: string; renderer: string } {
    try {
        const gl = (engine as unknown as { _gl?: WebGLRenderingContext | WebGL2RenderingContext })
            ._gl;
        if (gl) {
            return {
                vendor: (gl.getParameter(gl.VENDOR) as string) || 'unknown',
                renderer: (gl.getParameter(gl.RENDERER) as string) || 'unknown',
            };
        }
    } catch {
        // 读取 GL 上下文失败（如 headless），回退 unknown
    }
    return { vendor: 'unknown', renderer: 'unknown' };
}

/**
 * 场景初始化入口。首次调用时创建 Scene/Engine/运行时；
 * HMR 重入时先调用 _reinitSceneForHMR() 清理旧资源再重建。
 */
export async function initScene(): Promise<void> {
    if (_sceneInitialized) {
        await _reinitSceneForHMR();
    }
    const runtime = await _initMmdRuntime();
    initLighting(scene, _envSys.shadow, triggerAutoSave);
    initRenderer(scene, modelRegistry, triggerAutoSave);
    initEnvFacade(scene, pipeline);
    const beat = createProcBeatDetector();
    getSceneAction('attachBeatDetector')?.(beat);
    _bindSceneEvents(scene);
    await _injectRuntimeCallbacks(runtime, scene);
    _initModelManager(scene, runtime, triggerAutoSave, autoFrame);
    _injectModelCallbacks(modelManager, runtime);
    // Loader（必须在 modelManager + setTriggerAutoSave 之后）
    // [doc:adr-238] tryAutoApplyPreset/loadOutfits 经 scene-action-bridge（menus/model-preset + outfit 注册），
    // 切断 scene→menus 与 scene→outfit 反向依赖。
    initLoader(
        scene,
        runtime,
        modelManager,
        refreshWaterRenderList,
        (id: string) => getSceneAction('tryAutoApplyPreset')?.(id),
        (id: string) =>
            getSceneAction('loadOutfits')?.(id)
                .then(() => {})
                .catch(() => {
                    /* loadOutfits 仅用于换装，失败不阻断流程 */
                }),
        rebuildOutlineState
    );
    _disposePlaybackObservables = initPlaybackObservables(
        runtime,
        modelManager,
        updatePlaybackUI,
        updateProcMotion,
        getProcBeatDetector
    );
    await _initMotionSubsystems(scene, modelManager);
    applyEnvState(envState);
    _updateSunDisc();
    registerRenderBridge({ engine, setLightState, setRenderState, getLightState, getRenderState });
    // [doc:adr-196] 注入 AI 快照桥接：getter 惰性读取当前 engine/scene/modelManager，
    // HMR 重初始化新实例后仍能读到最新值（单向依赖，ai 模块不反向依赖 scene）。
    registerAiSnapshotBridge({
        getFps: () => engine.getFps(),
        getModelCount: () => modelManager?.getAll().length ?? 0,
        getMeshCount: () => scene.meshes.length,
        getMaterialCount: () => scene.materials.length,
        getActiveMotions: () =>
            scene.animationGroups.filter((ag) => ag.isPlaying).map((ag) => ag.name),
        getPerformanceMode: () => getPerformanceMode(),
        getRendererInfo: () => _getRendererInfo(),
        getKtx2Support: () => detectKtx2Support(),
    });
    _sceneInitialized = true;
}

/** HMR 重入时清理上一轮 Scene/Engine 及子模块资源。 */
async function _reinitSceneForHMR(): Promise<void> {
    disposeScene();
    _sceneDisposed = false;

    engine = createEngine();
    if (!_isTestEnv && !_isHeadless) {
        SdefInjector.OverrideEngineCreateEffect(engine);
    }
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);
    initCameraSystem(scene, dom.canvas);

    (await import('./motion/bone-override')).stopBoneOverride();
    (await import('./motion/feet-adjustment')).stopFeetAdjustment();
    (await import('./motion/footstep')).stopFootstep();
    (await import('../core/audio-bus')).disposeAudioBus();
    unsubscribeAll();
    (await import('./env/_bridge/env-persist')).cancelEnvPersistTimer();
    (await import('./env/env')).stopTimeOfDay();
}

/** 绑定场景级指针事件（水面涟漪 / 拖拽模式）。 */
function _bindSceneEvents(scene: Scene): void {
    // 点击水面 → 生成涟漪
    scene.onPointerObservable.add((info) => {
        if (info.type !== PointerEventTypes.POINTERDOWN) {
            return;
        }
        if (!envState.waterEnabled) {
            return;
        }
        if (info.pickInfo.hit) {
            return;
        }
        const ray = info.pickInfo.ray;
        if (!ray || ray.direction.y >= 0) {
            return;
        }
        const waterY = envState.waterLevel;
        // [fix P2] activeCamera 可能为 null（场景无活动相机时），访问前守卫
        const cam = scene.activeCamera;
        if (!cam) {
            return;
        }
        const camY = cam.globalPosition.y;
        if (camY === undefined || camY <= waterY) {
            return;
        }
        const t = (waterY - ray.origin.y) / ray.direction.y;
        if (t <= 0) {
            return;
        }
        const hit = ray.origin.add(ray.direction.scale(t));
        const half = Math.max(60, envState.groundSize) / 2;
        if (Math.abs(hit.x) > half || Math.abs(hit.z) > half) {
            return;
        }
        addRipple(hit, 5, 0.6, 2, 2.5);
    }, PointerEventTypes.POINTERDOWN);

    // [doc:adr-171] 场景级拖拽模式：点击物体 → 附加 Gizmo
    let _dragModePointerDownX = 0;
    let _dragModePointerDownY = 0;
    scene.onPointerObservable.add((info) => {
        if (!isDragModeEnabled()) {
            return;
        }
        if (info.type === PointerEventTypes.POINTERDOWN) {
            _dragModePointerDownX = info.event.clientX;
            _dragModePointerDownY = info.event.clientY;
            return;
        }
        if (info.type !== PointerEventTypes.POINTERUP) {
            return;
        }
        if (isGizmoDragging()) {
            return;
        }
        const dx = info.event.clientX - _dragModePointerDownX;
        const dy = info.event.clientY - _dragModePointerDownY;
        if (dx * dx + dy * dy > 25) {
            return;
        }
        tryAttachGizmoFromPick(scene, scene.pointerX, scene.pointerY);
    }, PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERUP);
}

/** 注入运行时回调（音画同步 / 场景引用 / 播放速度 / 动作广播）。 */
async function _injectRuntimeCallbacks(runtime: IMmdRuntime, scene: Scene): Promise<void> {
    // 将 StreamAudioPlayer 接入 MMD Runtime，实现原生音画同步
    // （play/pause/seek 由 Runtime 自动管理，无需手动 syncAudioPlayback）
    swallowError(
        Promise.resolve(
            getSceneAction('getStreamPlayer')?.() as
                Parameters<typeof runtime.setAudioPlayer>[0] | null
        ).then((player) => {
            if (player) {
                runtime.setAudioPlayer(player);
            }
        })
    );
    // [adr-104] 注入 scene 引用到 outfit（破除循环依赖，替代动态 import）。
    // 动态 import + swallowError 彻底规避 scene↔outfit 静态环，与既有模式一致。
    swallowError(import('@/scene/manager/outfit').then((m) => m.setSceneRef(scene)));
    // 同步用户记忆的播放速度到新 runtime，防状态漂移
    swallowError(
        import('../menus/motion-popup').then(({ syncPlaybackSpeedToRuntime }) =>
            syncPlaybackSpeedToRuntime(runtime)
        )
    );
    // [doc:adr-121] 初始化场景级动作意图广播（显式调用，避免模块顶层副作用）
    swallowError(
        import('../menus/motion-popup').then(({ initMotionBroadcast }) => initMotionBroadcast())
    );
}

/** 创建 ModelManager 并设置模型移除回调。 */
function _initModelManager(
    scene: Scene,
    runtime: IMmdRuntime,
    triggerAutoSave: () => void,
    autoFrame: (center: Vector3, extent: number) => void
): void {
    modelManager = new ModelManager(scene, triggerAutoSave, autoFrame);
    modelManager.onRemoveModel = (id) => {
        // [fix P1] 模型删除时清理动作历史与合并窗口状态，防止 _historyMap/_mergeMap
        // 条目累积（内存泄漏）及同 ID 复用读到幽灵历史
        clearHistory(id);

        // 程序化动作清理（视线追踪 observer 拆除）必须早于 destroyMmdModel
        // 否则下一帧 observer 同时读到 _procVmdActive=true + mmdModel 已销毁 → skeleton null → TypeError
        // 见 proc-motion-bridge.ts onModelRemoved
        onModelRemoved(id);

        // [doc:adr-168] 释放角色专属个人灯
        detachPersonalLight(id);

        // 同步销毁 MMD 模型：必须在网格释放 / modelRegistry.delete 之前执行
        // （见 model-manager.ts remove() 的调用顺序），且必须早于下方三个 fire-and-forget 清理。
        // 下方动态 import 仅「调度」Promise，其 .then 体在微任务中于本同步块结束后、即 destroyMmdModel 之后才运行。
        const inst = modelRegistry.get(id);
        if (inst?.mmdModel && mmdRuntime) {
            try {
                mmdRuntime.destroyMmdModel(inst.mmdModel);
            } catch (e) {
                logWarn('scene', 'removeModel: destroyMmdModel failed', e);
            }
        }

        // 两个清理均为 fire-and-forget：在 destroyMmdModel 之后（微任务）才真正执行。
        // 显式契约：它们只操作各自独立的 registry（_blenderStates / controllers），
        // 绝不访问已销毁的 mmdModel 或 modelRegistry.get(id)。
        // 若未来修改任一实现、新增对模型的访问，必须先加 modelRegistry.get(id) 守卫。
        // WASM 图层混合器 teardown（observer + evaluator 清理）
        swallowError(
            import('./motion/wasm-layers-blender').then(({ teardownWasmLayersBlender }) => {
                if (scene.isDisposed) {
                    return;
                }
                teardownWasmLayersBlender(id);
            })
        );

        // ADR-084 P3b: 模型卸载时释放该模型的虚拟裙骨控制器，避免 dispose 泄漏。
        // 经动态 import（motion-cloth-levels 内部仍以 await import 加载 virtual-skirt），
        // 不破坏 ADR-081/084 的 virtual-skirt 非 eager 导入约束。
        swallowError(
            import('../menus/motion-cloth-levels').then(({ disposeVirtualSkirtForModel }) => {
                if (scene.isDisposed) {
                    return;
                }
                disposeVirtualSkirtForModel(id);
            })
        );
    };
    setModelRegistry(modelManager.modelRegistry);
    // 必须注册真实实现 triggerAutoSaveImpl（scene-serialize 内的防抖存盘），
    // 而非 @/core/utils 的 triggerAutoSave 包装器本身——后者会令 _triggerAutoSaveImpl
    // 指回包装器自身，触发无限自递归（Maximum call stack size exceeded）。
    setTriggerAutoSave(triggerAutoSaveImpl);
}

/** 注入模型生命周期回调（聚焦 / 加载完成）。 */
function _injectModelCallbacks(modelManager: ModelManager, _runtime: IMmdRuntime): void {
    // 5. 注入回调解耦：model-loader / model-manager 不再直接动态导入 renderer / proc-motion-bridge
    setOnMeshesReady((meshes) => onModelMeshesReady(meshes));
    // proc-motion-bridge 已静态导入，activateGazeTracking 直接同步调用；
    // perception 未静态导入（避免环），仍走动态导入
    const activatePerception = import('./motion/perception').then((m) => m.activatePerception);
    swallowError(activatePerception);
    modelManager.onModelFocused = () => {
        activateGazeTracking();
    };
    setOnModelLoaded((id) => {
        activateGazeTracking();
        // [doc:adr-164] 新模型加载时自动激活感知层（全员感知模式下激活所有模型）
        swallowError(activatePerception.then((fn) => fn(id)));
        // [doc:adr-168] 角色模型自动获得专属个人灯
        const inst = modelRegistry.get(id);
        if (inst?.kind === 'actor') {
            attachPersonalLight(id);
        }
    });
}

/** 启动运动子系统（脚部跟随 / 脚步声 / 骨骼覆盖 / 程序化动作）。 */
async function _initMotionSubsystems(scene: Scene, _modelManager: ModelManager): Promise<void> {
    // 7. 脚部地面跟随系统启动（ADR-085）
    // [doc:adr-116 重构] 地面跟随降为 always-on 基础设施，不再由动作覆盖模块控制。
    // 使用默认 FeetState（enabled=true, intensity=1），始终贴地修正。
    const { startFeetAdjustment } = await import('./motion/feet-adjustment');
    startFeetAdjustment(
        (): { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] => {
            const out: { id: string; feet: FeetState; runtimeBones: readonly IMmdRuntimeBone[] }[] =
                [];
            for (const inst of modelRegistry.values()) {
                const bones = inst.mmdModel?.runtimeBones;
                if (bones && bones.length > 0) {
                    // [doc:adr-116 重构] 地面跟随 always-on：enabled=true, intensity=1
                    out.push({
                        id: inst.id,
                        feet: { ...createDefaultFeetState(), enabled: true },
                        runtimeBones: bones,
                    });
                }
            }
            return out;
        }
    );

    // 7.5 脚步声系统启动（ADR-088）：消费 feet-adjustment 落地事件发声
    // 必须在 startFeetAdjustment 之后注册（落地事件由脚部跟随产生）
    const { startFootstep } = await import('./motion/footstep');
    startFootstep(scene);

    // 8. Bone Override 系统启动
    // 注册 onBeforeRenderObservable 回调，在动画应用后逐骨骼覆盖
    const { startBoneOverride } = await import('./motion/bone-override');
    startBoneOverride(() => {
        const id = focusedModelId;
        if (!id) {
            return [];
        }
        const inst = modelRegistry.get(id);
        return inst?.mmdModel?.runtimeBones ?? [];
    }, scene);

    // [ADR-202 A-class] WASM IK 重解回调注入
    // 在 WASM 模式下，applyBoneOverrideIK 通过此回调调用 mmdModelSolveIk 导出重解 IK。
    // mmdRuntime 是 @/core/config 的 live binding（setMmdRuntime 后即指向当前运行时实例；
    // HMR 重入时 stopBoneOverride 清除旧 resolver，_initMmdRuntime 设新 mmdRuntime 后重注）。
    const { setWasmIkResolver } = await import('./motion/bone-override');
    const { solveIkNative, getPhysicsImpl } = await import('@/core/mmd-adapter');
    setWasmIkResolver((modelId: string, ikSolverIndex: number, usePhysics: boolean) => {
        const inst = modelRegistry.get(modelId);
        if (!inst?.mmdModel) {
            return;
        }
        const impl = getPhysicsImpl(mmdRuntime);
        if (!impl) {
            return;
        }
        solveIkNative(impl.wasmInstance, inst.mmdModel, ikSolverIndex, usePhysics);
    });

    // [doc:adr-116] 9. Motion Override Modules 注册（主初始化路径）
    // 必须在 focusModel 可能被调用之前完成；registry 内 setTargetModel/createModule 也有幂等兜底
    const { initMotionModules } = await import('./motion/motion-modules/registry');
    initMotionModules();
}

/** 初始化 MMD 运行时（WASM 主路径 / JS 调试路径）。 */
async function _initMmdRuntime(): Promise<IMmdRuntime> {
    // 1. MMD 运行时初始化
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    // [ADR-188] 材质模式日志
    const materialMode = getMaterialMode();
    logWarn('scene', `MMD 材质模式: ${materialMode}`);
    MmdRuntimeShared.MaterialProxyConstructor = getStandardMaterialProxy();
    // [ADR-188] PMX 加载阶段材质构建器切换
    // 默认 'babylon-mmd/esm/Loader/mmdModelLoader' import 已注册 MmdStandardMaterialBuilder
    // PBR 模式下需动态导入 PBRMaterialBuilder 覆盖 SharedMaterialBuilder
    if (materialMode === 'pbr') {
        await tryApplyPbrMaterialBuilder();
    }
    // 运行时切换：默认 WASM（含物理），可在程序化动作菜单切换到 JS 版（调试专用，无物理）
    // JS 版保留作为 gaze 行为对比排查与 WASM 兼容性回退，勿删除
    const useJsRuntime = getMmdRuntimeType() === 'js' || _isHeadless;
    let runtime: IMmdRuntime;
    if (useJsRuntime) {
        runtime = new MmdRuntime(scene, null);
        logWarn('scene', 'JS 版 MmdRuntime（调试专用，无物理）— 生产请用 WASM');
    } else {
        // MPR（多线程）需 SharedArrayBuffer + COOP/COEP，与 Go 端 CoopCoepMiddleware 同轴门控。
        // __MMD_ENABLE_MPR__ 为构建期常量（vite define）：未定义 VITE_MMD_WASM_MT → false →
        // esbuild 消除本分支，默认构建不含 MPR worker/wasm（零回归、bundle 精简）。
        // 运行时再叠加 crossOriginIsolated 守卫：即便构建带 MPR，若启动进程未注入 COOP/COEP
        // （漏设 VITE_MMD_WASM_MT 环境变量），也优雅回退 SPR，绝不因 SAB 不可用而崩窗。
        const useMultiThread =
            __MMD_ENABLE_MPR__ && typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        dom.loadingText.textContent = t('boot.downloadingWasm');
        let wasmInstance;
        if (useMultiThread) {
            try {
                const { MmdWasmInstanceTypeMPR } =
                    await import('babylon-mmd/esm/Runtime/Optimized/InstanceType/multiPhysicsRelease');
                wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeMPR());
                logWarn('scene', '使用 WASM 版 MmdWasmRuntime（MPR 多线程物理）');
            } catch (e) {
                logWarn('scene', 'MPR 初始化失败，回退 SPR 单线程物理：', e);
                wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
                logWarn('scene', '使用 WASM 版 MmdWasmRuntime（SPR 单线程物理，MPR 回退）');
            }
        } else {
            wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
            logWarn('scene', '使用 WASM 版 MmdWasmRuntime（SPR 单线程物理）');
        }
        // [doc:adr-099] 运行时模式徽标：检测 COI/SAB/MPR 并常驻渲染到右上角 HUD
        // （独立 DOM 元素，不被 setStatus 瞬时消息覆盖；结果持久化，刷新/导航后仍在）。
        const runtimeMode = detectRuntimeMode();
        persistRuntimeMode(runtimeMode);
        renderRuntimeBadge(runtimeMode);
        logWarn(
            'scene',
            `[ADR-099] 验证: crossOriginIsolated=${runtimeMode.coi} SharedArrayBuffer=${runtimeMode.sab} useMultiThread=${useMultiThread} threads=${runtimeMode.threads}`
        );
        const mmdWasmPhysics = new MmdWasmPhysics(scene);
        runtime = new MmdWasmRuntime(wasmInstance, scene, mmdWasmPhysics);
        initWindPhysics(runtime);
        if (_sceneDisposeObserverHandle) {
            _sceneDisposeObserverHandle.dispose();
        }
        _sceneDisposeObserverHandle = observe(scene.onDisposeObservable, () => {
            disposeWindPhysics();
            disposeReflection();
            disposeEnvUpdateObserver();
            disposeRenderer();
        });
    }
    // [doc:adr-059/binding] 生产静音：babymmd 的 Binding failed 告警（物理骨/IK 骨
    // 轨道精确匹配失败）是「失败跳过」设计、视觉无影响，属预期噪音。
    // 默认 loggingEnabled=false（babymmd 静音），仅 dev 构建开启以便调试绑定问题。
    if (import.meta.env.DEV) {
        runtime.loggingEnabled = true;
    }
    runtime.register(scene);
    setMmdRuntime(runtime);
    dom.loadingText.textContent = t('boot.initScene');
    // [adr:ground] 运行时就绪后还原持久化/默认的地面碰撞状态
    applyGroundCollision();
    return runtime;
}

// ======== 快捷 getter ========
export function getScene(): Scene {
    return scene;
}

// ======== AR Camera Mode (delegated to ar/ar-scene.ts) ========

// Re-exports from extracted sub-modules (zero-change for consumers)
export {
    loadVMDMotion,
    loadVMDFromPath,
    loadCameraVmdFromPath,
    loadVPDPose,
} from './motion/vmd-loader';
export { updatePlaybackUI, seekFromEvent, initPlaybackObservables } from './motion/playback';
export {
    dom,
    setStatus,
    formatTime,
    setMmdRuntime,
    mmdRuntime,
    modelRegistry,
    focusedModelId,
    setFocusedModelId,
    isPlaying,
    setIsPlaying,
    autoLoop,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    setModelRegistry,
    envState,
} from '../core/config';
export { triggerAutoSave, setTriggerAutoSave } from '../core/auto-save';
export type { EnvState, ModelInstance } from '../core/config';
export { resolveFileUrl, normPath } from '../core/fileservice';
export {
    pushUndoSnapshot,
    popUndoSnapshot,
    restoreUndoSnapshot,
    offerSceneUndo,
    offerSceneUndoAndRefresh,
    canUndo,
} from './scene-serialize';
export { applyEnvState } from './env/env';
export * from './motion/proc-motion-bridge';
export * from './motion/lipsync-bridge';
export * from './scene-serialize';
export * from './env/_bridge/env-bridge';
export * from './env/env-gravity';
export * from './env/env-collision';
export * from './env/_bridge/env-persist';
export * from './env/env-time-of-day';
export * from './render/lighting';
export * from './render/renderer';
export * from './manager/model-ops';
export { loadPMXFile, captureThumbnail, initLoader } from './manager/model-loader';
export {
    initCameraSystem,
    autoFrame,
    getCameraState,
    setCameraState,
    animateCameraVmd,
    loadCameraVmd,
    clearCameraVmd,
    hasCameraVmd,
    getCameraVmdName,
    getCameraVmdPath,
    switchCameraMode,
    getCameraMode,
} from './camera/camera';
export type { CameraState } from './camera/camera';
export { SaveThumbnail, SaveLastScene, LoadLastScene, SetEnvState } from '../core/wails-bindings';
export type { LightState, StageLightState } from './render/lighting';
export type { RenderState } from './render/renderer';

// [doc:adr-238] 注册模型搜索供 core/action-defs entity resolve 经 scene-action-bridge 调用
import { registerSceneAction, getSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('findSceneModelByName', async (name: string) => {
    // [fix P2] modelManager 在 _initModelManager（initScene 内）执行前为 undefined，
    // 该回调模块加载即注册，须守卫避免 initScene 前调用抛 TypeError。
    if (!modelManager) {
        return null;
    }
    return (
        modelManager.getAll().find((m) => m.name.toLowerCase().includes(name.toLowerCase())) ?? null
    );
});

// [doc:adr-238] 注册场景初始化供 core/init 经 scene-action-bridge 调用
registerSceneAction('initScene', () => initScene());
