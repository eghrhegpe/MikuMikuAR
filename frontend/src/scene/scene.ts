// [doc:architecture] Scene — 3D 场景核心模块（纯组装器）
// 规范文档: docs/architecture.md §渲染环节
// 职责: 导入所有子系统，按正确顺序装配，提供唯一 initScene() 入口
// 注意: 具体逻辑已拆分到子模块，此文件仅负责组合。

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Physics/v2/physicsEngineComponent';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import '@babylonjs/core/Particles/webgl2ParticleSystem';

import { RegisterMmdModelLoaders } from 'babylon-mmd/esm/Loader/dynamic';
import { RegisterDxBmpTextureLoader } from 'babylon-mmd/esm/Loader/registerDxBmpTextureLoader';
import { GetMmdWasmInstance } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance';
import { MmdWasmInstanceTypeSPR } from 'babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease';
import { MmdWasmRuntime } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime';
import { MmdWasmPhysics } from 'babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics';
import 'babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { MmdRuntimeShared } from 'babylon-mmd/esm/Runtime/mmdRuntimeShared';
// JS 版 runtime（无 WASM 双缓冲，worldMatrix 覆写可生效）
import { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import 'babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation';
import 'babylon-mmd/esm/Loader/mmdModelLoader.default';
import '@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader';
import '@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex';
import 'babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment';

import {
    initEnvFacade,
    applyEnvState,
    _envSys,
    refreshWaterRenderList,
    addRipple,
} from './env/env';
import { initCameraSystem, autoFrame } from './camera/camera';
import {
    dom,
    setMmdRuntime,
    mmdRuntime,
    modelRegistry,
    setModelRegistry,
    propRegistry,
    envState,
    uiState,
    triggerAutoSave,
    setTriggerAutoSave,
    getMmdRuntimeType,
    setStatus,
    focusedModelId,
} from '../core/config';
import { attachBeatDetector } from '../outfit/audio';
import { _catState, _matState, _matEnabled } from './manager/material';
import { updatePlaybackUI, initPlaybackObservables } from './motion/playback';
import { initLighting, _updateSunDisc } from './render/lighting';
import { initRenderer, rebuildOutlineState, pipeline } from './render/renderer';
import { initLoader } from './manager/model-loader';

// Re-export material system (extracted to material.ts for file size)
export {
    _catState,
    _matState,
    _matEnabled,
    _catOf,
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
    resetAllMatParams,
    getMatState,
    applyMatState,
    registerMaterialTarget,
    unregisterMaterialTarget,
    getMaterialMeshes,
    isMatCategoryAllEnabled,
    setMatCategoryEnabled,
    DEFAULT_MAT_PARAMS,
} from './manager/material';
export type { MaterialCategoryParams, MaterialCategory } from './manager/material';

import { ModelManager } from './manager/model-manager';
import {
    updateProcMotion,
    createProcBeatDetector,
    getProcBeatDetector,
    onModelRemoved,
} from './motion/proc-motion-bridge';
import { updateLipSync, initLipSync } from './motion/lipsync-bridge';
import { triggerAutoSaveImpl } from './scene-serialize';

// ======== Babylon.js ========
// alpha:true 让 WebGL drawing buffer 携带 alpha 通道，使 AR 模式下 scene.clearColor
// 的 a=0 生效（透明 canvas），从而透出底层 <video> 相机画面。非 AR 场景 clearColor
// 的 a=1.0 完全不透明，不受影响。
export const engine = new Engine(dom.canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    alpha: true,
});
export const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

/**
 * 统一应用帧率控制：垂直同步 + 帧率上限。
 * - 垂直同步关闭（vsync=false）：解除本应用层限帧（engine.maxFPS=0）。
 *   注意：浏览器/WebView 渲染循环由 requestAnimationFrame 驱动，天然与显示器刷新同步，
 *   无法在 Web 层真正关闭 vsync；此开关等价于"不施加任何人为限帧"。
 * - 垂直同步开启（默认）：应用帧率上限 fpsLimit（0=不限制=原生刷新同步）。
 */
