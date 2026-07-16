// thumbnail-key.ts — 缩略图缓存 key 的唯一推导源（P0 治理：消除双源拼接反弹）
//
// 历史：写侧（model-loader / props）与读侧（library-core）各自用字符串拼接构造
// `<baseKey>::<resolution>::<aspect>`，任何一侧微调即导致缓存 miss → 缩略图"消失/重生"，
// 形成 12 轮修改反弹。本模块将拼接收敛为唯一纯函数，两侧必须经由它构造 key。
//
// key 格式：`<baseKey>::<resolution>::<aspect>`
//   - baseKey：库引用路径（file_path）；ZIP 内模型追加 `::<zipInner>`。
//   - resolution：缩略图长边像素（默认 512，运行时取 uiState.thumbnailResolution）。
//   - aspect：'16/9'（舞台/场景/道具横屏）或 '2/3'（角色竖屏），由 isStageLike 决定。

import { isStageLike } from '@/core/utils';
import type { LibraryModel } from '@/core/types';

export interface ThumbnailBaseKeyInput {
    /** 库引用路径，优先作为 baseKey（等价 LibraryModel.file_path）。 */
    libraryPath?: string;
    /** 实际文件路径（解压临时路径或导入真实路径），libraryPath 缺省或与其相等时回退。 */
    filePath: string;
    /** ZIP 内部相对路径（等价 LibraryModel.zip_inner），存在时追加到 baseKey。 */
    innerPath?: string;
}

/**
 * 由库引用路径 + 内部路径推导 baseKey。
 * 统一了写侧（libraryPath 优先 + innerPath）与读侧（file_path + zip_inner）两种历史写法。
 */
export function thumbnailBaseKey(input: ThumbnailBaseKeyInput): string {
    const { libraryPath, filePath, innerPath } = input;
    let base = libraryPath && libraryPath !== filePath ? libraryPath : filePath;
    if (innerPath) {
        base = `${base}::${innerPath}`;
    }
    return base;
}

/** 由 LibraryModel 推导 baseKey（读侧专用适配器）。 */
export function libraryModelBaseKey(m: LibraryModel): string {
    return thumbnailBaseKey({
        libraryPath: m.file_path,
        filePath: m.file_path,
        innerPath: m.container === 'zip' && m.zip_inner ? m.zip_inner : undefined,
    });
}

export interface ThumbnailKeyInput {
    baseKey: string;
    /** 是否为横屏（舞台/场景/道具）。决定 aspect 后缀。 */
    isStage: boolean;
    /** 缩略图长边分辨率，默认 512。 */
    resolution?: number;
}

/** 唯一缓存 key 构造：`<baseKey>::<resolution>::<aspect>`。 */
export function buildThumbnailKey(input: ThumbnailKeyInput): string {
    const res = input.resolution ?? 512;
    const aspect = input.isStage ? '16/9' : '2/3';
    return `${input.baseKey}::${res}::${aspect}`;
}

/** 便捷：由 kind/type 字符串直接构造完整 key（isStage 判定仍走统一 isStageLike）。 */
export function thumbnailKeyForKind(input: {
    libraryPath?: string;
    filePath: string;
    innerPath?: string;
    kind: string;
    resolution?: number;
}): string {
    return buildThumbnailKey({
        baseKey: thumbnailBaseKey(input),
        isStage: isStageLike(input.kind),
        resolution: input.resolution,
    });
}
