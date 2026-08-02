// [doc:architecture] Scene Loader — PMX 模型加载、缩略图捕获
// 职责: 模型文件解析、实例创建、缩略图生成、outfit 预加载
// 注意: 从 scene.ts 静态导入但仅在函数体内访问，ES module live binding 保证安全。

import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { ISceneLoaderAsyncResult } from '@babylonjs/core/Loading/sceneLoader';
// ADR-188: 材质代理解析器（运行时 materialProxyConstructor）
import { getStandardMaterialProxy } from './material-proxy-resolver';
import { renderInstanceThumbnail } from './thumbnail-capture';
import { thumbnailBaseKey } from './thumbnail-key';
import {
    dom,
    setFocusedModelId,
    ModelInstance,
    triggerAutoSave,
    formatError,
    uiState,
    type RuntimeModel,
} from '@/core/config';
import { feedbackStatus } from '@/core/feedback';
import { setStatus } from '@/core/status-bar';
import { showInfoToast } from '@/core/toast';
import type { ModelMotionSlots } from '@/core/types';
import { getBaseName } from '@/core/path';
import { swallowError, fireAndForget } from '@/core/async';
import { resolveModelId } from './model-id';
import { logWarn } from '@/core/logger';
import { parsePmxComment } from '@/core/pmx-meta';
import {
    getActiveMotion,
    getSceneMotions,
    getMotionGen,
    resolveCompatibility,
} from '../motion/motion-intent';
import { resolveModelDir } from '@/core/fileservice';
import { readFileBytes, ListDirRecursive } from '@/core/wails-bindings';
import { readTextureWithLRU } from './texture-lru';
import { auditMissingTextures, parsePmxTexturePaths } from './pmx-texture-audit';
import { textureFallbackCandidates, registerDeclaredAliases } from './texture-fallback';
import { reportResourceWarning } from '@/core/resource-warning-sink';

// [temp:diagnose-eye] 临时诊断：复现「第二个角色看不见眼睛」时查看 dev 控制台（搜索 diagnose-eye）。
// 遍历场景内所有已加载模型，带 modelId 标签，便于对照双模型共存态。确诊根因后删除本函数及其调用点。
function _diagnoseEyeMaterials(): void {
    const models = _modelManager ? _modelManager.getAll() : [];
    const rows: Record<string, unknown>[] = [];
    for (const inst of models) {
        const modelTag = `${inst.id} (visible=${inst.visible}, opacity=${inst.opacity})`;
        for (const mesh of inst.meshes) {
            const mat = mesh.material as
                | (import('@babylonjs/core/Materials/standardMaterial').StandardMaterial & {
                      sphereTexture?: unknown;
                  })
                | null;
            if (!mat) {
                continue;
            }
            const nm = (mat.name || mesh.name || '').toLowerCase();
            if (!/眼|目|eye|iris|瞳|pupil|eyelash|眉|lash|白目|泪|表情/.test(nm)) {
                continue;
            }
            const morph = mesh.morphTargetManager;
            rows.push({
                model: modelTag,
                mesh: mesh.name,
                mat: mat.name,
                cls:
                    mat.getClassName?.() ??
                    (mat as { constructor?: { name?: string } }).constructor?.name,
                meshVisible: mesh.isVisible,
                meshVisibility: mesh.visibility,
                matAssigned: mesh.material === mat,
                matAlpha: mat.alpha,
                backFaceCulling: mat.backFaceCulling,
                alphaMode: mat.alphaMode,
                needAlphaBlending: mat.needAlphaBlending(),
                hasSphere: !!(mat as { sphereTexture?: unknown }).sphereTexture,
                hasDiffuse: !!mat.diffuseTexture,
                morphTargets: morph ? (morph as { numTargets: number }).numTargets : 0,
            });
        }
    }
    logWarn('diagnose-eye', `loaded models=${models.length}, eye-like materials=${rows.length}`, rows);
}
import { t } from '@/core/i18n/t';
import type { IMmdRuntime } from 'babylon-mmd/esm/Runtime/IMmdRuntime';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';
import { MmdWasmModel } from 'babylon-mmd/esm/Runtime/Optimized/mmdWasmModel';
import { retryWindPhysicsSubscription } from '../../physics/wind-physics';
import { _capture } from './material';
import { rebuildShadowCasters } from '../render/lighting';
import { getGroundHeightAt, setOnTerrainReady, setOnGroundChanged } from '../env/env-impl';
import { setTransformMetadata } from '../transform/transform-pick';

