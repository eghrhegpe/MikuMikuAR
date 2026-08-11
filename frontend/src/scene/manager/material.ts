// Material system for MikuMikuAR — category-based and per-material param adjustment.
// Extracted from scene.ts L1674-1978.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

import { modelRegistry, uiState } from '@/core/config';
import { triggerAutoSave } from '@/core/config';
import { clamp01 } from '@/core/clamp';
import { logWarn } from '../../core/logger';
import type { MmdStandardMaterial } from '../../core/types';
import { getMatSssState, applyMatSssState, disposeModelSssState, type SssParams } from './material-sss';

// [ADR-188] SSS 材质类型定义（PBRMaterial 子类，由材料系统识别）
export type SssMaterial = PBRMaterial;

export interface AlphaCtx {
    opacity: number;
    origAlpha: number[];
}

// ======== 按 id 查询 meshes ========

/** 按 id 查询 meshes（modelRegistry 单源，ADR-215 后外部注册表已废弃）。 */
function _getMeshesById(id: string): Mesh[] | undefined {
    return modelRegistry.get(id)?.meshes;
}

export type MaterialCategoryParams = {
    diffuseMul: number;
    specularMul: number;
    shininess: number;
    ambientMul: number;
    emissiveMul: number;
    diffuseTexLevel: number;
    bumpTexLevel: number;
    toonTexLevel: number;
    sphereTexLevel: number;
    emissiveTexLevel: number;
    alphaMul: number;
};

const CATEGORIES = ['皮肤', '头发', '眼睛', '服装', '配件', '道具'] as const;
export type MaterialCategory = (typeof CATEGORIES)[number];
const CATEGORY_SET = new Set<string>(CATEGORIES);

interface _OrigMat {
    diffuse: Color3;
    specular: Color3;
    specularPower: number;
    ambient: Color3;
    emissive: Color3;
    diffuseTexLevel: number;
    bumpTexLevel: number;
    toonTexLevel: number;
    sphereTexLevel: number;
    emissiveTexLevel: number;
    alpha: number;
}

/** 材质参数默认值 — 所有新增字段在此维护，消除散落硬编码。 */
export const DEFAULT_MAT_PARAMS: MaterialCategoryParams = {
    diffuseMul: 1,
    specularMul: 1,
    shininess: 50,
    ambientMul: 1,
    emissiveMul: 1,
    diffuseTexLevel: 1,
    bumpTexLevel: 1,
    toonTexLevel: 1,
    sphereTexLevel: 1,
    emissiveTexLevel: 1,
    alphaMul: 1,
};

/** 各参数的 clamp 规则：[min, max, round] */
const CLAMP_RULES: Record<keyof MaterialCategoryParams, [number, number, boolean]> = {
    diffuseMul: [0, 2, false],
    specularMul: [0, 2, false],
    shininess: [0, 200, true],
    ambientMul: [0, 2, false],
    emissiveMul: [0, 2, false],
    diffuseTexLevel: [0, 3, false],
    bumpTexLevel: [0, 3, false],
    toonTexLevel: [0, 3, false],
    sphereTexLevel: [0, 3, false],
    emissiveTexLevel: [0, 3, false],
    alphaMul: [0, 1, false],
};

/** 将 Partial 参数 clamp 后写入 target — 消除 setMatCatParams / setMatParams 的重复 clamp 逻辑。
 *  [fix P2] target 支持 Partial（per-mat entry 仅存显式字段）。 */
function _clampAndAssign(
    target: MaterialCategoryParams | Partial<MaterialCategoryParams>,
    params: Partial<MaterialCategoryParams>
): void {
    for (const key of Object.keys(params) as (keyof MaterialCategoryParams)[]) {
        const val = params[key];
        if (val === undefined) {
            continue;
        }
        const [min, max, round] = CLAMP_RULES[key];
        target[key] = round
            ? Math.max(min, Math.min(max, Math.round(val)))
            : Math.max(min, Math.min(max, val));
    }
}

/** [fix P2] 合并分类参数与 per-mat 显式字段：未显式设置的 per-mat 字段继承分类结果，
 *  消除「per-mat 存在即以 DEFAULT 全量覆盖 category」的遮蔽问题。 */
function _mergedMatParams(
    catParams: MaterialCategoryParams | undefined,
    perMatParams: Partial<MaterialCategoryParams> | undefined
): MaterialCategoryParams {
    return { ...(catParams ?? DEFAULT_MAT_PARAMS), ...(perMatParams ?? {}) };
}

