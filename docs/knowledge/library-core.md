---
kind: library_core
name: 资源库核心
category: ui
scope:
  - frontend/src/menus/library-core.ts
source_files:
  - frontend/src/menus/library-core.ts
adr: []
symbols:
  - LibraryCore
  - scanLibrary
  - indexResource
invariants:
  - 资源索引在后台线程构建
tests: []
use_when:
  - 资源库核心
  - 资源扫描
  - 资源索引
  - 资源管理核心
---

## 系统概览
**资源库核心模块**。负责资源扫描、索引构建、资源元数据管理，是资源库的数据层。

## 核心职责
- `library-core.ts` — 资源扫描、索引构建、元数据管理。

## 对外 API（节选）
- `scanLibrary(paths)` — 扫描资源路径。
- `indexResource(filePath)` — 索引单个资源。
- `getIndexedResources()` — 取已索引资源列表。

## 与其他子系统关系
- 文件服务：`@/core/fileservice`。
- 数据库：`@/core/backend/idb.ts`（IndexedDB）。
- 资源库 UI：`library-browse.ts`。

## 不变量
- 资源索引在后台线程构建，避免阻塞 UI。
- 索引文件变化时自动更新索引。
