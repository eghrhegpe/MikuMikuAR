// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import { renderInstanceThumbnail } from './thumbnail-capture';
import { thumbnailBaseKey } from './thumbnail-key';
import {
    dom,
    setStatus,
    setFocusedModelId,
    ModelInstance,
    propRegistry,
    overridePaths,
    libraryRoot,
    triggerAutoSave,
    formatError,
    uiState,
    type RuntimeModel,
} from '@/core/config';
import { getBaseName, swallowError, isUnderRoot } from '@/core/utils';
import { logWarn } from '@/core/logger';
import { getActiveMotion, getMotionGen, resolveCompatibility } from '../motion/motion-intent';
import { createDefaultFeetState } from '@/core/state';
import { resolveModelDir } from '@/core/fileservice';
import { readFileBytes, ListDirRecursive } from '@/core/wails-bindings';
import type { FileInfo } from '@/core/wails-bindings';
import { t } from '@/core/i18n/t';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { retryWindPhysicsSubscription } from '../../physics/wind-physics';
import { _capture } from './material';
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Promise timeout after ${timeoutMs}ms`)),
            timeoutMs
        );
        promise.then(
            (result) => {
                clearTimeout(timer);
                resolve(result);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

/** Captures a screenshot after model load for thumbnail cache.
 *  使用离屏渲染目标 + 独立相机，完全不触碰主相机，避免与用户操作冲突。
 *  @param filePath 解压后的临时路径或文件路径
 *  @param libraryPath 库引用路径（zip包路径或文件路径）
 *  @param innerPath zip内部相对路径（用于区分同一zip内的不同模型）
 *  @param inst 可选：指定模型实例截图，不传则截当前聚焦模型
 */
export async function captureThumbnail(
    filePath: string,
    libraryPath?: string,
    innerPath?: string,
    inst?: ModelInstance
): Promise<void> {
    const gen = ++_thumbCaptureGen;
    // [fix:thumbnail-physics] 提前解析目标实例并冻结物理，防止 whenReadyAsync / rAF
    // 等待期间 WASM Bullet 推进物理，导致缩略图捕捉到裙子/头发飞行中的过渡态。
    // renderInstanceThumbnail 内部的 freeze 变为 no-op（已是全 0），
    // 由本函数 finally 统一恢复原始状态。
    let savedPhysStates: Uint8Array | null = null;
    let targetInst: ModelInstance | null = null;
    try {
        if (!_scene || !_modelManager) {
            return;
        }

        targetInst = inst ?? _modelManager.focused();
        if (!targetInst || !targetInst.rootMesh) {
            return;
        }

        // 立即冻结物理（render 前的任何异步间隙都无法推进）
        const mmdModel = targetInst.mmdModel;
        const physStates = mmdModel?.rigidBodyStates ?? null;
        if (physStates) {
            savedPhysStates = new Uint8Array(physStates);
            physStates.fill(0);
        }

        let ready = false;
        try {
            await withTimeout(
                _scene.whenReadyAsync().then(() => {
                    ready = true;
                }),
                THUMBNAIL_TIMEOUT_MS
            );
        } catch {
            // 超时直接抛错，不静默降级
            return;
        }
        if (gen !== _thumbCaptureGen) {
            return;
        }

        if (!ready) {
            await new Promise((r) => requestAnimationFrame(r));
        }
        if (gen !== _thumbCaptureGen) {
            return;
        }

        const thumbKey = thumbnailBaseKey({ libraryPath, filePath, innerPath });

        // 复用共享的离屏 RT 渲染（pmx 与动作缩略图共用，见 thumbnail-capture.ts）。
        // 截的是模型加载瞬间的当前姿态（静止/T-pose），动画不推进。
        await renderInstanceThumbnail(_scene, targetInst, thumbKey);
    } catch (err) {
        logWarn('model-loader', 'captureThumbnail:', err);
    } finally {
        // 恢复物理到冻结前的状态。
        // 注意：physStates 是 WASM 内存视图；await 期间若新模型加载触发
        // memory.grow()，旧视图会 detach → 必须用当前 model 重新取视图再写回。
        if (savedPhysStates && targetInst) {
            const fresh = targetInst.mmdModel?.rigidBodyStates ?? null;
            if (fresh && fresh.byteLength === savedPhysStates.byteLength) {
                fresh.set(savedPhysStates);
            }
        }
    }
}

// ======== PMX Loading ========

/** @internal — matches babylon-mmd's IArrayBufferFile for referenceFiles */
interface TextureFile {
    readonly relativePath: string;
    readonly mimeType: string | undefined;
    readonly data: ArrayBuffer;
}

const TEXTURE_EXTS = /\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff)$/i;

function getMimeType(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase();
    const map: Record<string, string | undefined> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        bmp: 'image/bmp',
        tga: 'image/x-tga',
        dds: 'image/vnd-ms.dds',
        tif: 'image/tiff',
        tiff: 'image/tiff',
    };
    return map[ext ?? ''] ?? 'application/octet-stream';
}

/** Collect texture files from model directory (recursive) for referenceFiles. */
async function collectTextureFiles(modelDir: string): Promise<TextureFile[]> {
    const files: TextureFile[] = [];
    try {
        const entries = await ListDirRecursive(modelDir);
        if (!entries) {
            return files;
        }
        for (const entry of entries) {
            if (!TEXTURE_EXTS.test(entry.name)) {
                continue;
            }
            const data = await readFileBytes(modelDir + '/' + entry.relativePath);
            if (!data) {
                continue;
            }
            files.push({
                relativePath: entry.relativePath,
                mimeType: getMimeType(entry.name),
                data: data.buffer as ArrayBuffer,
            });
        }
    } catch (err) {
        logWarn('model-loader', 'texture scan failed, falling back to HTTP:', err);
    }
    return files;
}

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
    const effectiveSignal = signal ? AbortSignal.any([signal, abortCtrl.signal]) : abortCtrl.signal;

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

        const modelDir = await resolveModelDir(filePath);
        const fileName = getBaseName(filePath) || '';

        setStatus(t('scene.loader.loading'), false);
        dom.loadingEl.style.display = 'block';
        dom.loadingText.textContent = t('scene.loader.loadingZero');

        // [doc:adr-124] Phase 2: 递归收集模型目录下纹理 → referenceFiles 直传 babylon-mmd
        const textureFiles = await collectTextureFiles(modelDir);

        const pmxBytes = await readFileBytes(filePath);
        if (!pmxBytes || effectiveSignal.aborted) {
            return null;
        }
        const result = await (ImportMeshAsync as any)(pmxBytes, _scene, {
            pluginExtension: '.pmx',
            pluginOptions: {
                mmdmodel: {
                    referenceFiles: textureFiles as unknown as File[],
                },
            },
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
                    m.dispose(false, true);
                } catch {
                    logWarn('model-loader', 'dispose after abort failed');
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
                libraryPath,
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
                rotation: [0, 0, 0],
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
            // [fix:thumbnail-defer] setTimeout 0 推迟到下一事件循环，避免阻塞主线程
            setTimeout(() => {
                swallowError(captureThumbnail(filePath, libraryPath, innerPath, inst));
            }, 0);
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
            libraryPath,
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
            rotation: [0, 0, 0],
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
        // [adr-XX per-motion] 加载继承：注册前记录"上一个角色"，注册后继承槽位1 策略
        const prevInst =
            _modelManager && _modelManager.getAll().length > 0
                ? _modelManager.getAll()[_modelManager.getAll().length - 1]
                : null;
        _modelManager.register(inst);
        registeredId = id;
        // [adr-XX per-motion] 继承上一个角色的槽位1 source/procRole（不继承 pinned 快照、overlay）
        if (prevInst && prevInst.motionSlots) {
            const prevPrimary = prevInst.motionSlots.primary;
            if (!inst.motionSlots) {
                inst.motionSlots = {
                    primary: { source: 'inherit', status: 'idle' },
                    overlay: { source: 'inherit', status: 'idle' },
                };
            }
            // 只继承 inherit/procedural（pinned 不继承：快照是 per-model 的，新模型不一定有该动作）
            if (prevPrimary.source === 'inherit' || prevPrimary.source === 'procedural') {
                inst.motionSlots.primary.source = prevPrimary.source;
                if (prevPrimary.procRole) {
                    inst.motionSlots.primary.procRole = prevPrimary.procRole;
                }
            }
        }
        if (effectiveSignal.aborted) {
            // 清理已注册的模型和 wasm 资源，避免泄漏
            try {
                _modelManager.remove(registeredId);
            } catch (e) {
                logWarn('model-loader', 'Cleanup after abort:', e);
            }
            _mmdRuntime.destroyMmdModel(wasmModel);
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
                meshes: inst.meshes,
                rootMesh,
                position: [0, 0, 0],
                rotationY: 0,
                scaling: 1.0,
                visible: true,
            });
        }

        // [doc:adr-121] 应用场景级 activeMotion（继承），替代旧 pendingVmd
        let appliedVmd = '';
        const activeMotion = getActiveMotion();
        const loadGen = getMotionGen(); // 捕获当前 generation，防止异步加载过期
        if (activeMotion && activeMotion.vmdPath && _mmdRuntime) {
            const slots = inst.motionSlots ?? {
                primary: { source: 'inherit' as const, status: 'idle' as const },
                overlay: { source: 'inherit' as const, status: 'idle' as const },
            };
            if (slots.primary.source === 'inherit') {
                // 兼容性检查
                const bones =
                    inst.mmdModel?.runtimeBones?.map((b) => b.name) ??
                    inst.meshes[0]?.skeleton?.bones?.map((b) => b.name) ??
                    [];
                const compat = resolveCompatibility(bones, activeMotion);
                if (!compat.compatible) {
                    inst.motionSlots = {
                        primary: { ...slots.primary, status: 'incompatible' },
                        overlay: slots.overlay,
                    };
                } else {
                    appliedVmd = activeMotion.vmdName;
                    try {
                        // 读取 VMD 文件数据，然后加载到模型
                        // 读取后检查 generation：若已过期则丢弃，避免覆盖较新的广播结果
                        const vmdData = await readFileBytes(activeMotion.vmdPath);
                        if (getMotionGen() !== loadGen) {
                            appliedVmd = '';
                        } else {
                            const { loadVMDMotion } = await import('../motion/vmd-loader');
                            await loadVMDMotion(
                                vmdData.buffer as ArrayBuffer,
                                activeMotion.vmdName,
                                id
                            );
                            inst.motionSlots = {
                                primary: { source: 'inherit', status: 'compatible' },
                                overlay: slots.overlay,
                            };
                        }
                    } catch (vmdErr) {
                        if (getMotionGen() !== loadGen) {
                            appliedVmd = '';
                        } else {
                            logWarn('model-loader', 'VMD 加载失败，模型已保留:', vmdErr);
                            appliedVmd = '';
                            setStatus(
                                t('scene.loader.vmdFailedModelLoaded', { name: displayName }),
                                false
                            );
                            inst.motionSlots = {
                                primary: { source: 'inherit', status: 'incompatible' },
                                overlay: slots.overlay,
                            };
                        }
                    }
                }
            }
        }
        if (effectiveSignal.aborted) {
            // 清理已注册的模型和 wasm 资源，避免泄漏
            try {
                _modelManager.remove(registeredId);
            } catch (e) {
                logWarn('model-loader', 'Cleanup after abort:', e);
            }
            _mmdRuntime.destroyMmdModel(wasmModel);
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
        // 与 stage 分支(330 行)对称:显式传 inst,避免依赖 _modelManager.focused() 的竞态兜底
        // (focused() 在加载时序波动时返回 null/错位实例 → 早退 → 缩略图间歇 miss = 历史反弹根因)。
        // [fix:thumbnail-defer] setTimeout 0 推迟到下一事件循环，避免 canvas.toDataURL()
        // 同步 PNG 编码阻塞主线程 0.5–2s（用户看到模型渲染后仍卡顿）。
        setTimeout(() => {
            swallowError(captureThumbnail(filePath, libraryPath, innerPath, inst));
        }, 0);
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
                    m.dispose(false, true);
                } catch {
                    logWarn('model-loader', 'dispose after error failed');
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
