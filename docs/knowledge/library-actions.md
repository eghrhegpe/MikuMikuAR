---
tier: architecture
kind: library_actions
name: 资源库操作
category: ui
scope:
  - frontend/src/menus/library-actions.ts
source_files:
  - frontend/src/menus/library-actions.ts
adr:
  - ADR-131
  - ADR-135
  - ADR-143
  - ADR-150
  - ADR-155
  - ADR-169
  - ADR-182
  - ADR-195
symbols:
  - prepareModelRestore
  - importFile
  - importFileByPath
  - onModelRowClick
  - replaceModel
  - replaceMotion
  - buildTagsOverviewLevel
  - buildTagDetailLevel
  - highlightRow
  - findLibraryModelByName
  - findLibraryMotionByName
invariants:
  - 模块级 `_loadManagerAbortCtrl`（AbortController）取消上一 `loadManager.load()`，防快速连点竞态（ADR-143）
  - 替换 / 动作替换前 `pushUndoSnapshot` + `captureInheritedState`，成功后 `offerSceneUndoAndRefresh` 提供撤销（ADR-127/150/169）
  - 提取 / 加载中间步骤走状态栏（`feedbackStatus`），避免与最终 toast 叠加（ADR-feedback）
  - 多格式分流：`.zip` 解压后自动加载主 PMX；`.pmx` 与 `web://model/<encStem>` 视为 PMX 加载；`.vmd` 加载动作（ADR-182）
  - 行点击守卫：提取中 / 替换中直接返回并提示，不重复触发
tests: []
use_when:
  - 资源库操作
  - 导入模型
  - 替换模型
  - 替换动作
  - 标签浏览
  - 模型行点击
---

# 资源库操作

## 系统概览
资源库交互的执行层：把用户在资源浏览层（library-browse）的点击 / 导入 / 替换动作，翻译成对 `loadManager`、模型注册表与撤销系统的调用。所有对外能力均为纯函数式导出，UI 层（library-browse / library-setup）按需引用；内部替换 / 普通加载逻辑（`startReplaceModel` / `loadModelNormal`）为模块私有，不对外暴露。

## 核心职责

### 会话恢复与导入
- `prepareModelRestore(browseDir, category)` — 恢复上次会话：扫描 `recentModels`，定位 `browseDir` 下同 ref 的模型并聚焦；`allModels` 为空时直接跳过；无 recent 命中则回退 `GetLastBrowseDir(category)`。
- `importFile()` — 弹 `SelectImportFile` 对话框，用户取消则静默返回，失败走 `feedbackError`，选后委托 `importFileByPath`。
- `importFileByPath(path)` — 按扩展名分流：`.zip` → 解压后自动加载主 PMX（zip 导入与拖放行为一致）；`.pmx` / `web://model/*` → 加载 actor；`.vmd` → 加载动作；其余 → `feedbackStatus('library.unsupportedFormat')`。

### 行点击路由（普通 / 替换）
- `onModelRowClick(m, jumpToDirModelId?)` — 行点击入口：先判提取中 / 替换中守卫；记录 `recentModel` 与 `browseDir`；若 `jumpToDirModelId` 且为 actor → `startReplaceModel`（替换模式），否则 `loadModelNormal`（普通模式）。经 `replaceModel` 传参取代 `currentLevel.outcome` mutation（ADR-131）。
- `replaceModel(m)` — 模型行点击语义：等价于 `onModelRowClick(m, focusedModelId ?? undefined)`，即替换为当前聚焦模型。
- `replaceMotion(m)` — VMD 行点击：非 vmd 退化 `replaceModel`；无聚焦模型退化 `onModelRowClick`；否则原位替换聚焦模型基础动作（`pushUndoSnapshot` + `loadManager.load({kind:'vmd', modelId})` + `triggerAutoSave` + `offerSceneUndoAndRefresh`）（ADR-169）。

### 标签与查询
- `buildTagsOverviewLevel()` — 标签总览弹层（收藏 + 全部标签）。
- `buildTagDetailLevel(tagName)` — 单标签详情弹层。
- `highlightRow(root, rowKey)` — 高亮指定行（`slide-focused` + `scrollIntoView`）。
- `findLibraryModelByName(name)` / `findLibraryMotionByName(name)` — 纯名称模糊查询，**不触发加载**，供 ADR-155/197 NL 控制的 resolve 阶段使用，避免误触发真实加载。

## 对外 API（节选）
- `prepareModelRestore(browseDir, category)` / `importFile()` / `importFileByPath(path)`
- `onModelRowClick(m, jumpToDirModelId?)` / `replaceModel(m)` / `replaceMotion(m)`
- `buildTagsOverviewLevel()` / `buildTagDetailLevel(tagName)` / `highlightRow(root, rowKey)`
- `findLibraryModelByName(name)` / `findLibraryMotionByName(name)`

## 内部执行（模块私有，非导出）
- `startReplaceModel(m, replaceId)` — 替换执行：取消上一 AbortCtrl → `captureInheritedState` + `pushUndoSnapshot` → `loadManager.load` → `applyInheritedState` → `removeModel(replaceId)` → `offerSceneUndoAndRefresh`（保持浏览层打开，outcome.modelId 指向新模型，ADR-150/195）。
- `loadModelNormal(m, isStage)` — 普通加载：zip 提取或按格式直接 `loadManager.load`；模块级 AbortController 防连点竞态（ADR-143）。

## 与其他子系统关系
- 依赖 `library-core` / `librarySessionStore`（会话状态）、`@/core/fileservice`（`SelectImportFile` / `GetLastBrowseDir` / `GetModelsByTag` / `GetAllTags`）。
- 依赖 `loadManager`（加载）、`model-ops`（`removeModel`）、`modelRegistry`（`get`）、`model-loader`（`captureInheritedState` / `applyInheritedState`）。
- 依赖撤销系统 `pushUndoSnapshot` / `offerSceneUndoAndRefresh`（ADR-127）、反馈 `feedbackStatus` / `feedbackError` / `withLoadingStatus*`。
- 下游 UI：`stackRegistry.modelStack.reRender()`、`getMotionMenu()?.reRender()`。

## UI 入口

- 无独立入口函数（菜单基础设施卡）：菜单层级 / 入口一览见 [menu-map.md](./menu-map.md)（机器生成）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）由对应源码 UI 卡补充说明。
