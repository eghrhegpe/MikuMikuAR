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
//
// 模型库函数已迁移到 core/backend/idb，此处全部转发以保持向后兼容。

import {
    idbGet, idbSet, idbDelete, idbKeys,
    saveModel as _saveModel,
    listModels as _listModels,
    loadModelBytes as _loadModelBytes,
    getModelEntry as _getModelEntry,
    deleteModel as _deleteModel,
    setLastModel as _setLastModel,
    getLastModel as _getLastModel,
    formatSize as _formatSize,
} from '../core/backend/idb';
export type { WebModelEntry } from '../core/backend/idb';

/** @deprecated 请从 '../core/backend/idb' 直接导入 saveModel */
export const saveModel = _saveModel;
/** @deprecated 请从 '../core/backend/idb' 直接导入 listModels */
export const listModels = _listModels;
/** @deprecated 请从 '../core/backend/idb' 直接导入 loadModelBytes */
export const loadModelBytes = _loadModelBytes;
/** @deprecated 请从 '../core/backend/idb' 直接导入 getModelEntry */
export const getModelEntry = _getModelEntry;
/** @deprecated 请从 '../core/backend/idb' 直接导入 deleteModel */
export const deleteModel = _deleteModel;
/** @deprecated 请从 '../core/backend/idb' 直接导入 setLastModel */
export const setLastModel = _setLastModel;
/** @deprecated 请从 '../core/backend/idb' 直接导入 getLastModel */
export const getLastModel = _getLastModel;
/** @deprecated 请从 '../core/backend/idb' 直接导入 formatSize */
export const formatSize = _formatSize;
