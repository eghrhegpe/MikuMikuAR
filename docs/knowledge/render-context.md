---
kind: render_context
name: 菜单渲染上下文栈（RenderContext）
category: core
tier: leaf
scope:
  - frontend/src/core/render-context.ts
source_files:
  - frontend/src/core/render-context.ts
adr:
  - ADR-191
symbols:
  - RenderContext
  - getCurrentRenderingContext
  - pushRenderingContext
  - popRenderingContext
invariants:
  - 零依赖叶：不得引入 core 之外（尤其 menus/）的依赖，保持去桶化
  - 以最小 RenderContext 接口反转依赖：core 控件只认接口，menus/menu.ts 单向 push/pop SlideMenu 实例
  - pushRenderingContext 与 popRenderingContext 必须配对（renderCustom 前后，pop 在 finally）
  - registerControl(update, pathHint?) 由菜单 updateControls() 统一驱动刷新；pathHint 提供后仅该 key 本帧变更才调用
tests: []
use_when:
  - 菜单渲染上下文
  - 控件自更新注册
  - core↔menus 依赖反转
---

## 系统概览
菜单渲染上下文栈（零依赖叶子）。从 `menus/menu.ts` 抽出，断开 `core → menus` 反向边：core 层控件（`ui-rows` / `ui-collapsible` / `ui-header-toggle`）渲染期需注册自更新控件，过去经 `menu.ts` 的 `getCurrentRenderingMenu` 取得 `SlideMenu` 形成双向环；此处以最小 `RenderContext` 接口反转依赖——core 只认接口，`menus/menu.ts` 单向 push/pop `SlideMenu` 实例。

## 核心职责
- `RenderContext` 接口：`registerControl(update, pathHint?)`（由菜单 `updateControls()` 统一驱动刷新）
- `_renderingStack` 栈；`getCurrentRenderingContext()` 取栈顶；`pushRenderingContext` / `popRenderingContext` 配对进出

## 对外 API（节选）
- `getCurrentRenderingContext()`
- `pushRenderingContext(ctx)` / `popRenderingContext()`

## 关键约定
- 零依赖叶（禁引 `menus/`）；仅实现最小接口
- `push` / `pop` 必须配对（`pop` 置于 `finally`）
- `pathHint` 用于按 key 节流，仅本帧变更才调用 `update`

## 与其他子系统关系
- 被 core 控件（如 `ui-header-toggle`）经 `getCurrentRenderingContext()?.registerControl` 使用
- `menus/menu.ts` 实现 `RenderContext` 并在渲染期 `push` / `pop` 具体 `SlideMenu` 实例
