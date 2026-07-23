---
kind: preset_manager
name: 统一预设管理器
category: core
scope:
  - frontend/src/scene/env/**
source_files:
  - frontend/src/scene/env/preset-manager.ts
adr:
  - ADR-130
---

## 系统概览
统一预设系统接口（ADR-130 Phase 2.7），收敛各子系统零散的预设 CRUD 模式。提供 `PresetManager<T>` 泛型接口（list/save/load/delete/export/import 六元组），各子系统（env / lighting / ground / water / model / motion）各自实现，调用方通过同一接口操作。

当前已实现环境预设管理器 `EnvPresetManagerImpl`，对接现有 `CategorizedEnvPreset` 体系（sky/ground/water/atmosphere 四类）。

## 核心职责
- `preset-manager.ts` — 预设管理器接口定义、环境预设管理器实现。

## 对外 API（节选）
- `PresetMeta` — 预设元数据接口（name / label / category / createdAt / tags?）。
- `PresetEntry<T>` — 预设条目接口（meta + data）。
- `PresetManager<T>` — 统一预设管理器接口。
  - `list()` — 列出所有预设。
  - `save(name, label, data)` — 保存预设。
  - `load(name)` — 加载预设。
  - `delete(name)` — 删除预设。
  - `export(name)` — 导出为 JSON 字符串。
  - `import(json)` — 从 JSON 导入。
- `envPresetManager` — 环境预设管理器单例。
  - `snapshotFromCurrent(category, label)` — 从当前 envState 按分类创建快照并保存。

## 与其他子系统关系
- 依赖 `env-lighting` 的 `CategorizedEnvPreset` / `exportCategorizedEnvPreset` / `importCategorizedEnvPreset`。
- 被 env 菜单 UI 引用以管理环境预设的保存/加载/导入/导出。