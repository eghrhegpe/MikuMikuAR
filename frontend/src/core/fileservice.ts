// fileservice.ts — 统一文件服务层
// 所有需要通过 HTTP 加载模型/动作文件的函数都使用此模块。
// 集中一处 URL 构造逻辑，避免重复实现导致"改一处漏一处"。

import { StartFileServer, IsolateModelDir } from './wails-bindings';

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
    const port = await StartFileServer(safeDir);
    const url = `http://127.0.0.1:${port}/?f=${encodeFileRef(fileName)}`;
    return { url, port, dir: safeDir };
}

// ======== normPath 缓存（buildLevel 每模型调用一次，缓存避免重复正则） ========
const _normPathCache = new Map<string, string>();
const NORM_PATH_CACHE_MAX = 5000;

/** 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。
 *  注意：Android SAF URI（content://...）原样返回，不做转换。
 *  结果缓存，避免 buildLevel 遍历千级模型时重复正则替换。 */
export function normPath(p: string): string {
    const cached = _normPathCache.get(p);
    if (cached !== undefined) {
        return cached;
    }

    let result: string;
    if (p.startsWith('content://')) {
        result = p;
    } else {
        result = p.replace(/\\/g, '/').replace(/\/+$/, '');
    }

    if (_normPathCache.size >= NORM_PATH_CACHE_MAX) {
        _normPathCache.clear();
    }
    _normPathCache.set(p, result);
    return result;
}
