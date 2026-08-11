---
kind: debug_log_panel
name: 调试日志面板 — ADR-248 轻量 UI
tier: leaf
category: core
scope:
  - frontend/src/core/debug-log-panel.ts
source_files:
  - frontend/src/core/debug-log-panel.ts
tests:
  - frontend/src/__tests__/debug-log-panel.test.ts
invariants:
  - 日志面板通过 DOM 浮层展示 logger 缓冲区，支持 tag 过滤和 level 过滤
  - 用户在底部时自动滚动到底部，在中间时保留位置
  - Console 按钮用 /:\s*ON$/i 严格匹配尾部判定状态，避免 .includes("ON") 在含 ON 子串文案下误判
  - disposeLogPanel 清理 DOM + subscribe 回调 + 模块级过滤状态，彻底卸载
  - 面板通过 window.__logPanel 暴露给控制台调用
---

# 调试日志面板 — ADR-248 轻量 UI