/** 将一组参数写入 Babylon StandardMaterial — 消除 _applyAll 中分类级与逐材质级的重复写入。 */
function _applyParamsToMaterial(
    m: StandardMaterial,
    mmdMat: MmdStandardMaterial,
    o: _OrigMat,
    p: MaterialCategoryParams,
    alphaCtx?: AlphaCtx
): void {
    m.diffuseColor.set(
        o.diffuse.r * p.diffuseMul,
        o.diffuse.g * p.diffuseMul,
        o.diffuse.b * p.diffuseMul
    );
    m.specularColor.set(
        o.specular.r * p.specularMul,
        o.specular.g * p.specularMul,
        o.specular.b * p.specularMul
    );
    m.specularPower = p.shininess;
    m.ambientColor.set(
        o.ambient.r * p.ambientMul,
        o.ambient.g * p.ambientMul,
        o.ambient.b * p.ambientMul
    );
    m.emissiveColor.set(
        o.emissive.r * p.emissiveMul,
        o.emissive.g * p.emissiveMul,
        o.emissive.b * p.emissiveMul
    );
    if (m.diffuseTexture) {
        m.diffuseTexture.level = o.diffuseTexLevel * p.diffuseTexLevel;
    }
    if (m.bumpTexture) {
        m.bumpTexture.level = o.bumpTexLevel * p.bumpTexLevel;
    }
    if (mmdMat.toonTexture) {
        mmdMat.toonTexture.level = o.toonTexLevel * p.toonTexLevel;
    }
    if (mmdMat.sphereTexture) {
        mmdMat.sphereTexture.level = o.sphereTexLevel * p.sphereTexLevel;
    }
    if (m.emissiveTexture) {
        m.emissiveTexture.level = o.emissiveTexLevel * p.emissiveTexLevel;
    }
    if (alphaCtx) {
        const finalAlpha = clamp01(o.alpha * alphaCtx.opacity * p.alphaMul);
        m.alpha = finalAlpha;
        if (finalAlpha < 1) {
            if (m.transparencyMode === Material.MATERIAL_OPAQUE) {
                m.transparencyMode = Material.MATERIAL_ALPHABLEND;
            }
        } else {
            m.transparencyMode = Material.MATERIAL_OPAQUE;
        }
    }
}

const _origValues = new WeakMap<Material, _OrigMat>();

/** 材质状态管理器 — 集中管理分类/逐材质/可见性状态，便于测试 mock 和未来扩展。 */
export class MaterialStateManager {
    catState = new Map<string, Map<string, MaterialCategoryParams>>();
    // [fix P2] per-mat 存 Partial（仅显式设置的字段）：apply 时与分类参数合并，
    // 未设置的字段继承分类调整——否则新建 entry 用 DEFAULT 全量初始化会遮蔽
    // category 级 alphaMul 等调整。
    matState = new Map<string, Map<number, Partial<MaterialCategoryParams>>>();
    matEnabled = new Map<string, Map<number, boolean>>();

    dispose(id: string): void {
        this.catState.delete(id);
        this.matState.delete(id);
        this.matEnabled.delete(id);
    }

    clear(): void {
        this.catState.clear();
        this.matState.clear();
        this.matEnabled.clear();
    }
}

const _stateMgr = new MaterialStateManager();

/** @internal 直接访问底层 Map（仅用于兼容存量代码和测试）。新代码应优先使用 MaterialStateManager 实例。 */
export const _catState = _stateMgr.catState;
/** @internal 直接访问底层 Map（仅用于兼容存量代码和测试）。 */
export const _matState = _stateMgr.matState;
/** @internal 直接访问底层 Map（仅用于兼容存量代码和测试）。 */
export const _matEnabled = _stateMgr.matEnabled;
/** @internal exported for testing — 可注入 mock 实例 */
const _materialStateManager = _stateMgr;

/** 材质分类关键词表（按优先级排序）。
 *  用户可通过 uiState.materialCategoryMap 覆盖默认规则。
 *  提取为命名常量便于集中维护和本地化扩展。 */
