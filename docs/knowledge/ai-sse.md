---
kind: ai_sse
name: SSE 流式解析器
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/sse.ts
adr:
  - ADR-196
symbols:
  - parseSseStream
invariants:
  - 纯函数、零依赖，兼容 OpenAI / Ollama / 任意 OpenAI 兼容端点
  - 中止信号（signal.aborted）统一归并为 done，不渲染为 error（FR-10）
  - 兼容非 JSON 纯文本流（Ollama），catch 后直接产出原始文本
tests: []
use_when:
  - SSE 解析
  - 流式聊天
  - parseSseStream
---

## 系统概览
ADR-196 的 SSE（Server-Sent Events）行解析纯函数，从 `ReadableStream<Uint8Array>` 逐行解析 OpenAI 兼容格式（`data: {...}` / `data: [DONE]`），yield `ChatChunk`。

## 核心职责
- `parseSseStream(body, signal?)` — AsyncGenerator<ChatChunk>，处理流式分块、注释行、[DONE] 终止、abort 归并

## 与其他子系统关系
- 被 `browser-adapter.ts` 的 streamChat 调用

## 不变量
- 见 frontmatter