export function applyFrameControl(): void {
    if (uiState.vsync === false) {
        engine.maxFPS = 0; // 关闭垂直同步：不限帧
        return;
    }
    const limit = uiState.fpsLimit ?? 0;
    engine.maxFPS = limit > 0 ? limit : undefined;
}

export let modelManager: ModelManager;

/** 播放观察者 dispose 函数，场景销毁时调用以清理 observable。 */
let _disposePlaybackObservables: (() => void) | null = null;

// Dev debug helper — exposes internals for Console inspection
window.__envDebug = () => ({
    clearColor: `rgba(${scene.clearColor.r.toFixed(2)},${scene.clearColor.g.toFixed(2)},${scene.clearColor.b.toFixed(2)},${scene.clearColor.a})`,
    matType: _envSys.sky.skyMesh.material.getClassName() || 'none',
    skyMode: envState.skyMode,
});

// 相机系统不依赖 MMD runtime，模块顶层初始化（确保渲染循环启动时有 activeCamera）
initCameraSystem(scene, dom.canvas);

// scene-lighting.ts 提供 getLightState / setLightState
// scene-renderer.ts 提供 getRenderState / setRenderState / reattachPipeline

// ======== Convenience getters (delegated to model-ops) ========
export { focusedMmdModel, focusedModel } from './manager/model-ops';

// ======== Init Scene ========
export async function initScene(): Promise<void> {
    // 1. MMD 运行时初始化
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
    // 运行时切换：默认 WASM（含物理），可在程序化动作菜单切换到 JS 版（调试专用，无物理）
    // JS 版保留作为 gaze 行为对比排查与 WASM 兼容性回退，勿删除
    const useJsRuntime = getMmdRuntimeType() === 'js';
    let runtime: IMmdRuntime;
    if (useJsRuntime) {
        runtime = new MmdRuntime(scene, null);
        console.warn('[scene] JS 版 MmdRuntime（调试专用，无物理）— 生产请用 WASM');
    } else {
        const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
        const mmdWasmPhysics = new MmdWasmPhysics(scene);
        runtime = new MmdWasmRuntime(wasmInstance, scene, mmdWasmPhysics);
        console.log('[scene] 使用 WASM 版 MmdWasmRuntime（含物理）');
    }
    runtime.loggingEnabled = true;
    runtime.register(scene);
    setMmdRuntime(runtime);
    // 同步用户记忆的播放速度到新 runtime，防状态漂移
    import('../menus/motion-popup')
        .then(({ syncPlaybackSpeedToRuntime }) => syncPlaybackSpeedToRuntime(runtime))
        .catch(() => {});

    // 2. 各子系统初始化（相机系统已在模块顶层初始化）
    initLighting(scene, modelRegistry, propRegistry, _envSys.shadow, triggerAutoSave);
    initRenderer(scene, modelRegistry, triggerAutoSave);
    initEnvFacade(scene, pipeline);

    // 3. Beat Detector
    const beat = createProcBeatDetector();
    attachBeatDetector(beat);

    // 4. ModelManager（必须在 initLoader 之前初始化）
    //    注意：setTriggerAutoSave 必须在此之后立即调用，
    //    确保所有子系统（loader / lighting / renderer）触发保存时函数已实现。
    modelManager = new ModelManager(scene, triggerAutoSave, autoFrame);
    modelManager.onRemoveModel = (id) => {
        // 程序化动作清理（视线追踪 observer 拆除）必须早于 destroyMmdModel
        // 否则下一帧 observer 同时读到 _procVmdActive=true + mmdModel 已销毁 → skeleton null → TypeError
        // 见 proc-motion-bridge.ts onModelRemoved
        onModelRemoved(id);

        // WASM 图层混合器 teardown（observer + evaluator 清理）
        import('./motion/wasm-layers-blender')
            .then(({ teardownWasmLayersBlender }) => teardownWasmLayersBlender(id))
            .catch(() => {});

        // 解除此模型上的所有骨骼锚定道具
        import('./env/accessory')
            .then(({ detachModelAccessories }) => detachModelAccessories(id))
            .catch(() => {});

        const inst = modelRegistry.get(id);
        if (inst.mmdModel && mmdRuntime) {
            try {
                mmdRuntime.destroyMmdModel(inst.mmdModel);
            } catch (e) {
                console.warn('removeModel: destroyMmdModel failed', e);
            }
        }
    };
    setModelRegistry(modelManager.modelRegistry);
    setTriggerAutoSave(triggerAutoSaveImpl);

    // 4.5 注入 ModelManager 到依赖模块
    initLipSync(modelManager);

    // 5. Loader（必须在 modelManager + setTriggerAutoSave 之后）
    // 破除循环依赖：scene.ts 不再静态 import outfit / model-preset，
    // 改在 initScene(async) 内动态 import（同 scene.ts:187，adr-053/adr-064）。
    const outfitMod = await import('../outfit/outfit');
    const presetMod = await import('../menus/model-preset');
    initLoader(
        scene,
        runtime,
        modelManager,
        refreshWaterRenderList,
        presetMod.tryAutoApplyPreset,
        (id: string) => outfitMod.loadOutfits(id).then(() => {}),
        rebuildOutlineState
    );
    _disposePlaybackObservables = initPlaybackObservables(
        runtime,
        modelManager,
        updatePlaybackUI,
        updateProcMotion,
        updateLipSync,
        getProcBeatDetector
    );

    // 6. 应用初始环境状态
    applyEnvState(envState);
    _updateSunDisc();

    // 无 VMD 时也能驱动程序化动作和口型同步
    scene.onBeforeRenderObservable.add(() => {
        updateProcMotion().catch(() => {});
    });

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
        const camY = scene.activeCamera.globalPosition.y;
        if (camY === undefined || camY <= waterY) {
            return;
        }
        const t = (waterY - ray.origin.y) / ray.direction.y;
        if (t <= 0) {
            return;
        }
        const hit = ray.origin.add(ray.direction.scale(t));
        const half = envState.waterSize / 2;
        if (Math.abs(hit.x) > half || Math.abs(hit.z) > half) {
            return;
        }
        addRipple(hit, 3, 0.4, 1.5, 2);
    }, PointerEventTypes.POINTERDOWN);

    // 7. Bone Override 系统启动
    // 注册 onBeforeRenderObservable 回调，在动画应用后逐骨骼覆盖
    const { startBoneOverride } = await import('./motion/bone-override');
    startBoneOverride(() => {
        const id = focusedModelId;
        if (!id) return [];
        const inst = modelRegistry.get(id);
        return inst?.mmdModel?.runtimeBones ?? [];
    }, scene);

    setTriggerAutoSave(triggerAutoSaveImpl);
}