const MATERIAL_KEYWORDS: Record<MaterialCategory, string[]> = {
    服装: [
        '裙',
        '衣',
        '服',
        'cloth',
        'dress',
        'skirt',
        'sleeve',
        'collar',
        'belt',
        '袴',
        '袖',
        '襟',
        '帯',
        '外套',
        '胖次',
        '带',
    ],
    配件: [
        '帽',
        '鞋',
        '飾',
        'accessory',
        'acc',
        'ring',
        'earring',
        'necklace',
        'bracelet',
        '蝶结',
        '结',
        '星星',
        '领带',
        '扣',
    ],
    眼睛: [
        '眼',
        '目',
        'eye',
        'iris',
        '瞳',
        '白目',
        'pupil',
        'eyebrow',
        '眉',
        'eyelash',
        '睫毛',
        '泪',
        '表情',
    ],
    头发: [
        '发',
        '髪',
        '頭',
        'hair',
        'ahoge',
        '前髪',
        '後髪',
        'まとめ髪',
        'ponytail',
        'braid',
        '刘海',
        '呆毛',
        '辫子',
        '侧发',
        '后发',
        '后脑',
    ],
    皮肤: [
        '皮',
        '肌',
        '肤',
        'skin',
        'face',
        'body',
        'neck',
        '顔',
        '首',
        'cheek',
        '頬',
        'kihada',
        '嘴',
        '唇',
        '齿',
        '牙',
        '舌',
        '口',
        'lip',
        'tooth',
        'teeth',
        'tongue',
        '体',
        '臂',
        '指',
        '甲',
        '手',
        '足',
        '腿',
        '脚',
        '背',
        '胸',
        '腹',
        '腰',
    ],
    道具: [
        '武',
        '刀',
        '剑',
        '枪',
        '矛',
        '弓',
        '矢',
        'weapon',
        'gun',
        'sword',
        'shield',
        'rod',
        'staff',
        'blade',
        'axe',
        'bow',
        'arrow',
    ],
};

const CATEGORY_RULES: [string[], MaterialCategory][] = Object.entries(MATERIAL_KEYWORDS).map(
    ([cat, keywords]) => [keywords, cat as MaterialCategory]
);

function _catOfUncached(name: string): MaterialCategory {
    const customMap = uiState.materialCategoryMap;
    if (customMap) {
        for (const [pattern, category] of Object.entries(customMap)) {
            try {
                if (new RegExp(pattern, 'i').test(name)) {
                    return category as MaterialCategory;
                }
            } catch {
                logWarn('material', 'invalid category pattern:', pattern);
            }
        }
    }

    const lowerName = name.toLowerCase();
    for (const [keywords, cat] of CATEGORY_RULES) {
        if (keywords.some((k) => lowerName.includes(k))) {
            return cat;
        }
    }
    return '服装';
}

/**
 * Resolve the display category (皮肤 / 头发 / 眼睛 / 服装 …) for a material or its
 * material name. `Material` instances are cached per instance; raw-name lookups
 * delegate to `_catOfUncached` (which honours `uiState.materialCategoryMap`).
 */
export function getMaterialCategory(mat: Material | string): MaterialCategory {
    if (typeof mat === 'string') {
        return _catOfUncached(mat);
    }
    // [fix stale-cache] 委托带 mapRef 键的 _catCache（感知 materialCategoryMap 变更），
    // 不再使用不感知变更的 _matCategoryCache（幽灵路径：outfit 命中陈旧分类）。
    return categoryOfMaterial(mat);
}

/**
 * Per-material category cache.
 * Material names are immutable, but the resolved category also depends on
 * `uiState.materialCategoryMap` (user-overridable at runtime). We therefore
 * key the cache by the *current* map reference and recompute whenever it
 * changes, keeping the hot path in `_applyAll` free of repeated string scans
 * without risking staleness. WeakMap ⇒ no retention after a Material is disposed.
 */
const _catCache = new WeakMap<Material, { mapRef: unknown; cat: MaterialCategory }>();

function categoryOfMaterial(mat: Material): MaterialCategory {
    const mapRef = uiState.materialCategoryMap ?? null;
    const hit = _catCache.get(mat);
    if (hit && hit.mapRef === mapRef) {
        return hit.cat;
    }
    const cat = getMaterialCategory(mat.name);
    _catCache.set(mat, { mapRef, cat });
    return cat;
}

/** @internal exported for testing + pre-capture in scene-loader */
export function _capture(mat: Material, mi = 0, origAlpha: number[] = []): void {
    if (_origValues.has(mat) || !(mat instanceof StandardMaterial)) {
        return;
    }
    const mmdMat = mat as MmdStandardMaterial;
    _origValues.set(mat, {
        diffuse: mat.diffuseColor.clone(),
        specular: mat.specularColor.clone(),
        specularPower: mat.specularPower,
        ambient: mat.ambientColor.clone(),
        emissive: mat.emissiveColor.clone(),
        diffuseTexLevel: mat.diffuseTexture?.level ?? 1,
        bumpTexLevel: mat.bumpTexture?.level ?? 1,
        toonTexLevel: mmdMat.toonTexture?.level ?? 1,
        sphereTexLevel: mmdMat.sphereTexture?.level ?? 1,
        emissiveTexLevel: mat.emissiveTexture?.level ?? 1,
        alpha: origAlpha[mi] ?? 1,
    });
}

