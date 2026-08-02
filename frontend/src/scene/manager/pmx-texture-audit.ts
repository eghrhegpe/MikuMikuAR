// [feature:missing-texture-audit] PMX 声明纹理 vs 实际提供纹理 的差集审计。
// 复用 babylon-mmd 的 PmxReader 解析 PMX 头部与纹理清单（textures: string[]），
// 与 collectTextureFiles 提供给 babylon-mmd 的相对路径集合（含 basename fallback）做规范化差集，
// 找出「PMX 引用但模型目录中缺失」的纹理，供上层提示用户。
//
// 规范要点:
// - 匹配规则与 babylon-mmd ReferenceFileResolver 一致: 反斜杠→斜杠、大小写不敏感（PathNormalize + toUpperCase）。
// - 解析失败 / 异常一律返回空数组，绝不阻塞模型加载主流程。

import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader.js';

/** 规范化纹理路径用于不敏感匹配（与 babylon-mmd ReferenceFileResolver 的 key 构造一致） */
function _normalizeTexturePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/').trim().toUpperCase();
}

/** 将 Uint8Array 安全地转为 ArrayBuffer 切片（避免 byteOffset/视图长度错位） */
function _toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer as ArrayBuffer;
    }
    return bytes.slice().buffer as ArrayBuffer;
}

/**
 * 识别 PMX 声明但目录中缺失的纹理。
 * @param pmxBytes PMX 文件字节（readFileBytes 返回）
 * @param availableRelativePaths collectTextureFiles 提供的相对路径集合（已含 basename fallback）
 * @returns 缺失的纹理名列表（相对模型目录）；解析失败返回空数组
 */
export async function auditMissingTextures(
    pmxBytes: Uint8Array,
    availableRelativePaths: string[]
): Promise<string[]> {
    try {
        const pmx = await PmxReader.ParseAsync(_toArrayBuffer(pmxBytes));
        const available = new Set(availableRelativePaths.map(_normalizeTexturePath));
        const missing: string[] = [];
        for (const tex of pmx.textures) {
            if (!available.has(_normalizeTexturePath(tex))) {
                missing.push(tex);
            }
        }
        return missing;
    } catch {
        // 解析失败不影响主流程：宁可少一次提示，也不阻断模型加载
        return [];
    }
}
