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
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";

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
import { initCameraSystem, autoFrame, getCameraState, setCameraState, animateCameraVmd, loadCameraVmd, clearCameraVmd, hasCameraVmd, getCameraVmdName, getCameraVmdPath, switchCameraMode } from "./camera";
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
} from "./config";
import { resolveFileUrl, normPath } from "./fileservice";
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
}

export const hemiLight = new HemisphericLight("hemi", new Vector3(0.5, 1, 0.5), scene);
hemiLight.intensity = 0.8;
hemiLight.diffuse = new Color3(1, 1, 1);
hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

export const dirLight = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.5), scene);
dirLight.intensity = 0.4;
dirLight.position = new Vector3(20, 40, 20);

export function getLightState(): LightState {
    return {
        hemiIntensity: hemiLight.intensity,
        dirIntensity: dirLight.intensity,
        dirX: dirLight.direction.x,
        dirY: dirLight.direction.y,
        dirZ: dirLight.direction.z,
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
        toneMapping: scene.imageProcessingConfiguration?.toneMappingType ?? 0,
        exposure: scene.imageProcessingConfiguration?.exposure ?? 1,
        contrast: scene.imageProcessingConfiguration?.contrast ?? 1,
        fov: cam ? (cam as any).fov ?? 0.8 : 0.8,
        bgColor: [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b],
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

    // Stage / imageProcessing
    if (scene.imageProcessingConfiguration) {
        if (s.toneMapping !== undefined) scene.imageProcessingConfiguration.toneMappingType = s.toneMapping;
        if (s.exposure !== undefined) scene.imageProcessingConfiguration.exposure = s.exposure;
        if (s.contrast !== undefined) scene.imageProcessingConfiguration.contrast = s.contrast;
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

    const ground = CreateGround("ground", { width: 30, height: 30, subdivisions: 1 }, scene);
    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new Color3(0.15, 0.15, 0.18);
    groundMat.alpha = 0.6; groundMat.backFaceCulling = false;
    ground.material = groundMat; ground.position.y = -0.05;
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
                meshes, vmdData: null, vmdName: "", vmdPath: null,
                animationDuration: 0, kind: "stage",
                visible: true, opacity: 1.0, wireframe: false,
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
            meshes, mmdModel: wasmModel, vmdData: null, vmdName: "", vmdPath: null,
            animationDuration: 0, kind: "actor",
            visible: true, opacity: 1.0, wireframe: false,
            scaling: 1.0, rotationY: 0,
        };
        modelRegistry.set(id, inst);
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

// ======== Model Lifecycle ========
export function removeModel(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    if (inst.mmdModel && mmdRuntime) { try { mmdRuntime.destroyMmdModel(inst.mmdModel); } catch (e) { console.warn("removeModel: destroyMmdModel failed", e); } }
    for (const m of inst.meshes) { if (m instanceof Mesh) m.dispose(); }
    modelRegistry.delete(id);
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

// ======== Init Save/Load UI ========
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
