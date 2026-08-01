// Material proxy resolver — ADR-188 Phase 1
// 职责: 根据 VITE_MMD_MATERIAL 环境变量，返回对应的材质代理构造函数
//       'standard' (默认) → MmdStandardMaterialProxy（Lambert + Blinn-Phong，toon/sphere 原生支持）
//       'pbr'          → PBRMaterialBuilder（Cook-Torrance PBR，metallic/roughness，无 toon/sphere）
//
// 注意: PBR 模式下 toonTexLevel / sphereTexLevel 参数静默忽略，UI 需置灰提示

import { MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';
import type { MmdStandardMaterialProxy as T_MmdStandardMaterialProxy } from 'babylon-mmd/esm/Runtime/mmdStandardMaterialProxy';

export type MaterialMode = 'standard' | 'pbr';

/** 从 VITE_MMD_MATERIAL 环境变量读取材质模式（构建期常量，未定义时走默认值） */
export function getMaterialMode(): MaterialMode {
    const raw = import.meta.env.VITE_MMD_MATERIAL as string | undefined;
    if (raw === 'pbr') {
        return 'pbr';
    }
    return 'standard';
}

/** 返回标准材质代理（MmdStandardMaterialProxy）— 用于 Lambert + Blinn-Phong 渲染 */
export function getStandardMaterialProxy(): typeof MmdStandardMaterialProxy {
    return MmdStandardMaterialProxy;
}

/** 动态导入 PBRMaterialBuilder（PBR 材质构建器）
 *
 * 注意: PBRMaterialBuilder 在 PMX 加载阶段构建 PBRMaterial，
 * 与 MmdStandardMaterialProxy 的运行时材质代理职责不同。
 * 当前项目 PMX 加载器默认使用 MmdStandardMaterialBuilder，
 * PBR 模式下需额外配置 PMX 加载器使用 PBRMaterialBuilder（ADR-188 §Phase 0）。
 */
export async function getPBRMaterialBuilder() {
    const { PBRMaterialBuilder } = await import('babylon-mmd/esm/Loader/pbrMaterialBuilder');
    return PBRMaterialBuilder as unknown as typeof MmdStandardMaterialProxy;
}

/** 返回当前材质的代理构造函数（同步）
 *
 * @returns 'standard' 时返回 MmdStandardMaterialProxy；'pbr' 时返回 MmdStandardMaterialProxy
 *          （PBR 模式下的材质代理仍使用标准代理，因 PMX 加载阶段已由 PBRMaterialBuilder 构建材质，
 *          MmdStandardMaterialProxy 仅用于运行时材质 morph，对 PBRMaterial 也兼容）
 */
export function resolveMaterialProxy(): typeof MmdStandardMaterialProxy {
    // PBR 模式下材质代理仍用 MmdStandardMaterialProxy（运行时 morph 兼容 PBRMaterial）
    return getStandardMaterialProxy();
}
