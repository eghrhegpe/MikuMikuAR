import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { ModelInstance } from '@/core/types';
import { modelRegistry } from '@/core/scene-state';

interface _WetnessOrigState {
    roughness?: number;
    specularPower?: number;
    specularR?: number;
    specularG?: number;
    specularB?: number;
    diffuseR?: number;
    diffuseG?: number;
    diffuseB?: number;
}

let _wetnessActive = false;
const _originalMaterialState = new Map<number, _WetnessOrigState>();

const WET_ROUGHNESS_FACTOR = 0.5;
const WET_ROUGHNESS_MIN = 0.1;
const WET_SPECULAR_POWER_FACTOR = 2.0;
const WET_SPECULAR_COLOR_FACTOR = 1.3;
const WET_DIFFUSE_FACTOR = 0.85;

function _applyWetnessToMaterial(mat: Material): void {
    if (_originalMaterialState.has(mat.uniqueId)) {
        return;
    }
    if (mat instanceof PBRMaterial) {
        _originalMaterialState.set(mat.uniqueId, { roughness: mat.roughness });
        mat.roughness = Math.max(WET_ROUGHNESS_MIN, mat.roughness * WET_ROUGHNESS_FACTOR);
    } else if (mat instanceof StandardMaterial) {
        _originalMaterialState.set(mat.uniqueId, {
            specularPower: mat.specularPower,
            specularR: mat.specularColor.r,
            specularG: mat.specularColor.g,
            specularB: mat.specularColor.b,
            diffuseR: mat.diffuseColor.r,
            diffuseG: mat.diffuseColor.g,
            diffuseB: mat.diffuseColor.b,
        });
        mat.specularPower = mat.specularPower * WET_SPECULAR_POWER_FACTOR;
        mat.specularColor.r = Math.min(1, mat.specularColor.r * WET_SPECULAR_COLOR_FACTOR);
        mat.specularColor.g = Math.min(1, mat.specularColor.g * WET_SPECULAR_COLOR_FACTOR);
        mat.specularColor.b = Math.min(1, mat.specularColor.b * WET_SPECULAR_COLOR_FACTOR);
        mat.diffuseColor.r = mat.diffuseColor.r * WET_DIFFUSE_FACTOR;
        mat.diffuseColor.g = mat.diffuseColor.g * WET_DIFFUSE_FACTOR;
        mat.diffuseColor.b = mat.diffuseColor.b * WET_DIFFUSE_FACTOR;
    }
}

function _restoreMaterialState(mat: Material): void {
    const orig = _originalMaterialState.get(mat.uniqueId);
    if (!orig) {
        return;
    }
    if (mat instanceof PBRMaterial && orig.roughness !== undefined) {
        mat.roughness = orig.roughness;
    } else if (mat instanceof StandardMaterial) {
        if (orig.specularPower !== undefined) {
            mat.specularPower = orig.specularPower;
        }
        if (orig.specularR !== undefined) {
            mat.specularColor.r = orig.specularR;
            mat.specularColor.g = orig.specularG;
            mat.specularColor.b = orig.specularB;
        }
        if (orig.diffuseR !== undefined) {
            mat.diffuseColor.r = orig.diffuseR;
            mat.diffuseColor.g = orig.diffuseG;
            mat.diffuseColor.b = orig.diffuseB;
        }
    }
    _originalMaterialState.delete(mat.uniqueId);
}

export function applyWetnessToAllModels(): void {
    if (_wetnessActive) {
        return;
    }
    _wetnessActive = true;
    _originalMaterialState.clear();
    for (const [, inst] of modelRegistry) {
        if (!inst.meshes) {
            continue;
        }
        for (const mesh of inst.meshes) {
            const mat = mesh.material;
            if (!mat) {
                continue;
            }
            _applyWetnessToMaterial(mat);
        }
    }
}

export function removeWetnessFromAllModels(): void {
    if (!_wetnessActive) {
        return;
    }
    _wetnessActive = false;
    for (const [, inst] of modelRegistry) {
        if (!inst.meshes) {
            continue;
        }
        for (const mesh of inst.meshes) {
            const mat = mesh.material;
            if (!mat) {
                continue;
            }
            _restoreMaterialState(mat);
        }
    }
    _originalMaterialState.clear();
}

export function isWetnessActive(): boolean {
    return _wetnessActive;
}

export function applyWetnessToInst(inst: ModelInstance): void {
    if (!_wetnessActive) {
        return;
    }
    if (!inst.meshes) {
        return;
    }
    for (const mesh of inst.meshes) {
        const mat = mesh.material;
        if (!mat) {
            continue;
        }
        _applyWetnessToMaterial(mat);
    }
}
