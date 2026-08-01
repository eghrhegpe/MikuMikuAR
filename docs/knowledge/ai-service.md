---
tier: architecture
kind: ai_service
name: 内置 AI 诊断助手 — 双适配器服务层
category: core
scope:
  - frontend/src/core/ai
source_files:
  - frontend/src/core/ai/types.ts
  - frontend/src/core/ai/index.ts
  - frontend/src/core/ai/browser-adapter.ts
  - frontend/src/core/ai/go-adapter.ts
  - frontend/src/core/ai/go-key-allows-proceed.ts
adr:
  - ADR-196
  - ADR-176
symbols:
  - AI_ERROR_KINDS
  - AiCapabilities
  - AiConfigProvider
  - AiConnectionResult
  - AiErrorKind
  - AiPersistedConfig
  - AiService
  - AiValidationError
  - AiValidationResult
  - BrowserAiAdapter
  - ChatChunk
  - ChatMessage
  - ChatRequest
  - GoAiAdapter
  - ToolCall
  - ToolSchema
  - browserAiAdapter
  - goAiAdapter
  - goKeyAllowsProceed
  - resolveAi
invariants:
  - resolveAi() 为惰性单例，模块顶层禁止同步求值（避免 Android 冷启动 window.wails 未注入而误降级）
  - go-adapter 必须动态 import（桌面/安卓路径按需），不得进入纯浏览器 bundle
  - AiService.capabilities() 为同步签名，异步能力回源由 refreshCapabilities 更新缓存
  - 两适配器均实现统一 AiService 契约（streamChat 返回 AsyncIterable<ChatChunk>），双路径对调用方透明
tests: []
use_when:
  - AI 诊断助手
  - resolveAi
  - 浏览器/Go 适配器
  - streamChat / testConnection
---

## 系统概览
ADR-196 内置 AI 诊断助手的核心服务抽象，镜像 BackendService（ADR-176）双适配器模式。定义统一 `AiService` 契约，并提供 `BrowserAiAdapter`（直接 fetch OpenAI 兼容端点）与 `GoAiAdapter`（经 Wails events 订阅 Go 侧 LLM 流）两种实现；`resolveAi()` 按 Tier 分层策略惰性选型。

## 核心职责
- `types.ts` — `AiService` 接口 + `AiCapabilities` / `ChatMessage` / `ChatRequest` / `ChatChunk` 数据结构
- `index.ts` — `resolveAi()` 单例选择器（Tier 0 入口声明 → Tier 1 web 短路 → Tier 2 运行时桥接探测）
- `browser-adapter.ts` — 浏览器端实现，配置经 IndexedDB 持久化，含 CORS 风险判定与友好错误提示
- `go-adapter.ts` — Go 侧实现，经 `events.on('ai:chunk'|'ai:done'|'ai:error')` 转 AsyncIterable，支持中止取消

## 对外 API（节选）
- `resolveAi()` — 返回惰性单例 `AiService`
- `browserAiAdapter` / `goAiAdapter` — 两适配器实例
- `AiService.capabilities()` / `streamChat(req)` / `testConnection()`

## 与其他子系统关系
- 下行：`browser-adapter` → `config-store`（读取端点/key）、`sse`（SSE 解析）
- 下行：`go-adapter` → `runtime-bridge.events`、Go binding `@bindings/.../app`
- 上行：被 `menus/settings-diagnostic.ts` 经 `resolveAi()` 调用

## 不变量
- 见 frontmatter `invariants`

## 验证入口
- 契约见 ADR-196；单测以 `frontend/src/__tests__/core/ai/` 下 ai 子模块测试为准（待补登）
