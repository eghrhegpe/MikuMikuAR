/**
 * 纯前端 PMX 头部元数据解析（comment 提取）。
 * 不依赖 Go 后端，Wails 桌面模式和 Web 模式通用。
 * 只读前 8KB，足够覆盖头部四个文本段（name_jp/name_en/comment_jp/comment_en）。
 */

export interface PmxMeta {
    comment: string;
}

/**
 * 从 PMX 文件的 Uint8Array 中提取 comment（日本语说明/使用规约）。
 * 解析失败时返回空 comment（不抛异常）。
 */
export function parsePmxComment(bytes: Uint8Array): string {
    try {
        return _parsePmxCommentUnsafe(bytes);
    } catch {
        return '';
    }
}

function _parsePmxCommentUnsafe(bytes: Uint8Array): string {
    // PMX 格式：signature(4) + version(4 float32) + globalsCount(1) + flags(N) + text段×4
    if (bytes.length < 9) return '';

    // 检查签名 "PMX "
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (sig !== 'PMX ') return '';

    let offset = 8; // 跳过 signature(4) + version(4)
    const globalsCount = bytes[offset];
    offset++;
    if (offset + globalsCount > bytes.length) return '';

    const encoding = bytes[offset]; // 0=UTF-16LE, 1=UTF-8
    offset += globalsCount;

    // 读取四个文本段，只取第三个（CommentJp, index=2）
    for (let i = 0; i < 4; i++) {
        if (offset + 4 > bytes.length) return '';
        const textLen =
            (bytes[offset + 3] << 24) |
            (bytes[offset + 2] << 16) |
            (bytes[offset + 1] << 8) |
            bytes[offset];
        offset += 4;
        if (textLen < 0 || offset + textLen > bytes.length) return '';

        if (i === 2) {
            // CommentJp
            const raw = bytes.subarray(offset, offset + textLen);
            const text = encoding === 0 ? decodeUTF16LE(raw) : new TextDecoder().decode(raw);
            // eslint-disable-next-line no-control-regex -- PMX 二进制空字节必须用 \x00 匹配
            return text.replace(/\x00+$/, '').trim();
        }
        offset += textLen;
    }

    return '';
}

function decodeUTF16LE(bytes: Uint8Array): string {
    if (bytes.length % 2 !== 0) return '';
    const codeUnits: number[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
        codeUnits.push(bytes[i] | (bytes[i + 1] << 8));
    }
    return String.fromCharCode(...codeUnits);
}
