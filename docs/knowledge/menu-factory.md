---
kind: menu_factory
name: 菜单工厂
category: ui
scope:
  - frontend/src/menus/menu-factory.ts
source_files:
  - frontend/src/menus/menu-factory.ts
adr: []
symbols:
  - PopupMenuHandlers
  - RegisteredPopupMenuConfig
  - PopupMenuHandle
  - registerPopupMenu
  - PopupMenuConfig
invariants:
  - 弹窗菜单通过注册表管理
tests: []
use_when:
  - 菜单工厂
  - 菜单创建
  - 菜单实例化
---

## 系统概览
**菜单工厂**。创建和管理菜单实例，提供统一的菜单创建接口。

## 核心职责
- `menu-factory.ts` — 菜单实例创建、配置、初始化。

## 对外 API（节选）
- `interface PopupMenuHandlers` — 弹窗菜单处理器接口。
- `interface RegisteredPopupMenuConfig` — 注册的弹窗菜单配置。
- `interface PopupMenuHandle` — 弹窗菜单句柄。
- `registerPopupMenu(config)` — 注册弹窗菜单，返回句柄。
- `MenuFactory` — 菜单工厂类。

## 与其他子系统关系
- 被 `menu.ts` 调用。
- 菜单引擎：`menu.ts`。

## 不变量
- 工厂模式：创建菜单实例，不暴露内部实现。
