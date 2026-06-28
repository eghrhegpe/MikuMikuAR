// Material system for MikuMikuAR — category-based and per-material param adjustment.
// Extracted from scene.ts L1674-1978.

import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Material } from "@babylonjs/core/Materials/material";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { modelRegistry } from "../core/config";
import { triggerAutoSave } from "../core/config";

export type MaterialCategoryParams = {
    diffuseMul: number;
    specularMul: number;
    shininess: number;
    ambientMul: number;
};

const CATEGORIES = ["皮肤", "头发", "眼睛", "服装"] as const;
export type MaterialCategory = typeof CATEGORIES[number];

interface _OrigMat {
    diffuse: Color3;
    specular: Color3;
    specularPower: number;
    ambient: Color3;
}

const _origValues = new WeakMap<Material, _OrigMat>();

/** @internal exported for testing */
export const _catState = new Map<string, Map<string, MaterialCategoryParams>>();
/** @internal exported for testing */
export const _matState = new Map<string, Map<number, MaterialCategoryParams>>();
/** @internal exported for testing */
export const _matEnabled = new Map<string, Map<number, boolean>>();

/** @internal exported for testing */
export function _catOf(name: string): MaterialCategory {
    const l = name.toLowerCase();
    if (/skin|face|肌|顔|body|neck|首|cheek|頬|kihada/.test(l)) return "皮肤";
    if (/hair|髪|ahoge/.test(l)) return "头发";
    if (/eye|目|iris|瞳|白目|pupil/.test(l)) return "眼睛";
    return "服装";
}

function _capture(mat: Material): void {
    if (_origValues.has(mat)) return;
    const sm = mat as StandardMaterial;
    _origValues.set(mat, {
        diffuse: sm.diffuseColor.clone(),
        specular: sm.specularColor.clone(),
        specularPower: sm.specularPower,
        ambient: sm.ambientColor.clone(),
    });
}

/** @internal exported for testing */
export function _applyAll(id: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) return;
    const state = _catState.get(id);
    if (!state) return;
    const perMat = _matState.get(id);
    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const mesh = inst.meshes[mi];
        const m = mesh.material as StandardMaterial;
        if (!m) continue;
        _capture(m);
        const o = _origValues.get(m)!;
        const p = state.get(_catOf(m.name));
        if (!p) continue;
        m.diffuseColor.set(o.diffuse.r * p.diffuseMul, o.diffuse.g * p.diffuseMul, o.diffuse.b * p.diffuseMul);
        m.specularColor.set(o.specular.r * p.specularMul, o.specular.g * p.specularMul, o.specular.b * p.specularMul);
        m.specularPower = p.shininess;
        m.ambientColor.set(o.ambient.r * p.ambientMul, o.ambient.g * p.ambientMul, o.ambient.b * p.ambientMul);
        const mp = perMat?.get(mi);
        if (mp) {
            m.diffuseColor.set(o.diffuse.r * mp.diffuseMul, o.diffuse.g * mp.diffuseMul, o.diffuse.b * mp.diffuseMul);
            m.specularColor.set(o.specular.r * mp.specularMul, o.specular.g * mp.specularMul, o.specular.b * mp.specularMul);
            m.specularPower = mp.shininess;
            m.ambientColor.set(o.ambient.r * mp.ambientMul, o.ambient.g * mp.ambientMul, o.ambient.b * mp.ambientMul);
        }
    }
}

function _ensureState(id: string): Map<string, MaterialCategoryParams> {
    let m = _catState.get(id);
    if (m) return m;
    m = new Map();
    for (const c of CATEGORIES) m.set(c, { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 });
    _catState.set(id, m);
    return m;
}

export function isMatEnabled(id: string, matIndex: number): boolean {
    return _matEnabled.get(id)?.get(matIndex) ?? true;
}

export function setMatEnabled(id: string, matIndex: number, enabled: boolean): void {
    const inst = modelRegistry.get(id);
    if (!inst || matIndex < 0 || matIndex >= inst.meshes.length) return;
    const current = isMatEnabled(id, matIndex);
    if (current === enabled) return;
    inst.meshes[matIndex].setEnabled(enabled);
    if (enabled) {
        _matEnabled.get(id)?.delete(matIndex);
    } else {
        let m = _matEnabled.get(id);
        if (!m) { m = new Map(); _matEnabled.set(id, m); }
        m.set(matIndex, false);
    }
    triggerAutoSave();
}

export function getMatCatGroups(id: string): Map<string, { name: string; mat: Material }[]> {
    const groups = new Map<string, { name: string; mat: Material }[]>();
    const inst = modelRegistry.get(id);
    if (!inst) return groups;
    for (const mesh of inst.meshes) {
        const m = mesh.material;
        if (!m || !(m instanceof StandardMaterial)) continue;
        const cat = _catOf(m.name);
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push({ name: m.name, mat: m });
    }
    return groups;
}

