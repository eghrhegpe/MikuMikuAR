// [doc:architecture] Outfit — 换装系统核心逻辑（load/apply/reset + 自动发现）

import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadOutfitFile, ListSubDirs } from "../wailsjs/go/main/App";
import {
  modelRegistry,
  setStatus,
  OutfitFile, OutfitVariant, OutfitSlot, ModelInstance,
} from "./config";
import { scene, _catOf, triggerAutoSave } from "./scene";

interface _SlotMapping {
  matName: string;
  slot: string;
  basename: string;
}

function _isSharedTexture(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (lower.startsWith("shared_toon_texture_")) return true;
  return false;
}

function _collectSlotMappings(inst: ModelInstance): _SlotMapping[] {
  const result: _SlotMapping[] = [];
  const seen = new Set<string>();
  for (const mesh of inst.meshes) {
    const sm = mesh.material as StandardMaterial;
    if (!sm) continue;
    const matName = sm.name;
    for (const [slot, tex] of [
      ["diffuse", sm.diffuseTexture],
      ["toon", (sm as any).toonTexture],
      ["spa", (sm as any).sphereTexture],
      ["normal", sm.bumpTexture],
      ["emissive", sm.emissiveTexture],
    ] as const) {
      if (!tex) continue;
      const url = (tex as Texture).name || (tex as Texture).url || "";
      const base = url.split("/").pop()?.split("?")[0] || "";
      if (!base) continue;
      if (_isSharedTexture(base)) continue;
      const key = matName + "|" + slot + "|" + base;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ matName, slot, basename: base });
    }
  }
  return result;
}

function _encodePath(path: string): string {
  return path.replace(/\\/g, "/").split("/").map(p => encodeURIComponent(p)).join("/");
}

export async function loadOutfits(id: string): Promise<OutfitFile | null> {
  const inst = modelRegistry.get(id);
  if (!inst || !inst.filePath) return null;
  try {
    const json = await LoadOutfitFile(inst.filePath);
    if (json) {
      const outfit: OutfitFile = JSON.parse(json);
      if (outfit.version && Array.isArray(outfit.variants)) {
        inst.outfitFile = outfit;
        return outfit;
      }
    }
  } catch { /* fall through */ }

  try {
    const mappings = _collectSlotMappings(inst);
    if (mappings.length === 0) { inst.outfitFile = undefined; return null; }
    const modelDir = inst.filePath.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
    const subdirs = await ListSubDirs(modelDir);
    if (!subdirs || subdirs.length === 0) { inst.outfitFile = undefined; return null; }
    interface _Probe { subdir: string; matName: string; slot: string; relPath: string; url: string; }
    const seenUrl = new Set<string>();
    const probes: _Probe[] = [];
    for (const subdir of subdirs) {
      for (const m of mappings) {
        const relPath = subdir + "/" + m.basename;
        const url = `http://127.0.0.1:${inst.port}/${_encodePath(relPath)}`;
        if (seenUrl.has(url)) continue;
        seenUrl.add(url);
        probes.push({ subdir, matName: m.matName, slot: m.slot, relPath, url });
      }
    }
    const headCache = new Map<string, boolean>();
    const results = await Promise.all(subdirs.map(async (subdir): Promise<OutfitVariant | null> => {
      const byMaterial: Record<string, OutfitSlot> = {};
      let hasAny = false;
      const subdirProbes = probes.filter(p => p.subdir === subdir);
      await Promise.all(subdirProbes.map(async (p) => {
        let ok: boolean;
        if (headCache.has(p.url)) { ok = headCache.get(p.url)!; }
        else {
          try { const resp = await fetch(p.url, { method: "HEAD" }); ok = resp.ok; }
          catch { ok = false; }
          headCache.set(p.url, ok);
        }
        if (!ok) return;
        if (!byMaterial[p.matName]) byMaterial[p.matName] = {};
        (byMaterial[p.matName] as any)[p.slot] = p.relPath;
        hasAny = true;
      }));
      return hasAny ? { name: subdir, byMaterial } : null;
    }));
    const variantList: OutfitVariant[] = results.filter(Boolean) as OutfitVariant[];
    if (variantList.length === 0) { inst.outfitFile = undefined; return null; }
    const outfit: OutfitFile = { version: 1, variants: variantList };
    inst.outfitFile = outfit;
    return outfit;
  } catch { inst.outfitFile = undefined; return null; }
}

