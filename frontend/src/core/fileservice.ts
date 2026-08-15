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
/** 惰性缓存 resolveBackend 结果（避免每请求重路由）。失败不缓存 rejected Promise，下次调用重试。 */
function getBackend(): Promise<BackendService> {
    if (!_cachedBackend) {
        _cachedBackend = resolveBackend().catch((err) => {
            // [audit:round13 P3] 原实现缓存 rejected Promise → 永久失败永不再试
            //（如 transient 网络错误 / 后端尚未就绪）。失败时清空缓存，后续调用重试。
            _cachedBackend = null;
            throw err;
        });
    }
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
 * 浏览器分支返回 `blob:` URL（内存中 Blob），**调用方用完必须调用 {@link revokeFileUrl} 释放**
 * （否则 Blob 驻留内存；详见 ADR-176 双环境适配）。
 *
 * @returns URL、端口、文件所在目录
 */
export async function resolveFileUrl(
    filePath: string
): Promise<{ url: string; port: number; dir: string }> {
    const normalized = normPath(filePath);
    const safeDir = await IsolateModelDir(normalized);
    const fileName = normalized.substring(normalized.lastIndexOf('/') + 1);
    // [doc:adr-176] 浏览器端不使用 StartFileServer；后端选型后直接走
    // readFileBytes + Blob URL，构造 blob: 前缀。
    const backend = await getBackend();
    // [doc:adr-017][doc:adr-176][doc:adr-178] 浏览器端、Android 应用或无 crossOriginIsolated（单线程物理）宿主
    // 均不使用 127.0.0.1 HTTP 文件服务：改用 readFileBytes + Blob URL，彻底消除 http:// 子资源，从而可移除
    // MainActivity 的 MIXED_CONTENT_ALWAYS_ALLOW（A0-01 技术债根治，ADR-017 §六）。
    // 桌面端（crossOriginIsolated=true）仍走 StartFileServer（localhost HTTP）以维持既有流式性能与行为。
    // `backend.kind === 'browser'` 为保底：避免带 COOP/COEP 的网页部署误判 crossOriginIsolated=true 而走 http 崩溃。
    if (backend.kind === 'browser' || !getCachedCapabilities().crossOriginIsolated) {
        // 浏览器分支的 IsolateModelDir 已返回虚拟模型目录 web://model/<encStem>，
        // 它本身就是 browser-adapter 的加载路径（file:<encStem> 的规范入口）。
        // 再拼一次原始 fileName 会变成 web://model/<encStem>/<原始文件名>，非 ASCII
        // 文件名因 encStem 与裸文件名不一致而无法命中 IndexedDB 键，导致主文件读取失败。
        // 但 Android/go 降级分支的 safeDir 仍是真实隔离目录，必须保留 /fileName。
        const readPath = backend.kind === 'browser' ? safeDir : `${safeDir}/${fileName}`;
        const bytes = await backend.readFileBytes(readPath);
        if (!bytes) {
            throw new Error(`[fileservice] readFileBytes failed for ${readPath}`);
        }
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
 * 释放 resolveFileUrl 浏览器分支产生的 blob: URL（调用方用完必须调用，配对释放）。
 * [audit:round13 P3] 原实现 createObjectURL 永不 revoke → Blob 驻留内存；
 * 提供配套 revoke 入口使调用方能够成对释放（http:// 分支传 http URL 时无害 no-op）。
 */
export function revokeFileUrl(url: string | undefined | null): void {
    if (url && url.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* noop — 已释放或非 blob URL */
        }
    }
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
