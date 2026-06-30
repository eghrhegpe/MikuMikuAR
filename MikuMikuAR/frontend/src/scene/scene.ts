// [doc:architecture] Scene — 3D 场景核心模块
// 规范文档: docs/architecture.md §渲染环节
// 职责: Babylon.js 初始化 + PMX/VMD 加载 + 播放控制 + 场景序列化

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Observer } from "@babylonjs/core/Misc/observable";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import "@babylonjs/core/Particles/webgl2ParticleSystem";

import { RegisterMmdModelLoaders } from "babylon-mmd/esm/Loader/dynamic";
import { RegisterDxBmpTextureLoader } from "babylon-mmd/esm/Loader/registerDxBmpTextureLoader";
import { GetMmdWasmInstance } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance";
import { MmdWasmInstanceTypeSPR } from "babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease";
import { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";
import { MmdWasmPhysics } from "babylon-mmd/esm/Runtime/Optimized/Physics/mmdWasmPhysics";
import type { MmdWasmModel } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmModel";
import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
import { MmdWasmAnimation } from "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation";
import "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation";
import { MmdStandardMaterialProxy } from "babylon-mmd/esm/Runtime/mmdStandardMaterialProxy";
import { MmdRuntimeShared } from "babylon-mmd/esm/Runtime/mmdRuntimeShared";
import "babylon-mmd/esm/Loader/mmdModelLoader.default";
import "@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader";
import "@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader";
import "@babylonjs/core/Materials/Textures/Loaders/exrTextureLoader";
import "babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex";
import "babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment";
import { initEnvFacade, applyEnvState, applySky, _envSys, refreshWaterRenderList, updateWaterAnimSpeed, addRipple } from "./scene-env";

import { SaveThumbnail, SaveLastScene, LoadLastScene, SetEnvState } from "../../wailsjs/go/main/App";
import { initCameraSystem, autoFrame, getCameraState, setCameraState, animateCameraVmd, loadCameraVmd, clearCameraVmd, hasCameraVmd, getCameraVmdName, getCameraVmdPath, switchCameraMode, getCameraMode } from "./camera";
import type { CameraState } from "./camera";
import {
    dom, setStatus, formatTime, toBase64,
    setMmdRuntime, mmdRuntime, modelRegistry, focusedModelId, setFocusedModelId,
    isPlaying, setIsPlaying, autoLoop, setAutoLoop,
    isLoadingModel, setIsLoadingModel, isLoadingVmd, setIsLoadingVmd, isLoadingProp, setIsLoadingProp,
    pendingVmd, setPendingVmd,
    seekDragging, setSeekDragging,
    ModelInstance, setModelRegistry, escapeHtml,
    PropInstance, propRegistry, setPropRegistry,
    computeLibraryRef, resolveLibraryRef,
    envState, EnvState,
    OutfitFile, OutfitVariant, OutfitSlot,
    triggerAutoSave, setTriggerAutoSave,
} from "../core/config";
import { resolveFileUrl, normPath } from "../core/fileservice";
import { loadVPDFromBuffer } from "../motion/vpd-parser";
import { deriveLighting, ENV_PRESETS } from "./env-lighting";
import { syncAudioPlayback, loadAudioFile, setVolume, setAudioOffset, getAudioPath, getAudioName, getVolume, getAudioOffset, isAudioPlaying, resumeAudio, pauseAudio } from "../outfit/audio";
import {
    ProcMotionState, ProcMotionMode, DEFAULT_PROC_STATE,
    generateIdleVmd, generateAutoDanceVmd, shouldAutoDance, shouldIdle,
} from "../motion/procedural-motion";
import { LipSyncState as LipSyncStateType, DEFAULT_LIPSYNC_STATE, findLipMorph, amplitudeToWeight } from "../motion/lipsync";
import { BeatDetector } from "../motion/beat-detector";
import { attachBeatDetector, disposeAudio } from "../outfit/audio";
import { loadOutfits, applyOutfitVariant, resetOutfit } from "../outfit/outfit";
import { _catState, _matState, _matEnabled } from "./scene-material";
import { loadVMDMotion, loadVMDFromPath, loadCameraVmdFromPath, loadVPDPose } from "./scene-vmd";
import { updatePlaybackUI, seekFromEvent } from "./scene-playback";
import { tryAutoApplyPreset } from "../menus/model-preset";

// XPBD 布料模拟
import { createCloth, buildClothUpdateFn, disposeCloth, type ClothInstance, type ClothConfig } from "../physics/xpbd-cloth";
import { SdfCollider, DEFAULT_BODY_CAPSULES } from "../physics/xpbd-collider";

// Re-export material system (extracted to scene-material.ts for file size)
export { _catState, _matState, _matEnabled, _catOf, _applyAll, isMatEnabled, setMatEnabled, getMatCatGroups, getMatCatParams, setMatCatParams, resetMatCatParams, getMatDetailList, getMatParams, setMatParams, resetSingleMatParams, resetAllMatParams, getMatState, applyMatState } from "./scene-material";
export type { MaterialCategoryParams, MaterialCategory } from "./scene-material";

import { ModelManager } from "./scene-model";

// ======== Babylon.js ========
export const engine = new Engine(dom.canvas, true, { preserveDrawingBuffer: true, stencil: true });
export const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

export let modelManager: ModelManager;

// Dev debug helper — exposes internals for Console inspection
(window as any).__envDebug = () => ({
    clearColor: `rgba(${scene.clearColor.r.toFixed(2)},${scene.clearColor.g.toFixed(2)},${scene.clearColor.b.toFixed(2)},${scene.clearColor.a})`,
    matType: _envSys?.sky?.skyMesh?.material?.getClassName() || "none",
    skyMode: envState.skyMode,
});

// ======== Light State Management ========
export interface LightState {
    hemiIntensity: number;
    dirIntensity: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    dirColor: [number, number, number];
    hemiColor: [number, number, number];
    groundColor: [number, number, number];
    shadowEnabled: boolean;
    shadowType: "hard" | "soft" | "pcf";
    shadowCascades: number;
}

export const hemiLight = new HemisphericLight("hemi", new Vector3(0.5, 1, 0.5), scene);
hemiLight.intensity = 0.8;
hemiLight.diffuse = new Color3(1, 1, 1);
hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

export const dirLight = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.5), scene);
dirLight.intensity = 0.4;
dirLight.position = new Vector3(20, 40, 20);

let _shadowEnabled = false;
let _shadowType: LightState["shadowType"] = "soft";
let _shadowCascades = 2;

export function getLightState(): LightState {
    return {
        hemiIntensity: hemiLight.intensity,
        dirIntensity: dirLight.intensity,
        dirX: dirLight.direction.x,
        dirY: dirLight.direction.y,
        dirZ: dirLight.direction.z,
        dirColor: [dirLight.diffuse.r, dirLight.diffuse.g, dirLight.diffuse.b],
        hemiColor: [hemiLight.diffuse.r, hemiLight.diffuse.g, hemiLight.diffuse.b],
        groundColor: [hemiLight.groundColor.r, hemiLight.groundColor.g, hemiLight.groundColor.b],
        shadowEnabled: _envSys.shadow.generator !== null,
        shadowType: _shadowType,
        shadowCascades: _shadowCascades,
    };
}

