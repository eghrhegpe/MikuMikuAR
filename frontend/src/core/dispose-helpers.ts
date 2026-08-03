// dispose-helpers.ts — 统一「dispose 并置空」的模板（ADR-146 主题3）
//
// 替代项目中大量 `if (x) { x.dispose(); x = null; }` 手写重复（env/render
// 子系统累计 60-80 处）。调用形式：
//
//   _volCloudMat = safeDispose(_volCloudMat);
//   _envSys.water.mesh = safeDispose(_envSys.water.mesh, true);   // 透传 dispose 参数
//   pipeline = safeDispose(pipeline);                              // 返回 null，调用方重赋值
//
// 与手写模板语义严格等价：`obj?.dispose(...args)` 仅在 obj 非空时调用，
// 始终返回 null（调用方将自身引用置空）。Babylon 对象 dispose 幂等，
// safeDispose 在 obj 已是 null 时为 no-op。
//
// 注意：返回类型为 `null`。目标变量须为 `T | null`；若原代码置 `undefined`
// （如 `pipeline = undefined`），类型不兼容，请勿用本函数（保留原写法）。
//
// 另提供 detachSharedTextures：批量 dispose 材质前保护跨材质共享的纹理实例。

// type-only import：不引入运行时依赖，保持本模块为零依赖叶子。
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';

/**
 * 安全释放对象并置空。
 * @param obj 待释放对象（可为 null）
 * @param args 透传给 `obj.dispose(...args)` 的参数（如 mesh.dispose(true) 的 recursive）
 * @returns null（调用方应将原引用赋值为此返回值以完成置空）
 */
export function safeDispose<T extends { dispose(...args: unknown[]): void }>(
    obj: T | null,
    ...args: unknown[]
): null {
    obj?.dispose(...args);
    return null;
}

// —— 共享纹理保护 ——

/** 材质上可能持有「跨材质共享」纹理实例的字段。
 *  toonTexture / sphereTexture 由 babylon-mmd 的 MmdPluginMaterial 扩展而来。 */
const SHAREABLE_TEXTURE_SLOTS = [
    'toonTexture',
    'sphereTexture',
    'diffuseTexture',
    'emissiveTexture',
] as const;

/**
 * 批量 dispose 一组材质**之前**调用：摘除这组材质对「仍被其他存活材质引用」的纹理的引用，
 * 使随后的 `material.dispose(_, true)` 不会误杀共享纹理实例。
 *
 * 背景：Babylon 的 `Material.dispose(forceDisposeEffect, forceDisposeTextures=true)` 与
 * babylon-mmd 的 `MmdPluginMaterial.dispose` 都是**无引用计数**地直接 `texture.dispose()`。
 * 而 MMD 共享 toon（toon01–toon10）在 babylon-mmd 里是全局单例——其纹理缓存键为
 * `file:shared_toon_texture_<N>`，不含区分模型的 fileRootId，故所有模型共用同一 Texture 实例。
 * 卸载模型 A 会连带销毁仍在被模型 B 使用的那盏「共用的灯」，B 的相关材质随即渲染为黑
 * （toon 是着色查找表，采样死纹理恒黑，且不随场景光照变化）。
 *
 * 本函数只摘除「确有他人引用」的纹理；独占纹理保持原样交由 dispose 释放，
 * 因此不会退化为 GPU 纹理泄漏。
 *
 * @param disposing 即将被 dispose 的材质集合（须为 Set，用于 O(1) 判定归属）
 */
export function detachSharedTextures(disposing: Set<Material>): void {
    const scene = disposing.values().next().value?.getScene();
    if (!scene) {
        return;
    }
    const survivors = scene.materials.filter((m) => !disposing.has(m));
    if (survivors.length === 0) {
        return;
    }
    for (const mat of disposing) {
        for (const tex of mat.getActiveTextures()) {
            if (!survivors.some((other) => other.hasTexture(tex))) {
                continue;
            }
            const slots = mat as unknown as Record<string, BaseTexture | null>;
            for (const key of SHAREABLE_TEXTURE_SLOTS) {
                if (slots[key] === tex) {
                    slots[key] = null;
                }
            }
        }
    }
}
