// [doc:architecture] Outfit — 换装系统核心逻辑（load/apply/reset + 自动发现）

import { observe } from '@/core/observer-handle';

import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { LoadOutfitFile, ListSubDirs, readFileBytes, FileExists } from '@/core/wails-bindings';
import { readTextureWithLRU } from '@/scene/shared/texture-lru';
import {
    modelRegistry,
    OutfitFile,
    OutfitVariant,
    OutfitSlot,
    ModelInstance,
} from '@/core/config';
import { showInfoToast } from '@/core/toast';
import type { Scene } from '@babylonjs/core/scene';
import { getBaseName, normPath, getDirPath } from '@/core/path';
import { delay, LoadingGuard } from '@/core/async';
import { logWarn, logInfo } from '@/core/logger';
import { reportResourceWarning } from '@/core/resource-warning-sink';
import { getMaterialCategory } from './material';
import { triggerAutoSave } from '@/core/config';
import { loadOverlay, hideMaterials, restoreMaterials, disposeOverlay } from './outfit-overlay';
import type { MmdStandardMaterial } from '@/core/types';
import { t } from '@/core/i18n/t';

/** 恢复默认变体的标识名（非 outfits.json 中定义的变体名） */
const RESET_VARIANT = '默认';

// [adr-104] Scene 引用注入：由 scene.ts 初始化后调用 setSceneRef() 注入，
// 破除 outfit → scene → scene-serialize → outfit 的循环依赖（原靠动态 import 解耦，
// 有运行时开销且难测试）。保留动态 import 作为未注入时的兜底兼容路径。
let _sceneRef: Scene | null = null;
let _sceneLoading: Promise<Scene> | null = null;

/** 由 scene.ts 在场景初始化完成后注入当前 scene 实例 */
export function setSceneRef(scene: Scene): void {
    _sceneRef = scene;
}

async function _getScene(): Promise<Scene> {
    if (_sceneRef) {
        return _sceneRef;
    }
    if (!_sceneLoading) {
        _sceneLoading = (async () => {
            const mod = await import('@/scene/scene');
            _sceneRef = mod.scene;
            _sceneLoading = null;
            return _sceneRef;
        })().catch((err) => {
            _sceneLoading = null;
            throw err;
        });
    }
    return _sceneLoading;
}

type TextureSlotKey =
    'diffuseTexture' | 'toonTexture' | 'sphereTexture' | 'bumpTexture' | 'emissiveTexture';

type OutfitTextureSlot = 'diffuse' | 'toon' | 'spa' | 'normal' | 'emissive';

interface _SlotMapping {
    matName: string;
    slot: string;
    basename: string;
}

function _isSharedTexture(basename: string): boolean {
    const lower = basename.toLowerCase();
    if (lower.startsWith('shared_toon_texture_')) {
        return true;
    }
    return false;
}

function _collectSlotMappings(inst: ModelInstance): _SlotMapping[] {
    const result: _SlotMapping[] = [];
    const seen = new Set<string>();
    for (const mesh of inst.meshes) {
        const sm = mesh.material as StandardMaterial;
        if (!sm) {
            continue;
        }
        const matName = sm.name;
        const mmdSm = sm as MmdStandardMaterial;
        for (const [slot, tex] of [
            ['diffuse', sm.diffuseTexture],
            ['toon', mmdSm.toonTexture],
            ['spa', mmdSm.sphereTexture],
            ['normal', sm.bumpTexture],
            ['emissive', sm.emissiveTexture],
        ] as const) {
            if (!tex) {
                continue;
            }
            const url = (tex as Texture).name || (tex as Texture).url || '';
            const base = getBaseName(url.split('?')[0]) || '';
            if (!base) {
                continue;
            }
            if (_isSharedTexture(base)) {
                continue;
            }
            const key = matName + '|' + slot + '|' + base;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push({ matName, slot, basename: base });
        }
    }
    return result;
}