async function _applySlot(sm: StandardMaterial, slot: string, newPath: string | null, origTex: Texture | null, port: number): Promise<void> {
  const cur = (sm as any)[slot] as Texture | null;
  if (newPath) {
    const url = `http://127.0.0.1:${port}/${_encodePath(newPath)}`;
    const newTex = new Texture(url, scene);
    await new Promise<void>((resolve) => {
      if (newTex.isReady()) { resolve(); return; }
      const obs = newTex.onLoadObservable.add(() => { newTex.onLoadObservable.remove(obs); resolve(); });
      setTimeout(() => { newTex.onLoadObservable.remove(obs); resolve(); }, 5000);
    });
    if (cur && cur !== origTex) cur.dispose();
    (sm as any)[slot] = newTex;
  } else {
    if (origTex) { if (cur && cur !== origTex) cur.dispose(); (sm as any)[slot] = origTex; }
  }
}

function _getSlotFor(variant: OutfitVariant | undefined, smName: string, cat: string, slotKey: string): string | null {
  if (!variant) return null;
  const v = (variant.byMaterial?.[smName] as any)?.[slotKey] ?? (variant.byCategory?.[cat] as any)?.[slotKey] ?? (variant.all as any)?.[slotKey];
  return v ?? null;
}

function _getParamsFor(variant: OutfitVariant | undefined, smName: string, cat: string): OutfitSlot["params"] | undefined {
  if (!variant) return undefined;
  return variant.byMaterial?.[smName]?.params ?? variant.byCategory?.[cat]?.params ?? variant.all?.params;
}

function _getTintFor(variant: OutfitVariant | undefined, smName: string, cat: string): [number, number, number] | undefined {
  if (!variant) return undefined;
  const t = (variant.byMaterial?.[smName] as any)?.tint ?? (variant.byCategory?.[cat] as any)?.tint ?? (variant.all as any)?.tint;
  return t;
}

function _applyOutfitParams(sm: StandardMaterial, params: OutfitSlot["params"], orig: { diffuseR: number; diffuseG: number; diffuseB: number; specularR: number; specularG: number; specularB: number; specularPower: number; ambientR: number; ambientG: number; ambientB: number }): void {
  if (!params) return;
  if (params.diffuseMul !== undefined) sm.diffuseColor.set(orig.diffuseR * params.diffuseMul, orig.diffuseG * params.diffuseMul, orig.diffuseB * params.diffuseMul);
  if (params.specularMul !== undefined) sm.specularColor.set(orig.specularR * params.specularMul, orig.specularG * params.specularMul, orig.specularB * params.specularMul);
  if (params.shininess !== undefined) sm.specularPower = params.shininess;
  if (params.ambientMul !== undefined) sm.ambientColor.set(orig.ambientR * params.ambientMul, orig.ambientG * params.ambientMul, orig.ambientB * params.ambientMul);
}

function _applyOutfitTint(sm: StandardMaterial, tint: [number, number, number]): void {
  sm.diffuseColor.multiplyInPlace({ r: tint[0], g: tint[1], b: tint[2] } as any);
}

function _captureOrigParams(inst: any): void {
  if (inst._origParams) return;
  inst._origParams = new Map();
  for (let mi = 0; mi < inst.meshes.length; mi++) {
    const sm = inst.meshes[mi].material as StandardMaterial;
    if (!sm) continue;
    inst._origParams.set(mi, {
      diffuseR: sm.diffuseColor.r, diffuseG: sm.diffuseColor.g, diffuseB: sm.diffuseColor.b,
      specularR: sm.specularColor.r, specularG: sm.specularColor.g, specularB: sm.specularColor.b,
      specularPower: sm.specularPower,
      ambientR: sm.ambientColor.r, ambientG: sm.ambientColor.g, ambientB: sm.ambientColor.b,
    });
  }
}

