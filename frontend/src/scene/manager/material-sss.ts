// SSS 材质参数应用层 — ADR-188 Phase 1
// 职责: 在 PBRMaterial 上应用 SSS（次表面散射）参数到指定分类的材质
// 使用: applySss(id, '皮肤', { sssPower: 0.8, sssColor, sssDistance })
//
// 前提: 材质系统已通过 PBRMaterialBuilder 加载材质（VITE_MMD_MATERIAL=pbr），
//       SssPBRMaterial 由 PMX 加载时构建（或手动替换为 SssPBRMaterial）。

import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { clamp01 } from '@/core/clamp';
import { logWarn } from '@/core/logger';
import { modelRegistry, triggerAutoSave } from '@/core/config';
import { getMatCatGroups } from './material';

/** SSS 参数 */
export interface SssParams {
    /** SSS 开关 + 强度（0=关闭，0.1~1.5 常用） */
    sssPower: number;
    /** SSS 散射颜色（皮肤偏橙红 #FF9966，蜡/橡胶偏白 #FFFFFF，玉石偏绿 #99FF99） */
    sssColor: Color3;
    /** SSS 散射距离/深度（0=浅表面，1=深通透） */
    sssDistance: number;
    /** SSS 最小厚度（无厚度贴图时用作默认材质厚度） */
    sssMinThickness: number;
    /** SSS 最大厚度 */
    sssMaxThickness: number;
}

/** SSS 默认参数 */
export const DEFAULT_SSS_PARAMS: SssParams = {
    sssPower: 0.0,
    sssColor: new Color3(1, 1, 1),
    sssDistance: 0.5,
    sssMinThickness: 0.0,
    sssMaxThickness: 1.0,
};

/** 分类级 SSS 参数缓存 */
const _sssState = new Map<string, Map<string, SssParams>>();

/**
 * 获取指定分类的 SSS 参数
 */
export function getMatSssParams(id: string, cat: string): SssParams {
    const catMap = _sssState.get(id);
    if (!catMap) {
        return { ...DEFAULT_SSS_PARAMS };
    }
    const p = catMap.get(cat);
    return p ? { ...p } : { ...DEFAULT_SSS_PARAMS };
}

export type SssColorInput = Color3 | { r: number; g: number; b: number };

/**
 * 设置指定分类的 SSS 参数并立即应用到所有该分类材质
 * @param id 模型实例 ID
 * @param cat 材质分类（如'皮肤'、'服装'）
 * @param params SSS 参数（partial，未提供的字段保留现有值）
 *   sssColor 可传入 Color3 或 { r, g, b } 形式
 */
export function setMatSssParams(
    id: string,
    cat: string,
    params: Omit<Partial<SssParams>, 'sssColor'> & { sssColor?: SssColorInput }
): void {
    let catMap = _sssState.get(id);
    if (!catMap) {
        catMap = new Map();
        _sssState.set(id, catMap);
    }
    const existing = catMap.get(cat) ?? { ...DEFAULT_SSS_PARAMS };
    const merged: SssParams = { ...existing };

    // 钳制
    if (params.sssPower !== undefined) {
        merged.sssPower = clamp01(params.sssPower);
    }
    if (params.sssDistance !== undefined) {
        merged.sssDistance = clamp01(params.sssDistance);
    }

    // 颜色：兼容 Color3 和 { r, g, b }
    const colorInput = params.sssColor;
    if (colorInput instanceof Color3) {
        merged.sssColor = colorInput.clone();
    } else if (colorInput && typeof colorInput === 'object') {
        merged.sssColor = new Color3(colorInput.r, colorInput.g, colorInput.b);
    }

    catMap.set(cat, merged);
    applySss(id, cat);
    triggerAutoSave();
}

