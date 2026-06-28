// fileservice.ts — 统一文件服务层
// 所有需要通过 HTTP 加载模型/动作文件的函数都使用此模块。
// 集中一处 URL 构造逻辑，避免重复实现导致"改一处漏一处"。

import { StartFileServer, IsolateModelDir } from "../../wailsjs/go/main/App";

/**
 * 从文件路径解析出 HTTP URL 及对应服务器信息。
 * - 拆分目录/文件名 → 启动/复用文件服务器 → 构造 HTTP URL
 * - 输入路径支持正斜杠或反斜杠，内部统一处理
 *
 * @returns URL、端口、文件所在目录
 */
export async function resolveFileUrl(filePath: string): Promise<{ url: string; port: number; dir: string }> {
    const normalized = normPath(filePath);
    const safeDir = await IsolateModelDir(normalized);
    const fileName = normalized.substring(normalized.lastIndexOf("/") + 1);
    const port = await StartFileServer(safeDir);
    const url = `http://127.0.0.1:${port}/${encodeURIComponent(fileName)}`;
    return { url, port, dir: safeDir };
}

/** 标准化路径：反斜杠 → 正斜杠，去掉尾部斜杠。 */
export function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}
