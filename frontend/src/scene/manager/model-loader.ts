// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
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
    thumbnailCache,
    setThumbnailCache,
    type RuntimeModel,
} from '@/core/config';
import { getBaseName, swallowError, logWarn } from '@/core/utils';
import { createDefaultFeetState } from '@/core/state';
import { resolveFileUrl, normPath } from '@/core/fileservice';
import { isUnderRoot } from '@/core/utils';
import { t } from '@/core/i18n/t';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { loadVMDMotion } from '../motion/vmd-loader';
import { retryWindPhysicsSubscription } from '../../physics/wind-physics';
import { _capture, disposeModelMaterialState } from './material';
import { rebuildShadowCasters } from '../render/lighting';
import { getGroundHeightAt, setOnTerrainReady, setOnGroundChanged } from '../env/env-impl';

// ======== Loader Dependencies ========

let _scene: import('@babylonjs/core/scene').Scene | null = null;
let _mmdRuntime: IMmdRuntime | null = null;
let _modelManager: import('./model-manager').ModelManager | null = null;
let _refreshWaterRenderList: (() => void) | null = null;
let _tryAutoApplyPreset: ((id: string) => Promise<void>) | null = null;
let _loadOutfits: ((id: string) => Promise<void>) | null = null;
let _rebuildOutlineState: (() => void) | null = null;
let _onMeshesReady: ((meshes: Mesh[]) => void) | null = null;
let _onModelLoaded: ((id: string) => void) | null = null;
let _thumbCaptureGen = 0;
let _loadAbortController: AbortController | null = null;

export function setOnMeshesReady(fn: (meshes: Mesh[]) => void): void {
    _onMeshesReady = fn;
}

export function setOnModelLoaded(fn: (id: string) => void): void {
    _onModelLoaded = fn;
}

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
    // 地形（heightmap）加载完成 或 地面高度/坡度变化 → 把所有已加载模型重新贴合到地面
    const reGroundAllModels = (): void => {
        if (!_modelManager) {
            return;
        }
        for (const inst of _modelManager.getAll()) {
            const root = inst.rootMesh;
            if (root) {
                root.position.y = getGroundHeightAt(root.position.x, root.position.z);
            }
        }
    };
    setOnTerrainReady(reGroundAllModels);
    setOnGroundChanged(reGroundAllModels);
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

/** Captures a screenshot after model load for thumbnail cache.
 *  使用离屏渲染目标 + 独立相机，完全不触碰主相机，避免与用户操作冲突。
 *  @param filePath 解压后的临时路径或文件路径
 *  @param libraryPath 库引用路径（zip包路径或文件路径）
 *  @param innerPath zip内部相对路径（用于区分同一zip内的不同模型）
 */
