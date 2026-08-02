---
tier: leaf
kind: ai_markdown
name: 轻量 Markdown→DOM 渲染器
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/markdown.ts
adr:
  - ADR-196
symbols:
  - renderMarkdownInto
invariants:
  - 纯 DOM 构建（createElement + textContent），不用 innerHTML，免疫 XSS
  - 只覆盖 LLM 回复常用子集：标题/#、加粗/**、斜体/*_、行内代码/`、代码块/```、无序列表/-*+、有序列表/1.、水平线/---、段落与换行
  - 不支持链接/图片/表格（诊断场景不用）
  - 流式结束时一次性渲染（container 清空后重建），避免逐字符重排闪烁
tests: []
use_when:
  - Markdown 渲染
  - DOM 构建
  - 聊天消息格式化
  - markdown 渲染
  - md 转 dom
  - AI 回复渲染
  - 轻量渲染
---

# 轻量 Markdown→DOM 渲染器

## 系统概览
LLM 回复专用轻量 Markdown 渲染器（ADR-196）。纯 DOM 构建（`createElement` + `textContent`），不用 innerHTML 拼字符串，从根上免疫 XSS、无需 marked/dompurify 重依赖。只覆盖常用子集（标题/加粗/斜体/行内代码/代码块/列表/水平线/段落）；流式结束时一次性渲染（container 清空重建），避免逐字符重排闪烁。
