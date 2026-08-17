---
tier: architecture
kind: core_backend
name: 后端适配层
category: core
scope:
  - frontend/src/core/backend/*.ts
source_files:
  - frontend/src/core/backend/index.ts
  - frontend/src/core/backend/types.ts
  - frontend/src/core/backend/browser-adapter.ts
  - frontend/src/core/backend/go-adapter.ts
  - frontend/src/core/backend/idb.ts
  - frontend/src/core/backend/backend-mocks.ts
  - frontend/src/core/backend/browser-adapter-mocks.ts
adr:
  - ADR-176
  - ADR-206
symbols:
  - BackendCapabilities
  - BackendService
  - FsaAuthState
  - GoApp
  - NotSupportedError
  - STORES
  - Store
  - WebModelEntry
  - browserAdapter
  - clearWebFlag
  - closeIDB
  - dismissFsaAuthPrompt
  - eqBytes
  - getCachedCapabilities
  - getCapabilities
  - getFsaAuthState
  - getFsaDownloadAuthState
  - getFsaDownloadHandle
  - goAdapter
  - goAdapterMock
  - idbBatchSet
  - idbDelete
  - idbGet
  - idbKeys
  - idbSet
  - idbStore
  - ingestModelBytes
  - ingestModelFile
  - ingestModelFiles
  - isFsaAuthPromptDismissed
  - makeIdbMock
  - mem
  - openDB
  - reauthorizeFsaDownload
  - reauthorizeFsaRoot
  - resetFsaAuthPromptDismissed
  - resetIdb
  - resetMem
  - resolveBackend
  - saveModel
  - selectFsaDownloadDir
  - setScanProgressCallback
  - setStore
  - setWindow
invariants:
  - 浏览器和桌面后端通过适配器接口统一
  - IndexedDB 操作异步非阻塞
  - 测试桩共享实例跨用例复用，用例结束须 resetIdb()/resetMem() 防状态泄漏
  - mem 必须普通 const 导出（vi.hoisted 结果不能跨文件 export），vi.mock 各测试内联但共享同一 mem
tests:
  - frontend/src/core/backend/backend.capabilities.test.ts
  - frontend/src/core/backend/backend.data-chain.test.ts
  - frontend/src/core/backend/backend.virtual-dir.test.ts
  - frontend/src/core/backend/backend.extract.test.ts
  - frontend/src/core/backend/backend.resolve.test.ts
  - frontend/src/core/backend/backend.fsa.test.ts
  - frontend/src/core/backend/backend.update.test.ts
  - frontend/src/core/backend/browser-adapter.fsa-auth.test.ts
  - frontend/src/core/backend/browser-adapter.fsa-conflict.test.ts
  - frontend/src/core/backend/browser-adapter.ingest.test.ts
  - frontend/src/core/backend/browser-adapter.texture-collision.test.ts
use_when:
  - 后端适配
  - 浏览器后端
  - Go 后端
  - IndexedDB
  - 存储适配
  - 后端测试
  - 测试桩
  - mock
---

# 后端适配层

## 系统概览
**后端适配层**。提供统一的后端接口，支持浏览器（IndexedDB）和桌面（Go）两种后端。
`idb.ts` 封装 IndexedDB 操作，`browser-adapter.ts` 和 `go-adapter.ts` 分别为两种后端实现。

## 核心职责
- `backend/index.ts` — 后端适配层入口。
- `backend/types.ts` — 后端接口定义。
- `backend/browser-adapter.ts` — 浏览器后端实现（IndexedDB）。
- `backend/go-adapter.ts` — 桌面后端实现（Go/Wails）。
- `backend/idb.ts` — IndexedDB 操作封装。
- `backend/backend-mocks.ts` — 后端测试共享 Mock 工厂（ADR-206 Phase 4 拆自 backend.test.ts）。
- `backend/browser-adapter-mocks.ts` — 浏览器适配器测试共享 Mock 工厂（ADR-206 Phase 4 拆自 browser-adapter.test.ts）。

## 测试基础设施（ADR-206 Phase 4 / ADR-262 治理）
`go-adapter` 依赖 `@bindings` 运行时（Wails），`idb` 在 Node/happy-dom 下无 IndexedDB 实现，故两个 mock 工厂提供内存桩将单测与真实浏览器/桌面存储隔离：
- `backend-mocks.ts` — `idbStore`（内存 Map）/ `setWindow` / `clearWebFlag` / `resetIdb` 环境控制 + `goAdapterMock`（Go 后端能力桩）。
- `browser-adapter-mocks.ts` — `mem`（双层 Map store）/ `setStore` / `resetMem` 控制 + `eqBytes` 二进制相等断言。
- 坑：`mem` 必须普通 `const` 导出（Vite 禁止把 `vi.hoisted` 结果跨文件 export）；`vi.mock('./idb')` 因 hoist 约束在各测试文件内联，但共享同一 `mem` 实例；跨用例复用共享桩须 `resetIdb()` / `resetMem()` 防状态泄漏。

### idb 全局 mock（ADR-219 / ADR-262 治理）
`setup-wails.ts:104-118` 在**全局 setup** 层一次性 `vi.mock('@/core/backend/idb')`，
复用 `backend-mocks.ts` 的单源工厂 `makeIdbMock()`。isolate=false 下模块图全 worker
共享，per-file `vi.mock` 会触发"先到先得绑定锁定"污染（第一个加载者锁定 mock 绑定，
后续文件静默失效）；全局 setup mock 确保全 worker 唯一 mock 入口，从源头消除顺序敏感。
`backend.*.test.ts` 系列已移除冗余 per-file `vi.mock('./idb')`（ADR-262），依赖全局
setup mock；`browser-adapter.*.test.ts` 系列保留差异化 inline mock（使用 `mem` 双层
store，语义与 `makeIdbMock` 的单层 `idbStore` 不同，属合法例外）。
`config-store.test.ts` 使用 `vi.resetModules()` + 动态 import 做 per-test 隔离，
也是合法例外（见 ADR-262 §三）。

**护栏 CLI**：`npm run check:test-pollution`（`scripts/check-test-pollution.mjs`）
静态扫描检测冗余/形状漂移的 per-file `vi.mock`，warn 不阻断。

## 对外 API（节选）
- `BackendAdapter` — 后端适配器接口。
- `BrowserAdapter` — 浏览器后端实现。
- `GoAdapter` — Go 后端实现。
- `idbSet(store, key, value)` — 写入 IndexedDB。
- `idbGet(store, key)` — 读取 IndexedDB。
- `idbDelete(store, key)` — 删除 IndexedDB 记录。

## 与其他子系统关系
- IndexedDB：`@/core/backend/idb`。
- Wails 绑定：`@/core/wails-bindings`。
- 文件导入：`@/core/drop-import`。

## 不变量
- 适配器接口统一：浏览器和桌面后端通过相同接口调用。
- IndexedDB 操作异步：所有操作返回 Promise，不阻塞 UI。
- 数据隔离：浏览器和桌面后端数据独立存储。
