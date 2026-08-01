---
tier: leaf
kind: diagnostic_session
name: 诊断助手 → 会话管理（子模块）
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/diagnostic-session.ts
adr:
  - ADR-203
symbols:
  - doPersistSession
  - schedulePersistSession
  - flushSession
  - loadActiveSession
  - createSession
  - switchSession
  - deleteSessionAndAdjust
  - buildSessionsSchema
  - renderSessionList
  - fmtTime
invariants:
  - 持久化经 DebouncedTimer 500ms 防抖，flushSession 强制将未完成写操作完成
  - switchSession 先 flush 当前会话再加载目标，避免数据覆盖
  - 删除当前会话时自动切换到最近会话；无剩余会话时 clearActiveId
  - loadActiveSession 降级处理 IndexedDB 损坏（保持空会话不抛 UI 异常）
tests: []
use_when:
  - 会话历史
  - 会话列表
  - 切换/新建/删除会话
---
