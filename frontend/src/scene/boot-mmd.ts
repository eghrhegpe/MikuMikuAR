/**
 * [doc:adr-273] MMD 加载器 / 材质构建器注册 —— plan 中 'mmd-loaders' 步骤的实现体。
 *
 * 这段原先在 `scene/scene.ts` 的 `_initMmdRuntime()` 开头，是运行时初始化里唯一
 * **与运行时实例无关**的一截：它注册的是"以后加载 PMX 时用哪个 loader、用哪种材质构建器"。
 * 单独成步的理由不是好看，而是让 `loader` 步骤能声明 `requires: ['mmd-loaders']`——
 * 模型加载器必须在第一次加载模型之前注册好，否则报错信息是"没有 .pmx 的 loader"，
 * 与真正的原因（注册被挪到了加载之后）隔着一整层。
 */

import { RegisterMmdModelLoaders } from 'babylon-mmd/esm/Loader/dynamic';
import { RegisterDxBmpTextureLoader } from 'babylon-mmd/esm/Loader/registerDxBmpTextureLoader';
import { MmdRuntimeShared } from 'babylon-mmd/esm/Runtime/mmdRuntimeShared';
import { logWarn } from '@/core/logger';
import { getMaterialMode, getStandardMaterialProxy } from './manager/material-proxy-resolver';
import { tryApplyPbrMaterialBuilder } from './manager/pbr-builder-init';

/**
 * 注册 PMX loader、DDS/DxBmp 纹理 loader、材质代理构造器，并按材质模式切换构建器。
 *
 * [ADR-188] 默认 `'babylon-mmd/esm/Loader/mmdModelLoader'` 的 import 已注册
 * MmdStandardMaterialBuilder；PBR 模式下需动态导入 PBRMaterialBuilder 覆盖
 * SharedMaterialBuilder（动态导入因为 PBR 路径是少数派，不进默认 bundle）。
 */
export async function bootMmdLoaders(): Promise<void> {
    RegisterMmdModelLoaders();
    RegisterDxBmpTextureLoader();
    const materialMode = getMaterialMode();
    logWarn('scene', `MMD 材质模式: ${materialMode}`);
    MmdRuntimeShared.MaterialProxyConstructor = getStandardMaterialProxy();
    if (materialMode === 'pbr') {
        await tryApplyPbrMaterialBuilder();
    }
}
