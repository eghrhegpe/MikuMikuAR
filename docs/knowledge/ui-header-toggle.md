---
kind: ui_header_toggle
name: 标题栏小型开关（createHeaderToggle）
category: core
tier: leaf
scope:
  - frontend/src/core/ui-header-toggle.ts
source_files:
  - frontend/src/core/ui-header-toggle.ts
adr:
  - ADR-191
symbols:
  - HeaderToggleConfig
  - createHeaderToggle
invariants:
  - 零依赖叶（除 render-context）：从 ui-rows 抽出，断开 ui-rows ⇄ ui-slide-row 文件级双向环（ADR-191）
  - 双触发去重：跳过 target===input 的 synthetic click + preventDefault，防止 label 包裹 checkbox 的浏览器二次派发
  - bind 自更新：菜单重渲染时经 getCurrentRenderingContext().registerControl 同步 input.checked
  - disabled 态：input.disabled + toggle-disabled class，不响应 onChange；可挂 onDisabledClick
tests: []
use_when:
  - 标题栏开关
  - toggle.header-toggle
  - 折叠面板 / 材质行开关
---

# 标题栏小型开关（createHeaderToggle）

## 系统概览
标题栏小型开关（`toggle.header-toggle`）。从 `ui-rows` 抽出的零依赖叶子（ADR-191），断开 `ui-rows ⇄ ui-slide-row` 文件级双向环。复用点：`menu.ts` 弹窗标题 / `ui-collapsible` 折叠面板 / `ui-slide-row` 行 / `model-material` 材质行。统一双触发去重 + bind 自更新 + disabled。

## 核心职责
- `HeaderToggleConfig`：`{ value, onChange, bind?, disabled?, onDisabledClick?, disabledHint? }`
- `createHeaderToggle(config)` → `<label class="toggle header-toggle">`（含 `input[type=checkbox]` + `span.slider`）
- 双触发去重（跳过 synthetic click + `preventDefault`）
- `bind` 自更新（经 `render-context` 注册到渲染上下文）

## 对外 API（节选）
- `createHeaderToggle(config)` → `HTMLLabelElement`
- `HeaderToggleConfig` 接口

## 关键约定
- 双触发去重防止 `<label>` 包裹 checkbox 的浏览器二次派发造成的视觉错位
- `disabled` 不响应 `onChange`，可挂 `onDisabledClick`
- `bind` 经渲染上下文在菜单重渲染时自更新 `input.checked`

## 与其他子系统关系
- 依赖 `core/render-context`（`getCurrentRenderingContext`）
- 被 `menu.ts` / `ui-collapsible` / `ui-slide-row` / `model-material` 复用
