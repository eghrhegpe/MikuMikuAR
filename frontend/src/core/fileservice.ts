// fileservice.ts — 统一文件服务层
// 所有需要通过 HTTP 加载模型/动作文件的函数都使用此模块。
// 集中一处 URL 构造逻辑，避免重复实现导致"改一处漏一处"。
//
// [doc:adr-176] 双环境适配：桌面端走 StartFileServer HTTP 服务；
// 浏览器端回退到 readFileBytes + Blob URL（browser-adapter 签名已对齐 ADR-176 Phase 2）。

import { IsolateModelDir, StartFileServer } from './wails-bindings';
import { resolveBackend, getCachedCapabilities } from './backend';
import type { BackendService } from './backend/types';
import { normPath } from './path';

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
    // [doc:adr-017][doc:adr-176][doc:adr-178] 浏览器端、Android 应用或无 crossOriginIsolated（单线程物理）宿主
    // 均不使用 127.0.0.1 HTTP 文件服务：改用 readFileBytes + Blob URL，彻底消除 http:// 子资源，从而可移除
    // MainActivity 的 MIXED_CONTENT_ALWAYS_ALLOW（A0-01 技术债根治，ADR-017 §六）。
    // 桌面端（crossOriginIsolated=true）仍走 StartFileServer（localhost HTTP）以维持既有流式性能与行为。
    // `backend.kind === 'browser'` 为保底：避免带 COOP/COEP 的网页部署误判 crossOriginIsolated=true 而走 http 崩溃。
    if (backend.kind === 'browser' || !getCachedCapabilities().crossOriginIsolated) {
        const bytes = await backend.readFileBytes(safeDir + '/' + fileName);
        if (!bytes)
            throw new Error(`[fileservice] readFileBytes failed for ${safeDir}/${fileName}`);
        const blobUrl = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
        );
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

// normPath 已下沉至零依赖叶 @/core/path（ADR-191）；此处仅 re-export 以维持
// `from '../core/fileservice'` 的既有外部引用（scene.ts / 测试）不变。
export { normPath } from './path';
