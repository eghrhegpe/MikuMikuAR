---
tier: leaf
kind: diagnostic_chat
name: 诊断助手 → 聊天 UI（子模块）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-chat.ts
adr:
  - ADR-196
  - ADR-203
symbols:
  - addAssistantMessage
  - renderChat
  - showPendingBubble
  - renderStreamingChunk
  - finalizeStreamRow
  - finalizeStream
  - renderDialogueCards
  - pruneHistory
  - buildSystemMessage
  - updateSpeakToggle
  - updateSendButton
  - buildChatSchema
invariants:
  - 流式渲染分三步：showPendingBubble（占位）→ renderStreamingChunk（逐块追加）→ finalizeStream（定格 + 后处理）
  - 消息历史 pruneHistory 按 maxPairs=10 裁减，保留首条 system message
  - buildSystemMessage 注入 tool catalog + 当前场景快照，每次发送前重建
  - dialogueCards 模式渲染角色台词卡而非纯文本气泡
tests: []
use_when:
  - 聊天渲染
  - 流式对话
  - 消息气泡
  - 角色台词
---

# 诊断助手 → 聊天 UI（子模块）

## 系统概览
诊断助手聊天 UI 渲染（ADR-196/203，纯渲染无业务协调）。流式三步：`showPendingBubble`（占位）→ `renderStreamingChunk`（逐块追加）→ `finalizeStream`（定格 + 后处理）；`pruneHistory` 按 maxPairs=10 裁减历史；`buildSystemMessage` 每次发送前重建，注入 tool catalog + 场景快照；dialogueCards 模式渲染角色台词卡。