// ======== ADR-188: PBRMaterial 分支 ========

/** PBRMaterial 原始值缓存（与 _OrigMat 对应的 PBR 版） */
interface _OrigPbr {
    albedo: Color3;
    reflection: Color3;
    roughness: number;
    metallic: number;
    ambient: Color3;
    emissive: Color3;
    albedoTexLevel: number;
    bumpTexLevel: number;
    emissiveTexLevel: number;
    alpha: number;
    /** 捕获时的透明度模式基线（用于区分「本代码切到 ALPHABLEND」与「模型自设 ALPHATEST/ALPHABLEND」） */
    transparencyMode: number;
}

const _origPbrValues = new WeakMap<PBRMaterial, _OrigPbr>();

export function _isPbrMaterial(mat: Material): mat is PBRMaterial {
    return mat instanceof PBRMaterial;
}

/** 公开 type guard — 供外部模块（如 SSS、材质编辑器）使用 */
export { _isPbrMaterial as isPbrMaterial };

/** PBRMaterial 参数捕获（对应 _capture 的 PBR 版） */
export function _capturePbr(mat: PBRMaterial, mi = 0, origAlpha: number[] = []): void {
    if (_origPbrValues.has(mat)) {
        return;
    }
    _origPbrValues.set(mat, {
        albedo: mat.albedoColor.clone(),
        reflection: mat.reflectionColor.clone(),
        roughness: mat.roughness,
        metallic: mat.metallic,
        ambient: mat.ambientColor.clone(),
        emissive: mat.emissiveColor.clone(),
        albedoTexLevel: mat.albedoTexture?.level ?? 1,
        bumpTexLevel: mat.bumpTexture?.level ?? 1,
        emissiveTexLevel: mat.emissiveTexture?.level ?? 1,
        alpha: origAlpha[mi] ?? 1,
        transparencyMode: mat.transparencyMode,
    });
}

/** 将 MaterialCategoryParams 映射为 PBRMaterial 属性
 *  映射关系（与 StandardMaterial 语义对齐）：
 *  - diffuseMul   → albedoColor 乘率
 *  - specularMul  → reflectionColor 乘率
 *  - shininess    → roughness = (200 - shininess) / 200（反比，50→0.75）
 *  - ambientMul   → ambientColor 乘率
 *  - emissiveMul  → emissiveColor 乘率
 *  - diffuseTexLevel → albedoTexture.level
 *  - bumpTexLevel   → bumpTexture.level（语义一致）
 *  - emissiveTexLevel → emissiveTexture.level（语义一致）
 *  - alphaMul     → alpha
 *  - toonTexLevel / sphereTexLevel → 静默忽略（PBR 不支持）
 */
function _applyPbrMatParams(
    mat: PBRMaterial,
    orig: _OrigPbr,
    p: MaterialCategoryParams,
    alphaCtx?: AlphaCtx
): void {
    // albedo（对应 diffuse）
    mat.albedoColor = orig.albedo.scale(p.diffuseMul);
    // reflection（对应 specular）
    mat.reflectionColor = orig.reflection.scale(p.specularMul);
    // roughness（shininess 反比：0=极光滑，200=极粗糙 → 0=极粗糙，1=极光滑）
    mat.roughness = clamp01((200 - p.shininess) / 200);
    // ambient
    mat.ambientColor = orig.ambient.scale(p.ambientMul);
    // emissive
    mat.emissiveColor = orig.emissive.scale(p.emissiveMul);
    // 纹理级别
    if (mat.albedoTexture) {
        mat.albedoTexture.level = orig.albedoTexLevel * p.diffuseTexLevel;
    }
    if (mat.bumpTexture) {
        mat.bumpTexture.level = orig.bumpTexLevel * p.bumpTexLevel;
    }
    if (mat.emissiveTexture) {
        mat.emissiveTexture.level = orig.emissiveTexLevel * p.emissiveTexLevel;
    }
    // alpha（对齐 StandardMaterial 分支语义：opacity 乘子 + clamp + transparencyMode 切换）
    // [fix P2] 仅还原「本代码从 OPAQUE 切到 ALPHABLEND」的材质；模型自设的
    // ALPHATEST/ALPHABLEND（如 alpha 纹理头发/蕾丝）不得被强制改回 OPAQUE。
    if (alphaCtx) {
        const finalAlpha = clamp01(orig.alpha * alphaCtx.opacity * p.alphaMul);
        mat.alpha = finalAlpha;
        if (finalAlpha < 1) {
            if (mat.transparencyMode === Material.MATERIAL_OPAQUE) {
                mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
            }
        } else if (orig.transparencyMode === Material.MATERIAL_OPAQUE) {
            // 仅当基线是 OPAQUE（即本代码此前切过 ALPHABLEND）时才还原
            mat.transparencyMode = Material.MATERIAL_OPAQUE;
        }
    }
}

