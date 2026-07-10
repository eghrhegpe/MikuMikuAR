// Material system for MikuMikuAR — category-based and per-material param adjustment.
// Extracted from scene.ts L1674-1978.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

import { modelRegistry, uiState } from '@/core/config';
import { triggerAutoSave } from '@/core/config';

interface MmdStandardMaterial extends StandardMaterial {
    toonTexture: Texture | null;
    sphereTexture: Texture | null;
}

// ======== 外部材质目标注册表 ========
// 让 propRegistry 等 non-model 资源也能复用 id-based 材质 API。
// modelRegistry 优先，外部表兜底。
const _externalMeshes = new Map<string, Mesh[]>();

/** 注册外部 meshes（如 prop）到材质系统，使其可用 id 调用所有材质 API。 */
export function registerMaterialTarget(id: string, meshes: Mesh[]): void {
    _externalMeshes.set(id, meshes);
}

/** 注销外部材质目标（资源卸载时调用）。 */
export function unregisterMaterialTarget(id: string): void {
    _externalMeshes.delete(id);
    disposeModelMaterialState(id);
}

/** 按 id 查询 meshes：先 modelRegistry，后外部注册表。 */
function _getMeshesById(id: string): Mesh[] | undefined {
    const inst = modelRegistry.get(id);
    if (inst) {
        return inst.meshes;
    }
    return _externalMeshes.get(id);
}

/** 供 UI 层（model-material.ts）按 id 拿 meshes，不依赖 modelRegistry。 */
export function getMaterialMeshes(id: string): Mesh[] | undefined {
    return _getMeshesById(id);
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
};

