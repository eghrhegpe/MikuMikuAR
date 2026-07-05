// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { SaveThumbnail } from '../../core/wails-bindings';
import {
    dom,
    setStatus,
    setFocusedModelId,
    isLoadingModel,
    setIsLoadingModel,
    pendingVmd,
    setPendingVmd,
    ModelInstance,
    triggerAutoSave,
    formatError,
    type RuntimeModel,
} from '../../core/config';
import { resolveFileUrl, normPath } from '../../core/fileservice';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { loadVMDMotion } from '../motion/vmd-loader';
import { _capture } from './material';
import { rebuildShadowCasters } from '../render/lighting';

// ======== Loader Dependencies ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
let _mmdRuntime: IMmdRuntime | null = null;
let _modelManager: import('./model-manager').ModelManager | null = null;
let _refreshWaterRenderList: (() => void) | null = null;
let _tryAutoApplyPreset: ((id: string) => Promise<void>) | null = null;
let _loadOutfits: ((id: string) => Promise<void>) | null = null;
let _rebuildOutlineState: (() => void) | null = null;

export function initLoader(
    scene: import('@babylonjs/core/scene').Scene,
    mmdRuntime: IMmdRuntime,
    modelManager: import('./model-manager').ModelManager,
    refreshWaterRenderList: () => void,
    tryAutoApplyPreset: (id: string) => Promise<void>,
    loadOutfits: (id: string) => Promise<void>,
    rebuildOutlineState?: () => void
): void {
    _scene = scene;
    _mmdRuntime = mmdRuntime;
    _modelManager = modelManager;
    _refreshWaterRenderList = refreshWaterRenderList;
    _tryAutoApplyPreset = tryAutoApplyPreset;
    _loadOutfits = loadOutfits;
    _rebuildOutlineState = rebuildOutlineState ?? null;
}

// ======== Thumbnail Capture ========

const THUMBNAIL_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), timeoutMs);
        promise.then(
            (result) => {
                clearTimeout(timer);
                resolve(result);
            },
            () => {
                clearTimeout(timer);
                resolve(fallback);
            }
        );
    });
}

/** Captures a screenshot after model load for thumbnail cache. */
export async function captureThumbnail(filePath: string): Promise<void> {
    try {
        if (!_scene) {
            return;
        }

        let ready = false;
        await withTimeout(
            _scene.whenReadyAsync().then(() => {
                ready = true;
            }),
            THUMBNAIL_TIMEOUT_MS,
            undefined
        );

        if (!ready) {
            await new Promise((r) => requestAnimationFrame(r));
        }

        const base64 = dom.canvas.toDataURL('image/png', 0.8);
        const raw = base64.replace(/^data:image\/png;base64,/, '');
        await SaveThumbnail(filePath, raw);
    } catch (err) {
        console.warn('captureThumbnail:', err);
    }
}

// ======== PMX Loading ========

