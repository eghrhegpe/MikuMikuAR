---
kind: watch_import
name: 文件监控导入
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/watch-import.ts
adr:
  - ADR-102
---

## 系统概览
处理文件监控（watch）发现新文件后的自动/手动导入逻辑。监听 `watch:newfile` 事件，在自动导入模式下直接入库，手动导入模式下显示 toast 通知供用户点击确认。

## 核心职责
- `watch-import.ts` — 文件监控导入、toast 通知交互。

## 对外 API（节选）
- `importToLibrary(path, displayName)` — 将监控发现的文件导入库（调用 `ImportLocalFile` 后端绑定），刷新库列表。

## 事件处理
- `Events.On('watch:newfile')` — 监听新文件事件，根据 `getAutoImportCached()` 判断自动/手动模式。
  - 自动模式：直接调用 `importToLibrary`。
  - 手动模式：显示 `#importToast`，用户点击「导入」按钮触发入库，10 秒自动隐藏。

## 与其他子系统关系
- 依赖 `wails-bindings` 的 `ImportLocalFile` 与 `Events`。
- 依赖 `menus/library` 的 `refreshLibrary` 刷新库列表。
- 依赖 [`safe-call`](./safe-call.md) 安全执行异步刷新。