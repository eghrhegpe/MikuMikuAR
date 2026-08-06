---
kind: ui_rows
name: 基础行控件构建器
tier: architecture
category: ui
scope:
  - frontend/src/core/ui-rows.ts
source_files:
  - frontend/src/core/ui-rows.ts
adr:
  - ADR-140
  - ADR-191
  - ADR-173
symbols:
  - addActionRow
  - addBoneSelectRow
  - addCardTitle
  - addDangerRow
  - addDisabledRow
  - addEmptyRow
  - addFieldRow
  - addInlineToggleRow
  - addInfoCard
  - addInfoGrid
  - addModeRow
  - addSliderRow
  - addToggleRow
  - addWatchDirRow
  - BoneSelectOptions
  - buildBoneGroups
  - initControl
  - isIkBone
  - sliderRow
  - toggleRow
invariants:
  - 声明式行控件创建函数，统一返回 DOM 元素，调用方负责插入与移除（生命周期）
  - 滑块行（addSliderRow）统一由 DragSliderController 驱动（拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 一致（ADR-140）
  - addBoneSelectRow / isIkBone / buildBoneGroups 为 ADR-173 引入，替代 addModeRow 在骨骼列表的误用
  - ui-header-toggle 已从本文件抽出为零依赖叶子（ADR-191），断开 ui-rows ⇄ ui-slide-row 文件级双向环
use_when:
  - 行控件
  - 滑块行
  - 开关行
  - 模式行
  - 骨骼选择行
  - 危险操作行
  - 信息卡
---

# 基础行控件构建器

## 系统概览
**基础行控件（UI row builder）**。`ui-rows.ts` 是菜单 UI 的声明式行控件基元库，提供 toggle / slider / mode / field / danger / info / bone-select 等行控件的创建函数，统一返回 DOM 元素。被所有 menus 模块广泛调用，是 [ui-helpers.md](./ui-helpers.md) 聚合层的核心组成。

## 核心职责
- `ui-rows.ts` — 基础行控件（toggle / slider / mode / danger / field / info / bone-select）。

## 对外 API（节选）
- `addToggleRow(label, bind, options)` — 创建开关行。
- `addSliderRow(label, bind, options)` — 数字滑块行，内部由 DragSliderController 驱动（ADR-140）。
- `addBoneSelectRow(container, label, boneNames, currentName, onChange, opts?)` — 骨骼下拉选择（分组 + 搜索 + IK 标记），ADR-173。
- `addModeRow<T>(label, options, current, onChange)` — 模式选择行。
- `initControl<T>(bind, update)` — 封装 registerControl + immediate update 模式。
- `isIkBone(name)` / `buildBoneGroups(names)` — ADR-173 骨骼分组辅助。

## 与其他子系统关系
- **聚合层**：[ui-helpers.md](./ui-helpers.md) 通过 barrel re-export 暴露本文件符号，调用方 import 路径不变。
- **断环**：`ui-header-toggle` 已抽离为零依赖叶子（ADR-191），断开 `ui-rows ⇄ ui-slide-row` 双向环。
- **渲染**：`render-menu.ts` 使用这些函数构建菜单 UI；数据通过 `bind` 绑定到 `envState` / `uiState`。

## UI 入口
本模块为 UI 构建基元，无独立菜单入口；由 menus 各层级经 `addXxxRow` 渲染行控件。

## 不变量
- 声明式行控件创建函数，统一返回 DOM 元素，调用方管理生命周期。
- 滑块行（addSliderRow）统一由 DragSliderController 驱动（ADR-140）。
- addBoneSelectRow / isIkBone / buildBoneGroups 为 ADR-173 引入，替代 addModeRow 在骨骼列表的误用。
- ui-header-toggle 已从本文件抽出为零依赖叶子（ADR-191）。

## 验证入口
- 行控件渲染经 e2e 快照断言（KIND_CONTROL_SELECTOR 读取选择器）
- 局部逻辑（isIkBone / buildBoneGroups）可单测覆盖
