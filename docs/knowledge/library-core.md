---
tier: architecture
source_files:
  - frontend/src/menus/library-core.ts
tests:
  - frontend/src/__tests__/library-core.build-level.test.ts
  - frontend/src/__tests__/library-core.model-to-resource.test.ts
  - frontend/src/__tests__/library-core.model-to-row.test.ts
  - frontend/src/__tests__/library-core.path-boundary.test.ts
  - frontend/src/__tests__/library-core.resource-items.test.ts
  - frontend/src/__tests__/library-core.subdir-file.test.ts
adr:
  - ADR-131
  - ADR-135
  - ADR-136
  - ADR-195
  - ADR-238
kind: library_core
name: 资源库核心
category: ui
scope:
  - frontend/src/menus/library-core.ts
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
  - 视图模式在 list/grid 之间切换（resourceViewMode 经 setResourceViewMode 写入，真源 core/config）
  - renderCustom 必须返回 dispose 链：renderGridMode 内 createResourcePanel 的 handle 经 cardContainer 返回，menu.ts _customDispose 在重建/dispose 时释放 observer/virtualGrid（p3-leak 修复，2026-08-05）
  - 全屏 onSelect/onBack 双路径均须 safeDispose currentPanel（onSelect 修复，2026-08-05）
  - ensureModelMeta 每分片基于最新 modelMetaCache 增量合并回写，防不相交并发互相覆盖（p4 修复，2026-08-05）
  - buildResourceItemsForDir 是纯数组构建；RAF 分批渲染在 renderItemsWithRAF（列表模式）
  - 扫描/配置（initLibrary/rescanAndSync/refreshLibrary 等）真源在 library-setup.ts，本文件 re-export 兼容

use_when:
  - 资源库核心
  - 资源浏览层级
  - 网格视图
  - 缩略图流式加载
  - 资源管理核心
---

# 资源库核心

## 系统概览
**资源库核心模块**（library-core.ts）。资源库的**菜单/UI 构建核心**：负责浏览层级构建（`buildLevel`）、目录行构建（`buildPopupRows` / `buildModelRootItems`）、网格/列表渲染（`renderGridMode` / `renderItemsWithRAF`）、缩略图流式加载（`loadThumbnailsStreaming`，ADR-136）、元数据惰性守卫（`ensureModelMeta`）。资源**扫描/配置**（`initLibrary` / `rescanAndSync` / `refreshLibrary` 等）已迁至 `library-setup.ts`，本文件经 re-export 保持向后兼容。

## 核心职责
- `library-core.ts` — 浏览层级/行构建、视图渲染、缩略图流式加载、元数据缓存守卫、`buildLevel` 注入 menu-stack-registry、`buildBrowseLevel` 注册 ui-action-bridge（ADR-238）。

## 对外 API（节选）
- `type ResourceViewMode = 'list' | 'grid'` — 资源库视图模式。
- `getResourceViewMode()` / `setResourceViewMode(mode)` — 查询/设置视图模式。
- `buildLevel(dir, label, filter, stack, extraFolders, outcome)` — 构建浏览层级（renderCustom 自愈重算，ADR-131）。
- `loadThumbnailsStreaming(keys)` / `abortThumbnailStreaming()` — 缩略图流式加载 + 批次取消（ADR-136）。
- `getPendingMetaGuard()` — 取后台元数据加载守卫。
- `isLeafFlattenDir` / `isModelDirTarget` / `splitSubdirSegments` / `getRelativePathUnderDir` — 目录判定/路径工具。

## 与其他子系统关系
- `library-setup.ts` — 扫描/配置真源（initLibrary/rescanAndSync/refreshLibrary/reloadConfig/selectResourceRoot 等），本文件 re-export 兼容。
- `library-browse.ts` — `showModelPopup`（re-export）。
- `library-actions.ts` — `importFile` / `replaceModel` / `replaceMotion`（re-export + onModelRowClick 消费）。
- `core/ui-helpers` / `core/ui-card.ts` — `cardContainer` / `createResourcePanel` / `openFullscreen`（渲染原语；createResourcePanel 返回含 dispose 的 handle）。
- `menu-stack-registry.ts` — 模块加载时注入 `stackRegistry.buildLevel = buildLevel`。
- `ui-action-bridge.ts` — 注册 `buildBrowseLevel` 供 core/action-defs 调用（ADR-238）。
- `motion-popup.ts` / `scene-stage-levels.ts` — 经 stackRegistry.buildLevel / 动态 import 消费 buildLevel。

## UI 入口

- 菜单层级 / 入口函数 / 快捷键统一由 [menu-map.md](./menu-map.md) 机器生成（勿手改）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）无法静态提取，缺口由本卡正文说明。
## 不变量
- renderCustom 返回 dispose 链（grid 模式经 cardContainer 透传 createResourcePanel handle），menu.ts `_customDispose` 在重建/dispose 时释放——防止 observer/virtualGrid 泄漏。
- 全屏打开面板的 onSelect / onBack 双路径均 safeDispose `currentPanel`。
- `ensureModelMeta` 每分片基于最新缓存增量合并，跨路径并发不互相覆盖。
- `buildResourceItemsForDir` 为纯数组构建（无副作用）；长列表 RAF 分批渲染在 `renderItemsWithRAF`。
