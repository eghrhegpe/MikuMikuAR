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
} from './scene-env';
import {
    SaveThumbnail,
    SaveLastScene,
    LoadLastScene,
    SetEnvState,
} from '../../wailsjs/go/main/App';
import {
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
} from './camera';
import type { CameraState } from './camera';
import {
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
    isLoadingModel,
    setIsLoadingModel,
    isLoadingVmd,
    setIsLoadingVmd,
    setAutoLoop,
    seekDragging,
    setSeekDragging,
    ModelInstance,
    setModelRegistry,
    PropInstance,
    propRegistry,
    envState,
    EnvState,
    triggerAutoSave,
    setTriggerAutoSave,
    pendingVmd,
    setPendingVmd,
} from '../core/config';
import { resolveFileUrl, normPath } from '../core/fileservice';
import {
    syncAudioPlayback,
    attachBeatDetector,
    disposeAudio,
    isAudioPlaying,
} from '../outfit/audio';
import { loadOutfits, applyOutfitVariant, resetOutfit } from '../outfit/outfit';
import { _catState, _matState, _matEnabled } from './scene-material';
import { loadVMDMotion, loadVMDFromPath, loadCameraVmdFromPath, loadVPDPose } from './scene-vmd';
import { updatePlaybackUI, seekFromEvent, initPlaybackObservables } from './scene-playback';
import { tryAutoApplyPreset } from '../menus/model-preset';
import {
    initLighting,
    getLightState,
    setLightState,
    _updateSunDisc,
    rebuildShadowCasters,
    type LightState,
} from './scene-lighting';
import {
    initRenderer,
    getRenderState,
    setRenderState,
    reattachPipeline,
    rebuildOutlineState,
    pipeline,
    type RenderState,
} from './scene-renderer';
import { loadPMXFile as loadPMX, captureThumbnail, initLoader } from './scene-loader';
import {
    createCloth,
    buildClothUpdateFn,
    disposeCloth,
    type ClothInstance,
    type ClothConfig,
} from '../physics/xpbd-cloth';
import { SdfCollider, DEFAULT_BODY_CAPSULES } from '../physics/xpbd-collider';

// Re-export material system (extracted to scene-material.ts for file size)
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
} from './scene-material';
export type { MaterialCategoryParams, MaterialCategory } from './scene-material';

import { ModelManager } from './scene-model';
import {
    updateProcMotion,
    stopProcMotion,
    isProcVmdActive,
    createProcBeatDetector,
    getProcBeatDetector,
} from './scene-proc-motion';
import { updateLipSync } from './scene-lipsync';
import { triggerAutoSaveImpl } from './scene-serialize';

// ======== Babylon.js ========
export const engine = new Engine(dom.canvas, true, { preserveDrawingBuffer: true, stencil: true });
export const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

export let modelManager: ModelManager;

/** 播放观察者 dispose 函数，场景销毁时调用以清理 observable。 */
let _disposePlaybackObservables: (() => void) | null = null;

// Dev debug helper — exposes internals for Console inspection
(window as any).__envDebug = () => ({
    clearColor: `rgba(${scene.clearColor.r.toFixed(2)},${scene.clearColor.g.toFixed(2)},${scene.clearColor.b.toFixed(2)},${scene.clearColor.a})`,
    matType: _envSys.sky.skyMesh.material.getClassName() || 'none',
    skyMode: envState.skyMode,
});

// 相机系统不依赖 MMD runtime，模块顶层初始化（确保渲染循环启动时有 activeCamera）
initCameraSystem(scene, dom.canvas);

// scene-lighting.ts 提供 getLightState / setLightState
// scene-renderer.ts 提供 getRenderState / setRenderState / reattachPipeline

// ======== Convenience getters ========
export function focusedMmdModel() {
    return modelManager.focusedMmdModel() ?? null;
}
export function focusedModel() {
    return modelManager.focused() ?? null;
}

// ======== Init Scene ========
export async function initScene(): Promise<void> {
    // 1. MMD 运行时初始化
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
    const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
    const mmdWasmPhysics = new MmdWasmPhysics(scene);
    const runtime = new MmdWasmRuntime(wasmInstance, scene, mmdWasmPhysics);
    runtime.loggingEnabled = true;
    runtime.register(scene);
    setMmdRuntime(runtime);

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

    // 5. Loader（必须在 modelManager + setTriggerAutoSave 之后）
    initLoader(
        scene,
        runtime,
        modelManager,
        refreshWaterRenderList,
        tryAutoApplyPreset,
        (id: string) => loadOutfits(id).then(() => {}),
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

    setTriggerAutoSave(triggerAutoSaveImpl);
}

// ======== 快捷 getter ========
export function getScene(): Scene {
    return scene;
}

// Re-exports from extracted sub-modules (zero-change for consumers)
export { loadVMDMotion, loadVMDFromPath, loadCameraVmdFromPath, loadVPDPose } from './scene-vmd';
export { updatePlaybackUI, seekFromEvent, initPlaybackObservables } from './scene-playback';
export { triggerAutoSave } from '../core/config';
export * from './scene-proc-motion';
export * from './scene-lipsync';
export * from './scene-props';
export * from './scene-serialize';
export * from './scene-env-bridge';
export * from './scene-lighting';
export * from './scene-renderer';
export * from './scene-model-ops';
export { loadPMXFile, captureThumbnail, initLoader } from './scene-loader';
export type { LightState } from './scene-lighting';
export type { RenderState } from './scene-renderer';
