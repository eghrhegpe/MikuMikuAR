---
kind: runtime_stub
name: @wailsio/runtime 浏览器桩
category: core
scope:
  - frontend/src/core/runtime-stub.ts
source_files:
  - frontend/src/core/runtime-stub.ts
symbols:
  - Call
  - CancellablePromise
  - Events
  - Browser
invariants:
  - 仅影响浏览器构建，主应用 vite.config.ts 不受扰动
  - 桩可为全 no-op，Web 入口只用 browserAdapter
tests: []
use_when:
  - Web 构建
  - 浏览器桩
  - Wails 运行时替换
  - vite.web.config
---

## 系统概览
@wailsio/runtime 浏览器桩 — ADR-176/177 Web 构建。Web 构建（vite.web.config.ts / vite.spike.config.ts）时替换 @wailsio/runtime，避免 @bindings/app.ts 的 value import `import { Call } from "@wailsio/runtime"` 把整个 Wails 运行时打进浏览器 bundle。

## 核心职责
- `runtime-stub.ts` — 提供 @wailsio/runtime 的 no-op 实现，供浏览器构建使用。

## 对外 API（节选）
- `Call()` — 异步调用桩，返回 `Promise<null>`。
- `CancellablePromise` — 可取消 Promise 桩，`cancel()` 为 no-op。
- `Events` — 事件系统桩，所有方法为 no-op。
- `Browser` — 浏览器操作桩，`openURL()` 为 no-op。

## 与其他子系统关系
- 通过 vite.config.ts 的 resolve.alias 注入，替换 @wailsio/runtime。
- Web 入口只用 browserAdapter，不依赖 @wailsio/runtime 任何功能。
- go-adapter（唯一真实消费 @wailsio/runtime 的模块）在 web 入口下被 `__MMKU_WEB__` 短路。

## 不变量
- 仅影响浏览器构建，主应用 vite.config.ts 不受扰动。
- 桩可为全 no-op，Web 入口只用 browserAdapter。
- go-adapter 在 web 入口下被 `__MMKU_WEB__` 短路，永不加载。

## 验证入口
- 测试：当前主要由构建配置验证。
