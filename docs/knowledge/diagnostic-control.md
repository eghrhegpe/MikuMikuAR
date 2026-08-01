---
tier: leaf
kind: diagnostic_control
name: 诊断助手 → tool call 控制（子模块）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-control.ts
adr:
  - ADR-197
  - ADR-155
  - ADR-203
symbols:
  - tryQueuePendingAction
  - handleControlFallback
  - renderControlHint
  - undoLastAction
  - renderPendingAction
  - applyPendingAction
  - cancelPendingAction
  - advancePendingQueue
  - finalizePendingBatch
invariants:
  - pendingAction + pendingQueue 支持多 tool_call 批处理：逐项执行→回填 tool 消息→继续 stream
  - LLM 文本回退时 parseActionFromLLM 三级容错提取 JSON，无匹配则降级为纯文本回复
  - 破坏性操作（action.destructive）前置 showConfirm 二次确认
  - undo 委托 scene:undo 动作执行，非本地状态回滚
  - pendingToolResults 回填 tool_call_id 后触发 continueStream 继续对话
tests: []
use_when:
  - 待确认操作
  - tool call
  - 自然语言控场
  - 操作撤销
---

# 诊断助手 → tool call 控制（子模块）