export function setLightState(s: Partial<LightState>): void {
    if (s.hemiIntensity !== undefined) hemiLight.intensity = s.hemiIntensity;
    if (s.dirIntensity !== undefined) dirLight.intensity = s.dirIntensity;
    if (s.dirX !== undefined || s.dirY !== undefined || s.dirZ !== undefined) {
        dirLight.direction = new Vector3(
            s.dirX ?? dirLight.direction.x,
            s.dirY ?? dirLight.direction.y,
            s.dirZ ?? dirLight.direction.z,
        );
    }
    if (s.dirColor !== undefined) {
        dirLight.diffuse = new Color3(s.dirColor[0], s.dirColor[1], s.dirColor[2]);
    }
    if (s.hemiColor !== undefined) {
        hemiLight.diffuse = new Color3(s.hemiColor[0], s.hemiColor[1], s.hemiColor[2]);
    }
    if (s.groundColor !== undefined) {
        hemiLight.groundColor = new Color3(s.groundColor[0], s.groundColor[1], s.groundColor[2]);
    }
    if (s.shadowEnabled !== undefined) _shadowEnabled = s.shadowEnabled;
    if (s.shadowType !== undefined) _shadowType = s.shadowType;
    if (s.shadowCascades !== undefined) _shadowCascades = s.shadowCascades;
    if (s.shadowEnabled !== undefined || s.shadowType !== undefined) {
        _ensureShadow();
    }
    _updateSunDisc();
    triggerAutoSave();
}

// ======== Sun Disc (Visual Directional Light Indicator) ========

let _sunDisc: Mesh | null = null;
const SUN_DISC_DISTANCE = 400;

function _ensureSunDisc(): Mesh {
    if (_sunDisc) return _sunDisc;
    _sunDisc = MeshBuilder.CreateSphere("sunDisc", { diameter: 20, segments: 8 }, scene);
    const mat = new StandardMaterial("sunDiscMat", scene);
    mat.emissiveColor = new Color3(1, 0.9, 0.7);
    mat.disableLighting = true;
    _sunDisc.material = mat;
    _sunDisc.isPickable = false;
    return _sunDisc;
}

function _updateSunDisc(): void {
    const disc = _ensureSunDisc();
    const d = dirLight.direction;
    if (d.y <= 0) { disc.setEnabled(false); return; }
    disc.setEnabled(true);
    disc.position = new Vector3(d.x * SUN_DISC_DISTANCE, d.y * SUN_DISC_DISTANCE, d.z * SUN_DISC_DISTANCE);
    const b = Math.max(0.05, dirLight.intensity);
    const mat = disc.material as StandardMaterial;
    mat.emissiveColor = new Color3(b, b * 0.9, b * 0.7);
}

function _disposeSunDisc(): void {
    if (_sunDisc) { _sunDisc.dispose(); _sunDisc = null; }
}

