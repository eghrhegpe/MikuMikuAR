// [doc:architecture] 浏览器侧 IndexedDB 轻量封装 — ADR-176 browser-adapter 内部工具
//
// 资源配对：openDB 惰性单例，closeIDB() 在页面卸载/切换时释放连接。

const DB_NAME = 'mikumikuar-web';
// [doc:adr-203] v2：补建 'chats' store（AI 助手多会话持久化）。
// onupgradeneeded 仅在版本号提升时触发，对已有 v1 数据库必须升版本才能补建缺失 store。
const DB_VERSION = 2;

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
    // [doc:adr-203] AI 助手多会话历史：meta:<id> 存会话元信息，msgs:<id> 存消息数组。
    // onupgradeneeded 在 DB_VERSION 提升时补建（见 openDB 升级钩子）。
    'chats',
] as const;
export type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('[idb] IndexedDB 不可用（非浏览器环境）'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            // [doc:adr-177] Phase 4 IndexedDB 迁移框架
            // v1：历史 web-loader（已删除）与主应用共享同一 schema，键规约一致（file:<name>），无需迁移。
            // v2：[doc:adr-203] 新增 'chats' store（AI 助手多会话持久化）。
            //     老用户已有 v1 数据库无 chats store，必须升版本号触发 onupgradeneeded 才能补建。
            //     下方统一遍历 STORES 补建缺失项，对 v1→v2 与全新安装均覆盖。
            // 未来 schema 变更在此追加 if (oldVersion < N) { ... } 分支。
            const db = req.result;
            const oldVersion = event.oldVersion;
            void oldVersion; // 当前 v2 仅依赖 STORES 遍历补建，无需 oldVersion 分支；预留钩子供未来迁移使用

            // 首次创建或补建缺失 store（覆盖 v1→v2 升级与全新安装两种路径）
            for (const s of STORES) {
                if (!db.objectStoreNames.contains(s)) {
                    db.createObjectStore(s);
                }
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
        // [fix P2] QuotaExceededError 等触发 onabort 而非 onerror，缺此处理器 Promise 永不 settle
        tx.onabort = () => reject(tx.error);
    });
}

export async function idbDelete(store: Store, key: string): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        // [fix P2] 同上：onabort 时 Promise 须 reject
        tx.onabort = () => reject(tx.error);
    });
}

/** 单事务批量写入（键/值对），避免逐条 idbSet 的并发写竞态。
 *  [doc:adr-195] P3 约束：批量摄入（下载文件夹扫描）须包入事务，一次性写该批次所有 file:/entry: 键。 */
export async function idbBatchSet(store: Store, entries: [string, unknown][]): Promise<void> {
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        for (const [key, value] of entries) {
            tx.objectStore(store).put(value, key);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        // [fix P2] 同上：onabort 时 Promise 须 reject
        tx.onabort = () => reject(tx.error);
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
