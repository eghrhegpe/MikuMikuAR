// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ImportMeshAsync } from "@babylonjs/core/Loading/sceneLoader";
import { MmdStandardMaterialProxy } from "babylon-mmd/esm/Runtime/mmdStandardMaterialProxy";
import { SaveThumbnail } from "../../wailsjs/go/main/App";
import {
    dom, setStatus,
    setFocusedModelId,
    isPlaying, setIsPlaying, autoLoop,
    isLoadingModel, setIsLoadingModel,
    isLoadingVmd, setIsLoadingVmd, setAutoLoop,
    seekDragging, setSeekDragging,
    pendingVmd, setPendingVmd,
    ModelInstance,
    triggerAutoSave,
} from "../core/config";
import { resolveFileUrl, normPath } from "../core/fileservice";
import type { MmdWasmRuntime } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmRuntime";
import { loadVMDMotion } from "./scene-vmd";

// ======== Loader Dependencies ========

let _scene: import("@babylonjs/core/scene").Scene | null = null;
let _modelRegistry: Map<string, ModelInstance> | null = null;
let _mmdRuntime: MmdWasmRuntime | null = null;
let _modelManager: import("./scene-model").ModelManager | null = null;
let _refreshWaterRenderList: (() => void) | null = null;
let _tryAutoApplyPreset: ((id: string) => Promise<void>) | null = null;
let _loadOutfits: ((id: string) => Promise<void>) | null = null;

export function initLoader(
    scene: import("@babylonjs/core/scene").Scene,
    modelRegistry: Map<string, ModelInstance>,
    mmdRuntime: MmdWasmRuntime,
    modelManager: import("./scene-model").ModelManager,
    refreshWaterRenderList: () => void,
    tryAutoApplyPreset: (id: string) => Promise<void>,
    loadOutfits: (id: string) => Promise<void>,
): void {
    _scene = scene;
    _modelRegistry = modelRegistry;
    _mmdRuntime = mmdRuntime;
    _modelManager = modelManager;
    _refreshWaterRenderList = refreshWaterRenderList;
    _tryAutoApplyPreset = tryAutoApplyPreset;
    _loadOutfits = loadOutfits;
}

// ======== Thumbnail Capture ========

/** Captures a screenshot after model load for thumbnail cache. */
export async function captureThumbnail(filePath: string): Promise<void> {
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

export async function loadPMXFile(
    filePath: string,
    asStage?: boolean,
    skipAutoApply?: boolean,
): Promise<void> {
    if (!_scene || !_modelRegistry || !_mmdRuntime) return;
    if (isLoadingModel) return;
    setIsLoadingModel(true);
    try {
        // Check if already loaded — switch focus
        for (const [id, inst] of _modelRegistry) {
            if (inst.filePath === filePath) {
                setFocusedModelId(id);
                _modelManager?.focus(id);
                setStatus(`✓ 已切换至: ${inst.name}`, true);
                return;
            }
        }

        const { url, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split("/").pop() || "";

        setStatus("加载中...", false);
        dom.loadingEl.style.display = "block";
        dom.loadingText.textContent = "加载中 0%";

        const result = await ImportMeshAsync(url, _scene, {
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
                id, name: displayName, filePath, port: 0, modelDir,
                meshes, rootMesh: meshes[0], vmdData: null, vmdName: "", vmdPath: null,
                animationDuration: 0, kind: "stage",
                visible: true, opacity: 1.0, wireframe: false, showBoneLines: false, showBoneJoints: false, physicsEnabled: false,
                scaling: 1.0, rotationY: 0,
            };
            _modelRegistry.set(id, inst);
            _modelManager?.register(inst);
            setFocusedModelId(id);
            _modelManager?.focus(id);
            setStatus(`✓ ${displayName} (场景)`, true);
            _modelManager?.arrange();
            _refreshWaterRenderList?.();
            return;
        }

        // Actor: create MMD model from the loaded mesh via the runtime
        const rootMesh = meshes[0];
        const wasmModel = _mmdRuntime.createMmdModel(rootMesh, {
            materialProxyConstructor: MmdStandardMaterialProxy,
        });

        const inst: ModelInstance = {
            id, name: displayName, filePath, port: 0, modelDir,
            meshes, rootMesh, mmdModel: wasmModel, vmdData: null, vmdName: "", vmdPath: null,
            animationDuration: 0, kind: "actor",
            visible: true, opacity: 1.0, wireframe: false, showBoneLines: false, showBoneJoints: false, physicsEnabled: true,
            scaling: 1.0, rotationY: 0,
        };
        _modelRegistry.set(id, inst);
        _modelManager?.register(inst);
        if (wasmModel) {
            const states = wasmModel.rigidBodyStates;
            if (states) _modelManager?.storeRigidBodyState(id, states);
        }
        setFocusedModelId(id);

        // Apply pending VMD if any
        let appliedVmd = "";
        if (pendingVmd && _mmdRuntime) {
            const vmdData = pendingVmd.data;
            appliedVmd = pendingVmd.name;
            setPendingVmd(null);
            await loadVMDMotion(vmdData, appliedVmd, id);
        }

        _modelManager?.focus(id);
        setStatus(appliedVmd ? `✓ ${displayName} + ${appliedVmd}` : `✓ ${displayName}`, true);
        _modelManager?.arrange();
        _refreshWaterRenderList?.();

        // Auto-capture thumbnail for future popup display
        captureThumbnail(filePath).catch(() => {});
        if (!skipAutoApply) {
            _tryAutoApplyPreset?.(id).catch((err: any) => console.warn("auto-apply preset:", err));
        }
        // Pre-load outfit file for UI entry availability
        _loadOutfits?.(id).catch(() => {});
    } catch (err) {
        dom.loadingEl.style.display = "none";
        console.error("loadPMXFile:", err);
        setStatus("✗ 模型加载失败", false);
    } finally {
        setIsLoadingModel(false);
        dom.loadingEl.style.display = "none";
    }
}
