---
kind: library_actions
name: 资源库操作
category: ui
scope:
  - frontend/src/menus/library-actions.ts
source_files:
  - frontend/src/menus/library-actions.ts
adr: []
symbols:
  - loadThumbnailsForLevel
  - ensureModelMeta
  - prepareModelRestore
  - importFile
invariants:
  - 缩略图异步加载，不阻塞 UI
tests: []
use_when:
  - 资源库操作
  - 资源操作
  - 资源管理
---

## 系统概览
**资源库操作模块**。封装资源库的各种操作（添加、删除、移动、重命名等），提供统一的操作接口。

## 核心职责
- `library-actions.ts` — 资源库操作封装、权限检查、操作执行。

## 对外 API（节选）
- `interface LibraryActions` — 操作接口。
- `executeLibraryAction(action, params)` — 执行资源库操作。

## 与其他子系统关系
- 资源库核心：`library-core.ts`。
- 文件服务：`@/core/fileservice`。

## 不变量
- 操作前检查权限，避免误操作。
- 操作可撤销（部分操作支持撤销）。
