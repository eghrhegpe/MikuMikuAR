---
tier: architecture
kind: library_setup
name: 资源库初始化
category: ui
scope:
  - frontend/src/menus/library-setup.ts
source_files:
  - frontend/src/menus/library-setup.ts
adr: []
symbols:
  - initLibrary
  - selectResourceRoot
  - selectOverridePath
  - switchStorageMode
  - rescanAndSync
  - reloadConfig
  - refreshLibrary
invariants:
  - 初始化在应用启动时执行一次
  - 初始化失败时降级为最小可用状态
  - rescanAndSync 含防抖，避免频繁触发全量扫描
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
- `initLibrary()` — 初始化资源库（启动时调用）。
- `selectResourceRoot()` — 选择资源根路径。
- `selectOverridePath(category)` — 选择覆盖路径。
- `switchStorageMode(mode)` — 切换存储模式（private/shared）。
- `rescanAndSync()` — 重新扫描并同步资源库。

## 与其他子系统关系
- 资源库核心：`library-core.ts`。
- 配置：`@/core/config`。

## UI 入口

- 无独立入口函数（菜单基础设施卡）：菜单层级 / 入口一览见 [menu-map.md](./menu-map.md)（机器生成）。
- 运行时动态生成的菜单项（renderCustom / slideRow 等）由对应源码 UI 卡补充说明。
## 不变量
- 初始化在应用启动时执行一次。
- 初始化失败时降级为最小可用状态。
