// [doc:architecture] Web 模型库 — ADR-176 Phase 3
//
// web-loader（浏览器专属入口）的模型库持久化。与 browser-adapter 共享同一
// IndexedDB（core/backend/idb），键规约：
//   models 库：`entry:<name>` = WebModelEntry 元数据；`file:<name>` = 原档字节（zip/pmx）
//   meta  库：`web-loader.lastModel` = 上次加载的模型名
// 主前端经 backend.GetLibraryIndex() / readFileBytes('file:<name>') 可见同一批数据。
//
// 分层说明：web-loader 是浏览器专属入口壳，直接消费 idb 与 go-adapter 直连
// @bindings 对称，不构成对 backend 抽象的绕行（跨平台业务代码仍必须走 backend）。

import { idbGet, idbSet, idbDelete, idbKeys } from '../core/backend/idb';

export interface WebModelEntry {
    /** 库内唯一名（去扩展名的文件名） */
    name: string;
    /** 原始文件名（含 .pmx / .zip 扩展名，恢复加载时还原 File） */
    fileName: string;
    kind: 'pmx' | 'zip';
    /** 原档字节数 */
    size: number;
    /** 存入时刻（epoch ms） */
    savedAt: number;
}

const entryKey = (name: string): string => `entry:${name}`;
const fileKey = (name: string): string => `file:${name}`;
const LAST_MODEL_KEY = 'web-loader.lastModel';

/** 存入模型库（同名覆盖）。返回写入的元数据。 */
export async function saveModel(
    fileName: string,
    bytes: Uint8Array,
    kind: 'pmx' | 'zip'
): Promise<WebModelEntry> {
    const name = fileName.replace(/\.(pmx|zip)$/i, '');
    const entry: WebModelEntry = {
        name,
        fileName,
        kind,
        size: bytes.byteLength,
        savedAt: Date.now(),
    };
    await idbSet('models', fileKey(name), bytes);
    await idbSet('models', entryKey(name), entry);
    return entry;
}

/** 列出库内全部模型（按存入时间倒序）。 */
export async function listModels(): Promise<WebModelEntry[]> {
    const keys = (await idbKeys('models')).filter((k) => k.startsWith('entry:'));
    const out: WebModelEntry[] = [];
    for (const k of keys) {
        const e = await idbGet<WebModelEntry>('models', k);
        if (e) out.push(e);
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** 读取模型原档字节。 */
export async function loadModelBytes(name: string): Promise<Uint8Array | null> {
    return (await idbGet<Uint8Array>('models', fileKey(name))) ?? null;
}

/** 读取模型元数据。 */
export async function getModelEntry(name: string): Promise<WebModelEntry | null> {
    return (await idbGet<WebModelEntry>('models', entryKey(name))) ?? null;
}

/** 删除模型（元数据 + 原档配对删除；若为 lastModel 一并清除）。 */
export async function deleteModel(name: string): Promise<void> {
    await idbDelete('models', entryKey(name));
    await idbDelete('models', fileKey(name));
    if ((await getLastModel()) === name) {
        await setLastModel(null);
    }
}

/** 记录/清除上次加载的模型名。 */
export async function setLastModel(name: string | null): Promise<void> {
    if (name === null) {
        await idbDelete('meta', LAST_MODEL_KEY);
    } else {
        await idbSet('meta', LAST_MODEL_KEY, name);
    }
}

/** 取上次加载的模型名（无则 null）。 */
export async function getLastModel(): Promise<string | null> {
    return (await idbGet<string>('meta', LAST_MODEL_KEY)) ?? null;
}

/** 人类可读字节数。 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
