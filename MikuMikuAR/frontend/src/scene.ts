// [doc:architecture] Scene — 3D 场景核心模块
// 规范文档: docs/architecture.md §渲染环节
// 职责: Babylon.js 初始化 + PMX/VMD 加载 + 播放控制 + 场景序列化

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { GradientMaterial } from "@babylonjs/materials/gradient/gradientMaterial";
import { SkyMaterial } from "@babylonjs/materials/sky/skyMaterial";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { GPUParticleSystem } from "@babylonjs/core/Particles/gpuParticleSystem";

import { RegisterMmdModelLoaders } from "babylon-mmd/esm/Loader/dynamic";
import { RegisterDxBmpTextureLoader } from "babylon-mmd/esm/Loader/registerDxBmpTextureLoader";
import { GetMmdWasmInstance } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance";
import { MmdWasmInstanceTypeSPR } from "babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease";
import { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";
import type { MmdWasmModel } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmModel";
import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
import { MmdWasmAnimation } from "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation";
import "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmRuntimeModelAnimation";
import { MmdStandardMaterialProxy } from "babylon-mmd/esm/Runtime/mmdStandardMaterialProxy";
import { MmdRuntimeShared } from "babylon-mmd/esm/Runtime/mmdRuntimeShared";
import "babylon-mmd/esm/Loader/mmdModelLoader.default";
import "@babylonjs/core/Materials/Textures/Loaders/tgaTextureLoader";
import "babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.vertex";
import "babylon-mmd/esm/Loader/Shaders/textureAlphaChecker.fragment";

import { SaveThumbnail, SaveLastScene, LoadLastScene } from "../wailsjs/go/main/App";
import { initCameraSystem, autoFrame, getCameraState, setCameraState, animateCameraVmd, loadCameraVmd, clearCameraVmd, hasCameraVmd, getCameraVmdName, getCameraVmdPath, switchCameraMode, getCameraMode } from "./camera";
import type { CameraState } from "./camera";
import {
    dom, setStatus, formatTime, toBase64,
    setMmdRuntime, mmdRuntime, modelRegistry, focusedModelId, setFocusedModelId,
    isPlaying, setIsPlaying, autoLoop, setAutoLoop,
    isLoadingModel, setIsLoadingModel, isLoadingVmd, setIsLoadingVmd,
    pendingVmd, setPendingVmd,
    seekDragging, setSeekDragging,
    ModelInstance, setModelRegistry, escapeHtml,
    computeLibraryRef, resolveLibraryRef,
    envState, EnvState,
} from "./config";
import { resolveFileUrl, normPath } from "./fileservice";
import { loadVPDFromBuffer } from "./vpd-parser";
import { syncAudioPlayback, loadAudioFile, setVolume, setAudioOffset, getAudioPath, getAudioName, getVolume, getAudioOffset, isAudioPlaying, resumeAudio, pauseAudio } from "./audio";

// ======== Babylon.js ========
export const engine = new Engine(dom.canvas, true, { preserveDrawingBuffer: true, stencil: true });
export const scene = new Scene(engine);
scene.clearColor = new Color4(0.12, 0.12, 0.16, 1.0);

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
    triggerAutoSave();
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
    dofDarken: number;
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
        dofDarken: 0.5,
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

// ======== Convenience getters ========
export function focusedMmdModel() { return focusedModelId ? modelRegistry.get(focusedModelId)?.mmdModel ?? null : null; }
export function focusedModel() { return focusedModelId ? modelRegistry.get(focusedModelId) : undefined; }

// ======== Init Scene ========
export async function initScene(): Promise<void> {
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    MmdRuntimeShared.MaterialProxyConstructor = MmdStandardMaterialProxy;
    const wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
    const runtime = new MmdWasmRuntime(wasmInstance, scene);
    runtime.loggingEnabled = true;
    runtime.register(scene);
    setMmdRuntime(runtime);

    // Wire up playback UI observables
    runtime.onAnimationTickObservable.add(() => {
        updatePlaybackUI();
        const foc = focusedModel();
        const dur = foc?.animationDuration ?? runtime.animationDuration;
        syncAudioPlayback(runtime.currentTime, isPlaying, dur);
        animateCameraVmd(runtime.currentTime * 30);
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

    _applyGround(envState);
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

export async function loadPMXFile(filePath: string, asStage?: boolean): Promise<void> {
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
                visible: true, opacity: 1.0, wireframe: false, showBones: false, physicsEnabled: false,
                scaling: 1.0, rotationY: 0,
            };
            modelRegistry.set(id, inst);
            setFocusedModelId(id);
            focusModel(id);
            setStatus(`✓ ${displayName} (场景)`, true);
            arrangeModels();
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
            visible: true, opacity: 1.0, wireframe: false, showBones: false, physicsEnabled: true,
            scaling: 1.0, rotationY: 0,
        };
        modelRegistry.set(id, inst);
        // Remember initial rigid body states for physics toggle restoration
        if (wasmModel) {
            const states = wasmModel.rigidBodyStates;
            if (states) _initialRigidBodyStates.set(id, new Uint8Array(states));
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

        focusModel(id);
        setStatus(appliedVmd ? `✓ ${displayName} + ${appliedVmd}` : `✓ ${displayName}`, true);
        arrangeModels();
        // Auto-capture thumbnail for future popup display
        captureThumbnail(filePath).catch(() => {});
    } catch (err) {
        dom.loadingEl.style.display = "none";
        console.error("loadPMXFile:", err);
        setStatus("✗ 模型加载失败", false);
    } finally {
        setIsLoadingModel(false);
        dom.loadingEl.style.display = "none";
    }
}

// ======== VMD Loading ========
export async function loadVMDMotion(data: ArrayBuffer, name: string, targetModelId?: string): Promise<void> {
    if (!mmdRuntime) {
        setPendingVmd({ data, name });
        setStatus("VMD 已缓存，等待模型加载", false);
        return;
    }
    const targetId = targetModelId || focusedModelId;
    if (!targetId) {
        setStatus("✗ 没有目标模型", false);
        return;
    }
    const inst = modelRegistry.get(targetId);
    if (!inst) {
        setStatus("✗ 目标模型不存在", false);
        return;
    }
    try {
        // Load VMD from buffer using VmdLoader
        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(name, data);

        // Create WASM animation from the loaded data
        const wasmAnimation = new MmdWasmAnimation(mmdAnimation, mmdRuntime.wasmInstance, scene);

        // Extract camera track from VMD and apply to MmdCamera
        try {
            loadCameraVmd(mmdAnimation, "", name);
        } catch (camErr) {
            console.warn("Camera VMD load skipped:", camErr);
        }

        // Bind to model
        if (!inst.mmdModel) {
            setStatus(`✗ 舞台模型不支持 VMD`, false);
            return;
        }
        const handle = inst.mmdModel.createRuntimeAnimation(wasmAnimation);
        inst.mmdModel.setRuntimeAnimation(handle);

        inst.vmdData = data;
        inst.vmdName = name;
        // Convert from 30fps frames to seconds
        inst.animationDuration = mmdAnimation.endFrame / 30;

        if (!isPlaying && autoLoop) {
            await mmdRuntime.playAnimation();
            setIsPlaying(true);
        }
        setStatus(`✓ VMD: ${name}`, true);
    } catch (err) {
        console.error("VMD load failed:", err);
        setStatus("✗ VMD 加载失败", false);
    }
}

export async function loadVMDFromPath(path: string, targetModelId?: string): Promise<void> {
    if (isLoadingVmd) return;
    setIsLoadingVmd(true);
    try {
        const { url } = await resolveFileUrl(path);
        const vmdName = normPath(path).split("/").pop() || "";
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const vmdData = await resp.arrayBuffer();

        if (mmdRuntime && (targetModelId || focusedMmdModel())) {
            await loadVMDMotion(vmdData, vmdName.replace(/\.vmd$/i, ""), targetModelId);
            const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
            if (foc) foc.vmdPath = path;
        }
        else {
            setPendingVmd({ data: vmdData, name: vmdName.replace(/\.vmd$/i, "") });
            setStatus("VMD 已缓存，加载模型后自动应用", false);
        }
    } catch (err) {
        console.error("loadVMDFromPath:", err);
        setStatus("✗ VMD 加载失败", false);
    } finally {
        setIsLoadingVmd(false);
    }
}

export async function loadCameraVmdFromPath(path: string): Promise<void> {
    try {
        const { url } = await resolveFileUrl(path);
        const vmdName = normPath(path).split("/").pop() || "";
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const vmdData = await resp.arrayBuffer();

        const vmdLoader = new VmdLoader(scene);
        const mmdAnimation = await vmdLoader.loadFromBufferAsync(vmdName, vmdData);
        loadCameraVmd(mmdAnimation, path, vmdName.replace(/\.vmd$/i, ""));
        setStatus(`✓ 相机 VMD: ${vmdName}`, true);
    } catch (err) {
        console.error("loadCameraVmdFromPath:", err);
        setStatus("✗ 相机 VMD 加载失败", false);
    }
}

export async function loadVPDPose(path: string, targetModelId?: string): Promise<void> {
    if (isLoadingVmd) return;
    setIsLoadingVmd(true);
    try {
        const { url } = await resolveFileUrl(path);
        const poseName = normPath(path).split("/").pop() || "";
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const rawData = await resp.arrayBuffer();

        const vmdBuffer = loadVPDFromBuffer(rawData);

        await loadVMDMotion(vmdBuffer, "姿势: " + poseName.replace(/\.vpd$/i, ""), targetModelId);

        const foc = targetModelId ? modelRegistry.get(targetModelId) : focusedModel();
        if (foc) {
            foc.vmdPath = path;
        }
        setStatus(`✓ 姿势: ${poseName}`, true);
    } catch (err) {
        console.error("loadVPDPose:", err);
        setStatus("✗ 姿势加载失败", false);
    } finally {
        setIsLoadingVmd(false);
    }
}

// ======== Model Lifecycle ========
export function removeModel(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    if (inst.mmdModel && mmdRuntime) { try { mmdRuntime.destroyMmdModel(inst.mmdModel); } catch (e) { console.warn("removeModel: destroyMmdModel failed", e); } }
    for (const m of inst.meshes) { if (m instanceof Mesh) m.dispose(); }
    modelRegistry.delete(id);
    _catState.delete(id);
    _matState.delete(id);
    destroyBoneOverlay(id);
    if (focusedModelId === id) { setFocusedModelId(modelRegistry.size > 0 ? modelRegistry.keys().next().value : null); }
    if (focusedModelId) focusModel(focusedModelId);
    if (modelRegistry.size === 0) {
        setIsPlaying(false);
        setIsLoadingModel(false);
        setIsLoadingVmd(false);
        setAutoLoop(true);
        setSeekDragging(false);
        dom.playbackBar.style.display = "none";
    }
    arrangeModels();
}

export function removeFocusedModel(): void {
    if (!focusedModelId) return;
    removeModel(focusedModelId);
    setPendingVmd(null);
    if (modelRegistry.size === 0) {
        setIsPlaying(false);
        setAutoLoop(true);
        setSeekDragging(false);
        dom.playbackBar.style.display = "none";
    }
}

export function focusModel(id: string): void {
    setFocusedModelId(id);
    const inst = modelRegistry.get(id);
    if (!inst) { return; }
    // Auto-frame camera
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of inst.meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        min.minimizeInPlace(bb.minimumWorld);
        max.maximizeInPlace(bb.maximumWorld);
    }
    const center = min.add(max).scale(0.5);
    const size = max.subtract(min);
    const extent = Math.max(size.x, size.y, size.z);
    autoFrame(center, extent);
    updatePlaybackUI();
}

export function arrangeModels(): void {
    const models = Array.from(modelRegistry.values());
    const spacing = 3;
    models.forEach((inst, i) => {
        const offsetX = (i - (models.length - 1) / 2) * spacing;
        if (inst.meshes.length > 0) inst.meshes[0].position.x = offsetX;
    });
    triggerAutoSave();
}

// ======== Playback UI ========
export function updatePlaybackUI(): void {
    const mmdModel = focusedMmdModel();
    if (!mmdRuntime || !mmdModel) {
        dom.playbackBar.style.display = "none";
        return;
    }
    const foc = focusedModel();
    const duration = foc?.animationDuration ?? mmdRuntime.animationDuration;
    dom.playbackBar.style.display = "flex";
    dom.btnPlayPause.textContent = isPlaying ? "⏸" : "▶";
    dom.timeDisplay.textContent = `${formatTime(mmdRuntime.currentTime)} / ${formatTime(duration)}`;
    if (duration > 0) {
        const pct = (mmdRuntime.currentTime / duration) * 100;
        dom.seekProgress.style.width = `${Math.min(pct, 100)}%`;
    }
}

export function seekFromEvent(e: MouseEvent | PointerEvent): void {
    const foc = focusedModel();
    const duration = foc?.animationDuration ?? mmdRuntime!.animationDuration;
    if (!mmdRuntime || !focusedMmdModel() || duration <= 0) return;
    const rect = dom.seekBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * duration;
    mmdRuntime.seekAnimation(targetTime, true);
    updatePlaybackUI();
    syncAudioPlayback(targetTime, isPlaying, duration);
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
    };
}

