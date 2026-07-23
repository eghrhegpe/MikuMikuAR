---
kind: scene_migrate
name: 场景存档迁移（纯函数）
category: scene
scope:
  - frontend/src/scene/**
source_files:
  - frontend/src/scene/scene-migrate.ts
adr:
  - ADR-166
---

## 系统概览
旧存档 → 新状态迁移函数集合（纯函数，无 scene 依赖），从 `scene-serialize.ts` 拆分。负责把历史存档字段映射到当前 `PerceptionState` / `ProcMotion` 等状态结构。

## 核心职责
- `scene-migrate.ts` — 存档格式迁移（lipSync / perception / procMotion 等字段映射）

## 对外 API（节选）
- `migrateLipSyncFromOldState(old)` — 旧 lipSync → 新版 lipSync 字段
- `migratePerceptionData(perception)` — PerceptionState → `{ focused, pinned, tier, allEnabled }`
- `migratePerceptionFromProcMotion(...)` — ProcMotion 状态 → PerceptionState（[doc:adr-166]）

## 与其他子系统关系
- 由 `scene-serialize` 在反序列化旧存档时调用