function _applyMaterial(id: string, mi: number, alphaCtx?: AlphaCtx): void {
    const meshes = _getMeshesById(id);
    if (!meshes || mi < 0 || mi >= meshes.length) {
        return;
    }
    const m = meshes[mi].material;
    if (!m) {
        return;
    }
    // PBR 分支（ADR-188）
    if (m instanceof PBRMaterial) {
        _capturePbr(m, mi, alphaCtx?.origAlpha ?? []);
        const o = _origPbrValues.get(m)!;
        let applied = false;
        // [fix P2] category 参数提到外层，per-mat 合并时继承
        let catParams: MaterialCategoryParams | undefined;
        const state = _catState.get(id);
        if (state) {
            const p = state.get(categoryOfMaterial(m));
            if (p) {
                _applyPbrMatParams(m, o, p, alphaCtx);
                applied = true;
                catParams = p;
            }
        }
        const perMat = _matState.get(id);
        if (perMat) {
            const mp = perMat.get(mi);
            if (mp) {
                // [fix P2] 仅 per-mat 显式字段覆盖；未设置字段继承 category 结果
                _applyPbrMatParams(m, o, _mergedMatParams(catParams, mp), alphaCtx);
                applied = true;
            }
        }
        if (!applied && alphaCtx) {
            _applyPbrMatParams(m, o, DEFAULT_MAT_PARAMS, alphaCtx);
        }
        return;
    }
    // StandardMaterial 分支
    if (!(m instanceof StandardMaterial)) {
        return;
    }
    const mmdMat = m as MmdStandardMaterial;
    _capture(m, mi, alphaCtx?.origAlpha ?? []);
    const o = _origValues.get(m)!;
    let applied = false;
    // [fix P2] category 参数提到外层，per-mat 合并时继承
    let catParams: MaterialCategoryParams | undefined;
    const state = _catState.get(id);
    if (state) {
        const p = state.get(categoryOfMaterial(m));
        if (p) {
            _applyParamsToMaterial(m, mmdMat, o, p, alphaCtx);
            applied = true;
            catParams = p;
        }
    }
    const perMat = _matState.get(id);
    if (perMat) {
        const mp = perMat.get(mi);
        if (mp) {
            // [fix P2] 仅 per-mat 显式字段覆盖；未设置字段继承 category 结果
            _applyParamsToMaterial(m, mmdMat, o, _mergedMatParams(catParams, mp), alphaCtx);
            applied = true;
        }
    }
    if (!applied && alphaCtx) {
        _applyParamsToMaterial(m, mmdMat, o, DEFAULT_MAT_PARAMS, alphaCtx);
    }
}

function _applyCategory(id: string, cat: string, alphaCtx?: AlphaCtx): void {
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return;
    }
    const state = _catState.get(id);
    if (!state) {
        return;
    }
    const p = state.get(cat);
    if (!p) {
        return;
    }
    const perMat = _matState.get(id) ?? new Map();
    for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi].material;
        if (!m) {
            continue;
        }
        // PBR 分支（ADR-188）
        if (m instanceof PBRMaterial) {
            if (categoryOfMaterial(m) !== cat) {
                continue;
            }
            _capturePbr(m, mi, alphaCtx?.origAlpha ?? []);
            const o = _origPbrValues.get(m)!;
            _applyPbrMatParams(m, o, p, alphaCtx);
            const mp = perMat.get(mi);
            if (mp) {
                // [fix P2] 仅 per-mat 显式字段覆盖；未设置字段继承分类结果 p
                _applyPbrMatParams(m, o, _mergedMatParams(p, mp), alphaCtx);
            }
            continue;
        }
        // StandardMaterial 分支
        if (!(m instanceof StandardMaterial)) {
            continue;
        }
        if (categoryOfMaterial(m) !== cat) {
            continue;
        }
        const mmdMat = m as MmdStandardMaterial;
        _capture(m, mi, alphaCtx?.origAlpha ?? []);
        const o = _origValues.get(m)!;
        _applyParamsToMaterial(m, mmdMat, o, p, alphaCtx);
        const mp = perMat.get(mi);
        if (mp) {
            // [fix P2] 仅 per-mat 显式字段覆盖；未设置字段继承分类结果 p
            _applyParamsToMaterial(m, mmdMat, o, _mergedMatParams(p, mp), alphaCtx);
        }
    }
}

