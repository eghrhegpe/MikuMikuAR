// [doc:adr-189] 纹理 LRU 缓存 — Phase 1.3
// 按键 <modelDir>\x00<relativePath> 缓存纹理 ArrayBuffer，避免跨模型切换时重复读取。
// 驱逐策略：基于 Map 插入顺序的近似 LRU——命中时 delete+set 重新排到最后，
// 溢出时 delete(keys().next().value) 淘汰最旧插入项。O(1) 驱逐，无需双向链表。
// 释放：scene.ts disposeRenderer() → clearTextureLRU() 清空。

import { readFileBytes } from '@/core/wails-bindings';

interface TextureCacheEntry {
    data: ArrayBuffer;
    lastUsed: number;
}

/** key 使用 \x00（null char）分隔 modelDir 和 relativePath，避免路径中的冒号导致 key 解析歧义 */
const KEY_SEP = '\x00';

const _textureLRU = new Map<string, TextureCacheEntry>();

/** 5 个模型 × 平均 30 纹理/模型；实际纹理数待 Phase 1 验证时统计校准 */
const TEXTURE_LRU_MAX_ENTRIES = 5 * 30;

function evictOldest(): void {
    if (_textureLRU.size === 0) return;
    _textureLRU.delete(_textureLRU.keys().next().value!);
}

/**
 * 带 LRU 缓存的纹理读取。命中直接返回 ArrayBuffer，未命中则 readFileBytes 后缓存。
 * @param modelDir 模型目录（vfs 路径，如 web://model/some-model）
 * @param relativePath 纹理相对于 modelDir 的路径
 * @param signal 可选 AbortSignal — abort 后不入缓存
 */
export async function readTextureWithLRU(
    modelDir: string,
    relativePath: string,
    signal?: AbortSignal
): Promise<ArrayBuffer | null> {
    const key = `${modelDir}${KEY_SEP}${relativePath}`;
    const cached = _textureLRU.get(key);
    if (cached) {
        // 命中：更新访问时间 + 重新 set 以更新 Map 插入顺序（最近使用排在最后）
        cached.lastUsed = Date.now();
        _textureLRU.delete(key);
        _textureLRU.set(key, cached);
        return cached.data;
    }
    if (signal?.aborted) return null;
    const data = await readFileBytes(modelDir + '/' + relativePath);
    if (!data || signal?.aborted) return null;
    if (_textureLRU.size >= TEXTURE_LRU_MAX_ENTRIES) evictOldest();
    const entry: TextureCacheEntry = { data: data.buffer as ArrayBuffer, lastUsed: Date.now() };
    _textureLRU.set(key, entry);
    return entry.data;
}

/** 清空 LRU 缓存。在 disposeRenderer 中调用，释放所有缓存的纹理 ArrayBuffer。 */
export function clearTextureLRU(): void {
    _textureLRU.clear();
}

/** 返回当前缓存条目数（供测试使用）。 */
export function textureLRUSize(): number {
    return _textureLRU.size;
}

/** 仅供测试：重置缓存状态。 */
export function _resetTextureLRUForTest(): void {
    _textureLRU.clear();
}