function _ensureShadow(): void {
    if (_envSys.shadow.generator) {
        _envSys.shadow.generator.dispose();
        _envSys.shadow.generator = null;
    }
    if (!_shadowEnabled) return;

    const gen = new ShadowGenerator(1024, dirLight);
    gen.useBlurExponentialShadowMap = _shadowType !== "hard";
    gen.useKernelBlur = _shadowType === "pcf";
    gen.bias = 0.0001;

    for (const [, inst] of modelRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }
    for (const [, inst] of propRegistry) {
        for (const m of inst.meshes) {
            if (m instanceof Mesh) {
                gen.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }
    }

    _envSys.shadow.generator = gen;
}

// Initialise camera system immediately (before render loop)
initCameraSystem(scene, dom.canvas);

// ======== Rendering Pipeline (Default) ========
export const pipeline = new DefaultRenderingPipeline("default", true, scene, [scene.activeCamera!]);
pipeline.samples = 1;            // MSAA off (performance)
pipeline.fxaaEnabled = false;
pipeline.bloomEnabled = false;
pipeline.imageProcessingEnabled = true;

// ======== Render State Management (Post-Processing + Stage) ========

/** Tone-mapping mode values used by Babylon's ImageProcessingConfiguration. */
export const ToneMappingMode = {
    OFF: 0,
    ACES: 1,
    REINHARD: 2,
    CINEON: 3,
    NEUTRAL: 4,
} as const;

export interface RenderState {
    // Post-processing
    bloomEnabled: boolean;
    bloomWeight: number;      // 0-1, default 0.3
    bloomThreshold: number;   // 0-1, default 0.5
    bloomKernel: number;      // 0-512, default 64
    outlineEnabled: boolean;
    outlineColor: [number, number, number];  // RGB 0-1
    fxaaEnabled: boolean;
    // Stage / imageProcessing
    toneMapping: number;      // 0=OFF 1=ACES 2=Reinhard 3=Cineon 4=Neutral
    exposure: number;         // 0-4, default 1
    contrast: number;         // 0-4, default 1
    fov: number;              // 0.1-3 rad, default 0.8
    bgColor: [number, number, number];  // 0-1
    // Phase 8 — DOF + Vignette
    dofEnabled: boolean;
    dofAperture: number;
    vignetteEnabled: boolean;
    vignetteDarkness: number;
}

// Module-level outline state (edges are set on meshes, not pipeline; tracked here for getRenderState)
let _outlineEnabled = false;
let _outlineColor: [number, number, number] = [0, 0, 0];



export function getRenderState(): RenderState {
    const cam = scene.activeCamera;
    return {
        bloomEnabled: pipeline.bloomEnabled,
        bloomWeight: pipeline.bloomWeight ?? 0.3,
        bloomThreshold: pipeline.bloomThreshold ?? 0.5,
        bloomKernel: pipeline.bloomKernel ?? 64,
        outlineEnabled: _outlineEnabled,
        outlineColor: _outlineColor,
        fxaaEnabled: pipeline.fxaaEnabled,
        toneMapping: pipeline.imageProcessing?.toneMappingType ?? 0,
        exposure: pipeline.imageProcessing?.exposure ?? 1,
        contrast: pipeline.imageProcessing?.contrast ?? 1,
        fov: cam ? (cam as any).fov ?? 0.8 : 0.8,
        bgColor: [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b],
        dofEnabled: pipeline.depthOfFieldEnabled,
        dofAperture: pipeline.depthOfField?.fStop ?? 0.5,
        vignetteEnabled: pipeline.imageProcessing?.vignetteEnabled ?? false,
        vignetteDarkness: pipeline.imageProcessing?.vignetteWeight ?? 0.5,
    };
}

export function setRenderState(s: Partial<RenderState>): void {
    // Post-processing
    if (s.bloomEnabled !== undefined) pipeline.bloomEnabled = s.bloomEnabled;
    if (s.bloomWeight !== undefined) pipeline.bloomWeight = s.bloomWeight;
    if (s.bloomThreshold !== undefined) pipeline.bloomThreshold = s.bloomThreshold;
    if (s.bloomKernel !== undefined) pipeline.bloomKernel = s.bloomKernel;
    if (s.fxaaEnabled !== undefined) pipeline.fxaaEnabled = s.fxaaEnabled;

    // Outline — toggle edges rendering on all loaded meshes
    if (s.outlineEnabled !== undefined) {
        _outlineEnabled = s.outlineEnabled;
        for (const inst of modelRegistry.values()) {
            for (const m of inst.meshes) {
                if (s.outlineEnabled) {
                    m.enableEdgesRendering();
                } else {
                    m.disableEdgesRendering();
                }
            }
        }
    }
    // Apply outline color (separate from toggle so color can change independently)
    if (s.outlineColor !== undefined) {
        _outlineColor = s.outlineColor;
        for (const inst of modelRegistry.values()) {
            for (const m of inst.meshes) {
                if (m.edgesRenderer) {
                    m.edgesColor = new Color4(s.outlineColor[0], s.outlineColor[1], s.outlineColor[2], 1);
                }
            }
        }
    }

    // DOF — via pipeline.depthOfField
    if (s.dofEnabled !== undefined) {
        pipeline.depthOfFieldEnabled = s.dofEnabled;
    }
    if (s.dofAperture !== undefined && pipeline.depthOfField) {
        pipeline.depthOfField.fStop = s.dofAperture;
    }

    // Vignette — via pipeline.imageProcessing
    if (s.vignetteEnabled !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteEnabled = s.vignetteEnabled;
    }
    if (s.vignetteDarkness !== undefined && pipeline.imageProcessing) {
        pipeline.imageProcessing.vignetteWeight = s.vignetteDarkness;
    }

    // Stage / imageProcessing
    if (pipeline.imageProcessing) {
        if (s.toneMapping !== undefined) pipeline.imageProcessing.toneMappingType = s.toneMapping;
        if (s.exposure !== undefined) pipeline.imageProcessing.exposure = s.exposure;
        if (s.contrast !== undefined) pipeline.imageProcessing.contrast = s.contrast;
    }
    if (s.fov !== undefined && scene.activeCamera) {
        (scene.activeCamera as any).fov = s.fov;
    }
    if (s.bgColor !== undefined) {
        scene.clearColor = new Color4(s.bgColor[0], s.bgColor[1], s.bgColor[2], 1.0);
    }

    triggerAutoSave();
}

/** Re-attach the rendering pipeline to the current active camera (call after camera switch). */
export function reattachPipeline(): void {
    if (scene.activeCamera) {
        // Remove previously attached camera if still in pipeline
        if (_pipelineCamera && _pipelineCamera !== scene.activeCamera) {
            try { pipeline.removeCamera(_pipelineCamera); } catch (_) {}
        }
        pipeline.addCamera(scene.activeCamera);
        _pipelineCamera = scene.activeCamera;
    }
}

// Track last camera added to pipeline for cleanup on reattach
let _pipelineCamera: import("@babylonjs/core/Cameras/camera").Camera | null = null;

// ======== Procedural Motion State ========
let procState: ProcMotionState = { ...DEFAULT_PROC_STATE };
let procBeatDetector: BeatDetector | null = null;
/** @internal Exported for use by scene-vmd.ts */
export let procVmdActive = false;       // procedural VMD 是否正在播放
let lastBeatBpm = 120;           // 上次用于生成 Auto Dance 的 BPM
let procStarting = false;        // 防止并发 startProcMotion
let procActiveKind: ProcMotionMode = "idle"; // 当前加载的是 idle 还是 autodance
let procModelId: string | null = null;       // 持有 procedural VMD 的模型 ID，用于精准清理

// ======== LipSync State ========
let lipSyncState: LipSyncStateType = { ...DEFAULT_LIPSYNC_STATE };
let lipSyncMorphName: string | null = null;  // 缓存焦点模型的口型 morph 名

/** 人声频段 bin 范围（@ fftSize=256, 44100Hz：每 bin ~172Hz）。
 *  10..50 ≈ 430Hz..2.2kHz，覆盖人声基频与谐波。 */
const VOICE_BIN_START = 10;
const VOICE_BIN_END = 50;

export function setLipSyncEnabled(on: boolean): void {
    lipSyncState.enabled = on;
    if (!on) resetLipMorph();
    triggerAutoSave();
}

export function setLipSyncSensitivity(v: number): void {
    lipSyncState.sensitivity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function setLipSyncIntensity(v: number): void {
    lipSyncState.intensity = Math.max(0, Math.min(1, v));
    triggerAutoSave();
}

export function getLipSyncState(): LipSyncStateType {
    return { ...lipSyncState };
}

/** 重置焦点模型的口型 morph 为 0（关闭 Lipsync 或静音时调用）。 */
function resetLipMorph(): void {
    if (lipSyncMorphName && focusedModelId) {
        setModelMorphWeight(focusedModelId, lipSyncMorphName, 0);
    }
}

/** 每帧更新 LipSync。由 runtime.onAnimationTickObservable 调用。
 *  - 关闭 → 直接返回
 *  - 无音频播放 → 重置 morph 为 0
 *  - 焦点模型无口型 morph → 跳过
 *  - 正常 → 读 BeatDetector 人声频段能量 → amplitudeToWeight → setModelMorphWeight */
function updateLipSync(): void {
    if (!lipSyncState.enabled) return;
    if (!isAudioPlaying()) { resetLipMorph(); return; }
    const modelId = focusedModelId;
    if (!modelId) { lipSyncMorphName = null; return; }
    const inst = modelRegistry.get(modelId);
    if (!inst?.mmdModel?.morph) { lipSyncMorphName = null; return; }

    // 焦点切换或模型加载后重新检测 morph 名
    const morphs = inst.mmdModel.morph.morphs;
    if (!lipSyncMorphName || !morphs.some(m => m.name === lipSyncMorphName)) {
        lipSyncMorphName = findLipMorph(morphs.map(m => m.name));
    }
    if (!lipSyncMorphName) return;

    const level = procBeatDetector ? procBeatDetector.getLevel(VOICE_BIN_START, VOICE_BIN_END) : 0;
    const weight = amplitudeToWeight(level, lipSyncState.sensitivity, lipSyncState.intensity);
    setModelMorphWeight(modelId, lipSyncMorphName, weight);
}

// ======== Convenience getters ========
export function focusedMmdModel() { return modelManager?.focusedMmdModel() ?? null; }
export function focusedModel() { return modelManager?.focused() ?? null; }
/** 启动程序化动作：生成 procedural VMD 并加载。
 *  @param targetMode 要加载的模式（覆盖 procState.mode）
 *  @param bpm Auto Dance 用的 BPM */
async function startProcMotion(targetMode: ProcMotionMode, bpm?: number): Promise<void> {
    if (procStarting) return;
    procStarting = true;
    const model = focusedMmdModel();
    if (!model) { procStarting = false; return; }
    const morphNames = model.morph?.morphs?.map(m => m.name) ?? [];
    let buf: ArrayBuffer;
    if (targetMode === "autodance" && bpm) {
        buf = generateAutoDanceVmd(procState, bpm, morphNames);
        lastBeatBpm = bpm;
    } else {
        buf = generateIdleVmd(procState, morphNames);
    }
    procActiveKind = targetMode;
    procVmdActive = true;
    procModelId = focusedModelId;
    try {
        await loadVMDMotion(buf, targetMode === "autodance" ? "AutoDance" : "IdleMotion");
        // Clear vmdData/vmdName so hasUserVmd stays false, and action popup doesn't show stale name
        const inst = focusedModel();
        if (inst) {
            inst.vmdData = null;
            inst.vmdName = "";
        }
    } catch {
        procVmdActive = false;
        // loadVMDMotion may have set inst.vmdData/vmdName before failing — clear them
        const inst = focusedModel();
        if (inst) {
            inst.vmdData = null;
            inst.vmdName = "";
        }
    } finally {
        procStarting = false;
    }
}

/** @internal Exported for use by scene-vmd.ts */
export function stopProcMotion(): void {
    procVmdActive = false;
    if (procModelId) {
        const inst = modelRegistry.get(procModelId);
        if (inst && inst.mmdModel && mmdRuntime) {
            inst.mmdModel.setRuntimeAnimation(null);
        }
        procModelId = null;
    }
}

/** 每帧检查是否需要切换/重新生成 procedural VMD。 */
async function updateProcMotion(): Promise<void> {
    if (procState.mode === "off" && !procState.autoSwitch) {
        if (procVmdActive) stopProcMotion();
        return;
    }

    const audioOn = isAudioPlaying();
    const hasUserVmd = focusedModel()?.vmdData != null;
    const mode = procState.mode;
    const autoOk = mode !== "off" || procState.autoSwitch;
    const wantAutoDance = shouldAutoDance(audioOn, mode) && autoOk;
    const wantIdle = shouldIdle(audioOn, hasUserVmd, mode) && autoOk;

    // 用户加载了真实 VMD → 停止 procedural
    if (hasUserVmd && procVmdActive) {
        stopProcMotion();
        return;
    }

    // 需要 Auto Dance — 但不能覆盖用户已加载的 VMD
    if (wantAutoDance && !hasUserVmd && procBeatDetector) {
        const bpm = procBeatDetector.getBPM();
        if (!procVmdActive || procActiveKind !== "autodance" || Math.abs(bpm - lastBeatBpm) > 10) {
            await startProcMotion("autodance", bpm);
        }
        return;
    }

    // 需要 Idle — 当 autodance 正在播放但不再有音频时也会进入此分支
    if (wantIdle && !hasUserVmd) {
        if (!procVmdActive || procActiveKind !== "idle") {
            await startProcMotion("idle");
        }
        return;
    }
}

// ======== Init Scene ========
export async function initScene(): Promise<void> {
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
    const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
    const mmdWasmPhysics = new MmdWasmPhysics(scene);
    const runtime = new MmdWasmRuntime(wasmInstance, scene, mmdWasmPhysics);
    runtime.loggingEnabled = true;
    runtime.register(scene);
    setMmdRuntime(runtime);

    // Wire up playback UI observables
    runtime.onAnimationTickObservable.add(() => {
        // 每帧统一刷新节拍检测器（供 LipSync + Auto Dance 共享）
        if (isAudioPlaying() && procBeatDetector) procBeatDetector.update();
        updatePlaybackUI();
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, isPlaying, dur);
        animateCameraVmd(runtime.currentTime * 30);
        updateProcMotion();
        updateLipSync();
    });
    runtime.onPlayAnimationObservable.add(() => {
        setIsPlaying(true);
        updatePlaybackUI();
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, true, dur);
    });
    runtime.onPauseAnimationObservable.add(() => {
        // NOTE: babylon-mmd fires onPause when animation reaches the end (no
        // separate onFinish event), so the auto-loop logic lives here.
        setIsPlaying(false);
        if (seekDragging) { updatePlaybackUI(); return; }
        // Auto-loop: use the focused model's animation duration
        const focModel = focusedModel();
        if (autoLoop && focModel && runtime && focModel.animationDuration > 0
            && runtime.currentTime >= focModel.animationDuration - 0.1) {
            runtime.seekAnimation(0, true).then(() => {
                if (!autoLoop || !mmdRuntime) return;
                mmdRuntime.playAnimation().then(() => {
                    setIsPlaying(true);
                    updatePlaybackUI();
                });
            });
        }
        updatePlaybackUI();
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, false, dur);
    });

    // Initialize beat detector for Auto Dance
    procBeatDetector = new BeatDetector();
    attachBeatDetector(procBeatDetector);

    // Initialize ModelManager — wraps modelRegistry + per-model state
    modelManager = new ModelManager(scene, triggerAutoSave, autoFrame);
    modelManager.onRemoveModel = (id) => {
        const inst = modelRegistry.get(id);
        if (inst?.mmdModel && mmdRuntime) {
            try { mmdRuntime.destroyMmdModel(inst.mmdModel); } catch (e) { console.warn("removeModel: destroyMmdModel failed", e); }
        }
    };
    // Sync config's modelRegistry to ModelManager's internal registry
    setModelRegistry(modelManager.modelRegistry);

    // Initialize environment system (Phase 8 Facade)
    initEnvFacade(scene, pipeline);
    applyEnvState(envState);
    _updateSunDisc();

    // Click on water surface → generate ripple
    scene.onPointerObservable.add((info) => {
        if (info.type !== PointerEventTypes.POINTERDOWN) return;
        if (!envState.waterEnabled) return;
        // Skip if user clicked on a pickable mesh (model, ground, etc.)
        if (info.pickInfo?.hit) return;
        const ray = info.pickInfo?.ray;
        if (!ray || ray.direction.y >= 0) return;
        const waterY = envState.waterLevel;
        const camY = scene.activeCamera?.globalPosition.y;
        if (camY === undefined || camY <= waterY) return;
        const t = (waterY - ray.origin.y) / ray.direction.y;
        if (t <= 0) return;
        const hit = ray.origin.add(ray.direction.scale(t));
        // Bounds check against water size
        const half = envState.waterSize / 2;
        if (Math.abs(hit.x) > half || Math.abs(hit.z) > half) return;
        addRipple(hit, 3, 0.4, 1.5, 2);
    }, PointerEventTypes.POINTERDOWN);

    setTriggerAutoSave(triggerAutoSaveImpl);
}