export async function loadOutfits(id: string, signal?: AbortSignal): Promise<OutfitFile | null> {
    if (!_loadingOutfitsGuard.tryEnter(id)) {
        return null;
    }

    // [adr-105] AbortSignal：允许外部取消；内部 AbortController 合并外部 signal
    let abortCtrl: AbortController | undefined;
    let effectiveSignal: AbortSignal;
    if (signal) {
        effectiveSignal = signal;
    } else {
        abortCtrl = new AbortController();
        effectiveSignal = abortCtrl.signal;
    }

    try {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        if (!inst.filePath) {
            return null;
        }

        // [adr-105] 每个 await 点前检查取消状态
        if (effectiveSignal.aborted) {
            return null;
        }

        try {
            const json = await LoadOutfitFile(inst.filePath);
            if (json) {
                const outfit: OutfitFile = JSON.parse(json);
                if (outfit.version && Array.isArray(outfit.variants)) {
                    inst.outfitFile = outfit;
                    return outfit;
                }
            }
        } catch {
            /* expected failure when outfit file is invalid */
        }

        if (effectiveSignal.aborted) {
            return null;
        }

        try {
            const mappings = _collectSlotMappings(inst);
            if (mappings.length === 0) {
                inst.outfitFile = undefined;
                return null;
            }
            const modelDir = getDirPath(inst.filePath);
            const subdirs = await ListSubDirs(modelDir);
            if (!subdirs || subdirs.length === 0) {
                inst.outfitFile = undefined;
                return null;
            }

            if (effectiveSignal.aborted) {
                return null;
            }

            interface _Probe {
                subdir: string;
                matName: string;
                slot: string;
                relPath: string;
                fullPath: string;
            }
            const seenPath = new Set<string>();
            const probes: _Probe[] = [];
            for (const subdir of subdirs) {
                for (const m of mappings) {
                    const relPath = subdir + '/' + m.basename;
                    const fullPath = modelDir + '/' + normPath(relPath);
                    if (seenPath.has(fullPath)) {
                        continue;
                    }
                    seenPath.add(fullPath);
                    probes.push({ subdir, matName: m.matName, slot: m.slot, relPath, fullPath });
                }
            }
            const headCache = new Map<string, boolean>();
            // 并发限制：避免对大量子目录同时发起数百个 HEAD 请求
            const HEAD_CONCURRENCY = 6;
            const semaphore = { count: 0 };
            const withLimit = async <T>(fn: () => Promise<T>): Promise<T> => {
                while (semaphore.count >= HEAD_CONCURRENCY) {
                    await delay(10);
                    if (effectiveSignal.aborted) {
                        break;
                    }
                }
                semaphore.count++;
                try {
                    return await fn();
                } finally {
                    semaphore.count--;
                }
            };
            const results = await Promise.all(
                subdirs.map(async (subdir): Promise<OutfitVariant | null> => {
                    if (effectiveSignal.aborted) {
                        return null;
                    }
                    const byMaterial: Record<string, OutfitSlot> = {};
                    let hasAny = false;
                    const subdirProbes = probes.filter((p) => p.subdir === subdir);
                    await Promise.all(
                        subdirProbes.map(async (p) => {
                            if (effectiveSignal.aborted) {
                                return;
                            }
                            let ok: boolean;
                            if (headCache.has(p.fullPath)) {
                                ok = headCache.get(p.fullPath)!;
                            } else {
                                ok = await withLimit(async () => {
                                    try {
                                        return await FileExists(p.fullPath);
                                    } catch {
                                        return false;
                                    }
                                });
                                headCache.set(p.fullPath, ok);
                            }
                            if (!ok) {
                                return;
                            }
                            if (!byMaterial[p.matName]) {
                                byMaterial[p.matName] = {};
                            }
                            (byMaterial[p.matName] as Record<string, string>)[p.slot] = p.relPath;
                            hasAny = true;
                        })
                    );
                    return hasAny ? { name: subdir, byMaterial } : null;
                })
            );
            const variantList: OutfitVariant[] = results.filter(Boolean) as OutfitVariant[];
            if (variantList.length === 0) {
                inst.outfitFile = undefined;
                return null;
            }
            const outfit: OutfitFile = { version: 1, variants: variantList };
            inst.outfitFile = outfit;
            return outfit;
        } catch {
            inst.outfitFile = undefined;
            return null;
        }
    } finally {
        abortCtrl?.abort(); // 清理内部 AbortController
        _loadingOutfitsGuard.leave(id);
    }
}

