---
kind: runtime_bridge
name: Runtime 隔离桥（Wails Events/Browser）
category: core
scope:
  - frontend/src/core/runtime-bridge.ts
source_files:
  - frontend/src/core/runtime-bridge.ts
adr:
  - ADR-177
---

## 系统概览
`@wailsio/runtime` 的隔离层（ADR-177，绞杀者模式）。运行时动态选型：Web 走 no-op 实现，Wails 走真实的 `@wailsio/runtime`（动态 import，避免静态依赖）。生产代码中 `@wailsio/runtime` 的 value import **只允许出现在本文件**，业务侧一律经 `getRuntimeBridge()` 访问。

## 核心职责
- `RuntimeEvents` — `on` / `once` / `off` / `offAll` / `emit`，对齐 Wails 真实 API（`on` 返回 unsubscribe、`off` 可变参数、`emit` 返回 `Promise<boolean>`）
- `RuntimeBrowser` — `openURL(url)`，Web 侧 `window.open` + `noopener`，被拦截时抛可诊断错误
- `RuntimeBridge` — 聚合 `events` + `browser` + 应用级 `disposeAll()`

## 对外 API（节选）
- `getRuntimeBridge()` — 单例选型（web → WebRuntimeBridge / else → WailsRuntimeBridge）
- `initRuntimeBridge()` — bootstrap 桥接注入后调用，加载真实 `@wailsio/runtime`（Web 侧短路）
- `events.on(name, cb): Unsubscribe` — **主契约**：业务侧必须保存返回值并在 dispose 时调用
- `events.off(...names)` — 按事件名移除会清掉所有模块监听，谨慎使用
- `disposeAll()` — 仅供应用级 shutdown，遍历释放所有 unsubscribe

## 使用规范（ADR-177 第三轮审核）
- 业务侧优先保存 `on()` 返回的 `unsubscribe` 并在 dispose 调用——这是主契约
- `off(...names)` 仅兼容能力，按事件名移除会清掉所有模块监听，需谨慎
- `disposeAll()` 不允许业务模块随意全局清理

## 与其他子系统关系
- `wails-bindings.ts` 经本桥的 `events` 透传（命名导出 `Events`）
- 各业务模块的事件订阅统一经此处，实现平台无关与 HMR 资源释放