export function getMatCatParams(id: string, cat: string): MaterialCategoryParams {
    return { ..._ensureState(id).get(cat)! };
}

export function setMatCatParams(id: string, cat: string, params: Partial<MaterialCategoryParams>): void {
    Object.assign(_ensureState(id).get(cat)!, params);
    _applyAll(id);
    triggerAutoSave();
}

export function resetMatCatParams(id: string): void {
    _catState.delete(id);
    const inst = modelRegistry.get(id);
    if (!inst) return;
    for (const mesh of inst.meshes) {
        const m = mesh.material as StandardMaterial;
        if (!m) continue;
        const o = _origValues.get(m);
        if (o) {
            m.diffuseColor.copyFrom(o.diffuse);
            m.specularColor.copyFrom(o.specular);
            m.specularPower = o.specularPower;
            m.ambientColor.copyFrom(o.ambient);
        }
    }
    triggerAutoSave();
}

function _ensureMatState(id: string): Map<number, MaterialCategoryParams> {
    let m = _matState.get(id);
    if (m) return m;
    m = new Map();
    _matState.set(id, m);
    return m;
}

export function getMatDetailList(id: string): { name: string; index: number; params: MaterialCategoryParams; modified: boolean }[] {
    const result: { name: string; index: number; params: MaterialCategoryParams; modified: boolean }[] = [];
    const inst = modelRegistry.get(id);
    if (!inst) return result;
    const perMat = _matState.get(id);
    for (let mi = 0; mi < inst.meshes.length; mi++) {
        const m = inst.meshes[mi].material as StandardMaterial;
        if (!m) continue;
        const mp = perMat?.get(mi);
        const params: MaterialCategoryParams = mp
            ? { ...mp }
            : { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
        result.push({ name: m.name, index: mi, params, modified: !!mp });
    }
    return result;
}

export function getMatParams(id: string, matIndex: number): MaterialCategoryParams | null {
    const entry = _matState.get(id)?.get(matIndex);
    return entry ? { ...entry } : null;
}

export function setMatParams(id: string, matIndex: number, params: Partial<MaterialCategoryParams>): void {
    const inst = modelRegistry.get(id);
    if (!inst || matIndex < 0 || matIndex >= inst.meshes.length) {
        console.warn(`setMatParams: invalid matIndex ${matIndex} for model "${id}" (${inst ? inst.meshes.length : 0} meshes)`);
        return;
    }
    const state = _ensureMatState(id);
    let entry = state.get(matIndex);
    if (!entry) {
        entry = { diffuseMul: 1, specularMul: 1, shininess: 50, ambientMul: 1 };
        state.set(matIndex, entry);
    }
    if (params.diffuseMul !== undefined) entry.diffuseMul = Math.max(0, Math.min(2, params.diffuseMul));
    if (params.specularMul !== undefined) entry.specularMul = Math.max(0, Math.min(2, params.specularMul));
    if (params.shininess !== undefined) entry.shininess = Math.max(0, Math.min(200, Math.round(params.shininess)));
    if (params.ambientMul !== undefined) entry.ambientMul = Math.max(0, Math.min(2, params.ambientMul));
    _applyAll(id);
    triggerAutoSave();
}

export function resetSingleMatParams(id: string, matIndex: number): void {
    const inst = modelRegistry.get(id);
    if (!inst || matIndex < 0 || matIndex >= inst.meshes.length) {
        console.warn(`resetSingleMatParams: invalid matIndex ${matIndex} for model "${id}"`);
        return;
    }
    _matState.get(id)?.delete(matIndex);
    _applyAll(id);
    triggerAutoSave();
}

export function resetAllMatParams(id: string): void {
    _matState.delete(id);
    _applyAll(id);
    triggerAutoSave();
}

export function getMatState(id: string): {
    categories: Record<string, MaterialCategoryParams>;
    overrides: Record<number, MaterialCategoryParams>;
} | null {
    const catState = _catState.get(id);
    const matState = _matState.get(id);
    if (!catState && !matState) return null;
    const categories: Record<string, MaterialCategoryParams> = {};
    if (catState) {
        for (const [cat, params] of catState) {
            categories[cat] = { ...params };
        }
    }
    const overrides: Record<number, MaterialCategoryParams> = {};
    if (matState) {
        for (const [idx, params] of matState) {
            overrides[idx] = { ...params };
        }
    }
    return { categories, overrides };
}

export function applyMatState(id: string, state: {
    categories?: Record<string, MaterialCategoryParams>;
    overrides?: Record<number, MaterialCategoryParams>;
}): void {
    if (state.categories) {
        for (const [cat, params] of Object.entries(state.categories)) {
            setMatCatParams(id, cat as MaterialCategory, params);
        }
    }
    if (state.overrides) {
        for (const [idxStr, params] of Object.entries(state.overrides)) {
            const idx = parseInt(idxStr, 10);
            setMatParams(id, idx, params);
        }
    }
}