// ======== 快捷 getter ========
export function getScene(): Scene {
    return scene;
}

// ======== AR Camera Mode (delegated to ar/ar-scene.ts) ========
export { setARMode, takeARScreenshot, isARModeActive } from './ar/ar-scene';

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
    propRegistry,
    envState,
    triggerAutoSave,
    setTriggerAutoSave,
    pendingVmd,
    setPendingVmd,
} from '../core/config';
export type { EnvState, ModelInstance, PropInstance } from '../core/config';
export { resolveFileUrl, normPath } from '../core/fileservice';
export * from './motion/proc-motion-bridge';
export * from './motion/lipsync-bridge';
export * from './env/props';
export * from './scene-serialize';
export * from './env/env-bridge';
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
export {
    syncAudioPlayback,
    loadAudioFile,
    attachBeatDetector,
    disposeAudio,
    isAudioPlaying,
} from '../outfit/audio';
export { createCloth, buildClothUpdateFn, disposeCloth } from '../physics/xpbd-cloth';
export type { ClothInstance, ClothConfig } from '../physics/xpbd-cloth';
export { SdfCollider, DEFAULT_BODY_CAPSULES } from '../physics/xpbd-collider';
export { SaveThumbnail, SaveLastScene, LoadLastScene, SetEnvState } from '../core/wails-bindings';
export type { LightState, StageLightState } from './render/lighting';
export type { RenderState } from './render/renderer';