export async function deserializeScene(data: SceneFile): Promise<void> {
    // Clear current scene
    for (const id of Array.from(modelRegistry.keys())) {
        removeModel(id);
    }
    // Load each model — try libraryRef first, fall back to filePath
    for (const m of data.models) {
        try {
            const resolvedPath = (m.libraryRef ? resolveLibraryRef(m.libraryRef) : null) || m.filePath;
            await loadPMXFile(resolvedPath, m.kind === "stage");
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
        } catch (err) {
            console.warn(`Scene restore: skip ${m.name}:`, err);
        }
    }
    // Restore camera + lights + render
    if (data.camera) setCameraState(data.camera);
    if (data.lights) setLightState(data.lights);
    if (data.render) setRenderState(data.render);
    if (data.env) setEnvState(data.env);

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
}

// ======== Model Instance Manipulation Helpers ========

/** Apply the current visibility, opacity, and wireframe state of a ModelInstance to its meshes. */
function syncModelVisibility(inst: ModelInstance): void {
    for (const m of inst.meshes) {
        m.setEnabled(inst.visible);
        if (m.material) {
            m.material.alpha = inst.opacity;
            if (m.material instanceof StandardMaterial) {
                m.material.wireframe = inst.wireframe;
            }
        }
    }
}

/** Apply the current scaling and rotation state of a ModelInstance to its root mesh. */
function syncModelTransform(inst: ModelInstance): void {
    if (inst.meshes.length > 0) {
        const root = inst.meshes[0];
        root.scaling.setAll(inst.scaling);
        root.rotation.y = inst.rotationY;
    }
}

