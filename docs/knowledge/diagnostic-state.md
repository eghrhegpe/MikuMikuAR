---
tier: leaf
kind: diagnostic_state
name: 诊断助手 → 单例状态（子模块）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-state.ts
adr:
  - ADR-196
  - ADR-203
symbols:
  - DiagnosticState
  - diagState
  - PendingAction
  - PendingToolResult
invariants:
  - 单例 diagState 为所有诊断子模块（chat/config/control/session）共享状态源
  - callbacks 注册表由 entry point 接线，避免子模块间循环依赖
  - pendingQueue + pendingToolResults 支持多 tool_call 批处理，逐项推进
  - saveChain 链式防并发持久化竞争
tests: []
use_when:
  - diagState
  - 诊断面板状态
  - 待确认操作队列
---
