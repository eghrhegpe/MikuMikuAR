// [doc:architecture] 浏览器侧 IndexedDB 轻量封装 — ADR-176 browser-adapter 内部工具
//
// 资源配对：openDB 惰性单例，closeIDB() 在页面卸载/切换时释放连接。

const DB_NAME = 'mikumikuar-web';
const DB_VERSION = 1;

export const STORES = [
    'config',
    'uistate',
    'scenes',
    'models',
    'thumbnails',
    'caches',
    'presets',
    'tags',
    'meta',
] as const;
export type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('[idb] IndexedDB 不可用（非浏览器环境）'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            // [doc:adr-177] Phase 4 IndexedDB 迁移框架
            // v1：旧 web-loader 与新主应用共享同一 schema，键规约一致（file:<name>），无需迁移。
            // 未来 schema 变更在此追加 if (oldVersion < N) { ... } 分支。
            const db = req.result;
            const oldVersion = event.oldVersion;
            void oldVersion; // 当前 v1 无迁移逻辑，预留钩子

            // 首次创建或补建缺失 store
            for (const s of STORES) {
                if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

export async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
    const db = await openDB();
    return new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
    });
}

export async function idbSet(store: Store, key: string, value: unknown): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function idbDelete(store: Store, key: string): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function idbKeys(store: Store): Promise<string[]> {
    const db = await openDB();
    return new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => resolve(req.result as string[]);
        req.onerror = () => reject(req.error);
    });
}

/** 释放连接（页面卸载/切换时调用），与联邦资源配对纪律对齐。 */
export function closeIDB(): void {
    if (dbPromise) {
        dbPromise.then((db) => db.close()).catch(() => undefined);
        dbPromise = null;
    }
}

// ── 模型库（web-loader 与 drop-import 共享） ──────────────────

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

const _entryKey = (name: string): string => `entry:${name}`;
const _fileKey = (name: string): string => `file:${name}`;
const _LAST_MODEL_KEY = 'web-loader.lastModel';

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
    await idbSet('models', _fileKey(name), bytes);
    await idbSet('models', _entryKey(name), entry);
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
    return (await idbGet<Uint8Array>('models', _fileKey(name))) ?? null;
}

/** 读取模型元数据。 */
export async function getModelEntry(name: string): Promise<WebModelEntry | null> {
    return (await idbGet<WebModelEntry>('models', _entryKey(name))) ?? null;
}

/** 删除模型（元数据 + 原档配对删除；若为 lastModel 一并清除）。 */
export async function deleteModel(name: string): Promise<void> {
    await idbDelete('models', _entryKey(name));
    await idbDelete('models', _fileKey(name));
    if ((await getLastModel()) === name) {
        await setLastModel(null);
    }
}

/** 记录/清除上次加载的模型名。 */
export async function setLastModel(name: string | null): Promise<void> {
    if (name === null) {
        await idbDelete('meta', _LAST_MODEL_KEY);
    } else {
        await idbSet('meta', _LAST_MODEL_KEY, name);
    }
}

/** 取上次加载的模型名（无则 null）。 */
export async function getLastModel(): Promise<string | null> {
    return (await idbGet<string>('meta', _LAST_MODEL_KEY)) ?? null;
}

/** 人类可读字节数。 */
export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
