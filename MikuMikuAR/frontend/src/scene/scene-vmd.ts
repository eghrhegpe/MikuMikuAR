// [doc:architecture] SceneVMD — VMD/动作加载子模块
// 职责: 从 scene.ts 拆出的 VMD 加载/播放入口
// 依赖: config.ts + scene.ts (懒加载避免循环依赖)

import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
import { MmdWasmAnimation } from "babylon-mmd/esm/Runtime/Optimized/Animation/mmdWasmAnimation";
import {
    mmdRuntime, modelRegistry, focusedModelId,
    isPlaying, autoLoop, isLoadingVmd,
    setIsLoadingVmd, setPendingVmd, setIsPlaying, setStatus,
} from "../core/config";
import { resolveFileUrl, normPath } from "../core/fileservice";
import { loadVPDFromBuffer } from "../motion/vpd-parser";
import { loadCameraVmd } from "./camera";

// Dynamic re-import of scene.ts to access its module-level state
// (scene, focusedMmdModel, focusedModel, procVmdActive, stopProcMotion)
// without creating a static circular dependency.
function getScene() {
    return import("./scene") as Promise<typeof import("./scene")>;
}

// ======== VMD Loading ========
export async function loadVMDMotion(data: ArrayBuffer, name: string, targetModelId?: string): Promise<void> {
    const { scene, focusedMmdModel, procVmdActive, stopProcMotion, focusedModel } = await getScene();
    // If user loads a real VMD, stop procedural motion
    if (procVmdActive && name !== "IdleMotion" && name !== "AutoDance") {
        stopProcMotion();
    }
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
    const { focusedMmdModel, focusedModel } = await getScene();
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
    const { scene } = await getScene();
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
    const { focusedModel } = await getScene();
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
