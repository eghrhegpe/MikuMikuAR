// [doc:architecture] Env Wetness — 材质湿润视觉特效
// 职责: 修改模型材质的 roughness/specular/diffuse 参数模拟被淋湿的外观，
//       非物理湿度模拟（不涉及水滴、湿度计、物理吸附等）。
// 依赖: modelRegistry（遍历所有模型材质）
// 注意: 本模块名"wetness"是历史命名，实际只做视觉层面的材质参数调整。

import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { ModelInstance } from '@/core/types';
import { modelRegistry } from '@/core/scene-state';

/** 湿身前的原始参数基线。[doc:adr-276] 按材质类型写成两支完整记录：
 *  旧版是「全字段 optional」的扁结构，写入端其实总是成套写，结果恢复端不得不对每个字段
 *  单独判空（且 r/g/b 只判了 r，是靠写入习惯而不是类型保证的）。换成判别联合后，
 *  恢复端只按 kind 分流，字段缺失在编译期就不可表达。
 *  roughness 保留 Babylon 的 Nullable<number>：null = 未设定（交给粗糙度贴图/默认值），
 *  必须原样记下来才能原样还原。 */
type _WetnessOrigState =
    | { kind: 'pbr'; roughness: number | null }
    | {
          kind: 'standard';
          specularPower: number;
          specularR: number;
          specularG: number;
          specularB: number;
          diffuseR: number;
          diffuseG: number;
          diffuseB: number;
      };

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
        _originalMaterialState.set(mat.uniqueId, { kind: 'pbr', roughness: mat.roughness });
        // [doc:adr-276] roughness 为 null 时原实现靠 JS 把 null 强制转 0（→ 落到 MIN 下限），
        // 这里用 ?? 0 显式复刻同一视觉幅度，不借类型收窄顺手改行为。
        const baseRoughness = mat.roughness ?? 0;
        mat.roughness = Math.max(WET_ROUGHNESS_MIN, baseRoughness * WET_ROUGHNESS_FACTOR);
    } else if (mat instanceof StandardMaterial) {
        _originalMaterialState.set(mat.uniqueId, {
            kind: 'standard',
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
    if (orig.kind === 'pbr' && mat instanceof PBRMaterial) {
        mat.roughness = orig.roughness;
    } else if (orig.kind === 'standard' && mat instanceof StandardMaterial) {
        mat.specularPower = orig.specularPower;
        mat.specularColor.r = orig.specularR;
        mat.specularColor.g = orig.specularG;
        mat.specularColor.b = orig.specularB;
        mat.diffuseColor.r = orig.diffuseR;
        mat.diffuseColor.g = orig.diffuseG;
        mat.diffuseColor.b = orig.diffuseB;
    }
    _originalMaterialState.delete(mat.uniqueId);
}

/** 对所有已加载模型应用湿身材质效果（幂等）。 */
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

/** 移除所有模型的湿身材质效果（幂等）。 */
export function removeWetnessFromAllModels(): void {
    if (!_wetnessActive) {
        return;
    }
    try {
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
    } finally {
        _wetnessActive = false;
        _originalMaterialState.clear();
    }
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
