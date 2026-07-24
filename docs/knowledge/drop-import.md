---
kind: drop_import
name: 拖拽导入逻辑层
category: core
scope:
  - frontend/src/core/drop-import.ts
source_files:
  - frontend/src/core/drop-import.ts
adr:
  - ADR-177
symbols:
  - handleDropFile
invariants:
  - 桌面：File.path 绝对路径 → Go ImportZip/loadManager
  - 浏览器：File 无 path → 读 arrayBuffer → IndexedDB → ExtractZip
tests: []
use_when:
  - 拖拽导入
  - 文件导入
  - 拖拽处理
  - 文件落地
  - 导入逻辑
---

## 系统概览
**拖拽导入纯逻辑层**（ADR-177）。将 dropped File / 路径落地为模型/动作加载请求。
不含 DOM 事件注册（仍在 `events.ts` 的 `initDropHandler`），只暴露纯异步函数，便于单测 mock
依赖后验证浏览器分支语义。路径语义对齐桌面（绝对路径）和浏览器（IndexedDB）分支。

## 核心职责
- `drop-import.ts` — 拖拽文件落地、分支路由、加载触发。

## 对外 API（节选）
- `handleDropFile(path, zipBytes?)` — 处理已落地的文件路径。
  - zip + zipBytes：浏览器分支，ExtractZip 读 IndexedDB 解压
  - zip 无 bytes：桌面分支，ImportZip 由 Go 落盘
  - pmx：`loadManager.load({ kind: 'actor', path })`
  - vmd：`loadManager.load({ kind: 'vmd', path })`

## 与其他子系统关系
- 加载管理：`./load-manager`。
- Wails 绑定：`ImportZip` / `ExtractZip`（`./wails-bindings`）。
- IndexedDB：`idbSet` / `saveModel`（`./backend/idb`）。
- 资源库刷新：`../menus/library.refreshLibrary`。
- 状态提示：`setStatus` / `formatError`（`./config`）。
- 安全调用：`safeCallAsync`（`./safe-call`）。

## 不变量
- 纯逻辑层：不含 DOM 事件注册，便于单测。
- 分支路由：桌面用绝对路径，浏览器用 IndexedDB 键。
- 依赖精简：仅依赖 8 个数据/状态模块，单测成本可控。