/** Set visibility of a model (true = visible, false = hidden). */
export function setModelVisibility(id: string, visible: boolean): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.visible = visible;
    syncModelVisibility(inst);
    triggerAutoSave();
}

/** Set opacity (0..1) of a model. */
export function setModelOpacity(id: string, opacity: number): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.opacity = Math.max(0, Math.min(1, opacity));
    syncModelVisibility(inst);
    triggerAutoSave();
}

/** Toggle wireframe rendering on a model. */
export function setModelWireframe(id: string, wireframe: boolean): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.wireframe = wireframe;
    syncModelVisibility(inst);
    triggerAutoSave();
}

/** Toggle bone skeleton overlay on a model. */
export function setModelBoneVis(id: string, show: boolean): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.showBones = show;
    if (show) {
        createBoneOverlay(id);
    } else {
        destroyBoneOverlay(id);
    }
    triggerAutoSave();
}

/** Enable or disable physics simulation for a model. */
export function setModelPhysics(id: string, enabled: boolean): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.physicsEnabled = enabled;
    const mmdModel = inst.mmdModel;
    if (mmdModel) {
        const states = mmdModel.rigidBodyStates;
        if (states) {
            if (enabled) {
                // Restore initial states remembered at load time
                const init = (_initialRigidBodyStates.get(id) || new Uint8Array(0));
                if (init.length === states.length) {
                    states.set(init);
                } else {
                    states.fill(1);
                }
            } else {
                states.fill(0);
            }
        }
    }
    triggerAutoSave();
}

const _initialRigidBodyStates = new Map<string, Uint8Array>();