async function _applySlot(
    sm: StandardMaterial,
    slot: TextureSlotKey,
    newPath: string | null,
    origTex: Texture | null,
    modelDir: string,
    inst: ModelInstance,
    token?: symbol
): Promise<void> {
    const mmdSm = sm as MmdStandardMaterial & Record<TextureSlotKey, Texture | null>;
    const cur = mmdSm[slot];
    // [fix:p2-texture-token] 代次守卫：token 过期（变体已切换）时丢弃本次结果，
    // 避免慢加载的旧变体纹理覆盖新变体已设置的槽位（快速切换 A→B 竞态）
    const isStale = (): boolean => token !== undefined && inst._textureLoadToken !== token;
    if (newPath) {
        const scene = await _getScene();
        // [fix:p3-outfit-lru] 换装纹理走 readTextureWithLRU：与模型纹理共享 LRU 缓存，
        // 反复切换变体不重复读盘（键 modelDir\x00relativePath 与 collectTextureFiles 一致）
        const texData = await readTextureWithLRU(modelDir, normPath(newPath));
        if (!texData) {
            logWarn('outfit', '_applySlot: failed to read texture', newPath);
            reportResourceWarning(t('resource.outfitTextureMissing', { name: newPath }));
            return;
        }
        const ext = newPath.split('.').pop()?.toLowerCase() || 'png';
        const mimeMap: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            bmp: 'image/bmp',
            tga: 'image/x-tga',
            dds: 'image/vnd-ms.dds',
            spa: 'image/png',
            sph: 'image/png',
        };
        const blob = new Blob([texData], {
            type: mimeMap[ext] || 'application/octet-stream',
        });
        const url = URL.createObjectURL(blob);
        let loaded = false;
        let disposed = false;
        // onError 仅能通过构造函数选项注册（Texture 类无 onError 属性）；
        // 用 resolveLoad 桥接，使构造期回调能在 Promise 内 resolve。
        let resolveLoad: () => void = () => {};
        const newTex = new Texture(url, scene, {
            onError: () => {
                if (!loaded && !disposed) {
                    disposed = true;
                    newTex.dispose();
                    URL.revokeObjectURL(url);
                }
                resolveLoad();
            },
        });
        await new Promise<void>((resolve) => {
            resolveLoad = resolve;
            if (newTex.isReady()) {
                loaded = true;
                resolve();
                return;
            }
            const loadH = observe(newTex.onLoadObservable, () => {
                loadH.dispose();
                loaded = true;
                resolve();
            });
            setTimeout(() => {
                loadH.dispose();
                resolve(); // 超时：loaded 保持 false
            }, 5000);
        });
        if (loaded) {
            // [fix:p2-texture-token] 变体已切换：丢弃本次加载的纹理，不覆盖新槽位
            if (isStale()) {
                newTex.dispose();
                URL.revokeObjectURL(url);
                return;
            }
            if (cur && cur !== origTex) {
                cur.dispose();
            }
            mmdSm[slot] = newTex;
            URL.revokeObjectURL(url);
        } else {
            let done = false;
            const trySwap = (): void => {
                if (done) {
                    return;
                }
                done = true;
                if (disposed) {
                    return; // 已因加载失败被清理
                }
                // [fix:p2-texture-token] 变体已切换：丢弃（done 已置位，后续超时清理不会再 dispose）
                if (isStale()) {
                    newTex.dispose();
                    URL.revokeObjectURL(url);
                    return;
                }
                if (mmdSm[slot] === cur) {
                    if (cur && cur !== origTex) {
                        cur.dispose();
                    }
                    mmdSm[slot] = newTex;
                    URL.revokeObjectURL(url);
                } else {
                    newTex.dispose();
                    URL.revokeObjectURL(url); // 修复：丢弃过期贴图时回收 blob URL
                }
            };
            if (newTex.isReady()) {
                trySwap();
            } else {
                // 兜底 observer 等待迟到的加载完成；但若贴图永不加载（既不 load 也不 error），
                // observer + newTex + blobURL 会永不释放，故再加一次超时清理。
                const handle = observe(newTex.onLoadObservable, () => {
                    handle.dispose();
                    trySwap();
                });
                setTimeout(() => {
                    if (done) {
                        return;
                    }
                    done = true;
                    handle.dispose();
                    if (!disposed) {
                        newTex.dispose();
                        URL.revokeObjectURL(url);
                    }
                }, 5000);
            }
        }
    } else {
        if (origTex) {
            if (cur && cur !== origTex) {
                cur.dispose();
            }
            mmdSm[slot] = origTex;
        }
    }
}

