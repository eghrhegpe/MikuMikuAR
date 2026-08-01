---
tier: leaf
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
  - showPopupMenu
invariants:
  - 弹窗菜单通过注册表管理，registerPopupMenu 返回 handle（含 show 函数），不暴露 SlideMenu 实例
  - 支持两种入口：buildRoot 回调（惰性构造）和事先构造的 PopupLevel
  - overlayClass 自定义弹窗覆盖层 CSS 类，支持多种弹窗样式共存
  - showPopupMenu 为简化版单次入口（无需注册表），创建即显示
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
