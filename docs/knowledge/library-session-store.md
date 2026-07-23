---
kind: library_session_store
name: 资源库会话状态单例
category: ui
scope:
  - frontend/src/menus/**
source_files:
  - frontend/src/menus/library-session-store.ts
adr:
  - ADR-135
---

## 系统概览
资源库会话状态单例（ADR-135），收敛 `library-core` / `library-actions` / `library-browse` 三个模块散落的隐式状态变量，提供唯一权威读写入口。管理恢复链路（上次浏览位置 + 高亮模型）与加载守卫（解压 / 替换进行中标记）。

## 核心职责
- `library-session-store.ts` — 会话恢复状态、加载守卫管理。

## 对外 API（节选）
- `LibraryRestoreStatus` — 延迟恢复状态机（'idle' | 'polling' | 'ready' | 'timeout'）。
- `LibraryRestoreState` — 恢复链路状态接口（pendingAutoExpand / pendingFocusModel / timer / status / targetSeg / startedAt）。
- `LibraryLoadingState` — 加载守卫接口（extraction Set / replaceLoading）。
- `librarySessionStore` — 单例实例。
  - `getPendingAutoExpand()` / `setPendingAutoExpand(v)` — 待展开目录读写。
  - `getPendingFocusModel()` / `setPendingFocusModel(v)` — 待高亮模型读写。
  - `getRestoreStatus()` / `markRestorePolling(seg)` / `markRestoreTimeout()` / `markRestoreReady()` / `clearRestoreStatus()` — 恢复状态机控制。
  - `isExtracting(modelKey?)` / `setExtracting(modelKey)` / `clearExtracting(modelKey?)` — 解压状态守卫（P1.2 支持 per-model 精确守卫，非解压模型直接放行）。
  - `isReplaceLoading()` / `setReplaceLoading(v)` — 替换加载中标记。
  - `reset()` — 重置恢复链路状态（弹窗关闭时调用，不重置 loading 状态）。

## 与其他子系统关系
- 被 [`library-browse`](./library-browse.md)（恢复导航）、`library-actions`（解压守卫）、`library-core` 引用。