function createBoneOverlay(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst || !inst.mmdModel) return;
    if (_boneOverlayMap.has(id)) return;

    const bones = inst.mmdModel.runtimeBones;
    if (!bones || bones.length === 0) return;

    // Pre-compute physics bone set
    const physicsBoneSet = new Set<number>();
    for (let i = 0; i < bones.length; i++) {
        if (bones[i].rigidBodyIndices.length > 0) {
            physicsBoneSet.add(i);
        }
    }

    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];
    const tmp = new Vector3();

    // Build bone hierarchy lines
    for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (!bone.parentBone) continue;
        const parentPos = new Vector3();
        bone.parentBone.getWorldTranslationToRef(parentPos);
        bone.getWorldTranslationToRef(tmp);
        lines.push([parentPos.clone(), tmp.clone()]);
        // Physics bones get bright green; non-physics use transform-order hue
        const isPhysics = physicsBoneSet.has(i);
        let c: Color3;
        if (isPhysics) {
            c = new Color3(0.2, 1, 0.3); // bright green
        } else {
            const hue = (bone.transformOrder % 40) / 40;
            c = Color3.FromHSV(hue * 360, 1, 0.8);
        }
        colors.push([new Color4(c.r, c.g, c.b, 1), new Color4(c.r, c.g, c.b, 1)]);
    }

    // Check if there are any connectable bones
    if (lines.length === 0) {
        console.warn("setModelBoneVis: no parent-child bone connections found");
        return;
    }

    const overlay = MeshBuilder.CreateLineSystem("boneOverlay_" + id, {
        lines,
        colors,
        updatable: true,
        useVertexAlpha: true,
    }, scene);
    overlay.renderingGroupId = 2; // always on top

    // Per-frame update: refresh world positions of every bone line
    const updateFn = () => {
        const m = modelRegistry.get(id);
        if (!m || !m.mmdModel) return;
        const b = m.mmdModel.runtimeBones;
        if (!b) return;
        const positions: number[] = [];
        const colorData: number[] = [];
        for (let i = 0; i < b.length; i++) {
            const bone = b[i];
            if (!bone.parentBone) continue;
            const parentPos = new Vector3();
            const childPos = new Vector3();
            bone.parentBone.getWorldTranslationToRef(parentPos);
            bone.getWorldTranslationToRef(childPos);
            positions.push(parentPos.x, parentPos.y, parentPos.z);
            positions.push(childPos.x, childPos.y, childPos.z);
            const isPhysics = physicsBoneSet.has(i);
            let c: Color3;
            if (isPhysics) {
                c = new Color3(0.2, 1, 0.3);
            } else {
                const hue = (bone.transformOrder % 40) / 40;
                c = Color3.FromHSV(hue * 360, 1, 0.8);
            }
            colorData.push(c.r, c.g, c.b);
            colorData.push(c.r, c.g, c.b);
        }
        const posArr = new Float32Array(positions);
        const colArr = new Float32Array(colorData);
        overlay.updateVerticesData("position", posArr, false, false);
        overlay.updateVerticesData("color", colArr, false, false);
    };

    _boneOverlayMap.set(id, { overlay, update: updateFn });

    // Register the before-render observer if not yet registered
    ensureBoneUpdateObserver();
}

function destroyBoneOverlay(id: string): void {
    const entry = _boneOverlayMap.get(id);
    if (entry) {
        entry.overlay.dispose();
        _boneOverlayMap.delete(id);
    }
}

let _boneUpdateObserver: any = null;
function ensureBoneUpdateObserver(): void {
    if (_boneUpdateObserver) return;
    _boneUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        const toDelete: string[] = [];
        for (const [id, entry] of _boneOverlayMap) {
            const inst = modelRegistry.get(id);
            if (!inst || !inst.showBones || !inst.mmdModel) {
                // Clean up stale entries
                entry.overlay.dispose();
                toDelete.push(id);
                continue;
            }
            entry.update();
        }
        for (const id of toDelete) _boneOverlayMap.delete(id);
    });
}

/** Set uniform scale for a model (1.0 = original size). */
export function setModelScaling(id: string, scaling: number): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.scaling = Math.max(0.01, scaling);
    syncModelTransform(inst);
    triggerAutoSave();
}

/** Set Y-axis rotation for a model (radians). */
export function setModelRotationY(id: string, rotationY: number): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.rotationY = rotationY;
    syncModelTransform(inst);
    triggerAutoSave();
}

/** Set position (x, y, z) for a model. */
export function setModelPosition(id: string, x: number, y: number, z: number): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    if (inst.meshes.length > 0) {
        inst.meshes[0].position.set(x, y, z);
    }
    triggerAutoSave();
}

/** Get current position of a model as [x, y, z]. */
export function getModelPosition(id: string): [number, number, number] {
    const inst = modelRegistry.get(id);
    if (!inst || inst.meshes.length === 0) return [0, 0, 0];
    const p = inst.meshes[0].position;
    return [p.x, p.y, p.z];
}

/** Reset all transform/visibility properties to defaults. */
export function resetModelTransform(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    inst.visible = true;
    inst.opacity = 1.0;
    inst.wireframe = false;
    inst.scaling = 1.0;
    inst.rotationY = 0;
    if (inst.meshes.length > 0) {
        inst.meshes[0].position.set(0, 0, 0);
    }
    syncModelVisibility(inst);
    syncModelTransform(inst);
    triggerAutoSave();
}

// ======== Material Category Adjustment ========

export type MaterialCategoryParams = {
    diffuseMul: number;   // 0..2 漫反射强度倍率
    specularMul: number;  // 0..2 镜面反射强度倍率
    shininess: number;    // 0..200 镜面反射指数
    ambientMul: number;   // 0..2 环境光强度倍率
};

const CATEGORIES = ["皮肤", "头发", "眼睛", "服装"] as const;
export type MaterialCategory = typeof CATEGORIES[number];

interface _OrigMat {
    diffuse: Color3;
    specular: Color3;
    specularPower: number;
    ambient: Color3;
}

const _origValues = new WeakMap<Material, _OrigMat>();
/** @internal exported for testing */
export const _catState = new Map<string, Map<string, MaterialCategoryParams>>();
/** @internal exported for testing */
export const _matState = new Map<string, Map<number, MaterialCategoryParams>>();
const _boneOverlayMap = new Map<string, { overlay: Mesh; update: () => void }>();

/** @internal exported for testing */
export function _catOf(name: string): MaterialCategory {
    const l = name.toLowerCase();
    if (/skin|face|肌|顔|body|neck|首|cheek|頬|kihada/.test(l)) return "皮肤";
    if (/hair|髪|ahoge/.test(l)) return "头发";
    if (/eye|目|iris|瞳|白目|pupil/.test(l)) return "眼睛";
    return "服装";
}

function _capture(mat: Material): void {
    if (_origValues.has(mat)) return;
    const sm = mat as StandardMaterial;
    _origValues.set(mat, {
        diffuse: sm.diffuseColor.clone(),
        specular: sm.specularColor.clone(),
        specularPower: sm.specularPower,
        ambient: sm.ambientColor.clone(),
    });
}