export async function loadPMXFile(
    filePath: string,
    asStage?: boolean,
    skipAutoApply?: boolean
): Promise<string | null> {
    if (!_scene || !_mmdRuntime) {
        return null;
    }
    // Single-thread loading lock. Future: replace with a task queue for parallel loading.
    if (isLoadingModel) {
        setStatus('模型正在加载中，请稍候...', false);
        return null;
    }
    setIsLoadingModel(true);
    let loadedMeshes: Mesh[] = [];
    let wasmModel: IMmdModel | null = null;
    let registeredId: string | null = null;
    try {
        // Check if already loaded — switch focus via ModelManager
        const existing = _modelManager?.findByFilePath(filePath);
        if (existing) {
            setFocusedModelId(existing.id);
            _modelManager?.focus(existing.id);
            setStatus(`✓ 已切换至: ${existing.name}`, true);
            return existing.id;
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split('/').pop() || '';

        setStatus('加载中...', false);
        dom.loadingEl.style.display = 'block';
        dom.loadingText.textContent = '加载中 0%';

        // Keep a reference so we can clean up meshes on failure
        const result = await ImportMeshAsync(url, _scene, {
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = `加载中 ${pct}%`;
                }
            },
        });
        loadedMeshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];

        dom.loadingEl.style.display = 'none';

        const meshes = loadedMeshes;
        if (meshes.length === 0) {
            setStatus('✗ 未加载到网格', false);
            return null;
        }

        const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const displayName = fileName.replace(/\.pmx$/i, '');

        if (asStage) {
            // Stage: pure static mesh, no MMD runtime, no physics
            const inst: ModelInstance = {
                id,
                name: displayName,
                filePath,
                port,
                modelDir,
                meshes,
                rootMesh: meshes[0],
                vmdData: null,
                vmdName: '',
                vmdPath: null,
                animationDuration: 0,
                vmdLayers: [],
                kind: 'stage',
                visible: true,
                opacity: 1.0,
                wireframe: false,
                showBoneLines: false,
                showBoneJoints: false,
                physicsEnabled: false,
                scaling: 1.0,
                rotationY: 0,
            };
            // Register via ModelManager only — it owns the registry
            _modelManager.register(inst);
            registeredId = id;
            // Pre-capture material original values for reset functionality
            for (const mesh of meshes) {
                if (mesh.material) {
                    _capture(mesh.material);
                }
            }
            // 绑定 Reflection Probe 到新材料（如果探针已启用）
            try {
                const { bindReflectionProbeToModel } = await import('../render/renderer');
                bindReflectionProbeToModel(meshes);
            } catch {
                // Intentionally empty — renderer 未初始化时忽略
            }
            setFocusedModelId(id);
            _modelManager.focus(id);
            setStatus(`✓ ${displayName} (场景)`, true);
            _modelManager.arrange();
            _refreshWaterRenderList();
            rebuildShadowCasters();
            _rebuildOutlineState?.();
            triggerAutoSave();
            try {
                document.dispatchEvent(new CustomEvent('mmku:modelLoaded'));
            } catch {
                // Intentionally empty — 自定义事件派发失败不影响模型加载主流程
            }
            return id;
        }

        // Actor: create MMD model from the loaded mesh via the runtime
        const rootMesh = meshes[0];
        wasmModel = _mmdRuntime.createMmdModel(rootMesh, {
            materialProxyConstructor: MmdStandardMaterialProxy,
        });

        const inst: ModelInstance = {
            id,
            name: displayName,
            filePath,
            port,
            modelDir,
            meshes,
            rootMesh,
            mmdModel: wasmModel as RuntimeModel,
            vmdData: null,
            vmdName: '',
            vmdPath: null,
            animationDuration: 0,
            vmdLayers: [],
            kind: 'actor',
            visible: true,
            opacity: 1.0,
            wireframe: false,
            showBoneLines: false,
            showBoneJoints: false,
            physicsEnabled: true,
            scaling: 1.0,
            rotationY: 0,
        };
        // Register via ModelManager only — it owns the registry
        // Must register BEFORE VMD load because loadVMDMotion queries modelRegistry
        _modelManager.register(inst);
        registeredId = id;
        // Pre-capture material original values for reset functionality
        for (const mesh of meshes) {
            if (mesh.material) {
                _capture(mesh.material);
            }
        }
        // 绑定 Reflection Probe 到新材料（如果探针已启用）
        try {
            const { bindReflectionProbeToModel } = await import('../render/renderer');
            bindReflectionProbeToModel(meshes);
        } catch {
            // Intentionally empty — renderer 未初始化时忽略
        }
        if (wasmModel instanceof MmdWasmModel) {
            const states = wasmModel.rigidBodyStates;
            if (states) {
                _modelManager.storeRigidBodyState(id, states);
            }
        }
        setFocusedModelId(id);

        // Apply pending VMD if any — failure is isolated, won't roll back model
        let appliedVmd = '';
        if (pendingVmd && _mmdRuntime) {
            const vmdData = pendingVmd.data;
            appliedVmd = pendingVmd.name;
            setPendingVmd(null);
            try {
                await loadVMDMotion(vmdData, appliedVmd, id);
            } catch (vmdErr) {
                console.warn('VMD 加载失败，模型已保留:', vmdErr);
                appliedVmd = '';
                setStatus(`⚠ VMD 加载失败，模型已加载: ${displayName}`, false);
            }
        }

        _modelManager.focus(id);
        setStatus(appliedVmd ? `✓ ${displayName} + ${appliedVmd}` : `✓ ${displayName}`, true);
        _modelManager.arrange();
        _refreshWaterRenderList();
        rebuildShadowCasters();

        // Auto-capture thumbnail for future popup display
        captureThumbnail(filePath).catch(() => {});
        if (!skipAutoApply) {
            _tryAutoApplyPreset(id).catch((err: unknown) => console.warn('auto-apply preset:', err));
        }
        // Pre-load outfit file for UI entry availability
        _loadOutfits(id).catch(() => {});

        // Re-apply outline state so new model gets edge rendering if enabled
        _rebuildOutlineState?.();

        // Notify auto-save that scene state has changed
        triggerAutoSave();

        // Dispatch event so UI layers (e.g. model popup) can refresh
        try {
            document.dispatchEvent(new CustomEvent('mmku:modelLoaded'));
        } catch {
            // Intentionally empty — 自定义事件派发失败不影响模型加载主流程
        }

        return registeredId;
    } catch (err) {
        // 🔴 2: If model was registered, use remove() for clean disposal (handles meshes + cloth)
        // 🟡 3: Destroy leaked MMD runtime model before mesh disposal
        if (wasmModel && _mmdRuntime) {
            try {
                _mmdRuntime.destroyMmdModel(wasmModel);
            } catch (destroyErr) {
                console.warn('destroyMmdModel in cleanup:', destroyErr);
            }
        }
        if (registeredId && _modelManager) {
            try {
                _modelManager.remove(registeredId);
            } catch (removeErr) {
                console.warn('Cleanup after load failure:', removeErr);
            }
        } else {
            // Not yet registered — dispose meshes directly
            loadedMeshes.forEach((m) => {
                try {
                    m.dispose();
                } catch {
                    // Intentionally empty — 清理阶段单个 mesh dispose 失败不影响整体回滚
                }
            });
        }
        dom.loadingEl.style.display = 'none';
        console.error('loadPMXFile:', err);
        setStatus('✗ 模型加载失败: ' + formatError(err), false);
        return null;
    } finally {
        setIsLoadingModel(false);
        dom.loadingEl.style.display = 'none';
    }
}
