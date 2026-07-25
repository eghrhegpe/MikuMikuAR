---
kind: load_refresh_registry
name: 模型加载/库扫描完成后菜单刷新注册表
category: core
scope:
  - frontend/src/core/load-refresh-registry.ts
source_files:
  - frontend/src/core/load-refresh-registry.ts
symbols:
  - registerLoadRefreshHook
  - runLoadRefreshHooks
  - registerLibraryScannedHook
invariants:
  - 钩子仅在对应菜单已初始化且存活时执行刷新操作
  - 每个钩子带 try/catch，单个失败不影响其余
tests: []
use_when:
  - 加载后刷新
  - 库扫描完成
  - 菜单刷新
  - 注册表
---

## 系统概览
Load-Refresh Registry — 模型加载/库扫描完成后菜单刷新注册表。替代 load-manager.ts 中硬编码的动态 import 列表和各菜单文件独立注册的 mmar:library-scanned 监听器。

## 核心职责
- `load-refresh-registry.ts` — 管理加载后刷新钩子和库扫描完成钩子。

## 对外 API（节选）
- `registerLoadRefreshHook(hook)` — 注册一个「模型加载后刷新」钩子，返回取消注册函数。
- `runLoadRefreshHooks()` — 执行所有已注册的加载后刷新钩子，由 load-manager 在每次 load() 完成后调用。
- `registerLibraryScannedHook(hook)` — 注册一个「库扫描完成」钩子，返回取消注册函数。

## 与其他子系统关系
- 依赖 `./dom`（`addDisposableListener`）。
- 被 `load-manager.ts` 调用（`runLoadRefreshHooks`）。
- 被各菜单文件调用（注册刷新钩子）。

## 不变量
- 钩子仅在对应菜单已初始化且存活时执行刷新操作。
- 每个钩子带 try/catch，单个失败不影响其余。
- 库扫描完成钩子只注册一次全局监听器（`mmar:library-scanned`）。

## 验证入口
- 测试：当前主要由 UI 调用链间接覆盖。