export async function captureThumbnail(
    filePath: string,
    libraryPath?: string,
    innerPath?: string
): Promise<void> {
    const gen = ++_thumbCaptureGen;
    try {
        if (!_scene || !_modelManager) {
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
        if (gen !== _thumbCaptureGen) return;

        if (!ready) {
            await new Promise((r) => requestAnimationFrame(r));
        }
        if (gen !== _thumbCaptureGen) return;

        const focusedInst = _modelManager.focused();
        if (!focusedInst || !focusedInst.rootMesh) {
            return;
        }

        const activeCam = _scene.activeCamera;
        const engine = _scene.getEngine();
        // RTT 尺寸跟随相机（聚焦主相机）宽高比，使投影宽高比与缓冲宽高比一致，
        // 否则「16:9 投影塞进正方缓冲 → 角色横向压缩、视觉被拉高」。
        // 卡片用 background-size:cover / object-fit:cover 再裁切，比例始终正确、绝不拉伸。
        const camAspect = activeCam ? engine.getAspectRatio(activeCam) : 1;
        const rtMax = 512;
        let rtW = rtMax;
        let rtH = rtMax;
        if (camAspect >= 1) {
            rtH = Math.max(1, Math.round(rtMax / camAspect));
        } else {
            rtW = Math.max(1, Math.round(rtMax * camAspect));
        }

        const rt = new RenderTargetTexture('thumbRT', { width: rtW, height: rtH }, _scene, false);
        rt.clearColor = new Color4(0, 0, 0, 0);

        // 沿用主相机（模型加载后已 focus 到该模型，即用户实际聚焦视角），
        // 而非临时 new 一个 FreeCamera 自算 3/4 角 —— RT 渲染只借用相机视角、不会改动主相机。
        // 仅当无活动相机时兜底用包围盒算一个 3/4 视角。
        let thumbCam: FreeCamera | null = null;
        if (activeCam) {
            rt.activeCamera = activeCam;
        } else {
            const bb = focusedInst.rootMesh.getHierarchyBoundingVectors(true);
            const center = bb.max.add(bb.min).scale(0.5);
            const extent = bb.max.subtract(bb.min);
            const size = Math.max(extent.x, extent.y, extent.z);
            const dist = size * 0.8 + 2;
            thumbCam = new FreeCamera('thumbCam', Vector3.Zero(), _scene);
            thumbCam.minZ = 0.1;
            thumbCam.maxZ = 5000;
            thumbCam.position.set(center.x - dist, center.y + dist * 0.5, center.z);
            thumbCam.setTarget(new Vector3(center.x, center.y, center.z));
            rt.activeCamera = thumbCam;
        }

        const renderList: Mesh[] = [];
        focusedInst.rootMesh.getChildMeshes().forEach((m) => {
            if (m.isVisible) {
                renderList.push(m as Mesh);
            }
        });
        if (focusedInst.rootMesh.isVisible) {
            renderList.push(focusedInst.rootMesh);
        }
        rt.renderList = renderList;

        try {
            rt.render();

            // readPixels 读取的是「当前绑定的 framebuffer」。
            // rt.render() 结束会 unBindFramebuffer 回到默认 backbuffer，
            // 必须重新绑定 RTT 自身的 framebuffer 才能读到离屏渲染结果（否则截到的是主场景）。
            engine.bindFramebuffer(rt.renderTarget!);
            try {
                const floatPixels = await engine.readPixels(0, 0, rtW, rtH, true);
                if (gen !== _thumbCaptureGen) return;

                const canvas = document.createElement('canvas');
                canvas.width = rtW;
                canvas.height = rtH;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return;
                }

                const imageData = ctx.createImageData(rtW, rtH);
                // readPixels 返回 Uint8Array（0–255 字节），已是最终像素值，直接拷贝即可。
                // 原代码误当作 Float32Array 再 *255，导致所有非 0 像素被饱和成 255（全白）。
                const pixelsArr = floatPixels as Uint8Array;
                // WebGL framebuffer 原点在左下角，readPixels 行序为「底→顶」；
                // canvas putImageData 原点在左上角，需逐行上下翻转，否则缩略图上下颠倒（倒立）。
                const rowBytes = rtW * 4;
                const flipped = new Uint8Array(pixelsArr.length);
                for (let y = 0; y < rtH; y++) {
                    const srcStart = y * rowBytes;
                    const dstStart = (rtH - 1 - y) * rowBytes;
                    flipped.set(pixelsArr.subarray(srcStart, srcStart + rowBytes), dstStart);
                }
                imageData.data.set(flipped);
                ctx.putImageData(imageData, 0, 0);

                const base64 = canvas.toDataURL('image/png', 0.8);
                const raw = base64.replace(/^data:image\/png;base64,/, '');

                let thumbKey = libraryPath && libraryPath !== filePath ? libraryPath : filePath;
                if (innerPath) {
                    thumbKey = `${thumbKey}::${innerPath}`;
                }

                try {
                    await SaveThumbnail(thumbKey, raw);
                    if (gen !== _thumbCaptureGen) return;
                    const updated = new Map(thumbnailCache);
                    updated.set(thumbKey, raw);
                    setThumbnailCache(updated);
                } catch (saveErr) {
                    logWarn('model-loader', 'SaveThumbnail failed:', saveErr);
                }
            } finally {
                engine.unBindFramebuffer(rt.renderTarget!);
            }
        } finally {
            rt.dispose();
            thumbCam?.dispose();
        }
    } catch (err) {
        logWarn('model-loader', 'captureThumbnail:', err);
    }
}

// ======== PMX Loading ========

