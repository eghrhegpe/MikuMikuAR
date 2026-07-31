---
kind: backend_mocks
name: 后端测试共享 Mock 工厂
category: core
scope:
  - frontend/src/core/backend/backend-mocks.ts
source_files:
  - frontend/src/core/backend/backend-mocks.ts
adr:
  - ADR-206
symbols:
  - idbStore
  - setWindow
  - clearWebFlag
  - resetIdb
  - goAdapterMock
invariants:
  - 共享 vi.mock 工厂（ADR-206 Phase 4 拆自 backend.test.ts）
  - idbStore 为内存 Map 桩，隔离 IndexedDB 在 Node/happy-dom 下无实现的依赖
  - goAdapterMock 隔离 @bindings 运行时（Wails），使测试为纯桩
  - setWindow/clearWebFlag 控制测试环境 window 与 __MMKU_WEB__/__MMKU_BACKEND__ 全局标志
tests:
  - frontend/src/core/backend/backend.capabilities.test.ts
  - frontend/src/core/backend/backend.data-chain.test.ts
  - frontend/src/core/backend/backend.virtual-dir.test.ts
  - frontend/src/core/backend/backend.extract.test.ts
  - frontend/src/core/backend/backend.resolve.test.ts
  - frontend/src/core/backend/backend.fsa.test.ts
  - frontend/src/core/backend/backend.update.test.ts
use_when:
  - 后端测试
  - go-adapter 测试桩
  - IndexedDB 内存桩
  - backend mock
---

## 系统概览
**后端测试共享 Mock 工厂**（ADR-206 Phase 4 从 `backend.test.ts` 拆分而来）。`go-adapter` 依赖 `@bindings` 运行时（Wails），`idb` 在 Node/happy-dom 下无 IndexedDB 实现，故本文件提供内存 `Map` 桩与能力桩，将后端单测与真实浏览器/桌面存储依赖隔离。

## 核心职责
- `backend-mocks.ts` — 提供 `idbStore`（内存 Map）、`setWindow` / `clearWebFlag` / `resetIdb` 环境控制、`goAdapterMock`（Go 后端能力桩）。

## 对外 API（节选）
- `idbStore: Map<string, unknown>` — IndexedDB 内存替代，跨用例共享需 `resetIdb()`。
- `setWindow(w)` — 注入全局 `window`（模拟浏览器环境）。
- `clearWebFlag()` — 清除 `__MMKU_WEB__` / `__MMKU_BACKEND__`，复位平台标志。
- `resetIdb()` — 清空 `idbStore`。
- `goAdapterMock` — `{ goAdapter: { kind: 'go', capabilities() } }` 能力桩，供 `vi.mock` 替代 `go-adapter`。

## 与其他子系统关系
- 支撑 `core/backend` 系列单测（`backend.capabilities/data-chain/virtual-dir/extract/resolve/fsa/update.test.ts`）。
- 隔离对象：`core/backend/go-adapter.ts`（Wails 运行时）、`core/backend/idb.ts`（IndexedDB）。
- 同层配对：`browser-adapter-mocks.ts`（[浏览器适配器测试共享 Mock 工厂](./browser-adapter-mocks.md)）。

## 不变量
- 共享实例隔离：所有 backend 单测复用同一 `idbStore`，每个用例结束应 `resetIdb()` 防状态泄漏。
- 纯桩契约：`goAdapterMock.capabilities()` 返回固定能力集，不代表真实 Go 后端运行时行为。