/** @internal exported for testing */
export function _applyAll(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    const state = _catState.get(id);
    if (!state) return;
    const perMat = _matState.get(id);
    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const mesh = inst.meshes[mi];
        const m = mesh.material as StandardMaterial;
        if (!m) continue;
        _capture(m);
        const o = _origValues.get(m)!;
        // Category-level params
        const p = state.get(_catOf(m.name));
        if (!p) continue;
        m.diffuseColor.set(o.diffuse.r * p.diffuseMul, o.diffuse.g * p.diffuseMul, o.diffuse.b * p.diffuseMul);
        m.specularColor.set(o.specular.r * p.specularMul, o.specular.g * p.specularMul, o.specular.b * p.specularMul);
        m.specularPower = p.shininess;
        m.ambientColor.set(o.ambient.r * p.ambientMul, o.ambient.g * p.ambientMul, o.ambient.b * p.ambientMul);
        // Per-material override
        const mp = perMat?.get(mi);
        if (mp) {
            m.diffuseColor.set(o.diffuse.r * mp.diffuseMul, o.diffuse.g * mp.diffuseMul, o.diffuse.b * mp.diffuseMul);
            m.specularColor.set(o.specular.r * mp.specularMul, o.specular.g * mp.specularMul, o.specular.b * mp.specularMul);
            m.specularPower = mp.shininess;
            m.ambientColor.set(o.ambient.r * mp.ambientMul, o.ambient.g * mp.ambientMul, o.ambient.b * mp.ambientMul);
        }
    }
}

function _ensureState(id: string): Map<string, MaterialCategoryParams> {
    let m = _catState.get(id);
    if (m) return m;
    m = new Map();
    for (const c of CATEGORIES) m.set(c, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 });
    _catState.set(id, m);
    return m;
}

/** Get material groups categorized by body part for a model. */
export function getMatCatGroups(id: string): Map<string, { name: string; mat: Material }[]> {
    const groups = new Map<string, { name: string; mat: Material }[]>();
    const inst = modelRegistry.get(id);
    if (!inst) return groups;
    for (const mesh of inst.meshes) {
        const m = mesh.material;
        if (!m || !(m instanceof StandardMaterial)) continue;
        const cat = _catOf(m.name);
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push({ name: m.name, mat: m });
    }
    return groups;
}

/** Get current category params for a model. */
export function getMatCatParams(id: string, cat: string): MaterialCategoryParams {
    return { ..._ensureState(id).get(cat)! };
}

/** Set category params for a model and apply immediately. */
export function setMatCatParams(id: string, cat: string, params: Partial<MaterialCategoryParams>): void {
    Object.assign(_ensureState(id).get(cat)!, params);
    _applyAll(id);
    triggerAutoSave();
}

/** Reset all category params for a model to defaults. */
export function resetMatCatParams(id: string): void {
    _catState.delete(id);
    const inst = modelRegistry.get(id);
    if (!inst) return;
    for (const mesh of inst.meshes) {
        const m = mesh.material as StandardMaterial;
        if (!m) continue;
        const o = _origValues.get(m);
        if (o) {
            m.diffuseColor.copyFrom(o.diffuse);
            m.specularColor.copyFrom(o.specular);
            m.specularPower = o.specularPower;
            m.ambientColor.copyFrom(o.ambient);
        }
    }
    triggerAutoSave();
}

// ======== Per-Material Parameter Override ========

function _ensureMatState(id: string): Map<number, MaterialCategoryParams> {
    let m = _matState.get(id);
    if (m) return m;
    m = new Map();
    _matState.set(id, m);
    return m;
}

/**
 * Get detailed list of all materials for a model with their current effective params.
 * Returns array of { name, index, params, modified } where `modified` means per-material override is set.
 */
export function getMatDetailList(id: string): { name: string; index: number; params: MaterialCategoryParams; modified: boolean }[] {
    const result: { name: string; index: number; params: MaterialCategoryParams; modified: boolean }[] = [];
    const inst = modelRegistry.get(id);
    if (!inst) return result;
    const perMat = _matState.get(id);
    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const m = inst.meshes[mi].material as StandardMaterial;
        if (!m) continue;
        const mp = perMat?.get(mi);
        const params: MaterialCategoryParams = mp
            ? { ...mp }
            : { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
        result.push({ name: m.name, index: mi, params, modified: !!mp });
    }
    return result;
}

/** Get per-material override params, or null if no override is set. */
export function getMatParams(id: string, matIndex: number): MaterialCategoryParams | null {
    const entry = _matState.get(id)?.get(matIndex);
    return entry ? { ...entry } : null;
}