/** @internal exported for testing */
export function _applyAll(id: string, alphaCtx?: AlphaCtx): void {
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return;
    }
    const state = _catState.get(id);
    if (!state && !alphaCtx && !_matState.has(id)) {
        return;
    }
    for (let mi = 0; mi < meshes.length; mi++) {
        _applyMaterial(id, mi, alphaCtx);
    }
}

function _alphaCtxFor(id: string): AlphaCtx | undefined {
    const inst = modelRegistry.get(id);
    if (!inst) {
        return undefined;
    }
    return { opacity: inst.opacity, origAlpha: inst._origAlpha ?? [] };
}

function _ensureState(id: string): Map<string, MaterialCategoryParams> {
    let m = _catState.get(id);
    if (m) {
        return m;
    }
    m = new Map();
    for (const c of CATEGORIES) {
        m.set(c, { ...DEFAULT_MAT_PARAMS });
    }
    _catState.set(id, m);
    return m;
}

export function isMatEnabled(id: string, matIndex: number): boolean {
    return _matEnabled.get(id)?.get(matIndex) ?? true;
}

export function setMatEnabled(id: string, matIndex: number, enabled: boolean): void {
    const meshes = _getMeshesById(id);
    if (!meshes || matIndex < 0 || matIndex >= meshes.length) {
        return;
    }
    const current = isMatEnabled(id, matIndex);
    if (current === enabled) {
        return;
    }
    meshes[matIndex].setEnabled(enabled);
    if (enabled) {
        _matEnabled.get(id)?.delete(matIndex);
    } else {
        let m = _matEnabled.get(id);
        if (!m) {
            m = new Map();
            _matEnabled.set(id, m);
        }
        m.set(matIndex, false);
    }
    triggerAutoSave();
}

export function getMatCatGroups(id: string): Map<string, { name: string; mat: Material }[]> {
    const groups = new Map<string, { name: string; mat: Material }[]>();
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return groups;
    }
    for (const mesh of meshes) {
        const m = mesh.material;
        if (!m || !(m instanceof StandardMaterial || m instanceof PBRMaterial)) {
            continue;
        }
        const cat = categoryOfMaterial(m);
        if (!groups.has(cat)) {
            groups.set(cat, []);
        }
        groups.get(cat)!.push({ name: m.name, mat: m });
    }
    return groups;
}

export function getMatCatParams(id: string, cat: string): MaterialCategoryParams {
    if (!CATEGORY_SET.has(cat)) {
        logWarn('material', `getMatCatParams: unknown category "${cat}"`);
        return { ...DEFAULT_MAT_PARAMS };
    }
    const state = _catState.get(id);
    if (!state) {
        return { ...DEFAULT_MAT_PARAMS };
    }
    return { ...(state.get(cat) ?? DEFAULT_MAT_PARAMS) };
}

export function setMatCatParams(
    id: string,
    cat: string,
    params: Partial<MaterialCategoryParams>
): void {
    if (!CATEGORY_SET.has(cat)) {
        logWarn('material', `setMatCatParams: unknown category "${cat}"`);
        return;
    }
    const target = _ensureState(id).get(cat)!;
    _clampAndAssign(target, params);
    _applyCategory(id, cat, _alphaCtxFor(id));
    triggerAutoSave();
}

export function resetMatCatParams(id: string): void {
    _catState.delete(id);
    _matState.delete(id);
    _ensureState(id);
    _applyAll(id, _alphaCtxFor(id));
    triggerAutoSave();
}

/**
 * 光照兜底预设：让模型呈现"伪 unlit"状态，不依赖方向光即可正常显示。
 *
 * 适用于 PMX 材质异常（PBR fallback / disableLighting / 漫反射不响应光照）的少数模型。
 * 应用后效果：模型完全靠 ambient + emissive 呈现，看起来像贴纸——失去立体感但保证可见。
 *
 * 实现细节：
 * - diffuseMul→0：去掉对方向光的依赖（避免与异常光照叠加）
 * - ambientMul→2：环境光提到最大，让模型整体可见
 * - emissiveMul→2：自发光提到最大，让贴图颜色充分显示
 * - emissiveTexLevel→2：自发光贴图强度提到最大，配合 emissiveMul
 * - specularMul→0、toonTexLevel→0、sphereTexLevel→0：关闭所有可能引起光照异常的项
 *
 * 该函数仅设置状态值，不持久化到独立字段（与现有 preset/scene-save 复用 materialCategories）。
 * 用户满意后可手动「保存到 preset 库」固化，跨模型 categories 会自动复用。
 */
