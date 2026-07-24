---
kind: library_setup
name: 资源库初始化
category: ui
scope:
  - frontend/src/menus/library-setup.ts
source_files:
  - frontend/src/menus/library-setup.ts
adr: []
symbols:
  - setupLibrary
invariants:
  - 初始化在应用启动时执行
tests: []
use_when:
  - 资源库初始化
  - 资源库设置
  - 资源库启动
---

## 系统概览
**资源库初始化模块**。在应用启动时初始化资源库，配置扫描路径、建立索引。

## 核心职责
- `library-setup.ts` — 资源库初始化、路径配置、索引建立。

## 对外 API（节选）
- `setupLibrary(options)` — 初始化资源库。

## 与其他子系统关系
- 资源库核心：`library-core.ts`。
- 配置：`@/core/config`。

## 不变量
- 初始化在应用启动时执行一次。
- 初始化失败时降级为最小可用状态。
