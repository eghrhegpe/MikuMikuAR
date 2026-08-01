---
tier: leaf
kind: diagnostic_actions
name: 诊断用动作注册
category: core
scope:
  - frontend/src/core/action-defs
source_files:
  - frontend/src/core/action-defs/diagnostic-actions.ts
adr:
  - ADR-197
  - ADR-196
symbols:
  - registerDiagnosticActions
invariants:
  - 所有诊断动作均为 readonly（不修改场景状态），可安全自动执行
  - getFrontendState 从 envState + modelRegistry 同步快照，不依赖场景运行时
  - getBackendLogs/getBackendState 通过 @bindings 懒加载避免模块启动时依赖 Go 侧
  - registerDiagnosticActions 一次注册整组动作，适合在 AI 助手初始化时调用
tests: []
use_when:
  - 诊断动作
  - 注册动作
  - 场景快照
  - 前端状态
  - 后端日志
---

# 诊断用动作注册
