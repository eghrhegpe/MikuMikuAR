---
tier: leaf
kind: chat_store
name: AI 会话 IndexedDB 存储
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/chat-store.ts
adr:
  - ADR-203
symbols:
  - ChatSession
  - ChatSessionFull
  - newSessionId
  - deriveTitle
  - listSessions
  - loadSession
  - saveSession
  - deleteSession
  - getActiveId
  - setActiveId
  - clearActiveId
invariants:
  - 会话拆两键存储：meta:<id>（元信息，供列表快速枚举）+ msgs:<id>（消息数组懒加载），不与 LLM 配置混存
  - 活动会话 id 存 meta store 的 chat:activeId 键
  - 所有读操作对损坏/缺失数据降级返回 undefined/空数组，不向上抛异常
  - saveSession 使用 idbBatchSet 单事务批量写元信息和消息
tests: []
use_when:
  - 会话存储
  - IndexedDB
  - 聊天历史
  - 多会话
---

# AI 会话 IndexedDB 存储