// ======== Thumbnail Capture (Direction 3) ========

/** Captures a screenshot after model load for thumbnail cache. */
async function captureThumbnail(filePath: string): Promise<void> {
    try {
        // Wait two frames for the scene to fully render
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => requestAnimationFrame(r));

        const base64 = dom.canvas.toDataURL("image/png", 0.8);
        const raw = base64.replace(/^data:image\/png;base64,/, "");
        await SaveThumbnail(filePath, raw);
    } catch (err) {
        console.warn("captureThumbnail:", err);
    }
}

// ======== PMX Loading ========

export async function loadPMXFile(filePath: string, asStage?: boolean, skipAutoApply?: boolean): Promise<void> {
    if (isLoadingModel) return;
    setIsLoadingModel(true);
    try {
        // Check if already loaded — switch focus
        for (const [id, inst] of modelRegistry) {
            if (inst.filePath === filePath) {
                setFocusedModelId(id);
                focusModel(id);
                setStatus(`✓ 已切换至: ${inst.name}`, true);
                return;
            }
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split("/").pop() || "";

        setStatus("加载中...", false);
        dom.loadingEl.style.display = "block";
        dom.loadingText.textContent = "加载中 0%";

        const result = await ImportMeshAsync(url, scene, {
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = `加载中 ${pct}%`;
                }
            },
        });

        dom.loadingEl.style.display = "none";

        const meshes = result.meshes.filter(m => m instanceof Mesh) as Mesh[];
        if (meshes.length === 0) {
            setStatus("✗ 未加载到网格", false);
            return;
        }

        const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const displayName = fileName.replace(/\.pmx$/i, "");

        if (asStage) {
            // Stage: pure static mesh, no MMD runtime, no physics
            const inst: ModelInstance = {
                id, name: displayName, filePath, port, modelDir,
                meshes, rootMesh: meshes[0], vmdData: null, vmdName: "", vmdPath: null,
                animationDuration: 0, kind: "stage",
                visible: true, opacity: 1.0, wireframe: false, showBoneLines: false, showBoneJoints: false, physicsEnabled: false,
                scaling: 1.0, rotationY: 0,
            };
            modelRegistry.set(id, inst);
            modelManager.register(inst);
            setFocusedModelId(id);
            modelManager.focus(id);
            setStatus(`✓ ${displayName} (场景)`, true);
            modelManager.arrange();
            refreshWaterRenderList();
            return;
        }

        // Actor: create MMD model from the loaded mesh via the runtime
        if (!mmdRuntime) {
            setStatus("✗ MMD 运行时未初始化", false);
            return;
        }
        const rootMesh = meshes[0];
        const wasmModel = mmdRuntime.createMmdModel(rootMesh, {
            materialProxyConstructor: MmdStandardMaterialProxy,
        });

        const inst: ModelInstance = {
            id, name: displayName, filePath, port, modelDir,
            meshes, rootMesh, mmdModel: wasmModel, vmdData: null, vmdName: "", vmdPath: null,
            animationDuration: 0, kind: "actor",
            visible: true, opacity: 1.0, wireframe: false, showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1.0, rotationY: 0,
        };
        modelRegistry.set(id, inst);
        modelManager.register(inst);
        if (wasmModel) {
            const states = wasmModel.rigidBodyStates;
            if (states) modelManager.storeRigidBodyState(id, states);
        }
        setFocusedModelId(id);

        // Apply pending VMD if any
        let appliedVmd = "";
        if (pendingVmd && mmdRuntime) {
            const vmdData = pendingVmd.data;
            appliedVmd = pendingVmd.name;
            setPendingVmd(null);
            await loadVMDMotion(vmdData, appliedVmd, id);
        }

        modelManager.focus(id);
        setStatus(appliedVmd ? `✓ ${displayName} + ${appliedVmd}` : `✓ ${displayName}`, true);
        modelManager.arrange();
        refreshWaterRenderList();
        // Auto-capture thumbnail for future popup display
        captureThumbnail(filePath).catch(() => {});
        if (!skipAutoApply) {
            tryAutoApplyPreset(id).catch((err: any) => console.warn("auto-apply preset:", err));
        }
        // Pre-load outfit file for UI entry availability
        loadOutfits(id).catch(() => {});
    } catch (err) {
        dom.loadingEl.style.display = "none";
        console.error("loadPMXFile:", err);
        setStatus("✗ 模型加载失败", false);
    } finally {
        setIsLoadingModel(false);
        dom.loadingEl.style.display = "none";
    }
}