/** 将 Partial 参数 clamp 后写入 target — 消除 setMatCatParams / setMatParams 的重复 clamp 逻辑。 */
function _clampAndAssign(
    target: MaterialCategoryParams,
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

/** 将一组参数写入 Babylon StandardMaterial — 消除 _applyAll 中分类级与逐材质级的重复写入。 */
function _applyParamsToMaterial(
    m: StandardMaterial,
    mmdMat: MmdStandardMaterial,
    o: _OrigMat,
    p: MaterialCategoryParams
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
}

const _origValues = new WeakMap<Material, _OrigMat>();

/** @internal exported for testing */
export const _catState = new Map<string, Map<string, MaterialCategoryParams>>();
/** @internal exported for testing */
export const _matState = new Map<string, Map<number, MaterialCategoryParams>>();
/** @internal exported for testing */
export const _matEnabled = new Map<string, Map<number, boolean>>();

/**
 * 材质分类规则（按优先级排序）
 * 每条规则：[关键词数组, 分类名]
 * 匹配逻辑：材质名包含任意关键词即命中
 */
const CATEGORY_RULES: [string[], MaterialCategory][] = [
    // 服装（最高优先级，确保裙-腰带、裙-蝶结等不会被身体/配件干扰）
    [
        [
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
        '服装',
    ],
    // 配件（帽子/鞋子/装饰）
    [
        [
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
        '配件',
    ],
    // 眼睛
    [
        [
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
        '眼睛',
    ],
    // 头发
    [
        [
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
        '头发',
    ],
    // 皮肤（嘴巴/牙齿/身体）
    [
        [
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
        '皮肤',
    ],
    // 道具（武器）
    [
        [
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
        '道具',
    ],
];

/** @internal exported for testing */
export function _catOf(name: string): MaterialCategory {
    // 优先使用用户自定义映射
    const customMap = uiState.materialCategoryMap;
    if (customMap) {
        for (const [pattern, category] of Object.entries(customMap)) {
            try {
                if (new RegExp(pattern, 'i').test(name)) {
                    return category as MaterialCategory;
                }
            } catch {
                // 无效正则，跳过
            }
        }
    }

    // 按优先级匹配，命中即返回（包含匹配，不区分大小写）
    const lowerName = name.toLowerCase();
    for (const [keywords, cat] of CATEGORY_RULES) {
        if (keywords.some((k) => lowerName.includes(k))) {
            return cat;
        }
    }
    return '服装';
}

/** @internal exported for testing + pre-capture in scene-loader */
export function _capture(mat: Material): void {
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
    });
}

/** @internal exported for testing */
export function _applyAll(id: string): void {
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return;
    }
    const state = _catState.get(id);
    if (!state) {
        return;
    }
    const perMat = _matState.get(id) ?? new Map();
    for (let mi = 0; mi < meshes.length; mi++) {
        const m = meshes[mi].material;
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        const mmdMat = m as MmdStandardMaterial;
        _capture(m);
        const o = _origValues.get(m)!;
        const p = state.get(_catOf(m.name));
        if (!p) {
            continue;
        }
        _applyParamsToMaterial(m, mmdMat, o, p);
        const mp = perMat.get(mi);
        if (mp) {
            _applyParamsToMaterial(m, mmdMat, o, mp);
        }
    }
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
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        const cat = _catOf(m.name);
        if (!groups.has(cat)) {
            groups.set(cat, []);
        }
        groups.get(cat)!.push({ name: m.name, mat: m });
    }
    return groups;
}

export function getMatCatParams(id: string, cat: string): MaterialCategoryParams {
    if (!CATEGORY_SET.has(cat)) {
        console.warn(`[material] getMatCatParams: unknown category "${cat}"`);
        return { ...DEFAULT_MAT_PARAMS };
    }
    return { ..._ensureState(id).get(cat)! };
}

export function setMatCatParams(
    id: string,
    cat: string,
    params: Partial<MaterialCategoryParams>
): void {
    if (!CATEGORY_SET.has(cat)) {
        console.warn(`[material] setMatCatParams: unknown category "${cat}"`);
        return;
    }
    const target = _ensureState(id).get(cat)!;
    _clampAndAssign(target, params);
    _applyAll(id);
    triggerAutoSave();
}

export function resetMatCatParams(id: string): void {
    _catState.delete(id);
    _matState.delete(id); // 同时清理逐材质覆盖，避免残留状态在下次 _applyAll 中复现
    const meshes = _getMeshesById(id);
    if (!meshes) {
        return;
    }
    for (const mesh of meshes) {
        const m = mesh.material;
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        const mmdMat = m as MmdStandardMaterial;
        const o = _origValues.get(m);
        if (o) {
            m.diffuseColor.copyFrom(o.diffuse);
            m.specularColor.copyFrom(o.specular);
            m.specularPower = o.specularPower;
            m.ambientColor.copyFrom(o.ambient);
            m.emissiveColor.copyFrom(o.emissive);
            if (m.diffuseTexture) {
                m.diffuseTexture.level = o.diffuseTexLevel;
            }
            if (m.bumpTexture) {
                m.bumpTexture.level = o.bumpTexLevel;
            }
            if (mmdMat.toonTexture) {
                mmdMat.toonTexture.level = o.toonTexLevel;
            }
            if (mmdMat.sphereTexture) {
                mmdMat.sphereTexture.level = o.sphereTexLevel;
            }
            if (m.emissiveTexture) {
                m.emissiveTexture.level = o.emissiveTexLevel;
            }
        }
    }
    triggerAutoSave();
}

function _ensureMatState(id: string): Map<number, MaterialCategoryParams> {
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
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        const mp = perMat.get(mi);
        const params: MaterialCategoryParams = mp ? { ...mp } : { ...DEFAULT_MAT_PARAMS };
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
    return entry ? { ...entry } : null;
}

export function setMatParams(
    id: string,
    matIndex: number,
    params: Partial<MaterialCategoryParams>
): void {
    const meshes = _getMeshesById(id);
    if (!meshes || matIndex < 0 || matIndex >= meshes.length) {
        console.warn(
            `setMatParams: invalid matIndex ${matIndex} for target "${id}" (${meshes ? meshes.length : 0} meshes)`
        );
        return;
    }
    const state = _ensureMatState(id);
    let entry = state.get(matIndex);
    if (!entry) {
        entry = { ...DEFAULT_MAT_PARAMS };
        state.set(matIndex, entry);
    }
    _clampAndAssign(entry, params);
    _applyAll(id);
    triggerAutoSave();
}

export function resetSingleMatParams(id: string, matIndex: number): void {
    const meshes = _getMeshesById(id);
    if (!meshes || matIndex < 0 || matIndex >= meshes.length) {
        console.warn(`resetSingleMatParams: invalid matIndex ${matIndex} for target "${id}"`);
        return;
    }
    const modelState = _matState.get(id);
    if (modelState) {
        modelState.delete(matIndex);
    }
    _applyAll(id);
    triggerAutoSave();
}

/** 清理指定模型的全部材质状态（分类 + 逐材质 + 启用标记）。
 *  供模型移除时统一调用，替代外部直接操作内部 Map。 */
export function disposeModelMaterialState(id: string): void {
    _catState.delete(id);
    _matState.delete(id);
    _matEnabled.delete(id);
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
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        if (_catOf(m.name) !== cat) {
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
        if (!m || !(m instanceof StandardMaterial)) {
            continue;
        }
        if (_catOf(m.name) !== cat) {
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
    _applyAll(id);
    triggerAutoSave();
}

/** @deprecated 使用 resetPerMaterialParams */
export const resetAllMatParams = resetPerMaterialParams;

export function getMatState(id: string): {
    categories: Record<string, MaterialCategoryParams>;
    overrides: Record<number, MaterialCategoryParams>;
    enabled: Record<number, boolean>;
} | null {
    const catState = _catState.get(id);
    const matState = _matState.get(id);
    const enabledState = _matEnabled.get(id);
    if (!catState && !matState && !enabledState) {
        return null;
    }
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
    const enabled: Record<number, boolean> = {};
    if (enabledState) {
        for (const [idx, val] of enabledState) {
            enabled[idx] = val;
        }
    }
    return { categories, overrides, enabled };
}

export function applyMatState(
    id: string,
    state: {
        categories?: Record<string, MaterialCategoryParams>;
        overrides?: Record<number, MaterialCategoryParams>;
        enabled?: Record<number, boolean>;
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
}