/** babylon-mmd 扩展 ImportMeshAsync 接受 Uint8Array，原类型签名不支持，需手动断言 */
const importMeshFromBytes = ImportMeshAsync as unknown as (
    data: Uint8Array,
    scene: unknown,
    options: Record<string, unknown>
) => Promise<ISceneLoaderAsyncResult>;

/**
 * [doc:adr-182] 从 filePath 的 basename 推导人类可读显示名。
 * 网页 ZIP 加载路径为编码命名空间（web://model/<enc(zipStem/pmxStem)>），
 * getBaseName 会得到 `packA%2Fmiku` —— 需安全解码 + 取末段还原为 `miku`。
 * 桌面端真实路径无 `%`、无内嵌 `/`，此函数等价于原 `fileName.replace(/\.pmx$/i,'')`，零影响。
 */
function _displayNameFromBase(fileName: string): string {
    let name = fileName;
    if (name.includes('%')) {
        try {
            name = decodeURIComponent(name);
        } catch {
            /* 非法百分号编码（如真实文件名 "50%off"）→ 保持原样 */
        }
    }
    if (name.includes('/')) {
        name = name.split('/').pop() ?? name;
    }
    return name.replace(/\.pmx$/i, '');
}

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
        // [fix] setTimeout 闭包捕获的 inst 可能在调度前已被卸载（_modelManager.remove dispose 了 meshes）
        if (targetInst.rootMesh.isDisposed()) {
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

const TEXTURE_EXTS = /\.(png|jpg|jpeg|bmp|tga|dds|tif|tiff|sph|spa|toon|ktx2?)$/i;

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
        ktx: 'image/ktx',
        ktx2: 'image/ktx2',
    };
    return map[ext ?? ''] ?? 'application/octet-stream';
}

/** Collect texture files from model directory (recursive) for referenceFiles.
 *  [doc:adr-189] Phase 1: 并行读取 + basename 共享引用 + AbortSignal。
 *  @param signal 传入 loadPMXFile 的 effectiveSignal，abort 后立即停止读取 */
async function collectTextureFiles(modelDir: string, signal?: AbortSignal): Promise<TextureFile[]> {
    if (signal?.aborted) {
        return [];
    }
    const files: TextureFile[] = [];
    try {
        const entries = await ListDirRecursive(modelDir);
        if (!entries) {
            return files;
        }
        if (signal?.aborted) {
            return [];
        }
        // [doc:adr-189] 串行 → 并行读取（手写 semaphore，限制 8 并发，复用 outfit.ts 模式）
        const CONCURRENCY = 8;
        let running = 0;
        const tasks = entries
            .filter((e) => TEXTURE_EXTS.test(e.name))
            .map(async (entry) => {
                while (running >= CONCURRENCY) {
                    await new Promise((r) => setTimeout(r, 0)); // yield
                }
                running++;
                try {
                    if (signal?.aborted) {
                        return null;
                    }
                    // [doc:adr-189] LRU 缓存命中直接返回，未命中则 readFileBytes + 缓存
                    const data = await readTextureWithLRU(modelDir, entry.relativePath, signal);
                    if (!data) {
                        logWarn(
                            'model-loader',
                            'texture read failed, skipped:',
                            entry.relativePath
                        );
                        return null;
                    }
                    return {
                        relativePath: entry.relativePath,
                        mimeType: getMimeType(entry.name),
                        data: data, // readTextureWithLRU 已返回 ArrayBuffer
                    };
                } finally {
                    running--;
                }
            });
        const results = await Promise.all(tasks);
        if (signal?.aborted) {
            return [];
        } // 提前退出，避免浪费 basename fallback 计算
        files.push(...results.filter((r): r is TextureFile => r !== null));
    } catch (err) {
        logWarn('model-loader', 'texture scan failed, falling back to HTTP:', err);
    }
    // fallback: 为带目录前缀的贴图注册多候选路径副本（裸名 + 去首段 + 首段+裸名），
    // 使 PMX 声明路径（含目录前缀/反斜杠）能命中磁盘实际位置（可能深一层子目录）。
    // 例：声明 "textures\xxx.png" 可匹配到实际文件 "textures/Normalmap/xxx.png"。
    // [doc:adr-189] 共享引用替代 .slice(0)：babylon-mmd 走 new Blob([data]) 路径不 detach ArrayBuffer
    const hasCandidate = new Set<string>();
    const fallbacks: TextureFile[] = [];
    for (const tf of files) {
        const rel = tf.relativePath.replace(/\\/g, '/');
        for (const cand of textureFallbackCandidates(rel)) {
            if (cand === rel || hasCandidate.has(cand)) {
                continue;
            }
            hasCandidate.add(cand);
            fallbacks.push({ ...tf, relativePath: cand, data: tf.data }); // 共享引用
        }
    }
    files.push(...fallbacks);
    return files;
}