export function applyUnlitFallback(id: string): void {
    const fallback = {
        diffuseMul: 0,
        specularMul: 0,
        ambientMul: 2,
        emissiveMul: 2,
        toonTexLevel: 0,
        sphereTexLevel: 0,
        emissiveTexLevel: 2,
        // shininess / bumpTexLevel / diffuseTexLevel 保留默认，不影响"伪 unlit"效果
    };
    _matState.delete(id);
    const state = _ensureState(id);
    for (const cat of CATEGORIES) {
        _clampAndAssign(state.get(cat)!, fallback);
    }
    _applyAll(id, _alphaCtxFor(id));
    triggerAutoSave();
}

function _ensureMatState(id: string): Map<number, Partial<MaterialCategoryParams>> {
    let m = _matState.get(id);
    if (m) {
        return m;
    }
    m = new Map();
    _matState.set(id, m);
    return m;
}

export function getMatDetailList(
    id: string
): { name: string; index: number; params: MaterialCategoryParams; modified: boolean }[] {
    const result: {
        name: string;
        index: number;
        params: MaterialCategoryParams;
        modified: boolean;
    }[] = [];
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return result;
    }
    const perMat = _matState.get(id) ?? new Map();
    for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi].material;
        if (!m || !(m instanceof StandardMaterial || m instanceof PBRMaterial)) {
            continue;
        }
        const mp = perMat.get(mi);
        // [fix P2] per-mat 为 Partial：UI 回填须合并 DEFAULT 显示完整值
        const params: MaterialCategoryParams = mp
            ? { ...DEFAULT_MAT_PARAMS, ...mp }
            : { ...DEFAULT_MAT_PARAMS };
        result.push({ name: m.name, index: mi, params, modified: !!mp });
    }
    return result;
}

export function getMatParams(id: string, matIndex: number): MaterialCategoryParams | null {
    const modelState = _matState.get(id);
    if (!modelState) {
        return null;
    }
    const entry = modelState.get(matIndex);
    // [fix P2] per-mat 为 Partial：回填完整值（未设置字段以 DEFAULT 兜底，UI 显示不缺失）
    return entry ? { ...DEFAULT_MAT_PARAMS, ...entry } : null;
}

export function setMatParams(
    id: string,
    matIndex: number,
    params: Partial<MaterialCategoryParams>
): void {
    const meshes = _getMeshesById(id);
    if (!meshes || matIndex < 0 || matIndex >= meshes.length) {
        logWarn(
            'material',
            `setMatParams: invalid matIndex ${matIndex} for target "${id}" (${meshes ? meshes.length : 0} meshes)`
        );
        return;
    }
    const state = _ensureMatState(id);
    let entry = state.get(matIndex);
    if (!entry) {
        // [fix P2] per-mat 新建为空 Partial：仅存显式设置字段（apply 时与分类参数合并继承），
        // 不再用 DEFAULT 全量初始化（那会遮蔽 category 级调整）。
        entry = {};
        state.set(matIndex, entry);
    }
    _clampAndAssign(entry, params);
    _applyMaterial(id, matIndex, _alphaCtxFor(id));
    triggerAutoSave();
}

export function resetSingleMatParams(id: string, matIndex: number): void {
    const meshes = _getMeshesById(id);
    if (!meshes || matIndex < 0 || matIndex >= meshes.length) {
        logWarn(
            'material',
            `resetSingleMatParams: invalid matIndex ${matIndex} for target "${id}"`
        );
        return;
    }
    const modelState = _matState.get(id);
    if (modelState) {
        modelState.delete(matIndex);
    }
    _applyAll(id, _alphaCtxFor(id));
    triggerAutoSave();
}

/** 清理指定模型的全部材质状态（分类 + 逐材质 + 启用标记）。
 *  供模型移除时统一调用，替代外部直接操作内部 Map。 */
export function disposeModelMaterialState(id: string): void {
    _stateMgr.dispose(id);
    disposeModelSssState(id);
}

/**
 * 检查指定分类的全部材质是否都已启用。
 * 用于 batch level 的 headerToggle bind，返回 true 表示全开。
 */
export function isMatCategoryAllEnabled(id: string, cat: string): boolean {
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return true;
    }
    const state = _ensureState(id);
    if (!state.has(cat)) {
        return true;
    }
    for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi].material;
        if (!m || !(m instanceof StandardMaterial || m instanceof PBRMaterial)) {
            continue;
        }
        if (categoryOfMaterial(m) !== cat) {
            continue;
        }
        if (!isMatEnabled(id, mi)) {
            return false;
        }
    }
    return true;
}