/** 三级回退：byMaterial → byCategory → all，泛型访问器 */
function _resolveVariant<T>(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string,
    access: (slot: OutfitSlot | undefined) => T | undefined
): T | undefined {
    if (!variant) {
        return undefined;
    }
    return (
        access(variant.byMaterial?.[smName]) ??
        access(variant.byCategory?.[cat]) ??
        access(variant.all)
    );
}

/** 按 slot key 回退纹理路径 */
function _getSlotFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string,
    slotKey: OutfitTextureSlot
): string | null {
    return (
        _resolveVariant(
            variant,
            smName,
            cat,
            (slot) => slot?.[slotKey as keyof OutfitSlot] as string | undefined
        ) ?? null
    );
}

/** 按材质/分类/全局回退参数块 */
function _getParamsFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string
): OutfitSlot['params'] | undefined {
    return _resolveVariant(variant, smName, cat, (s) => s?.params);
}

/** 按材质/分类/全局回退 tint */
function _getTintFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string
): [number, number, number] | undefined {
    return _resolveVariant(variant, smName, cat, (s) => s?.tint);
}

function _applyOutfitParams(
    sm: StandardMaterial,
    params: OutfitSlot['params'],
    orig: {
        diffuseR: number;
        diffuseG: number;
        diffuseB: number;
        specularR: number;
        specularG: number;
        specularB: number;
        specularPower: number;
        ambientR: number;
        ambientG: number;
        ambientB: number;
    }
): void {
    if (!params) {
        return;
    }
    if (params.diffuseMul !== undefined) {
        sm.diffuseColor.set(
            orig.diffuseR * params.diffuseMul,
            orig.diffuseG * params.diffuseMul,
            orig.diffuseB * params.diffuseMul
        );
    }
    if (params.specularMul !== undefined) {
        sm.specularColor.set(
            orig.specularR * params.specularMul,
            orig.specularG * params.specularMul,
            orig.specularB * params.specularMul
        );
    }
    if (params.shininess !== undefined) {
        sm.specularPower = params.shininess;
    }
    if (params.ambientMul !== undefined) {
        sm.ambientColor.set(
            orig.ambientR * params.ambientMul,
            orig.ambientG * params.ambientMul,
            orig.ambientB * params.ambientMul
        );
    }
}

function _applyOutfitTint(
    sm: StandardMaterial,
    tint: [number, number, number],
    orig: { diffuseR: number; diffuseG: number; diffuseB: number },
    diffuseMul?: number
): void {
    // [fix P1] 基于 orig 绝对设置而非 multiplyInPlace：乘法不可逆，每次 apply 同一
    // 变体都乘 tint → diffuseColor 几何级数漂移（orig 仅在 reset 后重捕获，连续
    // 变体切换 A→B→A 之间不 reset）。绝对设置保证幂等。
    // [fix code_review P2] 合并 diffuseMul：同一 slot 可同时定义 params.diffuseMul
    // 与 tint（测试 fixture 构造过），旧语义是 orig * diffuseMul * tint——绝对 set
    // 若只乘 tint 会丢掉 diffuseMul 亮度因子。此处组合两者。
    const mul = diffuseMul ?? 1;
    sm.diffuseColor.set(
        orig.diffuseR * mul * tint[0],
        orig.diffuseG * mul * tint[1],
        orig.diffuseB * mul * tint[2]
    );
}

function _captureOrigParams(inst: ModelInstance): void {
    if (inst._origParams) {
        return;
    }
    inst._origParams = new Map();
    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const sm = inst.meshes[mi].material as StandardMaterial;
        if (!sm) {
            continue;
        }
        inst._origParams.set(mi, {
            diffuseR: sm.diffuseColor.r,
            diffuseG: sm.diffuseColor.g,
            diffuseB: sm.diffuseColor.b,
            specularR: sm.specularColor.r,
            specularG: sm.specularColor.g,
            specularB: sm.specularColor.b,
            specularPower: sm.specularPower,
            ambientR: sm.ambientColor.r,
            ambientG: sm.ambientColor.g,
            ambientB: sm.ambientColor.b,
        });
    }
}