export async function applyOutfitVariant(id: string, variantName: string): Promise<void> {
  const inst = modelRegistry.get(id);
  if (!inst || !inst.outfitFile) return;
  const variant = variantName === "默认" ? undefined : inst.outfitFile.variants.find(v => v.name === variantName);
  if (!variant && variantName !== "默认") return;

  if (!inst._origTextures) {
    inst._origTextures = new Map();
    for (let mi = 0; mi < inst.meshes.length; mi++) {
      const sm = inst.meshes[mi].material as StandardMaterial;
      if (!sm) continue;
      inst._origTextures.set(mi, {
        diffuse: sm.diffuseTexture as Texture | null,
        toon: (sm as any).toonTexture as Texture | null,
        spa: (sm as any).sphereTexture as Texture | null,
        normal: sm.bumpTexture as Texture | null,
        emissive: sm.emissiveTexture as Texture | null,
      });
    }
  }
  _captureOrigParams(inst);

  const promises: Promise<void>[] = [];
  for (let mi = 0; mi < inst.meshes.length; mi++) {
    const sm = inst.meshes[mi].material as StandardMaterial;
    if (!sm) continue;
    const origTex = inst._origTextures.get(mi);
    if (!origTex) continue;
    const origParams = inst._origParams.get(mi)!;
    const cat = _catOf(sm.name);

    promises.push(_applySlot(sm, "diffuseTexture", _getSlotFor(variant, sm.name, cat, "diffuse"), origTex.diffuse, inst.port));
    promises.push(_applySlot(sm, "toonTexture", _getSlotFor(variant, sm.name, cat, "toon"), origTex.toon, inst.port));
    promises.push(_applySlot(sm, "sphereTexture", _getSlotFor(variant, sm.name, cat, "spa"), origTex.spa, inst.port));
    promises.push(_applySlot(sm, "bumpTexture", _getSlotFor(variant, sm.name, cat, "normal"), origTex.normal, inst.port));
    promises.push(_applySlot(sm, "emissiveTexture", _getSlotFor(variant, sm.name, cat, "emissive"), origTex.emissive, inst.port));

    const slotParams = _getParamsFor(variant, sm.name, cat);
    if (slotParams) _applyOutfitParams(sm, slotParams, origParams);

    const tint = _getTintFor(variant, sm.name, cat);
    if (tint) _applyOutfitTint(sm, tint);
  }

  await Promise.all(promises);
  inst.activeVariant = variantName;
  setStatus(`✓ 已切换服装: ${variantName}`, true);
  triggerAutoSave();
}

export function resetOutfit(id: string): void {
  const inst = modelRegistry.get(id);
  if (!inst) return;
  if (inst._origTextures) {
    for (let mi = 0; mi < inst.meshes.length; mi++) {
      const sm = inst.meshes[mi].material as StandardMaterial;
      if (!sm) continue;
      const orig = inst._origTextures.get(mi);
      if (!orig) continue;
      _applySlot(sm, "diffuseTexture", null, orig.diffuse, inst.port);
      _applySlot(sm, "toonTexture", null, orig.toon, inst.port);
      _applySlot(sm, "sphereTexture", null, orig.spa, inst.port);
      _applySlot(sm, "bumpTexture", null, orig.normal, inst.port);
      _applySlot(sm, "emissiveTexture", null, orig.emissive, inst.port);
    }
  }
  if (inst._origParams) {
    for (let mi = 0; mi < inst.meshes.length; mi++) {
      const sm = inst.meshes[mi].material as StandardMaterial;
      if (!sm) continue;
      const p = inst._origParams.get(mi);
      if (!p) continue;
      sm.diffuseColor.set(p.diffuseR, p.diffuseG, p.diffuseB);
      sm.specularColor.set(p.specularR, p.specularG, p.specularB);
      sm.specularPower = p.specularPower;
      sm.ambientColor.set(p.ambientR, p.ambientG, p.ambientB);
    }
  }
  inst.activeVariant = undefined;
  inst.outfitFile = undefined;
  inst._origTextures = undefined;
  inst._origParams = undefined;
  triggerAutoSave();
}
