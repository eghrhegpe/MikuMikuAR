---
kind: safe_call
name: 安全调用工具
category: core
scope:
  - frontend/src/core/**
source_files:
  - frontend/src/core/safe-call.ts
adr:
  - ADR-146
---

## 系统概览
统一「吞错并 logWarn」的散点模式（ADR-146 主题2），替代项目中大量 `try { fn() } catch (err) { logWarn(tag, msg, err) }` 与 `promise.catch(...)` 手写重复。与 `utils.ts` 的 `swallowError` 区别：保留调用方传入的 tag/msg 上下文，便于按模块聚合排查。

## 核心职责
- `safe-call.ts` — 同步/异步安全调用，异常时记录日志并返回 undefined。

## 对外 API（节选）
- `safeCall(tag, msg, fn)` — 安全执行同步函数，异常时 logWarn 并返回 undefined。
- `safeCallVoid(tag, msg, fn)` — 同 safeCall，但 fn 无返回值。
- `safeCallAsync(tag, msg, fn)` — 安全执行异步函数，异常时 logWarn，Promise 解析为 undefined（不 reject）。

## 与其他子系统关系
- 依赖 [`logger.ts`](./logger.md) 记录警告日志。
- 被各子系统（[`watch-import`](./watch-import.md)、[`events`](./events.md) 等）广泛引用。