/**
 * 应用 SSS 参数到指定分类的所有 PBRMaterial 材质
 *
 * 内部实现：
 * 1. 遍历该模型所有 mesh 的材质
 * 2. 筛选出指定分类且为 PBRMaterial 的材质
 * 3. 应用 sssPower、sssColor、sssDistance 等参数
 * 4. 标记材质脏（触发重新编译）
 */
export function applySss(id: string, cat: string): void {
    const inst = modelRegistry.get(id);
    if (!inst) {
        logWarn('sss', `applySss: model "${id}" not found`);
        return;
    }
    const meshes = inst.meshes;
    if (!meshes) {
        return;
    }

    const sssParams = getMatSssParams(id, cat);
    const pbrMatMap = getMatCatGroups(id);
    const materialsInCat = pbrMatMap.get(cat) ?? [];

    for (const { mat } of materialsInCat) {
        applySssToMaterial(mat, sssParams);
    }
}

/**
 * 将 SSS 参数应用到单个 PBRMaterial 材质
 * 对于 SssPBRMaterial 直接设置其 SSS 属性；
 * 对于普通 PBRMaterial，通过 setSssEnabled 等方式设置。
 */
function applySssToMaterial(mat: Material, params: SssParams): void {
    if (!(mat instanceof PBRMaterial)) {
        return;
    }

    const p = params as SssParams;

    // [fix P1] Babylon 9.x PBRBaseMaterial 公开只读 subSurface（构造时自动注册
    // PBRSubSurfaceConfiguration），直接读取；不再桥接访问 plugins 数组
    // （9.x 插件注册于私有 pluginManager._plugins，无 plugins 成员）。
    const ss = mat.subSurface;

    if (!ss) {
        logWarn(
            'sss',
            `applySssToMaterial: no PBRSubSurfaceConfiguration plugin found on "${mat.name}"`
        );
        return;
    }

    // 启用/禁用 SSS
    ss.isTranslucencyEnabled = p.sssPower > 0;
    ss.isScatteringEnabled = p.sssPower > 0;

    // 强度（translucencyIntensity）
    ss.translucencyIntensity = p.sssPower;

    // 颜色
    ss.tintColor = p.sssColor ?? new Color3(1, 1, 1);

    // 距离
    ss.tintColorAtDistance = p.sssDistance ?? 0.5;

    // 扩散距离
    ss.diffusionDistance = new Color3(1, 1, 1);

    // 厚度
    ss.useThicknessAsDepth = p.sssPower > 0;
    ss.minimumThickness = p.sssMinThickness ?? 0;
    ss.maximumThickness = p.sssMaxThickness ?? 1;

    mat.markDirty();
}

/**
 * 重置指定模型的所有 SSS 状态
 */
export function disposeModelSssState(id: string): void {
    _sssState.delete(id);
}

/**
 * 序列化指定模型的 SSS 状态为 JSON 兼容结构
 * 用于场景/预设保存。仅返回非默认值，避免默认值噪声。
 */
export function getMatSssState(id: string): {
    sssCategories?: Record<string, SssParams>;
} | null {
    const catMap = _sssState.get(id);
    if (!catMap) {
        return null;
    }
    const defaultJson = JSON.stringify(DEFAULT_SSS_PARAMS);
    const sssCategories: Record<string, SssParams> = {};
    for (const [cat, params] of catMap) {
        if (JSON.stringify(params) === defaultJson) {
            continue;
        }
        sssCategories[cat] = { ...params };
    }
    if (Object.keys(sssCategories).length === 0) {
        return null;
    }
    return { sssCategories };
}

/**
 * 反序列化 SSS 状态并应用到模型
 */
export function applyMatSssState(
    id: string,
    state: { sssCategories?: Record<string, SssParams> }
): void {
    if (!state.sssCategories) {
        return;
    }
    for (const [cat, params] of Object.entries(state.sssCategories)) {
        // 反序列化后 sssColor 实际是 JSON 的 { r, g, b } 平对象，setMatSssParams 已兼容
        setMatSssParams(id, cat, { ...params });
    }
}