/**
 * Apply scene-level motion (VMD) to a newly loaded actor model.
 * Uses sceneMotionId from motionSlots, falling back to getActiveMotion().
 * Handles compatibility check, generation-based staleness guard, and abort signal.
 * @returns { appliedVmd } on success, null if aborted (caller should return null).
 */
async function _applySceneMotion(
    inst: ModelInstance,
    mmdRuntime: IMmdRuntime | null,
    effectiveSignal: AbortSignal,
    registeredId: string | null
): Promise<{ appliedVmd: string } | null> {
    const slots: ModelMotionSlots = inst.motionSlots ?? {
        primary: { source: 'inherit', status: 'idle' },
    };
    const pickedId = slots.primary.sceneMotionId;
    const pickedMotion = pickedId
        ? (getSceneMotions().find((m) => m.id === pickedId) ?? null)
        : null;
    const activeMotion = pickedMotion ?? getActiveMotion();
    const loadGen = getMotionGen();
    let appliedVmd = '';

    if (activeMotion && activeMotion.vmdPath && mmdRuntime) {
        if (slots.primary.source === 'inherit') {
            // 兼容性检查
            const bones =
                inst.mmdModel?.runtimeBones?.map((b) => b.name) ??
                inst.meshes[0]?.skeleton?.bones?.map((b) => b.name) ??
                [];
            // [doc:adr-121 P4-2] 宽松匹配：未传 vmdBoneNames，退回标准骨骼预筛（有意为之，见 motion-binding-ui.ts 注释）
            const compat = resolveCompatibility(bones, activeMotion);
            if (!compat.compatible) {
                inst.motionSlots = {
                    primary: { ...slots.primary, status: 'incompatible' },
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
                            inst.id
                        );
                        // [doc:adr-167] 保留 sceneMotionId（由 broadcast 设置）
                        inst.motionSlots = {
                            primary: {
                                source: 'inherit',
                                sceneMotionId: slots.primary.sceneMotionId,
                                status: 'compatible',
                            },
                        };
                    }
                } catch (vmdErr) {
                    if (getMotionGen() !== loadGen) {
                        appliedVmd = '';
                    } else {
                        logWarn('model-loader', 'VMD 加载失败，模型已保留:', vmdErr);
                        appliedVmd = '';
                        feedbackStatus('scene.loader.vmdFailedModelLoaded', undefined, false, {
                            name: inst.name,
                        });
                        inst.motionSlots = {
                            primary: {
                                source: 'inherit',
                                sceneMotionId: slots.primary.sceneMotionId,
                                status: 'incompatible',
                            },
                        };
                    }
                }
            }
        }
    }

    if (effectiveSignal.aborted) {
        try {
            if (registeredId && _modelManager) {
                _modelManager.remove(registeredId);
            }
        } catch (e) {
            logWarn('model-loader', 'Cleanup after abort:', e);
        }
        return null;
    }

    return { appliedVmd };
}