// ======== Prop Loading (independent of modelRegistry / VMD / physics) ========

export async function loadProp(filePath: string): Promise<string | null> {
    if (isLoadingProp) return null;
    setIsLoadingProp(true);
    dom.loadingEl.style.display = "block";
    dom.loadingText.textContent = "加载道具 0%";
    try {
        for (const [, inst] of propRegistry) {
            if (inst.filePath === filePath) {
                setStatus(`道具已存在: ${inst.name}`, false);
                return inst.id;
            }
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split("/").pop() || "";
        setStatus("加载道具...", false);

        const result = await ImportMeshAsync(url, scene, {
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = `加载道具 ${pct}%`;
                }
            },
        });

        const meshes = result.meshes.filter(m => m instanceof Mesh) as Mesh[];
        if (meshes.length === 0) {
            setStatus("✗ 道具未加载到网格", false);
            return null;
        }

        const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const displayName = fileName.replace(/\.pmx$/i, "");
        const inst: PropInstance = {
            id, name: displayName, filePath, port, modelDir,
            meshes, rootMesh: meshes[0],
            position: [0, 0, 0], rotationY: 0, scaling: 1.0, visible: true,
        };
        propRegistry.set(id, inst);

        // Add to shadow generator if shadows are enabled
        if (_envSys.shadow.generator) {
            for (const m of inst.meshes) {
                _envSys.shadow.generator.addShadowCaster(m);
                m.receiveShadows = true;
            }
        }

        setStatus(`✓ 道具: ${displayName}`, true);
        triggerAutoSave();
        return id;
    } catch (err) {
        console.error("loadProp:", err);
        setStatus("✗ 道具加载失败", false);
        return null;
    } finally {
        setIsLoadingProp(false);
        dom.loadingEl.style.display = "none";
    }
}

export function removeProp(id: string): void {
    const inst = propRegistry.get(id);
    if (!inst) return;
    for (const m of inst.meshes) {
        scene.removeMesh(m);  // detach from scene first to avoid parent-dispose warnings
        m.dispose();
    }
    propRegistry.delete(id);
    setStatus(`✓ 已移除道具: ${inst.name}`, true);
    triggerAutoSave();
}

export function setPropTransform(id: string, partial: Partial<Pick<PropInstance, "position" | "rotationY" | "scaling" | "visible">>): void {
    const inst = propRegistry.get(id);
    if (!inst) return;
    if (partial.position !== undefined) {
        inst.position = partial.position;
        inst.rootMesh.position.set(partial.position[0], partial.position[1], partial.position[2]);
    }
    if (partial.rotationY !== undefined) {
        inst.rotationY = partial.rotationY;
        inst.rootMesh.rotation.y = partial.rotationY;
    }
    if (partial.scaling !== undefined) {
        inst.scaling = partial.scaling;
        inst.rootMesh.scaling.setAll(partial.scaling);
    }
    if (partial.visible !== undefined) {
        inst.visible = partial.visible;
        for (const m of inst.meshes) m.setEnabled(partial.visible);
    }
    triggerAutoSave();
}

export function getPropList(): PropInstance[] {
    return Array.from(propRegistry.values());
}

// ======== Model Lifecycle ========
export function removeModel(id: string): void {
    // Scene-specific cleanup before modelManager removes the model
    if (procModelId === id) {
        procVmdActive = false;
        procModelId = null;
    }
    if (focusedModelId === id) {
        lipSyncMorphName = null;
    }
    // Clean material state maps (owned by scene-material.ts)
    _catState.delete(id);
    _matState.delete(id);
    _matEnabled.delete(id);

    // Delegate registry management + focus + bone overlay + mesh disposal to ModelManager
    modelManager.remove(id);
    refreshWaterRenderList();

    // Concert mode has no model to track after removal — fall back to orbit
    if (focusedModelId === null && getCameraMode() === "concert") {
        switchCameraMode("orbit");
    }
    if (modelRegistry.size === 0) {
        setIsPlaying(false);
        setIsLoadingModel(false);
        setIsLoadingVmd(false);
        setAutoLoop(true);
        setSeekDragging(false);
        dom.playbackBar.style.display = "none";
        disposeAudio();
    }
}

export function removeFocusedModel(): void {
    if (!focusedModelId) return;
    removeModel(focusedModelId);
    setPendingVmd(null);
}

export function focusModel(id: string): void {
    modelManager.focus(id);
    updatePlaybackUI();
}

export function arrangeModels(): void {
    modelManager.arrange();
}

// ======== Scene Serialization ========

