---
tier: architecture
adr:
  - ADR-243
kind: env_state_defaults
name: EnvState 默认值派生
category: core
scope:
  - frontend/src/core/env-state-defaults.ts
source_files:
  - frontend/src/core/env-state-defaults.ts
symbols:
  - deriveDefaultEnvState
invariants:
  - 默认值从 ENV_STATE_SCHEMA 自动派生，单一事实源
  - tuple3 类型使用 slice() 克隆新引用，避免 reactive Proxy 写穿
  - 新增 env 字段只需改 schema 一处，无需手写第二份默认值
tests: []
use_when:
  - EnvState 默认值
---

# EnvState 默认值派生
