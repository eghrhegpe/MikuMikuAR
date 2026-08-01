---
tier: leaf
kind: assistant_panel
name: AI 助手独立面板入口
category: ui
scope:
  - frontend/src/menus
source_files:
  - frontend/src/menus/assistant-panel.ts
adr:
  - ADR-203
  - ADR-093
symbols:
  - showAssistant
invariants:
  - 复用 registerPopupMenu + 同一 buildDiagnosticSchema（withSessions:true 区分设置入口和独立面板）
  - overlayClass('sceneOverlay-assistant') 区别于设置菜单弹窗，二者不重影
  - 关闭时 renderDiagnosticPanel 返回的 dispose 负责 flush 会话 + 清理运行态
tests: []
use_when:
  - 助手面板
  - 独立弹窗入口
  - showAssistant
---
