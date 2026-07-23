---
kind: observer_handle
name: Observer 生命周期管理
category: core
scope:
  - frontend/src/core/observer-handle.ts
source_files:
  - frontend/src/core/observer-handle.ts
---

## 系统概览
统一封装 Babylon.js `Observable.add/remove`，确保每次订阅都返回可 dispose 的句柄、支持批量清理、且 dispose 幂等。消除「手动在 metadata 中存储 observer 引用」的脆弱写法，是 AGENTS.md「资源配对」审核维度的标准基础设施。

## 核心职责
- `ObserverHandle<T>` — 包裹单个 Observable+Observer，`.dispose()` 移除并释放引用，幂等（`isDisposed` 可读）
- `observe(observable, cb)` — 等价于 `add()` 但返回 `ObserverHandle`（add 返回 null 时抛错）
- `observeOnce(observable, cb)` — 一次性订阅，回调执行后自动移除
- `ObserverRegistry` — 收集多个句柄，`disposeAll()` 一次性清理，幂等；支持 `add` / `register` / `remove` / `size` / `clear`

## 对外 API（节选）
- `observe<T>(observable, cb): ObserverHandle<T>`
- `observeOnce<T>(observable, cb): ObserverHandle<T>`
- `new ObserverRegistry()` + `.add()` / `.register()` / `.remove(h)` / `.disposeAll()` / `.size`

## 使用约定
- 模块有多个 observer 时统一用 `ObserverRegistry`，dispose 时 `disposeAll()`
- 句柄 `dispose()` 可安全重复调用（幂等，防空引用）

## 与其他子系统关系
- `render-loop.ts` 用 `observe` 订阅 `onBeforeRenderObservable` / `onAfterRenderObservable`，模块级句柄支持 HMR 幂等销毁
- 各场景/渲染子系统统一经此处管理 observer，保证 dispose 链路完整
