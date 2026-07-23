---
kind: load_manager
name: 统一资源加载队列
category: core
scope:
  - frontend/src/core/load-manager.ts
source_files:
  - frontend/src/core/load-manager.ts
adr:
  - ADR-045
  - ADR-135
symbols:
  - loadManager
  - LoadRequest
  - ResourceHandle
  - LibraryLoadError
  - LoadPhase
invariants:
  - 所有资源请求经单一 Promise 队列串行执行
  - 每个请求拥有 loadId，失败时保留 phase 与原始 cause
  - finally 必须清空当前请求、loadId 和 phase
use_when:
  - 模型加载、动作加载、道具加载、音频加载、加载排队、加载进度、loadId
---

## 系统概览
跨资源类型的统一加载入口，串行化 actor、stage、prop、VMD、音频和相机 VMD 请求，避免不同底层 loader 同时工作造成竞态。通过动态 import 降低与 scene 模块的循环依赖。

## 对外 API（节选）
- `loadManager.load(req, signal?)` — 入队并返回 `ResourceHandle | null`。
- `loadManager.current` — 兼容旧调用的当前请求快照。
- `loadManager.getCurrentLoad()` — 返回 `loadId`、`phase` 和请求详情。
- `LoadRequest` — 描述资源类型、路径、模型关联和 zip 缓存上下文。
- `LibraryLoadError` — 带 `loadId/phase/cause` 的结构化加载错误。

## 不变量
- 请求按入队顺序执行，后续请求不能绕过当前请求。
- `AbortSignal` 必须透传到底层 loader。
- 错误包装不能丢失原始异常和请求上下文。

## 验证入口
- 测试：当前缺少专属单元测试，后续应优先覆盖串行队列、取消和错误包装。

