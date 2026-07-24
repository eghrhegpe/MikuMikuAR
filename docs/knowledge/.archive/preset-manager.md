---
kind: preset_manager
name: 统一预设系统接口
category: env
scope:
  - frontend/src/scene/env/preset-manager.ts
source_files:
  - frontend/src/scene/env/preset-manager.ts
adr:
  - ADR-130
---

## 系统概览
统一预设系统接口（ADR-130 Phase 2.7）：收敛各子系统零散的预设 CRUD 模式，提供统一的 List/Save/Load/Delete/Import/Export 接口。各子系统（env/lighting/ground/water/model/motion）各自实现 `PresetManager`，调用方通过同一接口操作，无需关心存储细节。

## 核心职责
- `PresetMeta`（`name`/`label`/`category`/`createdAt`/`tags`）+ `PresetEntry<T>`（统一格式，各子系统共用）
- `PresetManager<T>` 接口：List/Save/Load/Delete/Import/Export
- env 预设基于 `CategorizedEnvPreset`（`env-lighting`），提供 `snapshotEnvPresetByCategory` / `exportCategorizedEnvPreset` / `importCategorizedEnvPreset` / `ENV_PRESET_FIELDS`
- 实例：`envPresetManager` / `lightingPresetManager` 等

## 对外 API（节选）
- `envPresetManager.list()` / `.save(name, snapshot)` / `.load(name)` / `.delete(name)` / `.export(name)` / `.import(json)`

## 关键约定
- 各子系统实现同一接口，UI 层统一操作，存储细节内聚
- 预设按 category 分域（env/lighting/ground/...）

## 与其他子系统关系
- 依赖 `env-lighting.ts`（`CategorizedEnvPreset` / 快照 / 导入导出）
- 服务于各 UI 预设面板（env-menu / lighting-menu 等）
- 持久化经 backend 代理（`wails-bindings`）