/** Set per-material override params. Values are clamped. matIndex must be within meshes range. */
export function setMatParams(id: string, matIndex: number, params: Partial<MaterialCategoryParams>): void {
    const inst = modelRegistry.get(id);
    if (!inst || matIndex < 0 || matIndex >= inst.meshes.length) {
        console.warn(`setMatParams: invalid matIndex ${matIndex} for model "${id}" (${inst ? inst.meshes.length : 0} meshes)`);
        return;
    }
    const state = _ensureMatState(id);
    let entry = state.get(matIndex);
    if (!entry) {
        entry = { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
        state.set(matIndex, entry);
    }
    if (params.diffuseMul !== undefined) entry.diffuseMul = Math.max(0, Math.min(2, params.diffuseMul));
    if (params.specularMul !== undefined) entry.specularMul = Math.max(0, Math.min(2, params.specularMul));
    if (params.shininess !== undefined) entry.shininess = Math.max(0, Math.min(200, Math.round(params.shininess)));
    if (params.ambientMul !== undefined) entry.ambientMul = Math.max(0, Math.min(2, params.ambientMul));
    _applyAll(id);
    triggerAutoSave();
}

/** Reset per-material override for a single material index. Guards against invalid index. */
export function resetSingleMatParams(id: string, matIndex: number): void {
    const inst = modelRegistry.get(id);
    if (!inst || matIndex < 0 || matIndex >= inst.meshes.length) {
        console.warn(`resetSingleMatParams: invalid matIndex ${matIndex} for model "${id}"`);
        return;
    }
    _matState.get(id)?.delete(matIndex);
    _applyAll(id);
    triggerAutoSave();
}

/** Reset all per-material overrides for a model (keeps category-level params). */
export function resetAllMatParams(id: string): void {
    _matState.delete(id);
    _applyAll(id);
    triggerAutoSave();
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
    inst.vmdData = null;
    inst.vmdName = "";
    inst.vmdPath = null;
    inst.animationDuration = 0;
    if (isPlaying) {
        mmdRuntime?.pauseAnimation();
        setIsPlaying(false);
    }
    updatePlaybackUI();
    triggerAutoSave();
}

/** Get the full material state (categories + per-material overrides) for a model.
 *  Returns null if no material adjustments have been made.
 *  Used for preset serialization.
 */
export function getMatState(id: string): {
    categories: Record<string, MaterialCategoryParams>;
    overrides: Record<number, MaterialCategoryParams>;
} | null {
    const catState = _catState.get(id);
    const matState = _matState.get(id);
    if (!catState && !matState) return null;
    const categories: Record<string, MaterialCategoryParams> = {};
    if (catState) {
        for (const [cat, params] of catState) {
            categories[cat] = { ...params };
        }
    }
    const overrides: Record<number, MaterialCategoryParams> = {};
    if (matState) {
        for (const [idx, params] of matState) {
            overrides[idx] = { ...params };
        }
    }
    return { categories, overrides };
}

/** Apply a previously saved material state to a model.
 *  Used for preset deserialization.
 *  ⚠ MaterialCategory is a string union ("皮肤"|"头发"|"眼睛"|"服装"),
 *    so Object.entries() yields [string, T] — need `as MaterialCategory`.
 */
export function applyMatState(id: string, state: {
    categories?: Record<string, MaterialCategoryParams>;
    overrides?: Record<number, MaterialCategoryParams>;
}): void {
    if (state.categories) {
        for (const [cat, params] of Object.entries(state.categories)) {
            setMatCatParams(id, cat as MaterialCategory, params);
        }
    }
    if (state.overrides) {
        for (const [idxStr, params] of Object.entries(state.overrides)) {
            const idx = parseInt(idxStr, 10);
            setMatParams(id, idx, params);
        }
    }
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

export function triggerAutoSave(): void {
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

export function setEnvState(partial: Partial<EnvState>): void {
    Object.assign(envState, partial);

    if (partial.skyMode !== undefined || partial.skyColorTop !== undefined ||
        partial.skyColorMid !== undefined || partial.skyColorBot !== undefined ||
        partial.skyTexture !== undefined || partial.skyRotationY !== undefined ||
        partial.skyBrightness !== undefined || partial.envIntensity !== undefined) {
        _applySky(envState);
    }

    if (partial.groundVisible !== undefined || partial.groundMode !== undefined ||
        partial.groundColor !== undefined || partial.groundAlpha !== undefined) {
        _applyGround(envState);
    }

    if (partial.particleType !== undefined || partial.particleEnabled !== undefined || partial.windEnabled !== undefined) {
        if (envState.particleEnabled && envState.particleType !== "none") {
            _createParticleEmitter(envState.particleType, envState.windEnabled);
        } else {
            _disposeParticles();
        }
    }

    if (partial.cloudsEnabled !== undefined || partial.cloudCover !== undefined || partial.cloudScale !== undefined) {
        _createClouds(envState);
    }

    if (partial.fogEnabled !== undefined || partial.fogColor !== undefined || partial.fogDensity !== undefined) {
        if (envState.fogEnabled) {
            scene.fogMode = Scene.FOGMODE_EXP2;
            scene.fogColor = new Color3(envState.fogColor[0], envState.fogColor[1], envState.fogColor[2]);
            scene.fogDensity = envState.fogDensity;
        } else {
            scene.fogMode = Scene.FOGMODE_NONE;
        }
    }

    triggerAutoSave();
}

// ======== Init Save/Load UI ========
// ======== Morph / Expression Preview ========

/** Get all morph names and types for a model. */
export function getModelMorphs(id: string): Array<{ name: string; type: number }> {
    const inst = modelRegistry.get(id);
    if (!inst?.mmdModel?.morph?.morphs) return [];
    return inst.mmdModel.morph.morphs.map(m => ({ name: m.name, type: m.type }));
}

/** Set a morph weight for a model (0..1). */
export function setModelMorphWeight(id: string, morphName: string, weight: number): void {
    const inst = modelRegistry.get(id);
    if (!inst?.mmdModel?.morph) return;
    inst.mmdModel.morph.setMorphWeight(morphName, weight);
}

/** Get a morph weight for a model. */
export function getModelMorphWeight(id: string, morphName: string): number {
    const inst = modelRegistry.get(id);
    if (!inst?.mmdModel?.morph) return 0;
    return inst.mmdModel.morph.getMorphWeight(morphName);
}

/** Reset all morph weights to 0. */
export function resetModelMorphs(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst?.mmdModel?.morph) return;
    inst.mmdModel.morph.resetMorphWeights();
}

// ======== Auto-restore ========
export async function tryRestoreLastScene(): Promise<void> {
    try {
        const json = await LoadLastScene();
        if (!json) return;
        const data = JSON.parse(json);
        if (data && data.version === 1) {
            await deserializeScene(data);
            console.log("Auto-restored last scene");
        }
    } catch (err) {
        // No saved scene or corrupt — silent
    }
}

// ======== Environment System (Phase 8) ========

interface EnvSkyResources {
    skyMesh: Mesh | null;
    envTexture: BaseTexture | null;
    gradientMesh: Mesh | null;
}

const _envSys: {
    sky: EnvSkyResources;
    ground: { mesh: Mesh | null };
    particles: { emitter: any | null; update: (() => void) | null };
    clouds: { postProcess: any | null };
    shadow: { generator: any | null };
    wind: { lastUpdate: number };
} = {
    sky: { skyMesh: null, envTexture: null, gradientMesh: null },
    ground: { mesh: null },
    particles: { emitter: null, update: null },
    clouds: { postProcess: null },
    shadow: { generator: null },
    wind: { lastUpdate: 0 },
};

function _disposeSky(): void {
    if (_envSys.sky.skyMesh) {
        _envSys.sky.skyMesh.dispose();
        _envSys.sky.skyMesh = null;
    }
    if (_envSys.sky.gradientMesh) {
        _envSys.sky.gradientMesh.dispose();
        _envSys.sky.gradientMesh = null;
    }
    if (_envSys.sky.envTexture) {
        _envSys.sky.envTexture.dispose();
        _envSys.sky.envTexture = null;
        scene.environmentTexture = null;
    }
}

function _createGradientSky(state: EnvState): void {
    const skySphere = MeshBuilder.CreateSphere("envSkySphere", {
        diameter: 1000,
        segments: 24,
        sideOrientation: Mesh.BACKSIDE,
    }, scene);
    skySphere.isPickable = false;
    skySphere.renderingGroupId = 0;

    const mat = new GradientMaterial("envSkyGradient", scene);
    mat.topColor = new Color3(
        state.skyColorTop[0],
        state.skyColorTop[1],
        state.skyColorTop[2],
    );
    mat.bottomColor = new Color3(
        state.skyColorBot[0],
        state.skyColorBot[1],
        state.skyColorBot[2],
    );
    mat.offset = 0.3;
    skySphere.material = mat;

    _envSys.sky.skyMesh = skySphere;
    scene.clearColor = new Color4(
        state.skyColorBot[0],
        state.skyColorBot[1],
        state.skyColorBot[2],
        1,
    );
}

function _loadEnvTexture(path: string, rotationY: number, intensity: number): void {
    const ext = path.split(".").pop()?.toLowerCase();
    let tex: BaseTexture;
    if (ext === "dds") {
        tex = new CubeTexture(path, scene);
    } else {
        tex = new Texture(path, scene, false, true);
    }
    scene.environmentTexture = tex;
    scene.environmentIntensity = intensity;

    if (tex instanceof CubeTexture) {
        tex.rotationY = rotationY;
    }

    _envSys.sky.envTexture = tex;
    scene.clearColor = new Color4(0, 0, 0, 1);
}

function _createProceduralSky(state: EnvState): void {
    const skybox = MeshBuilder.CreateBox("envSkyBox", {
        size: 1000,
        sideOrientation: Mesh.BACKSIDE,
    }, scene);
    skybox.isPickable = false;

    const skyMat = new SkyMaterial("envSkyMat", scene);
    skyMat.backFaceCulling = false;
    skyMat.luminance = state.skyBrightness;
    skyMat.turbidity = 10;
    skyMat.rayleigh = 2;

    // Sun always above horizon; derive azimuth from direction light XY, keep Y positive
    const ls = getLightState();
    const sunDir = new Vector3(ls.dirX, 0.5, ls.dirZ).normalize();
    skyMat.sunPosition = sunDir.scale(100);

    skybox.material = skyMat;
    _envSys.sky.skyMesh = skybox;
    scene.clearColor = new Color4(0, 0, 0, 1);
}

function _applySky(state: EnvState): void {
    // Color mode: always just clearColor (no mesh)
    if (state.skyMode === "color") {
        _disposeSky();
        scene.clearColor = new Color4(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2], 1);
        return;
    }

    // Gradient mode — in-place material update if mesh exists
    if (state.skyMode === "gradient") {
        if (_envSys.sky.skyMesh?.material instanceof GradientMaterial) {
            const mat = _envSys.sky.skyMesh.material;
            mat.topColor = new Color3(state.skyColorTop[0], state.skyColorTop[1], state.skyColorTop[2]);
            mat.bottomColor = new Color3(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2]);
            scene.clearColor = new Color4(state.skyColorBot[0], state.skyColorBot[1], state.skyColorBot[2], 1);
            return;
        }
    }

    // Procedural mode — in-place material update if mesh exists
    if (state.skyMode === "procedural") {
        if (_envSys.sky.skyMesh?.material instanceof SkyMaterial) {
            const mat = _envSys.sky.skyMesh.material as SkyMaterial;
            mat.luminance = state.skyBrightness;
            return;
        }
    }

    // Full rebuild (mode switch or first-time setup)
    _disposeSky();

    switch (state.skyMode) {
        case "gradient": {
            _createGradientSky(state);
            break;
        }
        case "texture": {
            if (state.skyTexture) {
                _loadEnvTexture(state.skyTexture, state.skyRotationY, state.envIntensity);
            }
            break;
        }
        case "procedural": {
            _createProceduralSky(state);
            break;
        }
    }
}