export interface SceneFile {
    version: 1;
    models: Array<{
        filePath: string;
        libraryRef?: string;   // portable library identifier (main: "rel/path", ext: "Source:rel/path")
        name: string;
        kind: "actor" | "stage";
        vmdPath: string | null;
        vmdLibraryRef?: string; // portable library identifier for VMD
        vmdName: string;
        // Transform fields
        positionX: number;
        positionY?: number;
        positionZ?: number;
        scaling?: number;
        rotationY?: number;
        // Visibility fields
        visible?: boolean;
        opacity?: number;
        wireframe?: boolean;
        showBoneLines?: boolean;
        showBoneJoints?: boolean;
        physicsEnabled?: boolean;
        outfitVariant?: string;
    }>;
    camera: CameraState;
    lights: LightState;
    render?: RenderState;  // optional — legacy scenes without this field are fine
    env?: EnvState;        // optional — legacy scenes without this field are fine
    cameraVmd?: {
        path: string;
        libraryRef?: string;
        name: string;
        active: boolean;  // whether camera is in vmd mode
    };
    audio?: {
        path: string;
        libraryRef?: string;
        name: string;
        volume: number;
        offset: number;
        playing: boolean;
    };
    /** Procedural motion state (Idle/Auto Dance). */
    procMotion?: ProcMotionState;
    /** LipSync state (real-time amplitude-driven). */
    lipSync?: LipSyncStateType;
    /** Scene props (independent of modelRegistry). */
    props?: Array<{
        filePath: string;
        libraryRef?: string;
        name: string;
        positionX: number;
        positionY: number;
        positionZ: number;
        rotationY: number;
        scaling: number;
        visible: boolean;
    }>;
    gravityStrength?: number;  // physics gravity multiplier, 0-2, default 1.0
}

export function serializeScene(): SceneFile {
    const models = Array.from(modelRegistry.values()).map(inst => ({
        filePath: inst.filePath,
        libraryRef: computeLibraryRef(inst.filePath) || undefined,
        name: inst.name,
        kind: inst.kind,
        vmdPath: inst.vmdPath,
        vmdLibraryRef: inst.vmdPath ? (computeLibraryRef(inst.vmdPath) || undefined) : undefined,
        vmdName: inst.vmdName,
        positionX: inst.meshes[0]?.position.x ?? 0,
        positionY: inst.meshes[0]?.position.y ?? 0,
        positionZ: inst.meshes[0]?.position.z ?? 0,
        scaling: inst.scaling,
        rotationY: inst.rotationY,
        visible: inst.visible,
        opacity: inst.opacity,
        wireframe: inst.wireframe,
        showBoneLines: inst.showBoneLines,
        showBoneJoints: inst.showBoneJoints,
        physicsEnabled: inst.physicsEnabled,
        outfitVariant: inst.activeVariant,
    }));
    return {
        version: 1,
        models,
        camera: getCameraState(),
        lights: getLightState(),
        render: getRenderState(),
        env: envState,
        cameraVmd: hasCameraVmd() ? {
            path: getCameraVmdPath(),
            libraryRef: getCameraVmdPath() ? (computeLibraryRef(getCameraVmdPath()) || undefined) : undefined,
            name: getCameraVmdName(),
            active: getCameraMode() === "vmd",
        } : undefined,
        audio: getAudioName() ? {
            path: getAudioPath(),
            libraryRef: getAudioPath() ? (computeLibraryRef(getAudioPath()) || undefined) : undefined,
            name: getAudioName(),
            volume: getVolume(),
            offset: getAudioOffset(),
            playing: isAudioPlaying(),
        } : undefined,
        procMotion: { ...procState },
        lipSync: { ...lipSyncState },
        props: Array.from(propRegistry.values()).map(p => ({
            filePath: p.filePath,
            libraryRef: computeLibraryRef(p.filePath) || undefined,
            name: p.name,
            positionX: p.position[0],
            positionY: p.position[1],
            positionZ: p.position[2],
            rotationY: p.rotationY,
            scaling: p.scaling,
            visible: p.visible,
        })),
        gravityStrength: _gravityStrength,
    };
}

export async function deserializeScene(data: SceneFile, skipEnv = false): Promise<void> {
    // Clear current scene
    for (const id of Array.from(modelRegistry.keys())) {
        removeModel(id);
    }
    // Clear props
    for (const id of Array.from(propRegistry.keys())) {
        removeProp(id);
    }
    // Load each model — try libraryRef first, fall back to filePath
    for (const m of data.models) {
        try {
            const resolvedPath = (m.libraryRef ? resolveLibraryRef(m.libraryRef) : null) || m.filePath;
            await loadPMXFile(resolvedPath, m.kind === "stage", true);
            const inst = focusedModel();
            if (inst && inst.meshes[0]) {
                inst.meshes[0].position.x = m.positionX ?? 0;
                inst.meshes[0].position.y = m.positionY ?? 0;
                inst.meshes[0].position.z = m.positionZ ?? 0;
                // Apply scaling and rotation (with defaults for legacy scenes)
                if (m.scaling !== undefined) { inst.scaling = m.scaling; inst.meshes[0].scaling.setAll(m.scaling); }
                if (m.rotationY !== undefined) { inst.rotationY = m.rotationY; inst.meshes[0].rotation.y = m.rotationY; }
                // Apply visibility (with defaults)
                inst.visible = m.visible ?? true;
                inst.opacity = m.opacity ?? 1.0;
                inst.wireframe = m.wireframe ?? false;
                if (m.showBoneLines !== undefined) { inst.showBoneLines = m.showBoneLines; setModelBoneLinesVis(inst.id, m.showBoneLines); }
                if (m.showBoneJoints !== undefined) { inst.showBoneJoints = m.showBoneJoints; setModelBoneJointsVis(inst.id, m.showBoneJoints); }
                if (m.physicsEnabled !== undefined) { inst.physicsEnabled = m.physicsEnabled; setModelPhysics(inst.id, m.physicsEnabled); }
                if (inst.visible === false) {
                    for (const mesh of inst.meshes) mesh.setEnabled(false);
                }
                if (inst.opacity < 1.0 || inst.wireframe) {
                    for (const mesh of inst.meshes) {
                        if (mesh.material) {
                            mesh.material.alpha = inst.opacity;
                            if (mesh.material instanceof StandardMaterial) {
                                mesh.material.wireframe = inst.wireframe;
                            }
                        }
                    }
                }
            }
            if (m.vmdPath) {
                const resolvedVmdPath = (m.vmdLibraryRef ? resolveLibraryRef(m.vmdLibraryRef) : null) || m.vmdPath;
                await loadVMDFromPath(resolvedVmdPath);
            }
            if (m.outfitVariant) {
                const freshInst = focusedModel();
                if (freshInst) {
                    await loadOutfits(freshInst.id);
                    applyOutfitVariant(freshInst.id, m.outfitVariant);
                }
            }
        } catch (err) {
            console.warn(`Scene restore: skip ${m.name}:`, err);
        }
    }
    // Restore camera + lights + render
    if (data.camera) setCameraState(data.camera);
    if (data.lights) setLightState(data.lights);
    if (data.render) setRenderState(data.render);
    if (data.env && !skipEnv) setEnvState(data.env);
    // Restore gravity strength
    if (data.gravityStrength !== undefined) setGravityStrength(data.gravityStrength);

    // Restore procedural motion state
    if (data.procMotion) {
        procState = { ...DEFAULT_PROC_STATE, ...data.procMotion as Partial<ProcMotionState> };
        regenerateProcMotion();
    }

    // Restore LipSync state
    if (data.lipSync) {
        lipSyncState = { ...DEFAULT_LIPSYNC_STATE, ...data.lipSync as Partial<LipSyncStateType> };
    } else {
        lipSyncState = { ...DEFAULT_LIPSYNC_STATE };
    }

    // Restore camera VMD
    if (data.cameraVmd && data.cameraVmd.path) {
        try {
            const resolvedPath = (data.cameraVmd.libraryRef ? resolveLibraryRef(data.cameraVmd.libraryRef) : null) || data.cameraVmd.path;
            await loadCameraVmdFromPath(resolvedPath);
            if (data.cameraVmd.active) {
                switchCameraMode("vmd");
            }
        } catch (err) {
            console.warn("Scene restore: camera VMD failed:", err);
        }
    }

    // Restore audio
    if (data.audio && data.audio.path) {
        try {
            const resolvedPath = (data.audio.libraryRef ? resolveLibraryRef(data.audio.libraryRef) : null) || data.audio.path;
            await loadAudioFile(resolvedPath);
            setVolume(data.audio.volume ?? 1);
            setAudioOffset(data.audio.offset ?? 0);
            if (data.audio.playing) {
                resumeAudio();
            }
        } catch (err) {
            console.warn("Scene restore: audio failed:", err);
        }
    }

    // Restore props
    if (data.props && data.props.length > 0) {
        for (const p of data.props) {
            try {
                const resolvedPath = (p.libraryRef ? resolveLibraryRef(p.libraryRef) : null) || p.filePath;
                const propId = await loadProp(resolvedPath);
                if (propId) {
                    setPropTransform(propId, {
                        position: [p.positionX, p.positionY, p.positionZ],
                        rotationY: p.rotationY,
                        scaling: p.scaling,
                        visible: p.visible,
                    });
                }
            } catch (err) {
                console.warn(`Scene restore: skip prop ${p.name}:`, err);
            }
        }
    }
}

