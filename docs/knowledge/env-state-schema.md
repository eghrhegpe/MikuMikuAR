---
kind: env_state_schema
name: EnvState 单一源 Schema
category: core
scope:
  - frontend/src/core/env-state-schema.ts
source_files:
  - frontend/src/core/env-state-schema.ts
adr:
  - ADR-137
  - ADR-132
---

## 系统概览
EnvState 全部字段的**类型 + 默认值 + dispatch 分组**单一来源。新增字段只需在此追加一处（type + default + group），`types.ts` / `state.ts` 自动派生，各子系统通过 `getEnvKeys(group)` 自动获取 key 列表，无需再手工维护 `_SKY_KEYS` / `_GROUND_KEYS` / `_WATER_KEYS` 等数组。

## 核心职责
- 每字段定义为 `_FieldDef`，按 `sky / ground / wind / particle / water / water-shader / underwater / clouds / mirror / fog / collision / lighting` 分组
- `group` 决定字段变化时触发哪些子系统回调；未指定则不触发
- `enum` 类型附带 `values` 白名单（如 `skyMode: color|texture|procedural`、`groundType: flat|terrain`）
- `tuple3` 类型用于颜色/向量（写入需整体替换，经 Proxy 约定）

## 对外 API（节选）
- `ENV_STATE_SCHEMA` — 字段名 → `{ type, default, group?, values? }` 的完整映射
- `getEnvKeys(group)` — 取某 dispatch 分组下的全部字段 key（供 env-bridge 派发变更）
- `buildDefaultEnvState()`（在 state.ts 引用 schema.default 构造初始 state）

## 关键约定
- `envBrightness`（ADR-132）作为天空/IBL/云/主光/环境光的全局明暗统一标量
- 数组/tuple3 写入必须整体替换，不依赖内部索引赋值触发刷新（见 `reactivity.ts` Proxy 约定）

## 与其他子系统关系
- `state.ts` 的 `buildDefaultEnvState()` 从本 schema.default 构造初始 EnvState
- `scene/env/` 各子系统按 group 订阅变更，实现「单一源 → 多子系统自动分发」
