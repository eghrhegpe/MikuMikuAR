---
kind: ui_helpers
name: UI 辅助函数聚合
category: ui
scope:
  - frontend/src/core/ui-helpers.ts
  - frontend/src/core/ui-rows.ts
  - frontend/src/core/ui-advanced-rows.ts
  - frontend/src/core/ui-slide-row.ts
  - frontend/src/core/ui-collapsible.ts
  - frontend/src/core/ui-types.ts
  - frontend/src/core/ui-fullscreen-overlay.ts
  - frontend/src/core/ui-resource-panel.ts
  - frontend/src/core/ui-virtual-grid.ts
source_files:
  - frontend/src/core/ui-helpers.ts
adr: []
symbols:
  - slideRow
  - initControl
  - addToggleRow
  - addSliderRow
  - addModeRow
  - addDangerRow
  - addCollapsible
  - addSectionTitle
  - addPresetChip
  - createResourcePanel
  - createVirtualGrid
  - openFullscreen
  - closeFullscreen
invariants:
  - Barrel re-export，调用方无需改 import
  - 控件创建函数返回 DOM 元素，需调用方管理生命周期
tests: []
use_when:
  - UI 辅助
  - 控件创建
  - 滑块行
  - 开关行
  - 折叠面板
  - 预设芯片
  - 全屏覆盖
  - 资源面板
  - 虚拟网格
---

## 系统概览
**UI 辅助函数聚合层**（barrel re-export）。提供声明式 UI 控件创建函数（slider、toggle、dropdown、
collapsible 等），统一返回 DOM 元素。`ui-helpers.ts` 为聚合入口，各组件在独立文件中实现。

## 核心职责
- `ui-helpers.ts` — barrel re-export 入口。
- `ui-rows.ts` — 基础行控件（toggle/slider/mode/danger/field/info）。
- `ui-advanced-rows.ts` — 高级行控件（color/vector3）。
- `ui-slide-row.ts` — 滑动行控件。
- `ui-collapsible.ts` — 折叠面板、章节标题、预设芯片。
- `ui-resource-panel.ts` — 资源面板组件。
- `ui-virtual-grid.ts` — 虚拟网格组件（大列表性能优化）。
- `ui-fullscreen-overlay.ts` — 全屏覆盖层。

## 对外 API（节选）
- `addSliderRow(label, bind, options)` — 创建滑块行。
- `addToggleRow(label, bind, options)` — 创建开关行。
- `addCollapsible(title, contentFactory)` — 创建折叠面板。
- `createResourcePanel(options)` — 创建资源面板。
- `createVirtualGrid(options)` — 创建虚拟网格。
- `openFullscreen(content)` / `closeFullscreen()` — 全屏覆盖。

## 与其他子系统关系
- 被所有 menus 模块调用。
- 渲染：`render-menu.ts` 使用这些函数构建 UI。
- 数据绑定：通过 `bind` 属性绑定到 `envState` / `uiState`。

## 不变量
- Barrel re-export：`ui-helpers.ts` 聚合所有子模块，调用方 import 路径不变。
- 控件生命周期：创建函数返回 DOM 元素，调用方负责插入和移除。
- 数据绑定：通过 `bind` 路径实现，不直接读写状态。
