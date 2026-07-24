---
kind: model_preset_ui
name: 模型预设管理 UI
category: ui
scope:
  - frontend/src/menus/model-preset.ts
source_files:
  - frontend/src/menus/model-preset.ts
adr:
  - ADR-145
symbols:
  - ModelPresetEntry
  - ModelPresetFile
  - serializeModelPreset
  - applyModelPreset
  - selectAndSavePreset
  - selectAndLoadPreset
  - buildPresetListLevel
invariants:
  - Schema 驱动 UI
  - 动作预设管理
tests: []
use_when:
  - 模型预设
  - 动作预设
  - 预设管理
  - 预设面板
---

## 系统概览
**模型预设管理 UI**（ADR-145）。提供动作预设的创建、保存、加载、删除等 UI，
是 `ui-preset.ts` 面板复合组件的模型预设入口。

## 核心职责
- `model-preset.ts` — 模型预设菜单 schema 定义、预设操作。

## 对外 API（节选）
- `serializeModelPreset(id, presetName?)` — 序列化模型预设为 JSON 字符串。
- `applyModelPreset(id, jsonStr)` — 从 JSON 字符串应用预设。
- `selectAndSavePreset(id)` / `selectAndLoadPreset(id)` — 保存/加载预设。
- `buildPresetListLevel(id)` — 构建预设列表菜单层级。

## 与其他子系统关系
- 预设面板：`../../core/ui-preset.ts`。
- 动作预设：`../../scene/motion/motion-intent.ts`。
- 渲染：`render-menu.ts`。

## 不变量
- Schema 驱动 UI。
- 预设操作与 `preset-manager.ts` 数据层协作。
