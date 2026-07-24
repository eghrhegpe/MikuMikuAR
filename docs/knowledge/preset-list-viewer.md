---
kind: preset_list_viewer
name: 预设列表查看器
category: ui
scope:
  - frontend/src/menus/preset-list-viewer.ts
source_files:
  - frontend/src/menus/preset-list-viewer.ts
adr: []
symbols:
  - PresetListViewerConfig
  - presetListContent
  - buildPresetListLevel
invariants:
  - 被 env-preset-levels/model-preset/scene-render-levels/render-presets 引用（约 4 次）
tests: []
use_when:
  - 预设列表
  - 预设查看
  - 预设选择
  - 预设管理
---

## 系统概览
**预设列表查看器**。提供预设列表的 UI 构建（选择、删除、重命名等操作），
被 env-preset-levels/model-preset/scene-render-levels/render-presets 约 4 个模块引用。

## 核心职责
- `preset-list-viewer.ts` — 预设列表 UI 构建、操作。

## 对外 API（节选）
- `interface PresetListViewerConfig<T>` — 预设列表查看器配置。
- `presetListContent<T>(options)` — 生成预设列表内容（异步）。
- `buildPresetListLevel<T>(options)` — 构建预设列表层级。

## 与其他子系统关系
- 环境预设：`./env-preset-levels.ts`。
- 模型预设：`./model-preset.ts`。
- 场景渲染预设：`./scene-render-levels.ts` / `./scene-render-presets.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- 预设列表与数据层（`preset-manager.ts`）同步。
- 预设操作（删除/重命名）需确认提示。