/**
 * 按分类批量切换材质可见性。
 * 将指定分类下所有材质统一设为 enabled/disabled。
 */
export function setMatCategoryEnabled(id: string, cat: string, enabled: boolean): void {
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return;
    }
    const state = _ensureState(id);
    if (!state.has(cat)) {
        return;
    }
    for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi].material;
        if (!m || !(m instanceof StandardMaterial || m instanceof PBRMaterial)) {
            continue;
        }
        if (categoryOfMaterial(m) !== cat) {
            continue;
        }
        const current = isMatEnabled(id, mi);
        if (current === enabled) {
            continue;
        }
        meshes[mi].setEnabled(enabled);
        if (enabled) {
            _matEnabled.get(id)?.delete(mi);
        } else {
            let me = _matEnabled.get(id);
            if (!me) {
                me = new Map();
                _matEnabled.set(id, me);
            }
            me.set(mi, false);
        }
    }
    triggerAutoSave();
}

/** 重置所有逐材质覆盖（per-material），保留分类调整（皮肤/头发等）。
 *  如需完整恢复材质到原始状态请先调用 resetMatCatParams。 */
export function resetPerMaterialParams(id: string): void {
    _matState.delete(id);
    _applyAll(id, _alphaCtxFor(id));
    triggerAutoSave();
}

export function getMatState(id: string): {
    categories: Record<string, MaterialCategoryParams>;
    overrides: Record<number, MaterialCategoryParams>;
    enabled: Record<number, boolean>;
    sssCategories?: Record<string, SssParams>;
} | null {
    const catState = _catState.get(id);
    const matState = _matState.get(id);
    const enabledState = _matEnabled.get(id);
    // ADR-188: 仅调 SSS 时三个 Map 皆空，需把 SSS 状态纳入守卫，否则 SSS 不落盘
    const sssState = getMatSssState(id);
    if (!catState && !matState && !enabledState && !sssState) {
        return null;
    }
    // 过滤默认值噪声：_ensureState 会种入 6 类默认值供 UI 读取，
    // 但序列化时无需落盘默认值（apply 时会兜底）。避免预设文件膨胀。
    const defaultJson = JSON.stringify(DEFAULT_MAT_PARAMS);
    const categories: Record<string, MaterialCategoryParams> = {};
    if (catState) {
        for (const [cat, params] of catState) {
            if (JSON.stringify(params) === defaultJson) {
                continue;
            }
            categories[cat] = { ...params };
        }
    }
    const overrides: Record<number, MaterialCategoryParams> = {};
    if (matState) {
        for (const [idx, params] of matState) {
            // [fix P2] per-mat 为 Partial：仅落盘「值 ≠ DEFAULT」的显式字段——
            // 显式设回默认值（如 alphaMul=1）等价于继承 category，不产生序列化体积；
            // 全部为默认值时整个 entry 跳过（与「无调整」语义一致）。
            const filtered: Record<string, number> = {};
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== DEFAULT_MAT_PARAMS[k as keyof MaterialCategoryParams]) {
                    filtered[k] = v;
                }
            }
            if (Object.keys(filtered).length === 0) {
                continue;
            }
            overrides[idx] = filtered as MaterialCategoryParams;
        }
    }
    const enabled: Record<number, boolean> = {};
    if (enabledState) {
        for (const [idx, val] of enabledState) {
            enabled[idx] = val;
        }
    }
    // ADR-188: 序列化 SSS 参数（sssState 已在上方守卫处计算）
    const sssCategories = sssState?.sssCategories ?? {};

    // 全部为默认值时返回 null（与「无调整」语义一致）
    if (
        Object.keys(categories).length === 0 &&
        Object.keys(overrides).length === 0 &&
        Object.keys(enabled).length === 0 &&
        Object.keys(sssCategories).length === 0
    ) {
        return null;
    }
    return {
        categories,
        overrides,
        enabled,
        ...(Object.keys(sssCategories).length > 0 ? { sssCategories } : {}),
    };
}

export function applyMatState(
    id: string,
    state: {
        categories?: Record<string, MaterialCategoryParams>;
        overrides?: Record<number, MaterialCategoryParams>;
        enabled?: Record<number, boolean>;
        sssCategories?: Record<string, SssParams>;
    }
): void {
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
    if (state.enabled) {
        for (const [idxStr, val] of Object.entries(state.enabled)) {
            const idx = parseInt(idxStr, 10);
            setMatEnabled(id, idx, val);
        }
    }
    // ADR-188: 恢复 SSS 参数
    applyMatSssState(id, { sssCategories: state.sssCategories });
}