function _applyCheckerGround(ground: Mesh, state: EnvState): void {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const tileSize = 16;
    for (let y = 0; y < 128; y += tileSize) {
        for (let x = 0; x < 128; x += tileSize) {
            const isWhite = ((x / tileSize) + (y / tileSize)) % 2 === 0;
            const bright = isWhite ? 1 : 0.6;
            const r = Math.round(state.groundColor[0] * bright * 255);
            const g = Math.round(state.groundColor[1] * bright * 255);
            const b = Math.round(state.groundColor[2] * bright * 255);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x, y, tileSize, tileSize);
        }
    }
    const tex = new Texture("data:image/png;base64," + canvas.toDataURL(), scene);
    const mat = new StandardMaterial("envGroundChecker", scene);
    mat.diffuseTexture = tex;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.alpha = state.groundAlpha;
    mat.backFaceCulling = false;
    ground.material = mat;
}

function _applyGround(state: EnvState): void {
    if (_envSys.ground.mesh) {
        _envSys.ground.mesh.dispose();
        _envSys.ground.mesh = null;
    }
    if (!state.groundVisible) return;

    const ground = MeshBuilder.CreateGround("envGround", {
        width: 60,
        height: 60,
        subdivisions: 2,
    }, scene);
    ground.isPickable = false;
    ground.position.y = -0.05;

    if (state.groundMode === "grid") {
        const mat = new GridMaterial("envGroundMat", scene);
        mat.gridRatio = 1;
        mat.mainColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2],
        );
        mat.lineColor = new Color3(
            state.groundColor[0] * 1.5,
            state.groundColor[1] * 1.5,
            state.groundColor[2] * 1.5,
        );
        mat.backFaceCulling = false;
        ground.material = mat;
    } else if (state.groundMode === "checker") {
        _applyCheckerGround(ground, state);
    } else {
        const mat = new StandardMaterial("envGroundMat", scene);
        mat.diffuseColor = new Color3(
            state.groundColor[0],
            state.groundColor[1],
            state.groundColor[2],
        );
        mat.alpha = state.groundAlpha;
        mat.backFaceCulling = false;
        ground.material = mat;
    }

    _envSys.ground.mesh = ground;
}