export async function loadPMXFile(
    filePath: string,
    asStage?: boolean,
    skipAutoApply?: boolean,
    libraryPath?: string,
    innerPath?: string,
    signal?: AbortSignal
): Promise<string | null> {
    if (!_scene || !_mmdRuntime) {
        return null;
    }
    // 取消之前的加载，避免竞态覆盖
    if (_loadAbortController) {
        _loadAbortController.abort();
    }
    const abortCtrl = new AbortController();
    _loadAbortController = abortCtrl;
    // 合并外部 signal（调用方取消）与内部 abortCtrl.signal（自动取消前一个加载，ADR-096）
    // 两者任一 abort 即生效；用 ?? 回退会忽略内部 abortCtrl，导致 ADR-096 机制失效
    const effectiveSignal = signal
        ? AbortSignal.any([signal, abortCtrl.signal])
        : abortCtrl.signal;

    let loadedMeshes: Mesh[] = [];
    let wasmModel: IMmdModel | null = null;
    let registeredId: string | null = null;
    try {
        // Check if already loaded — switch focus via ModelManager
        const existing = _modelManager?.findByFilePath(filePath);
        if (existing) {
            setFocusedModelId(existing.id);
            _modelManager?.focus(existing.id, uiState.autoCenterModel);
            setStatus(t('scene.loader.switched', { name: existing.name }), true);
            return existing.id;
        }

        const { url, port, dir: modelDir } = await resolveFileUrl(filePath);
        const fileName = getBaseName(filePath) || '';

        setStatus(t('scene.loader.loading'), false);
        dom.loadingEl.style.display = 'block';
        dom.loadingText.textContent = t('scene.loader.loadingZero');

        // Keep a reference so we can clean up meshes on failure
        // [doc:adr-057] URL 使用 ?f=base64url 形式无扩展名，需显式指定 pluginExtension
        // 否则 SceneLoader 无法识别文件类型，回退到 JSON 解析导致 importMesh has failed JSON parse
        const result = await ImportMeshAsync(url, _scene, {
            pluginExtension: '.pmx',
            onProgress: (evt) => {
                if (effectiveSignal.aborted) {
                    return;
                }
                if (evt.lengthComputable) {
                    const pct = Math.round((evt.loaded / evt.total) * 100);
                    dom.loadingText.textContent = t('scene.loader.loadingProgress', { pct });
                }
            },
        });
        if (effectiveSignal.aborted) {
            loadedMeshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];
            loadedMeshes.forEach((m) => {
                try {
                    m.dispose();
                } catch {
                }
            });
            return null;
        }
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
                boneOverrides: [],
                feet: createDefaultFeetState(),
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
            if (_onMeshesReady) {
                try {
                    _onMeshesReady(meshes);
                } catch {
                    // Intentionally empty — renderer 未初始化时忽略
                }
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
            // [fix:thumbnail] stage 同样需要缩略图（库网格含 stage 模型）；用库引用路径作 key
            swallowError(captureThumbnail(filePath, libraryPath, innerPath));
            return id;
        }

        // Actor: create MMD model from the loaded mesh via the runtime
        const rootMesh = meshes[0];
        wasmModel = _mmdRuntime.createMmdModel(rootMesh, {
            materialProxyConstructor: MmdStandardMaterialProxy,
        });

        // [adr-104] 模型创建后 physics impl 已就绪，显式重试风力订阅，
        // 替代原 monkey-patch createMmdModel 的脆弱做法（不再拦截创建路径）
        retryWindPhysicsSubscription(_mmdRuntime);

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
            boneOverrides: [],
            feet: createDefaultFeetState(),
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
        if (effectiveSignal.aborted) {
            return null;
        }
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
        if (_onMeshesReady) {
            try {
                _onMeshesReady(meshes);
            } catch {
                // Intentionally empty — renderer 未初始化时忽略
            }
        }
        if (wasmModel instanceof MmdWasmModel) {
            const states = wasmModel.rigidBodyStates;
            if (states) {
                _modelManager.storeRigidBodyState(id, states);
            }
        }
        setFocusedModelId(id);

        // 加载完成后自动激活默认视线追踪（眼球 + 头部），使配置立即生效
        if (_onModelLoaded) {
            swallowError(Promise.resolve(_onModelLoaded(id)));
        }

        // 道具路径下的模型同时注册到 propRegistry（兼容灯光/阴影/序列化）
        const propDir = (
            overridePaths.prop || (libraryRoot ? libraryRoot + '/prop' : '')
        ).toLowerCase();
        if (isUnderRoot(propDir, filePath)) {
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
                logWarn('model-loader', 'VMD 加载失败，模型已保留:', vmdErr);
                appliedVmd = '';
                setStatus(t('scene.loader.vmdFailedModelLoaded', { name: displayName }), false);
            }
        }
        if (effectiveSignal.aborted) {
            return null;
        }

        _modelManager.focus(id, uiState.autoCenterModel);
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
        swallowError(captureThumbnail(filePath, libraryPath, innerPath));
        if (!skipAutoApply) {
            _tryAutoApplyPreset(id).catch((err: unknown) =>
                logWarn('model-loader', 'auto-apply preset:', err)
            );
        }
        // Pre-load outfit file for UI entry availability
        swallowError(_loadOutfits(id));

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
        if (err instanceof DOMException && err.name === 'AbortError') {
            return null;
        }
        if (registeredId && _modelManager) {
            try {
                _modelManager.remove(registeredId);
            } catch (removeErr) {
                logWarn('model-loader', 'Cleanup after load failure:', removeErr);
            }
        } else {
            if (wasmModel && _mmdRuntime) {
                try {
                    _mmdRuntime.destroyMmdModel(wasmModel);
                } catch (destroyErr) {
                    logWarn('model-loader', 'destroyMmdModel in cleanup:', destroyErr);
                }
            }
            loadedMeshes.forEach((m) => {
                try {
                    m.dispose();
                } catch {
                }
            });
        }
        dom.loadingEl.style.display = 'none';
        console.error('loadPMXFile:', err);
        setStatus(t('scene.loader.loadFailed', { error: formatError(err) }), false);
        return null;
    } finally {
        dom.loadingEl.style.display = 'none';
        if (_loadAbortController === abortCtrl) {
            _loadAbortController = null;
        }
    }
}
