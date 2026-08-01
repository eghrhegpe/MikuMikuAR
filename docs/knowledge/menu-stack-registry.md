---
tier: architecture
kind: menu_stack_registry
name: 菜单栈共享指针（stackRegistry）
category: ui
scope:
  - frontend/src/menus/menu-stack-registry.ts
source_files:
  - frontend/src/menus/menu-stack-registry.ts
adr:
  - ADR-191
symbols:
  - stackRegistry
invariants:
  - 共享可变单例：modelStack / sceneStackGetter / buildLevel 由 menus 子系统在运行时填充
  - 仅持有 SlideMenu 引用与工厂，不持有 DOM / 状态
  - 从 @/core/utils 抽出（ADR-191 去桶化），置于 menus/ 因持有 SlideMenu 引用
tests: []
use_when:
  - 菜单栈
  - modelStack
  - buildLevel
  - 跨菜单导航
---

## 系统概览
共享菜单栈指针。从 `@/core/utils` 抽出（ADR-191），置于 `menus/` 因其持有 `SlideMenu` 引用。

## 核心职责
- `stackRegistry: { modelStack: SlideMenu | null; sceneStackGetter: (() => SlideMenu | null) | null; buildLevel: (...) => PopupLevel | null }`
- 由 menus 子系统在运行时填充（菜单栈导航 / 模型浏览）

## 对外 API（节选）
- `stackRegistry`（导出 const 单例）

## 关键约定
- 共享可变单例，运行时填充；本模块不负责重置
- 仅持有引用与工厂，避免与 DOM / 状态耦合

## 与其他子系统关系
- 引用 `menus/menu` 的 `SlideMenu` 类型
- 被菜单栈导航 / 模型浏览逻辑消费