// ======== Particle System (Phase 8) ========

function _getParticleTexture(): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    return new Texture("data:image/png;base64," + canvas.toDataURL(), scene);
}

function _createParticleEmitter(type: EnvState["particleType"], windEnabled: boolean): void {
    _disposeParticles();

    if (type === "none") return;

    const particleTexture = _getParticleTexture();

    const ps = new GPUParticleSystem("envParticles", { capacity: 5000 }, scene);

    ps.particleTexture = particleTexture;
    ps.emitter = new Vector3(0, 10, 0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.updateSpeed = 0.01;

    switch (type) {
        case "sakura":
            ps.emitRate = 30;
            ps.gravity = new Vector3(0, -0.5, 0);
            ps.minLifeTime = 8;
            ps.maxLifeTime = 15;
            ps.direction1 = new Vector3(-0.5, 0, -0.5);
            ps.direction2 = new Vector3(0.5, 0, 0.5);
            ps.color1 = new Color4(1, 0.8, 0.8, 1);
            ps.color2 = new Color4(1, 0.9, 0.9, 1);
            ps.minSize = 0.1;
            ps.maxSize = 0.3;
            break;
        case "rain":
            ps.emitRate = 800;
            ps.gravity = new Vector3(0, -20, 0);
            ps.minLifeTime = 1;
            ps.maxLifeTime = 2;
            ps.direction1 = new Vector3(-0.1, -1, -0.1);
            ps.direction2 = new Vector3(0.1, -1, 0.1);
            ps.color1 = new Color4(0.7, 0.8, 1, 0.6);
            ps.color2 = new Color4(0.8, 0.9, 1, 0.8);
            ps.minSize = 0.01;
            ps.maxSize = 0.03;
            break;
        case "snow":
            ps.emitRate = 200;
            ps.gravity = new Vector3(0, -2, 0);
            ps.minLifeTime = 5;
            ps.maxLifeTime = 10;
            ps.direction1 = new Vector3(-0.3, -0.5, -0.3);
            ps.direction2 = new Vector3(0.3, -0.5, 0.3);
            ps.color1 = new Color4(1, 1, 1, 0.8);
            ps.color2 = new Color4(1, 1, 1, 1);
            ps.minSize = 0.05;
            ps.maxSize = 0.15;
            break;
        case "fireworks":
            ps.emitRate = 5;
            ps.gravity = new Vector3(0, 0, 0);
            ps.minLifeTime = 0.5;
            ps.maxLifeTime = 2;
            ps.direction1 = new Vector3(-2, 3, -2);
            ps.direction2 = new Vector3(2, 5, 2);
            ps.color1 = new Color4(1, 0.5, 0.2, 1);
            ps.color2 = new Color4(1, 0.8, 0.5, 1);
            ps.minSize = 0.1;
            ps.maxSize = 0.3;
            ps.createSphereEmitter(0.5);
            break;
    }

    if (windEnabled) {
        _applyWindToParticles(ps);
    }

    _envSys.particles.emitter = ps;
}

function _disposeParticles(): void {
    if (_envSys.particles.emitter) {
        _envSys.particles.emitter.dispose();
        _envSys.particles.emitter = null;
    }
}

// ======== Wind System (Phase 8) ========

function _applyWindToParticles(ps: GPUParticleSystem): void {
    const dir = envState.windDirection;
    const speed = envState.windSpeed;
    ps.direction1.addInPlace(new Vector3(dir[0] * speed * 0.1, dir[1] * speed * 0.1, dir[2] * speed * 0.1));
    ps.direction2.addInPlace(new Vector3(dir[0] * speed * 0.1, dir[1] * speed * 0.1, dir[2] * speed * 0.1));
}

// ======== Clouds (Phase 8) ========

function _createClouds(state: EnvState): void {
    _disposeClouds();

    if (!state.cloudsEnabled) return;

    const cloudPlane = MeshBuilder.CreatePlane("envClouds", {
        width: 200,
        height: 200,
    }, scene);
    cloudPlane.isPickable = false;
    cloudPlane.position = new Vector3(0, 30, 0);
    cloudPlane.rotation.x = Math.PI / 2;

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(256, 256);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const x = (i / 4) % 256;
        const y = Math.floor((i / 4) / 256);
        const n = Math.random();
        imgData.data[i] = 255;
        imgData.data[i + 1] = 255;
        imgData.data[i + 2] = 255;
        imgData.data[i + 3] = n > state.cloudCover ? 0 : Math.floor(n * 255 * 0.5);
    }
    ctx.putImageData(imgData, 0, 0);

    const tex = new Texture("data:image/png;base64," + canvas.toDataURL(), scene);
    const mat = new StandardMaterial("envCloudMat", scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.5;

    cloudPlane.material = mat;
    cloudPlane.scaling.x = state.cloudScale;
    cloudPlane.scaling.z = state.cloudScale;

    _envSys.clouds.postProcess = cloudPlane;

    // Ensure per-frame wind drift for clouds
    _ensureEnvUpdateObserver();
}

function _disposeClouds(): void {
    if (_envSys.clouds.postProcess) {
        if (_envSys.clouds.postProcess instanceof Mesh) {
            _envSys.clouds.postProcess.dispose();
        }
        _envSys.clouds.postProcess = null;
    }
}

let _envUpdateObserver: any = null;
function _ensureEnvUpdateObserver(): void {
    if (_envUpdateObserver) return;
    _envUpdateObserver = scene.onBeforeRenderObservable.add(() => {
        // Cloud wind drift
        if (envState.cloudsEnabled && envState.windEnabled) {
            const cloud = _envSys.clouds.postProcess;
            if (cloud instanceof Mesh) {
                cloud.position.x += envState.windDirection[0] * envState.windSpeed * 0.01;
                cloud.position.z += envState.windDirection[2] * envState.windSpeed * 0.01;
            }
        }
    });
}
