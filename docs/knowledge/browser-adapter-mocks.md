---
kind: browser_adapter_mocks
name: 浏览器适配器测试共享 Mock 工厂
category: core
scope:
  - frontend/src/core/backend/browser-adapter-mocks.ts
source_files:
  - frontend/src/core/backend/browser-adapter-mocks.ts
adr:
  - ADR-206
symbols:
  - mem
  - setStore
  - eqBytes
  - resetMem
invariants:
  - 共享 vi.mock 工厂（ADR-206 Phase 4 拆自 browser-adapter.test.ts）
  - mem 为普通 const 导出（非 vi.hoisted），因 Vite 禁止导出 hoisted 变量跨文件
  - vi.mock('./idb') 因 hoist 约束在各测试文件内联，但共享同一 mem 实例
  - eqBytes 用于二进制字节数组相等断言
tests:
  - frontend/src/core/backend/browser-adapter.fsa-auth.test.ts
  - frontend/src/core/backend/browser-adapter.fsa-conflict.test.ts
  - frontend/src/core/backend/browser-adapter.ingest.test.ts
  - frontend/src/core/backend/browser-adapter.texture-collision.test.ts
use_when:
  - 浏览器适配器测试
  - browser-adapter 测试桩
  - IndexedDB 内存桩
  - 测试 mock
---

## 系统概览
**浏览器适配器测试共享 Mock 工厂**（ADR-206 Phase 4 从 `browser-adapter.test.ts` 拆分而来）。通过 `vi.mock('./idb')` 注入内存 store 绕过 IndexedDB，将 `browser-adapter` 单测与真实浏览器存储依赖隔离。`mem` 用普通 `const` 导出（因 Vite 不允许把 `vi.hoisted` 结果 `export` 跨文件），`vi.mock` 工厂留各测试文件内联。

## 核心职责
- `browser-adapter-mocks.ts` — 提供 `mem`（双层 Map 内存 store）、`setStore` / `resetMem` 控制、`eqBytes` 二进制相等断言。

## 对外 API（节选）
- `mem: Map<string, Map<string, unknown>>` — store→key→value 双层内存 Map。
- `setStore(store, entries)` — 以 `Record` 批量写入某 store。
- `eqBytes(a, b)` — 断言两个 `Uint8Array` 长度与逐字节相等（a 可为 null）。
- `resetMem()` — 清空 `mem`。

## 与其他子系统关系
- 支撑 `browser-adapter` 系列单测（`browser-adapter.fsa-auth/fsa-conflict/ingest/texture-collision.test.ts`）。
- 隔离对象：`core/backend/idb.ts`（IndexedDB），经各测试文件内联 `vi.mock('./idb')` 注入。
- 同层配对：`backend-mocks.ts`（[后端测试共享 Mock 工厂](./backend-mocks.md)）。

## 不变量
- 共享实例隔离：所有 browser-adapter 单测复用同一 `mem`，每个用例结束应 `resetMem()` 防状态泄漏。
- hoist 约束：`mem` 必须是普通 `const`（不能是 `vi.hoisted` 结果），否则 Vite 报 "Cannot export hoisted variable"；`vi.mock('./idb')` 工厂在各测试文件内联但读写同一 `mem` 实例。