// ======== Model Instance Manipulation Helpers ========

/** Set visibility of a model (true = visible, false = hidden). */
export function setModelVisibility(id: string, visible: boolean): void {
    modelManager?.setVisibility(id, visible);
}

/** Set opacity (0..1) of a model. */
export function setModelOpacity(id: string, opacity: number): void {
    modelManager?.setOpacity(id, opacity);
}

/** Toggle wireframe rendering on a model. */
export function setModelWireframe(id: string, wireframe: boolean): void {
    modelManager?.setWireframe(id, wireframe);
}

/** Toggle bone line overlay on a model. */
export function setModelBoneLinesVis(id: string, show: boolean): void {
    modelManager?.setBoneLinesVis(id, show);
}

/** Toggle bone joint sphere overlay on a model. */
export function setModelBoneJointsVis(id: string, show: boolean): void {
    modelManager?.setBoneJointsVis(id, show);
}

/** Enable or disable physics simulation for a model. */
export function setModelPhysics(id: string, enabled: boolean): void {
    modelManager?.setPhysics(id, enabled);
}

export type PhysicsCategory = "skirt" | "chest" | "hair" | "accessory";
export type LipSyncState = LipSyncStateType;

export function getPhysicsCategories(id: string): PhysicsCategory[] {
    return modelManager?.getPhysicsCategories(id) ?? [];
}

export function getPhysicsCatState(id: string): Record<string, boolean> | null {
    return modelManager?.getPhysicsCatState(id) ?? null;
}

export function isPhysicsCategoryEnabled(id: string, cat: string): boolean {
    return modelManager?.isPhysicsCategoryEnabled(id, cat) ?? false;
}

export function setPhysicsCategory(id: string, cat: string, enabled: boolean): void {
    modelManager?.setPhysicsCategory(id, cat, enabled);
}

/** Set uniform scale for a model (1.0 = original size). */
export function setModelScaling(id: string, scaling: number): void {
    modelManager?.setScaling(id, scaling);
}

/** Set Y-axis rotation for a model (radians). */
export function setModelRotationY(id: string, rotationY: number): void {
    modelManager?.setRotationY(id, rotationY);
}

/** Set position (x, y, z) for a model. */
export function setModelPosition(id: string, x: number, y: number, z: number): void {
    modelManager?.setPosition(id, x, y, z);
}

/** Get current position of a model as [x, y, z]. */
export function getModelPosition(id: string): [number, number, number] {
    return modelManager?.getPosition(id) ?? [0, 0, 0];
}

/** Reset all transform/visibility properties to defaults. */
export function resetModelTransform(id: string): void {
    modelManager?.resetTransform(id);
}

// ======== Model Preset Support ========

/** Stop VMD animation on a model and clean up state.
 *  Always use this instead of manual setRuntimeAnimation(null).
 */
export function stopVMD(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    if (inst.mmdModel && mmdRuntime) {
        inst.mmdModel.setRuntimeAnimation(null);
    }
    modelManager?.stopVMD(id);
    if (isPlaying) {
        mmdRuntime?.pauseAnimation();
        setIsPlaying(false);
    }
    updatePlaybackUI();
}

// ======== Gravity Control ========

const DEFAULT_GRAVITY = -98;
let _gravityStrength = 1.0; // 0..2 multiplier relative to default
const _gravityVec = new Vector3(0, DEFAULT_GRAVITY, 0);

/** Set gravity strength multiplier (0 = no gravity, 1 = default, 2 = double). */
export function setGravityStrength(value: number): void {
    _gravityStrength = Math.max(0, Math.min(2, value));
    _gravityVec.y = DEFAULT_GRAVITY * _gravityStrength;
    mmdRuntime?.physics?.setGravity(_gravityVec);
    triggerAutoSave();
}

/** Get current gravity strength multiplier. */
export function getGravityStrength(): number {
    return _gravityStrength;
}

// ======== Auto-save debounce ========
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoSaveImpl(): void {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
        try {
            const json = JSON.stringify(serializeScene());
            await SaveLastScene(json);
        } catch (err) {
            // Silent — auto-save is best-effort
        }
    }, 2000);
}

// ======== Environment Auto-Link (Env → Lighting) ========

let envAutoLink = true;
let envSunAngle = 45; // default sun elevation
let _envPersistTimer: ReturnType<typeof setTimeout> | null = null;

export function setEnvAutoLink(on: boolean): void {
    envAutoLink = on;
}

export function getEnvAutoLink(): boolean {
    return envAutoLink;
}

export function setEnvSunAngle(deg: number): void {
    envSunAngle = Math.max(-15, Math.min(90, deg));
}

export function getEnvSunAngle(): number {
    return envSunAngle;
}

// ======== Time-of-Day Animation ========

let _timeOfDayActive = false;
let _timeOfDaySpeed = 3; // 度/秒（模拟时间）
let _lastSkySunAngle = 90; // 上一帧天空纹理对应的 sunAngle

function _timeOfDayTick(): void {
    if (!_timeOfDayActive) return;
    const dt = scene.getAnimationRatio() * (1 / 60);
    envSunAngle += _timeOfDaySpeed * dt;
    if (envSunAngle > 90) { envSunAngle = -15; }
    if (envSunAngle < -15) { envSunAngle = 90; }

    _updateSunDisc();
    redoEnvAutoLink();

    // 天空纹理每 0.4° 重建一次（避免每帧创建 Canvas）
    if (Math.abs(envSunAngle - _lastSkySunAngle) >= 0.4) {
        _lastSkySunAngle = envSunAngle;
        if (envState.skyMode === "procedural") {
            applySky(envState);
        }
    }
}

