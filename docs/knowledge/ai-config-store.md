---
tier: architecture
kind: ai_config_store
name: AI 配置持久化（IndexedDB）
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/config-store.ts
adr:
  - ADR-196
symbols:
  - AiConfig
  - DEFAULT_AI_CONFIG
  - DEFAULT_RELAY_URL
  - DEFAULT_TIMEOUT_MS
  - MAX_TIMEOUT_MS
  - MIN_TIMEOUT_MS
  - PROVIDER_PRESETS
  - ProviderPreset
  - classifyAiError
  - ensureAiConfigLoaded
  - loadAiConfig
  - normalizeEndpoint
  - normalizeTimeout
  - saveAiConfig
  - validateAiConfig
invariants:
  - 仅服务浏览器适配器；桌面端配置由 Go 侧持有，前端不暴露 key
  - 默认零 key 路径：本地 Ollama（http://localhost:11434/v1/chat/completions，model llama3.2）
  - capabilities() 同步语义：内存缓存 + 异步回源，未加载时回退默认不阻塞调用方
tests: []
use_when:
  - AI 配置
  - loadAiConfig / saveAiConfig
  - Ollama 端点
---

# AI 配置持久化（IndexedDB）

## 系统概览
ADR-196 浏览器端 AI 配置持久化层，复用 `backend/idb.ts` IndexedDB，取代 Web Storage（FR-9/AC-5）。提供同步读（`loadAiConfig`）与同步写（`saveAiConfig`）+ 异步落盘。

## 核心职责
- `AiConfig` — `{ endpoint, apiKey, model }`
- `DEFAULT_AI_CONFIG` — 零 key 本地 Ollama 默认
- `loadAiConfig()` — 优先内存缓存，未加载触发异步回源
- `saveAiConfig(partial)` — 合并写缓存 + fire-and-forget 落盘
- `ensureAiConfigLoaded()` — 主动预加载，建议 init 后台调用

## 与其他子系统关系
- 被 `browser-adapter.ts`、`menus/settings-diagnostic.ts` 调用
- 依赖 `core/backend/idb.ts`

## 不变量
- 见 frontmatter
