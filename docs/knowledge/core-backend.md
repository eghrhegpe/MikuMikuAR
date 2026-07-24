---
kind: core_backend
name: 后端适配层
category: core
scope:
  - frontend/src/core/backend/*.ts
source_files:
  - frontend/src/core/backend/index.ts
  - frontend/src/core/backend/types.ts
  - frontend/src/core/backend/browser-adapter.ts
  - frontend/src/core/backend/go-adapter.ts
  - frontend/src/core/backend/idb.ts
adr:
  - ADR-176
symbols:
  - BackendAdapter
  - IndexedDBStore
  - BrowserAdapter
  - GoAdapter
invariants:
  - 浏览器和桌面后端通过适配器接口统一
  - IndexedDB 操作异步非阻塞
tests: []
use_when:
  - 后端适配
  - 浏览器后端
  - Go 后端
  - IndexedDB
  - 存储适配
---

## 系统概览
**后端适配层**。提供统一的后端接口，支持浏览器（IndexedDB）和桌面（Go）两种后端。
`idb.ts` 封装 IndexedDB 操作，`browser-adapter.ts` 和 `go-adapter.ts` 分别为两种后端实现。

## 核心职责
- `backend/index.ts` — 后端适配层入口。
- `backend/types.ts` — 后端接口定义。
- `backend/browser-adapter.ts` — 浏览器后端实现（IndexedDB）。
- `backend/go-adapter.ts` — 桌面后端实现（Go/Wails）。
- `backend/idb.ts` — IndexedDB 操作封装。

## 对外 API（节选）
- `BackendAdapter` — 后端适配器接口。
- `BrowserAdapter` — 浏览器后端实现。
- `GoAdapter` — Go 后端实现。
- `idbSet(store, key, value)` — 写入 IndexedDB。
- `idbGet(store, key)` — 读取 IndexedDB。
- `idbDelete(store, key)` — 删除 IndexedDB 记录。

## 与其他子系统关系
- IndexedDB：`@/core/backend/idb`。
- Wails 绑定：`@/core/wails-bindings`。
- 文件导入：`@/core/drop-import`。

## 不变量
- 适配器接口统一：浏览器和桌面后端通过相同接口调用。
- IndexedDB 操作异步：所有操作返回 Promise，不阻塞 UI。
- 数据隔离：浏览器和桌面后端数据独立存储。