export function startTimeOfDay(speed?: number): void {
    if (speed !== undefined) _timeOfDaySpeed = speed;
    if (_timeOfDayActive) return;
    _timeOfDayActive = true;
    _lastSkySunAngle = envSunAngle;
    scene.onBeforeRenderObservable.add(_timeOfDayTick);
}

export function stopTimeOfDay(): void {
    _timeOfDayActive = false;
    scene.onBeforeRenderObservable.removeCallback(_timeOfDayTick);
}

export function isTimeOfDayActive(): boolean {
    return _timeOfDayActive;
}

export function getTimeOfDaySpeed(): number {
    return _timeOfDaySpeed;
}

/** 根据当前天空色 + 太阳角重新推导光照（滑块变化后调�?*/
export function redoEnvAutoLink(): void {
    if (!envAutoLink || envState.skyMode !== "procedural") return;
    const l = deriveLighting(envState.skyColorTop, envSunAngle);
    setLightState({
        dirColor: l.dirDiffuse,
        dirX: l.dirDirection[0],
        dirY: l.dirDirection[1],
        dirZ: l.dirDirection[2],
        dirIntensity: l.dirIntensity,
        hemiIntensity: l.hemiIntensity,
    });
}

/** 应用环境预设：同时设天空 + 灯光 + 渲染。*/
export function applyEnvPreset(name: string): boolean {
    const preset = ENV_PRESETS[name];
    if (!preset) return false;
    const wasLinked = envAutoLink;
    envAutoLink = false;
    envSunAngle = preset.sunAngle;

    const mid: [number, number, number] = [
        (preset.skyColorTop[0] + preset.skyColorBot[0]) / 2,
        (preset.skyColorTop[1] + preset.skyColorBot[1]) / 2,
        (preset.skyColorTop[2] + preset.skyColorBot[2]) / 2,
    ];

    setEnvState({
        skyMode: "procedural",
        skyColorTop: preset.skyColorTop,
        skyColorMid: mid,
        skyColorBot: preset.skyColorBot,
        skyBrightness: 1.0,
    });
    setLightState({
        dirColor: preset.dirDiffuse,
        dirX: preset.dirDirection[0],
        dirY: preset.dirDirection[1],
        dirZ: preset.dirDirection[2],
        dirIntensity: preset.dirIntensity,
        hemiIntensity: preset.hemiIntensity,
    });
    setRenderState({
        exposure: preset.exposure,
        toneMapping: preset.toneMapping,
    });
    envAutoLink = wasLinked;
    return true;
}

export function setEnvState(partial: Partial<EnvState>): void {
    // Runtime guard: detect black sky color assignments
    // 初始 restore 时 skyColorTop 为 [0,0,0] 是正常行为，不报 warning
    const isFullRestore = Object.keys(partial).length > 5 && partial.skyColorTop?.[0] === 0;
    if (!isFullRestore &&
        ((partial.skyColorTop && partial.skyColorTop[0] === 0 && partial.skyColorTop[1] === 0 && partial.skyColorTop[2] === 0) ||
        (partial.skyColorBot && partial.skyColorBot[0] === 0 && partial.skyColorBot[1] === 0 && partial.skyColorBot[2] === 0))) {
        console.warn("[env] ⚠️ setEnvState with black sky color:", JSON.stringify(partial));
        console.warn(new Error().stack);
    }

    Object.assign(envState, partial);

    // All environment changes go through the Facade
    applyEnvState(envState);

    // Auto-link: derive lighting from sky color when in procedural mode
    if (envAutoLink && envState.skyMode === "procedural" &&
        (partial.skyColorTop !== undefined || partial.skyColorMid !== undefined || partial.skyColorBot !== undefined || partial.skyBrightness !== undefined)) {
        const l = deriveLighting(envState.skyColorTop, envSunAngle);
        setLightState({
            dirColor: l.dirDiffuse,
            dirX: l.dirDirection[0],
            dirY: l.dirDirection[1],
            dirZ: l.dirDirection[2],
            dirIntensity: l.dirIntensity,
            hemiIntensity: l.hemiIntensity,
        });
    }

    // Update water animation speed without full recreation
    if (partial.waterAnimSpeed !== undefined) {
        updateWaterAnimSpeed(partial.waterAnimSpeed);
    }

    // Persist env state to config.json (debounced)
    if (_envPersistTimer) clearTimeout(_envPersistTimer);
    _envPersistTimer = setTimeout(() => {
        SetEnvState(envState as any).catch(() => {});
    }, 500);

    triggerAutoSave();
}

// ======== Init Save/Load UI ========
// ======== Morph / Expression Preview ========

/** Get all morph names and types for a model. */
export function getModelMorphs(id: string): Array<{ name: string; type: number }> {
    return modelManager?.getMorphs(id) ?? [];
}

/** Set a morph weight for a model (0..1). */
export function setModelMorphWeight(id: string, morphName: string, weight: number): void {
    modelManager?.setMorphWeight(id, morphName, weight);
}

/** Get a morph weight for a model. */
export function getModelMorphWeight(id: string, morphName: string): number {
    return modelManager?.getMorphWeight(id, morphName) ?? 0;
}

/** Reset all morph weights to 0. */
export function resetModelMorphs(id: string): void {
    modelManager?.resetMorphs(id);
}

// ======== Auto-restore ========
export async function tryRestoreLastScene(): Promise<void> {
    try {
        const json = await LoadLastScene();
        if (!json) return;
        const data = JSON.parse(json);
        if (data && data.version === 1) {
            await deserializeScene(data, true);
            console.log("Auto-restored last scene");
        }
    } catch (err) {
        // No saved scene or corrupt — silent
    }
}

// ======== Procedural Motion Control API ========

export function setProcMotionMode(mode: ProcMotionMode): void {
    procState = { ...procState, mode };
    if (mode === "off") stopProcMotion();
}

export function setProcMotionIntensity(v: number): void {
    procState = { ...procState, intensity: Math.max(0, Math.min(1, v)) };
}

export function setProcMotionSpeed(v: number): void {
    procState = { ...procState, speed: Math.max(0.5, Math.min(2, v)) };
}
export function getScene(): Scene {
    return scene;
}
export function setProcMotionAutoSwitch(on: boolean): void {
    procState = { ...procState, autoSwitch: on };
}

export function getProcMotionState(): ProcMotionState {
    return { ...procState };
}

/** 强制立即重新生成 procedural VMD（参数变更后调用）。
 *  mode=off 且未激活时静默返回。 */
export function regenerateProcMotion(): void {
    if (!procVmdActive && procState.mode === "off") return;
    const mode = procState.mode === "autodance" ? "autodance" as const : "idle" as const;
    const bpm = procBeatDetector?.getBPM() ?? 120;
    startProcMotion(mode, mode === "autodance" ? bpm : undefined);
}

// Re-exports from extracted sub-modules (zero-change for consumers)
export { loadVMDMotion, loadVMDFromPath, loadCameraVmdFromPath, loadVPDPose } from "./scene-vmd";
export { updatePlaybackUI, seekFromEvent } from "./scene-playback";
export { triggerAutoSave } from "../core/config";
