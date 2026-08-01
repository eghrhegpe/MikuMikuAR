---
tier: architecture
kind: library_core
name: 资源库核心
category: ui
scope:
  - frontend/src/menus/library-core.ts
source_files:
  - frontend/src/menus/library-core.ts
adr: []
symbols:
  - ResourceViewMode
  - abortThumbnailStreaming
  - buildLevel
  - buildModelFormationLevel
  - buildModelRootItems
  - buildResourceItemsForDir
  - computeRestoreSegments
  - getPendingMetaGuard
  - getRelativePathUnderDir
  - getResourceViewMode
  - importFile
  - initLibrary
  - isLeafFlattenDir
  - isModelDirTarget
  - loadThumbnailsStreaming
  - modelToResourceItem
  - modelToRow
  - prepareModelRestore
  - refreshLibrary
  - refreshModelRoot
  - reloadConfig
  - rescanAndSync
  - resolveDisplayBrowseDir
  - selectOverridePath
  - selectResourceRoot
  - setResourceViewMode
  - showModelPopup
  - splitSubdirSegments
  - switchStorageMode
  - thumbnailKeyForModel
invariants:
  - 视图模式在 list/grid 之间切换
  - 资源索引在后台构建，避免阻塞 UI
  - isLeafFlattenDir 递归判定目录是否为纯叶子目录
  - buildResourceItemsForDir 使用 RAF 分批渲染避免长列表卡顿
tests: []
use_when:
  - 资源库核心
  - 资源扫描
  - 资源索引
  - 资源管理核心
---

# 资源库核心

## 系统概览
**资源库核心模块**。负责资源扫描、索引构建、资源元数据管理，是资源库的数据层。

## 核心职责
- `library-core.ts` — 资源扫描、索引构建、元数据管理。

## 对外 API（节选）
- `type ResourceViewMode = 'list' | 'grid'` — 资源库视图模式。
- `getResourceViewMode()` / `setResourceViewMode(mode)` — 查询/设置视图模式。
- `isModelDirTarget(target)` — 判断目标是否为模型目录。
- `getPendingMetaGuard()` — 取后台加载守卫。

## 与其他子系统关系
- 文件服务：`@/core/fileservice`。
- 数据库：`@/core/backend/idb.ts`（IndexedDB）。
- 资源库 UI：`library-browse.ts`。

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
## 不变量
- 资源索引在后台线程构建，避免阻塞 UI。
- 索引文件变化时自动更新索引。