// 并发锁：防止同一模型的变体应用并发执行导致竞态
const _applyingVariantGuard = new LoadingGuard();

// R3 去重：防止对同一模型并发执行 loadOutfits 导致重复请求
const _loadingOutfitsGuard = new LoadingGuard();

// 并发队列：快速切换变体时记录最新一次请求（last-wins），待当前应用完成后再执行，
// 避免直接 return 导致用户点击的切换被静默丢弃
const _pendingVariant = new Map<string, string>();

export async function applyOutfitVariant(id: string, variantName: string): Promise<void> {
    if (_applyingVariantGuard.isLoading(id)) {
        _pendingVariant.set(id, variantName);
        return;
    }
    _applyingVariantGuard.tryEnter(id);
    try {
        let target = variantName;
        for (;;) {
            await _applyOutfitVariantCore(id, target);
            const next = _pendingVariant.get(id);
            if (next === undefined) {
                break;
            }
            _pendingVariant.delete(id);
            target = next;
        }
    } finally {
        _applyingVariantGuard.leave(id);
    }
}

async function _applyOutfitVariantCore(id: string, variantName: string): Promise<void> {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    if (!inst.outfitFile) {
        return;
    }
    const variants = inst.outfitFile.variants;
    const variant =
        variantName === RESET_VARIANT
            ? undefined
            : Array.isArray(variants)
              ? variants.find((v) => v.name === variantName)
              : undefined;
    if (!variant && variantName !== RESET_VARIANT) {
        return;
    }

    if (!inst._origTextures) {
        inst._origTextures = new Map();
        for (let mi = 0; mi < inst.meshes.length; mi++) {
            const sm = inst.meshes[mi].material as StandardMaterial;
            if (!sm) {
                continue;
            }
            const mmdSm = sm as MmdStandardMaterial;
            inst._origTextures.set(mi, {
                diffuse: sm.diffuseTexture as Texture | null,
                toon: mmdSm.toonTexture,
                spa: mmdSm.sphereTexture,
                normal: sm.bumpTexture as Texture | null,
                emissive: sm.emissiveTexture as Texture | null,
            });
        }
    }
    _captureOrigParams(inst);

    const promises: Promise<void>[] = [];

    // overlay 处理（与纹理替换并行）：清理旧 overlay → 加载新 overlay → 隐藏 PMX 布料
    // token 守卫：防止快速切换变体时，旧 loadOverlay 完成后覆盖新状态导致孤儿 mesh 泄漏
    const token = Symbol('overlay');
    inst._overlayLoadToken = token;
    // [fix:p2-texture-token] 纹理槽位共用同一代次 token：旧变体 _applySlot 完成后检测过期即丢弃
    inst._textureLoadToken = token;
    promises.push(
        (async () => {
            if (inst._overlayMeshes) {
                disposeOverlay(inst);
                restoreMaterials(inst);
            }
            if (variant?.meshFile) {
                const { meshes, retargetOk } = await loadOverlay(
                    inst,
                    variant.meshFile,
                    await _getScene()
                );
                // token 过期：说明此期间已切换到其他变体，丢弃本次结果
                if (inst._overlayLoadToken !== token) {
                    logInfo('outfit', 'overlay load stale (token mismatch), discarding');
                    for (const m of meshes) {
                        try {
                            m.dispose();
                        } catch {
                            /* cleanup, ignore errors */
                        }
                    }
                    return;
                }
                // 仅在 overlay 成功加载且骨骼重定向成功时隐藏 PMX 布料；
                // retarget 失败（静态降级）时保留原布料，避免穿模
                if (meshes.length > 0 && retargetOk && variant.hideMaterials) {
                    hideMaterials(inst, variant.hideMaterials);
                } else if (meshes.length > 0 && !retargetOk && variant.hideMaterials) {
                    logWarn(
                        'outfit',
                        'FBX overlay retarget failed, keeping PMX materials to avoid穿模'
                    );
                }
            }
        })()
    );

    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const sm = inst.meshes[mi].material as StandardMaterial;
        if (!sm) {
            continue;
        }
        const origTex = inst._origTextures.get(mi);
        if (!origTex) {
            continue;
        }
        const origParams = inst._origParams.get(mi)!;
        const cat = getMaterialCategory(sm);

        promises.push(
            _applySlot(
                sm,
                'diffuseTexture',
                _getSlotFor(variant, sm.name, cat, 'diffuse'),
                origTex.diffuse,
                inst.modelDir,
                inst,
                token
            )
        );
        promises.push(
            _applySlot(
                sm,
                'toonTexture',
                _getSlotFor(variant, sm.name, cat, 'toon'),
                origTex.toon,
                inst.modelDir,
                inst,
                token
            )
        );
        promises.push(
            _applySlot(
                sm,
                'sphereTexture',
                _getSlotFor(variant, sm.name, cat, 'spa'),
                origTex.spa,
                inst.modelDir,
                inst,
                token
            )
        );
        promises.push(
            _applySlot(
                sm,
                'bumpTexture',
                _getSlotFor(variant, sm.name, cat, 'normal'),
                origTex.normal,
                inst.modelDir,
                inst,
                token
            )
        );
        promises.push(
            _applySlot(
                sm,
                'emissiveTexture',
                _getSlotFor(variant, sm.name, cat, 'emissive'),
                origTex.emissive,
                inst.modelDir,
                inst,
                token
            )
        );

        const slotParams = _getParamsFor(variant, sm.name, cat);
        if (slotParams) {
            _applyOutfitParams(sm, slotParams, origParams);
        }

        const tint = _getTintFor(variant, sm.name, cat);
        if (tint) {
            _applyOutfitTint(sm, tint, origParams, slotParams?.diffuseMul);
        }
    }

    await Promise.all(promises);
    inst.activeVariant = variantName;
    showInfoToast(t('outfit.switched', { name: variantName }));
    triggerAutoSave();
}

