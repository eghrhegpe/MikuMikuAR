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
            // v1：历史 web-loader（已删除）与主应用共享同一 schema，键规约一致（file:<name>），无需迁移。
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

// ── 模型库（browser-adapter 与 drop-import 共享） ──────────────────

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

// 注：listModels/loadModelBytes/getModelEntry/deleteModel/formatSize/setLastModel/getLastModel
// 已删除（无外部消费者；browser-adapter.ts 内部使用 _listModels 等私有实现，不再走 idb.ts 公共 API）。
// 列表/读取/删除等 CRUD 操作请使用 browser-adapter.ts 暴露的统一 backend 接口。
