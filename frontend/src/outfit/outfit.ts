// [doc:architecture] Outfit — 换装系统核心逻辑（load/apply/reset + 自动发现）

import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { LoadOutfitFile, ListSubDirs } from '../core/wails-bindings';
import {
    modelRegistry,
    setStatus,
    OutfitFile,
    OutfitVariant,
    OutfitSlot,
    ModelInstance,
} from '../core/config';
import { scene } from '../scene/scene';
import { _catOf } from '../scene/manager/material';
import { triggerAutoSave } from '../core/config';
import { encodeFileRef } from '../core/fileservice';
import { loadOverlay, hideMaterials, restoreMaterials, disposeOverlay } from './outfit-overlay';

interface MmdStandardMaterial extends StandardMaterial {
    toonTexture: Texture | null;
    sphereTexture: Texture | null;
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
            const base = url.split('/').pop().split('?')[0] || '';
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

function _encodePath(path: string): string {
    // [doc:adr-057] 复用 fileservice 的 base64url 查询参数编码
    return path.replace(/\\/g, '/');
}

export async function loadOutfits(id: string): Promise<OutfitFile | null> {
    if (_loadingOutfits.has(id)) {
        return null;
    }
    _loadingOutfits.add(id);
    try {
        const inst = modelRegistry.get(id);
        if (!inst) {
            return null;
        }
        if (!inst.filePath) {
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
            /* fall through */
        }

        try {
            const mappings = _collectSlotMappings(inst);
            if (mappings.length === 0) {
                inst.outfitFile = undefined;
                return null;
            }
            const modelDir = inst.filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '');
            const subdirs = await ListSubDirs(modelDir);
            if (!subdirs || subdirs.length === 0) {
                inst.outfitFile = undefined;
                return null;
            }
            interface _Probe {
                subdir: string;
                matName: string;
                slot: string;
                relPath: string;
                url: string;
            }
            const seenUrl = new Set<string>();
            const probes: _Probe[] = [];
            for (const subdir of subdirs) {
                for (const m of mappings) {
                    const relPath = subdir + '/' + m.basename;
                    const url = `http://127.0.0.1:${inst.port}/?f=${encodeFileRef(_encodePath(relPath))}`;
                    if (seenUrl.has(url)) {
                        continue;
                    }
                    seenUrl.add(url);
                    probes.push({ subdir, matName: m.matName, slot: m.slot, relPath, url });
                }
            }
            const headCache = new Map<string, boolean>();
            // 并发限制：避免对大量子目录同时发起数百个 HEAD 请求
            const HEAD_CONCURRENCY = 6;
            const semaphore = { count: 0 };
            const withLimit = async <T>(fn: () => Promise<T>): Promise<T> => {
                while (semaphore.count >= HEAD_CONCURRENCY) {
                    await new Promise((r) => setTimeout(r, 10));
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
                    const byMaterial: Record<string, OutfitSlot> = {};
                    let hasAny = false;
                    const subdirProbes = probes.filter((p) => p.subdir === subdir);
                    await Promise.all(
                        subdirProbes.map(async (p) => {
                            let ok: boolean;
                            if (headCache.has(p.url)) {
                                ok = headCache.get(p.url)!;
                            } else {
                                ok = await withLimit(async () => {
                                    try {
                                        const resp = await fetch(p.url, { method: 'HEAD' });
                                        return resp.ok;
                                    } catch {
                                        return false;
                                    }
                                });
                                headCache.set(p.url, ok);
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
        _loadingOutfits.delete(id);
    }
}

async function _applySlot(
    sm: StandardMaterial,
    slot: TextureSlotKey,
    newPath: string | null,
    origTex: Texture | null,
    port: number
): Promise<void> {
    const mmdSm = sm as MmdStandardMaterial & Record<TextureSlotKey, Texture | null>;
    const cur = mmdSm[slot];
    if (newPath) {
        const url = `http://127.0.0.1:${port}/?f=${encodeFileRef(_encodePath(newPath))}`;
        const newTex = new Texture(url, scene);
        let loaded = false;
        await new Promise<void>((resolve) => {
            if (newTex.isReady()) {
                loaded = true;
                resolve();
                return;
            }
            const obs = newTex.onLoadObservable.add(() => {
                newTex.onLoadObservable.remove(obs);
                loaded = true;
                resolve();
            });
            setTimeout(() => {
                newTex.onLoadObservable.remove(obs);
                resolve(); // 超时：loaded 保持 false
            }, 5000);
        });
        // 仅加载成功时才替换纹理；超时则 dispose 并保留原纹理
        if (loaded) {
            if (cur && cur !== origTex) {
                cur.dispose();
            }
            mmdSm[slot] = newTex;
        } else {
            newTex.dispose();
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

function _getSlotFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string,
    slotKey: OutfitTextureSlot
): string | null {
    if (!variant) {
        return null;
    }
    const v =
        variant.byMaterial?.[smName]?.[slotKey] ??
        variant.byCategory?.[cat]?.[slotKey] ??
        variant.all?.[slotKey];
    return v ?? null;
}

function _getParamsFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string
): OutfitSlot['params'] | undefined {
    if (!variant) {
        return undefined;
    }
    return (
        variant.byMaterial?.[smName]?.params ??
        variant.byCategory?.[cat]?.params ??
        variant.all?.params
    );
}

function _getTintFor(
    variant: OutfitVariant | undefined,
    smName: string,
    cat: string
): [number, number, number] | undefined {
    if (!variant) {
        return undefined;
    }
    const t =
        variant.byMaterial?.[smName]?.tint ?? variant.byCategory?.[cat]?.tint ?? variant.all?.tint;
    return t;
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

function _applyOutfitTint(sm: StandardMaterial, tint: [number, number, number]): void {
    sm.diffuseColor.multiplyInPlace(new Color3(tint[0], tint[1], tint[2]));
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
const _applyingVariant = new Map<string, boolean>();

// R3 去重：防止对同一模型并发执行 loadOutfits 导致重复请求
const _loadingOutfits = new Set<string>();

export async function applyOutfitVariant(id: string, variantName: string): Promise<void> {
    if (_applyingVariant.get(id)) {
        return;
    }
    const inst = modelRegistry.get(id);
    if (!inst) {
        return;
    }
    if (!inst.outfitFile) {
        return;
    }
    _applyingVariant.set(id, true);
    try {
        const variant =
            variantName === '默认'
                ? undefined
                : inst.outfitFile.variants.find((v) => v.name === variantName);
        if (!variant && variantName !== '默认') {
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
        promises.push(
            (async () => {
                if (inst._overlayMeshes) {
                    disposeOverlay(inst);
                    restoreMaterials(inst);
                }
                if (variant?.meshFile) {
                    const { meshes, retargetOk } = await loadOverlay(inst, variant.meshFile, scene);
                    // token 过期：说明此期间已切换到其他变体，丢弃本次结果
                    if (inst._overlayLoadToken !== token) {
                        console.info('[outfit] overlay load stale (token mismatch), discarding');
                        for (const m of meshes) {
                            try {
                                m.dispose();
                            } catch {
                                // ignore
                            }
                        }
                        return;
                    }
                    // 仅在 overlay 成功加载且骨骼重定向成功时隐藏 PMX 布料；
                    // retarget 失败（静态降级）时保留原布料，避免穿模
                    if (meshes.length > 0 && retargetOk && variant.hideMaterials) {
                        hideMaterials(inst, variant.hideMaterials);
                    } else if (meshes.length > 0 && !retargetOk && variant.hideMaterials) {
                        console.warn(
                            '[outfit] FBX overlay retarget failed, keeping PMX materials to avoid穿模'
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
            const cat = _catOf(sm.name);

            promises.push(
                _applySlot(
                    sm,
                    'diffuseTexture',
                    _getSlotFor(variant, sm.name, cat, 'diffuse'),
                    origTex.diffuse,
                    inst.port
                )
            );
            promises.push(
                _applySlot(
                    sm,
                    'toonTexture',
                    _getSlotFor(variant, sm.name, cat, 'toon'),
                    origTex.toon,
                    inst.port
                )
            );
            promises.push(
                _applySlot(
                    sm,
                    'sphereTexture',
                    _getSlotFor(variant, sm.name, cat, 'spa'),
                    origTex.spa,
                    inst.port
                )
            );
            promises.push(
                _applySlot(
                    sm,
                    'bumpTexture',
                    _getSlotFor(variant, sm.name, cat, 'normal'),
                    origTex.normal,
                    inst.port
                )
            );
            promises.push(
                _applySlot(
                    sm,
                    'emissiveTexture',
                    _getSlotFor(variant, sm.name, cat, 'emissive'),
                    origTex.emissive,
                    inst.port
                )
            );

            const slotParams = _getParamsFor(variant, sm.name, cat);
            if (slotParams) {
                _applyOutfitParams(sm, slotParams, origParams);
            }

            const tint = _getTintFor(variant, sm.name, cat);
            if (tint) {
                _applyOutfitTint(sm, tint);
            }
        }

        await Promise.all(promises);
        inst.activeVariant = variantName;
        const { t } = await import('../core/i18n/t');
        setStatus(t('outfit.switched', { name: variantName }), true);
        triggerAutoSave();
    } finally {
        _applyingVariant.delete(id);
    }
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
            promises.push(_applySlot(sm, 'diffuseTexture', null, orig.diffuse, inst.port));
            promises.push(_applySlot(sm, 'toonTexture', null, orig.toon, inst.port));
            promises.push(_applySlot(sm, 'sphereTexture', null, orig.spa, inst.port));
            promises.push(_applySlot(sm, 'bumpTexture', null, orig.normal, inst.port));
            promises.push(_applySlot(sm, 'emissiveTexture', null, orig.emissive, inst.port));
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
    // token 失效，使进行中的 loadOverlay 完成后丢弃结果
    inst._overlayLoadToken = undefined;
    disposeOverlay(inst);
    restoreMaterials(inst);

    inst.activeVariant = undefined;
    inst.outfitFile = undefined;
    inst._origTextures = undefined;
    inst._origParams = undefined;
    triggerAutoSave();
}