export async function resetOutfit(id: string): Promise<void> {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    const promises: Promise<void>[] = [];
    if (inst._origTextures) {
        for (let mi = 0; mi < inst.meshes.length; mi++) {
            const sm = inst.meshes[mi].material as StandardMaterial;
            if (!sm) {
                continue;
            }
            const orig = inst._origTextures.get(mi);
            if (!orig) {
                continue;
            }
            promises.push(_applySlot(sm, 'diffuseTexture', null, orig.diffuse, inst.modelDir, inst));
            promises.push(_applySlot(sm, 'toonTexture', null, orig.toon, inst.modelDir, inst));
            promises.push(_applySlot(sm, 'sphereTexture', null, orig.spa, inst.modelDir, inst));
            promises.push(_applySlot(sm, 'bumpTexture', null, orig.normal, inst.modelDir, inst));
            promises.push(_applySlot(sm, 'emissiveTexture', null, orig.emissive, inst.modelDir, inst));
        }
    }
    await Promise.all(promises);
    if (inst._origParams) {
        for (let mi = 0; mi < inst.meshes.length; mi++) {
            const sm = inst.meshes[mi].material as StandardMaterial;
            if (!sm) {
                continue;
            }
            const p = inst._origParams.get(mi);
            if (!p) {
                continue;
            }
            sm.diffuseColor.set(p.diffuseR, p.diffuseG, p.diffuseB);
            sm.specularColor.set(p.specularR, p.specularG, p.specularB);
            sm.specularPower = p.specularPower;
            sm.ambientColor.set(p.ambientR, p.ambientG, p.ambientB);
        }
    }
    // 清理 overlay mesh 并恢复被隐藏的 PMX 材质
    // token 失效，使进行中的 loadOverlay / _applySlot 完成后丢弃结果（防止 reset 与切换竞态）
    inst._overlayLoadToken = undefined;
    inst._textureLoadToken = undefined;
    disposeOverlay(inst);
    restoreMaterials(inst);

    inst.activeVariant = undefined;
    inst.outfitFile = undefined;
    inst._origTextures = undefined;
    inst._origParams = undefined;
    triggerAutoSave();
}

// [doc:adr-238] 注册换装加载供 scene 经 scene-action-bridge 调用（切断 scene→outfit）
import { registerSceneAction } from '@/core/scene-action-bridge';
registerSceneAction('loadOutfits', (id: string) => loadOutfits(id) as unknown as Promise<void>);

// [doc:adr-238] 注册换装变体应用供 scene-serialize 经 scene-action-bridge 调用
registerSceneAction('applyOutfitVariant', (id: string, variantName: string) =>
    applyOutfitVariant(id, variantName)
);
