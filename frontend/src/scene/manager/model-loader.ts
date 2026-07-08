// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { SaveThumbnail } from '@/core/wails-bindings';
import {
    dom,
    setStatus,
    setFocusedModelId,
    pendingVmd,
    setPendingVmd,
    ModelInstance,
    PropInstance,
    propRegistry,
    overridePaths,
    libraryRoot,
    triggerAutoSave,
    formatError,
    uiState,
    type RuntimeModel,
} from '@/core/config';
import { resolveFileUrl, normPath } from '@/core/fileservice';
import { t } from '@/core/i18n/t';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { loadVMDMotion } from '../motion/vmd-loader';
import { _capture } from './material';
import { rebuildShadowCasters } from '../render/lighting';
import { getGroundHeightAt, setOnTerrainReady } from '../env/env-impl';

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
    // 地形（heightmap）加载完成后，把所有已加载模型重新贴合到起伏地面
    setOnTerrainReady(() => {
        if (!_modelManager) {
            return;
        }
        for (const inst of _modelManager.getAll()) {
            const root = inst.rootMesh;
            if (root) {
                root.position.y = getGroundHeightAt(root.position.x, root.position.z);
            }
        }
    });
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
    let loadedMeshes: Mesh[] = [];
    let wasmModel: IMmdModel | null = null;
    let registeredId: string | null = null;
    try {
        // Check if already loaded — switch focus via ModelManager
        const existing = _modelManager?.findByFilePath(filePath);
        if (existing) {
            setFocusedModelId(existing.id);
            _modelManager?.focus(existing.id);
            setStatus(t('scene.loader.switched', { name: existing.name }), true);
            return existing.id;
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = normPath(filePath).split('/').pop() || '';

        setStatus(t('scene.loader.loading'), false);
        dom.loadingEl.style.display = 'block';
        dom.loadingText.textContent = t('scene.loader.loadingZero');

        // Keep a reference so we can clean up meshes on failure
        // [doc:adr-057] URL 使用 ?f=base64url 形式无扩展名，需显式指定 pluginExtension
        // 否则 SceneLoader 无法识别文件类型，回退到 JSON 解析导致 importMesh has failed JSON parse
        const result = await ImportMeshAsync(url, _scene, {
            pluginExtension: '.pmx',
            onProgress: (evt) => {
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = t('scene.loader.loadingProgress', { pct });
                }
            },
        });
        loadedMeshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];

        dom.loadingEl.style.display = 'none';

        const meshes = loadedMeshes;
        if (meshes.length === 0) {
            setStatus(t('scene.loader.noMeshes'), false);
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
            setStatus(t('scene.loader.stageLoaded', { name: displayName }), true);
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
            physicsEnabled: uiState.defaultPhysicsEnabled !== false,
            scaling: 1.0,
            rotationY: 0,
        };
        // 默认模型自动缩放：按统一目标高度归一化（仅 actor）
        if (uiState.autoScaleModel) {
            const bb = rootMesh.getHierarchyBoundingVectors(true);
            const h = bb.max.y - bb.min.y;
            if (h > 1e-3) {
                inst.scaling = 18 / h;
            }
        }
        // Register via ModelManager only — it owns the registry
        // Must register BEFORE VMD load because loadVMDMotion queries modelRegistry
        _modelManager.register(inst);
        registeredId = id;
        // 贴地：把模型根节点放到当前地面高度（heightmap 模式=真实起伏，其他模式=groundLevel）。
        // 地形尚未就绪时回退 groundLevel；地形 onReady 后会回调重新贴地所有模型。
        if (inst.rootMesh) {
            inst.rootMesh.position.y = getGroundHeightAt(
                inst.rootMesh.position.x,
                inst.rootMesh.position.z
            );
        }
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

        // 道具路径下的模型同时注册到 propRegistry（兼容灯光/阴影/序列化）
        const propDir = (
            overridePaths.prop || (libraryRoot ? libraryRoot + '/prop' : '')
        ).toLowerCase();
        if (propDir && filePath.toLowerCase().startsWith(propDir)) {
            const rootMesh = inst.meshes[0];
            propRegistry.set(id, {
                id,
                name: displayName,
                filePath,
                port,
                modelDir,
                meshes: inst.meshes,
                rootMesh,
                position: [0, 0, 0],
                rotationY: 0,
                scaling: 1.0,
                visible: true,
            });
        }

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
                setStatus(t('scene.loader.vmdFailedModelLoaded', { name: displayName }), false);
            }
        }

        _modelManager.focus(id);
        setStatus(
            appliedVmd
                ? t('scene.loader.actorLoadedWithVmd', { name: displayName, vmd: appliedVmd })
                : t('scene.loader.actorLoaded', { name: displayName }),
            true
        );
        _modelManager.arrange();
        _refreshWaterRenderList();
        rebuildShadowCasters();

        // Auto-capture thumbnail for future popup display
        captureThumbnail(filePath).catch(() => {});
        if (!skipAutoApply) {
            _tryAutoApplyPreset(id).catch((err: unknown) =>
                console.warn('auto-apply preset:', err)
            );
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
        setStatus(t('scene.loader.loadFailed', { error: formatError(err) }), false);
        return null;
    } finally {
        dom.loadingEl.style.display = 'none';
    }
}
