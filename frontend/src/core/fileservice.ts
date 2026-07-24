// fileservice.ts — 统一文件服务层
// 所有需要通过 HTTP 加载模型/动作文件的函数都使用此模块。
// 集中一处 URL 构造逻辑，避免重复实现导致"改一处漏一处"。
//
// [doc:adr-176] 双环境适配：桌面端走 StartFileServer HTTP 服务；
// 浏览器端回退到 readFileBytes + Blob URL（browser-adapter 签名已对齐 ADR-176 Phase 2）。

import { IsolateModelDir, StartFileServer } from './wails-bindings';
import { resolveBackend } from './backend';
import { isAndroidPlatform } from './platform';
import type { BackendService } from './backend/types';

let _cachedBackend: Promise<BackendService> | null = null;
/** 惰性缓存 resolveBackend 结果（避免每请求重路由）。 */
function getBackend(): Promise<BackendService> {
    if (!_cachedBackend) _cachedBackend = resolveBackend();
    return _cachedBackend;
}

// [doc:adr-057] base64url（无填充）编码文件名，用于查询参数 ?f=
// 绕开 URL 路径段编码语义，避免 U+FFFD 被编码为 %EF%BF%BD 后与 Go 侧 d.Name() 不匹配。
// 与 Go 侧 base64.RawURLEncoding 对齐。
function _toBase64Url(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (const b of bytes) {
        bin += String.fromCharCode(b);
    }
    // btoa → 标准 Base64；转换 +/ → -_，去掉 = 填充
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 编码文件名为查询参数值（base64url 无填充）。
 * 用于构造 `?f=<encodeFileRef(fileName)>` 形式的 URL。
 * [doc:adr-057] Shift-JIS URL 乱码修复
 */
export function encodeFileRef(fileName: string): string {
    return _toBase64Url(fileName);
}

/**
 * 从文件路径解析出 HTTP URL 及对应服务器信息。
 * - 拆分目录/文件名 → 启动/复用文件服务器 → 构造 HTTP URL
 * - 输入路径支持正斜杠或反斜杠，内部统一处理
 * - URL 形态 `?f=<base64url(fileName)>`，绕开路径段编码歧义（ADR-057）
 *
 * @returns URL、端口、文件所在目录
 */
export async function resolveFileUrl(
    filePath: string
): Promise<{ url: string; port: number; dir: string }> {
    const normalized = normPath(filePath);
    const safeDir = await IsolateModelDir(normalized);
    const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
    // [doc:adr-176] 浏览器端 StartFileServer 抛 NotSupportedError，
    // 此时回退到 readFileBytes + Blob URL，构造 chrome-extension:// 或 blob: 前缀。
    const backend = await getBackend();
    // [doc:adr-017][doc:adr-176] 浏览器端与 Android 均不使用 127.0.0.1 HTTP 文件服务：
    // 改用 readFileBytes + Blob URL，彻底消除 http:// 子资源，从而可移除
    // MainActivity 的 MIXED_CONTENT_ALWAYS_ALLOW（A0-01 技术债根治，ADR-017 §六）。
    // 桌面端仍走 StartFileServer（localhost HTTP）以维持既有流式性能与行为。
    if (backend.kind === 'browser' || isAndroidPlatform()) {
        const bytes = await backend.readFileBytes(safeDir + '/' + fileName);
        if (!bytes) throw new Error(`[fileservice] readFileBytes failed for ${safeDir}/${fileName}`);
        const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
        return { url: blobUrl, port: -1, dir: safeDir };
    }
    const port = await StartFileServer(safeDir);
    const url = `http://127.0.0.1:${port}/?f=${encodeFileRef(fileName)}`;
    return { url, port, dir: safeDir };
}

/**
 * 从文件路径解析出隔离后的目录路径（不启动 HTTP 服务器）。
 * 用于 ArrayBuffer 加载路径：只需目录路径做纹理扫描，无需 HTTP。
 */
export async function resolveModelDir(filePath: string): Promise<string> {
    const normalized = normPath(filePath);
    return IsolateModelDir(normalized);
}

/**
 * 通过文件服务解析 URL 并拉取文件内容为 ArrayBuffer。
 * 统一封装 `resolveFileUrl → fetch → HTTP 状态校验 → arrayBuffer` 序列，
 * 避免各加载器重复实现导致"改一处漏一处"（ADR-096 复用收敛）。
 *
 * @param filePath 模型/动作文件路径（支持正斜杠或反斜杠）
 * @returns 解析出的 HTTP URL 与二进制内容
 * @throws 当 HTTP 响应非 2xx 时抛出 `Error('HTTP <status>')`
 */
export async function fetchArrayBuffer(
    filePath: string,
    signal?: AbortSignal
): Promise<{ url: string; data: ArrayBuffer }> {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
    const { url } = await resolveFileUrl(filePath);
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.arrayBuffer();
    return { url, data };
}

// ======== normPath 缓存（buildLevel 每模型调用一次，缓存避免重复正则） ========

/**
 * Wails v3 将 Go []byte 序列化为 JSON base64 字符串，此函数将其解码为 Uint8Array。
 * 所有 ReadFileBytes 调用方必须经过此解码步骤。
 */
export function decodeBase64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

const _normPathCache = new Map<string, string>();
const NORM_PATH_CACHE_MAX = 5000;

/** 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。
 *  注意：Android SAF URI（content://...）原样返回，不做转换。
 *  结果缓存，避免 buildLevel 遍历千级模型时重复正则替换。
 *  缓存键使用小写化路径，确保大小写不敏感系统（Windows/macOS）上同一文件只缓存一次。 */
export function normPath(p: string): string {
    const cacheKey = p.toLowerCase();
    const cached = _normPathCache.get(cacheKey);
    if (cached !== undefined) {
        return cached;
    }

    let result: string;
    if (p.startsWith('content://')) {
        result = p.replace(/\/+$/, '');
    } else {
        result = p.replace(/\\/g, '/').replace(/\/+$/, '');
        result = result
            .replace(/\/\.\//g, '/')
            .replace(/^\.\//, '')
            .replace(/\/\.$/, '');
    }

    if (_normPathCache.size >= NORM_PATH_CACHE_MAX) {
        _normPathCache.clear();
    }
    _normPathCache.set(cacheKey, result);
    return result;
}