export async function loadPMXFile(
    filePath: string,
    asStage?: boolean,
    skipAutoApply?: boolean,
    libraryPath?: string,
    innerPath?: string,
    signal?: AbortSignal,
    /** [doc:stable-identity] 恢复场景时传入存档 uuid，使 runtime id 稳定、可跨会话复用（材质/个人灯等状态按此 id 落盘） */
    preferredId?: string
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
            const switchedMsg = t('scene.loader.switched', { name: existing.name });
            showInfoToast(switchedMsg);
            setStatus(switchedMsg, true, true);
            dom.canvas.setAttribute('aria-label', `${t('menu.canvasLabel')}：${existing.name}`);
            return existing.id;
        }

        const modelDir = await resolveModelDir(filePath);
        const fileName = getBaseName(filePath) || '';

        feedbackStatus('scene.loader.loading', undefined, false);
        dom.loadingEl.style.display = 'block';
        dom.loadingText.textContent = t('scene.loader.loadingZero');

        // [doc:adr-124] Phase 2: 递归收集模型目录下纹理 → referenceFiles 直传 babylon-mmd
        // [doc:adr-189] 传入 effectiveSignal，模型切换时 abort 并行读取
        const textureFiles = await collectTextureFiles(modelDir, effectiveSignal);
        if (effectiveSignal.aborted) {
            return null;
        }

        const pmxBytes = await readFileBytes(filePath);
        if (!pmxBytes || effectiveSignal.aborted) {
            return null;
        }
        // [fix:decl-alias] 按 PMX 声明路径反向注册别名：PMX 声明的目录名可能与磁盘实际
        // 目录名异写（如声明 tex\xxx.png，磁盘实际 Texture/xxx.png），候选路径无法枚举，
        // 以声明为准：磁盘有同名 basename 文件即注册「声明完整路径」别名（共享 data）。
        // 真缺失（磁盘无同名文件）不注册，audit 差集仍会如实提示。
        const declaredPaths = await parsePmxTexturePaths(pmxBytes);
        const finalTextureFiles = registerDeclaredAliases(textureFiles, declaredPaths);
        const result = await importMeshFromBytes(pmxBytes, _scene, {
            pluginExtension: '.pmx',
            pluginOptions: {
                mmdmodel: {
                    referenceFiles: finalTextureFiles as unknown as File[],
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

        // [feature:missing-texture-audit] 识别 PMX 声明但目录缺失的纹理并提示用户。
        // 不阻塞主加载：异步解析 PMX 纹理清单，与已提供的纹理文件（含 basename fallback
        // 与声明别名 finalTextureFiles）做差集；路径集合在此捕获副本，后续会被清空释放。
        if (loadedMeshes.length > 0) {
            const _declaredTexturePaths = finalTextureFiles.map((f) => f.relativePath);
            fireAndForget(() =>
                auditMissingTextures(pmxBytes, _declaredTexturePaths).then((missing) => {
                    for (const name of missing) {
                        reportResourceWarning(t('resource.textureMissing', { name }));
                    }
                })
            );
        }

        // [fix:gpu-texture-leak] 释放纹理文件引用，让 GC 尽早回收 ArrayBuffer（可达数百 MB）。
        // textureFiles 在闭包中存活直到 loadPMXFile 返回；后续 VMD 加载 + 缩略图渲染耗时较长，
        // 尽早释放引用可让 GC 在异步间隙回收 RAM，避免多模型加载/替换时内存峰值叠加。
        for (let i = 0; i < textureFiles.length; i++) {
            (textureFiles[i] as { data: ArrayBuffer | null }).data = null;
        }
        textureFiles.length = 0;

        dom.loadingEl.style.display = 'none';

        const meshes = loadedMeshes;
        if (meshes.length === 0) {
            feedbackStatus('scene.loader.noMeshes', undefined, false);
            return null;
        }

        // [doc:stable-identity] 稳定身份：优先复用存档 uuid（恢复路径传入），否则生成稳定 uuid。
        // 替代原 `model_${Date.now()}_${random}`，避免 id 每次加载重生导致材质/outfit/个人灯状态孤儿化。
        const id = resolveModelId(preferredId);
        const displayName = _displayNameFromBase(fileName);

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
                _origAlpha: meshes.map((m) => m.material?.alpha ?? 1),
            };
            // Register via ModelManager only — it owns the registry
            _modelManager.register(inst);
            registeredId = id;
            setTransformMetadata(inst.rootMesh, 'stage', id);
            // Pre-capture material original values for reset functionality
            for (let i = 0; i < meshes.length; i++) {
                if (meshes[i].material) {
                    _capture(meshes[i].material!, i, inst._origAlpha ?? []);
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
            showInfoToast(t('scene.loader.stageLoaded', { name: displayName }));
            dom.canvas.setAttribute('aria-label', `${t('menu.canvasLabel')}：${displayName}`);
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
            // [fix:thumbnail-async] 缩略图编码已改为 toBlob 异步（后台线程），不再阻塞主线程
            setTimeout(() => {
                swallowError(captureThumbnail(filePath, libraryPath, innerPath, inst));
            }, 0);
            return id;
        }

        // Actor: create MMD model from the loaded mesh via the runtime
        const rootMesh = meshes[0];
        wasmModel = _mmdRuntime.createMmdModel(rootMesh, {
            materialProxyConstructor: getStandardMaterialProxy(),
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
            _origAlpha: meshes.map((m) => m.material?.alpha ?? 1),
        };
        // 从 PMX 字节中提取 comment 写入 modelMetaCache
        const metaComment = parsePmxComment(pmxBytes);
        if (metaComment || libraryPath) {
            const { setModelMetaCache, modelMetaCache } = await import('@/core/config');
            const cacheKey = libraryPath || filePath;
            if (!modelMetaCache.has(cacheKey) || metaComment) {
                const merged = new Map(modelMetaCache);
                const existing = merged.get(cacheKey);
                merged.set(cacheKey, { comment: metaComment || existing?.comment || '' });
                setModelMetaCache(merged);
                // 如果详情面板正显示该模型的 comment card，更新其内容
                const commentCard = document.querySelector('[data-comment-card]');
                if (commentCard) {
                    const valEl = commentCard.querySelector('.info-card-value');
                    const labelEl = commentCard.querySelector('.info-card-label');
                    if (labelEl) {
                        labelEl.textContent = t('model-detail.fComment');
                    }
                    if (valEl) {
                        valEl.textContent = metaComment || '—';
                        (valEl as HTMLElement).style.whiteSpace = 'pre-wrap';
                    }
                }
            }
        }
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
        setTransformMetadata(inst.rootMesh, 'actor', id);
        // [adr-XX per-motion] 继承上一个角色的槽位1 source/procRole（不继承 pinned 快照）
        // [doc:adr-167] overlay 槽位已移除
        if (prevInst && prevInst.motionSlots) {
            const prevPrimary = prevInst.motionSlots.primary;
            if (!inst.motionSlots) {
                inst.motionSlots = {
                    primary: { source: 'inherit', status: 'idle' },
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
            // 清理已注册的模型，避免泄漏。
            // _modelManager.remove() 内 onRemoveModel 回调（scene.ts:375-394）
            // 已调用 destroyMmdModel，此处不再重复销毁 wasmModel。
            try {
                _modelManager.remove(registeredId);
            } catch (e) {
                logWarn('model-loader', 'Cleanup after abort:', e);
            }
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
        for (let i = 0; i < meshes.length; i++) {
            if (meshes[i].material) {
                _capture(meshes[i].material!, i, inst._origAlpha ?? []);
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

        // [doc:adr-167] 应用场景级动作（按角色 sceneMotionId 解析；未指定则用默认动作）
        const vmdResult = await _applySceneMotion(inst, _mmdRuntime, effectiveSignal, registeredId);
        if (vmdResult === null) {
            return null;
        }
        const appliedVmd = vmdResult.appliedVmd;

        // [fix] 感知层激活和角色个人灯附着必须在 VMD 继承完成后进行，
        // 避免 activatePerception 读到无 VMD 帧状态。
        if (_onModelLoaded) {
            swallowError(Promise.resolve(_onModelLoaded(id)));
        }

        _modelManager.focus(id, uiState.autoCenterModel);
        showInfoToast(
            appliedVmd
                ? t('scene.loader.actorLoadedWithVmd', { name: displayName, vmd: appliedVmd })
                : t('scene.loader.actorLoaded', { name: displayName })
        );
        dom.canvas.setAttribute('aria-label', `${t('menu.canvasLabel')}：${displayName}`);
        _modelManager.arrange();
        _refreshWaterRenderList();
        rebuildShadowCasters();

        // Auto-capture thumbnail for future popup display
        // 与 stage 分支(330 行)对称:显式传 inst,避免依赖 _modelManager.focused() 的竞态兜底
        // (focused() 在加载时序波动时返回 null/错位实例 → 早退 → 缩略图间歇 miss = 历史反弹根因)。
        // [fix:thumbnail-async] 缩略图编码已改为 toBlob 异步（后台线程），不再阻塞主线程。
        setTimeout(() => {
            swallowError(captureThumbnail(filePath, libraryPath, innerPath, inst));
        }, 0);
        if (!skipAutoApply) {
            _tryAutoApplyPreset(id).catch((err: unknown) =>
                logWarn('model-loader', 'auto-apply preset:', err)
            );
        }
        // [temp:diagnose-eye] 复现「第二个角色看不见眼睛」时查看 console（确诊后删除）
        swallowError(Promise.resolve(_diagnoseEyeMaterials()));
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
        feedbackStatus('scene.loader.loadFailed', undefined, false, { error: formatError(err) });
        return null;
    } finally {
        dom.loadingEl.style.display = 'none';
        if (_loadAbortController === abortCtrl) {
            _loadAbortController = null;
        }
    }
}
