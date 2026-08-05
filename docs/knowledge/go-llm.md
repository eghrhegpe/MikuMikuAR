---
tier: architecture
kind: go_llm
name: Go LLM 客户端与 AI 绑定
category: backend
scope:
  - internal/app/llm/client.go
  - internal/app/llm/tools.go
  - internal/app/ai_binding.go
source_files:
  - internal/app/llm/client.go
  - internal/app/llm/tools.go
  - internal/app/ai_binding.go
symbols:
  - AiCancelStream
  - AiFetchModels
  - AiGetLLMConfig
  - AiSetLLMConfig
  - AiStreamChat
  - AiTestLLMConnection
  - ChatMessage
  - ChatRequest
  - Client
  - Config
  - ConnectionResult
  - FetchModels
  - LLMConfig
  - LLMConnectionResult
  - NewClient
  - StreamChat
  - StreamEvent
  - TestConnection
  - ToolCall
  - ToolCallFunc
  - ToolFunction
  - ToolSchema
  - WithConfig
  - boolToStr
  - classifyConnectionError
  - deltaToolCall
  - fetchModelsFrom
  - getLLMClient
  - getLLMConfig
  - isLocalhost
  - testConnTimeout
  - urlOrigin
invariants:
  - 流式请求单实例：App 持有 llmCancel + llmMu，AiStreamChat 启动新流前先取消旧流
  - AiStreamChat 为 Wails 绑定（返回 error），流事件经 Events 回推前端（SSE 对齐 ai-sse）
  - TestConnection/FetchModels 用独立超时（testConnTimeout=10s），不阻塞主流
  - LLMConfig 持久化经配置系统（AiSetLLMConfig → updateConfig）
  - llm.Client 无状态可复用，每次 StreamChat 独立 ctx（由 AiCancelStream 取消）
tests:
  - internal/app/llm/client_test.go
  - internal/app/ai_binding_test.go
use_when:
  - Go LLM 客户端 StreamChat 流式对话
  - AI 诊断助手 AiStreamChat AiCancelStream 后端实现
  - 连接测试 AiTestLLMConnection AiFetchModels
  - 工具调用 ToolSchema tool call
---

# Go LLM 客户端与 AI 绑定

## 系统概览
AI 诊断助手 / NL 控制的后端实现（`llm/client.go` + `llm/tools.go` + `ai_binding.go`）。`llm.Client` 是 OpenAI 兼容流式客户端（SSE 解析、tool call 增量、连接错误分类）；`ai_binding.go` 将客户端接到 Wails 绑定面（`AiStreamChat`/`AiCancelStream`/配置/连接测试/模型列表）。与前端 `ai-service.ts` 形成双适配器（ADR-196）。

## 核心职责
- `llm/client.go` — `NewClient(cfg)`、`StreamChat(ctx, req, emit)`（SSE 增量 + tool call）、`TestConnection`、`FetchModels`、`classifyConnectionError`（超时/401/429/连通性）。
- `llm/tools.go` — `ToolSchema`/`ToolFunction` 声明（供 tool call 回传）。
- `ai_binding.go` — `AiStreamChat`（绑定入口，流事件回推）、`AiCancelStream`（取消当前流）、`AiSet/GetLLMConfig`、`AiFetchModels`、`AiTestLLMConnection`。

## 对外 API（节选）
- `AiStreamChat(req llm.ChatRequest) error` — 开始流式对话（事件经 Wails Events `ai:stream` 等回推）。
- `AiCancelStream()` — 取消进行中的流（llmCancel）。
- `AiTestLLMConnection() LLMConnectionResult` — 连接测试结果（含分类错误）。
- `AiFetchModels() ([]string, error)` — 拉取模型列表。

## 与其他子系统关系
- 前端 AI 诊断面板（`settings-diagnostic.ts`、`ai-service.ts`、`ai-sse.ts`）消费绑定与流事件。
- 配置持久化走 `go-app.md` 的配置系统；错误回传经 `i18nerr` 信封。

## 前端接入入口
- AI 诊断助手面板 / NL 控制：`frontend/src/core/ai-*.ts` 系列 + `settings-diagnostic.ts`。

## 不变量
- 并发流只允许一个：新流必须取消旧流（llmMu + llmCancel），否则多流事件交错。
- 绑定方法返回错误而非 panic；内部 panic 由 util.SafeCall 兜底。
- 流式事件必须与前端 `ai-sse.ts` 的协议完全一致（事件名/载荷）。

## 验证入口
- 测试：`internal/app/llm/client_test.go`、`internal/app/ai_binding_test.go`。
- 命令：`go test ./internal/app/...`。
