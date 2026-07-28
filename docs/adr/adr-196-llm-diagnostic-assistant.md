# ADR-196: 内置 AI 诊断助手（LLM Diagnostic Assistant）

- **状态**: ✅ 已完成（Phase 0 基础设施 + Phase 1 集成打通与体验打磨 + Phase 2 审计修复与测试覆盖）
- **日期**: 2026-07-28
- **相关**: ADR-154（聊天面板·推荐路线，传输层上游）、ADR-155（NL 控场景，未来应用入口）、ADR-156（角色台词，兄弟用例）、ADR-176（BackendService 双适配器，镜像模板）、ADR-192（上游适配层，适配器术语）、ADR-093（声明式菜单 Schema，面板挂载）、`docs/ai-new/ai-news-2026-07-27.md`（安全护栏情报）

---

## 背景与问题

LLM 能力已在 2026-07-20 经 ADR-154/155/156 决议，但**全部 0 代码落地**，且三份都偏「创作/交互」（聊天、NL 控场景、角色台词），漏掉了 ROI 最高、也最贴合用户诉求的用例：**内置 AI 帮忙排错**。

用户原问：「内置 AI 后，有没有办法让他帮忙排错？」结论：能，且可完全骑在现有架构与资产上，不引入新架构风险。本 ADR 将其确立为 LLM 能力的**第一个生产性用例**，以 ADR-154 聊天面板为传输底座。

## 前置探测（2026-07-28 实测，作为决议依据）

> 起草前已对仓库做实地探测，以下结论均为磁盘事实，非推测。

| 探测项 | 方法 | 结果 | 对设计的影响 |
|--------|------|------|--------------|
| AI 依赖 | `grep` package.json / frontend/package.json 的 openai/anthropic/ollama/langchain/ai-sdk/groq/cohere | **零匹配** | 现状 0 代码，greenfield |
| AI 代码 | `grep` frontend/src 的 SDK 字面量 + `\bllm\b` | **零匹配**（首轮广匹配系 `llm` 子串误报） | 无需清理旧实现 |
| 适配器模板 | 读 `frontend/src/core/backend/{types,index,go-adapter}.ts` | `BackendService = Omit<GoApp,排除集> & {kind, capabilities(), readFileBytes()}`；`resolveBackend()` Tier0/1/2 惰性探测 + 动态 import go-adapter | `AiService` 直接镜像此形 |
| 错误缓冲 | 读 `frontend/src/core/logger.ts` + `grep` 全局 `onerror`/`unhandledrejection` | logger 仅打 console，**无内存缓冲**；全局错误钩子**零处** | 诊断缓冲层须**新增**全局捕获；采用「patch console.error」方案使所有 `console.error`（含 `logger` 的 `logError`）自动入环，零业务文件改动（Batch A 已落地 `installLoggingPatch`） |
| 菜单挂载 | 读 `frontend/src/menus/settings.ts` + `settings-targets.ts` | `SETTINGS` 枚举 + `SETTINGS_FOLDER_ROUTES: Record<target, ()=>PopupLevel>` builder 表 + `buildSettingsRootItems` 推送 folder 项 | 诊断面板复用同形（加 `SETTINGS.DIAGNOSTIC` + builder + 表项） |
| 运行时状态探针 | 现有 `detectKtx2Support` / 质量档位 / `engine.getFps` / activeMotion | 已存在，可快照 | 引擎快照源无需新造 |
| 绑定契约 | ADR-176 契约测试 139 函数 | `AiService` 为**新增独立服务** | 不触碰 139 函数契约，无需改 `app.contract` |

---

## 决策

1. **以 ADR-154 聊天面板为传输层**，在其上叠加**诊断助手**作为核心交付；诊断助手是 LLM 能力的第一个生产性用例，聊天闲聊为其子集。
2. **引入 `AiService` 抽象，镜像 `BackendService` 双适配器**（ADR-176）：
   - 桌面（go-adapter）经 Go 侧 `internal/app/llm/client.go`（ADR-154 已点名）持有 HTTP 客户端与密钥；
   - 网页（browser-adapter）直连用户配置的 OpenAI 兼容端点（含本地 Ollama `localhost`，免 key）。
3. **诊断上下文严格限定三源**（均在 App 运行时内，不依赖仓库 `docs/`）：
   - 错误环形缓冲（新增）、引擎快照（复用现有探针）、用户附加上下文（可选）。
4. **安全护栏为硬约束**（依据 `ai-news-2026-07-27`）：
   - 默认**只读咨询**：AI 输出为文本建议，绝不自动改代码 / 自动执行命令 / 直接 mutate 场景；
   - 「应用建议」必须经 ADR-155 的 NL 控场景闭集（ADR-093 菜单动作）且用户显式确认，不开放自由函数调用；
   - 密钥前端不可见（桌面走 Go；网页仅用户自带 key；本地 Ollama 零 key）；
   - 检索优于长上下文：诊断上下文严格上限 + 截断，不 dumping 全仓库。

### 核心原则

- **加性不侵入**：`AiService` 是新增服务，不修改 `BackendService` 接口、不动 139 函数绑定契约、不改动既有菜单文件（仅追加）。
- **复用 > 新造**：适配器形状、解析单例、菜单注册、运行时探针全部复用既有范式。
- **只读优先**：诊断助手默认不产生任何副作用；副作用一律升级到 ADR-155 闭集并显式确认。
- **零 key 默认路径**：默认提供本地 Ollama（`http://localhost:11434`）零 key 选项，降低隐私/成本门槛。

---

## 第一步交付（Phase 0 → 2）

| 模块 | 建议落点 | 内容 |
|------|----------|------|
| AiService 接口 | `frontend/src/core/ai/types.ts` | 镜像 `BackendService`：`{ kind:'go'\|'browser'; capabilities(): AiCapabilities; streamChat(req): AsyncIterable<ChatChunk> }` |
| 解析单例 | `frontend/src/core/ai/index.ts` | `resolveAi()` 复用后端 Tier0/1/2 探测（同源 `__MMKU_BACKEND__`，避免重复逻辑） |
| Go 适配器 | `frontend/src/core/ai/go-adapter.ts` + `internal/app/llm/client.go` | Go 持有 HTTP 客户端 + key 保管（Wails 安全配置/IndexedDB）+ SSE 流式 |
| 浏览器适配器 | `frontend/src/core/ai/browser-adapter.ts` + `config-store.ts` | OpenAI 兼容直连 / 本地 Ollama；配置经 `config-store.ts` 走 IndexedDB 持久化（废弃 localStorage，FR-9）；CORS 友好提示（FR-13） |
| 错误缓冲 | `frontend/src/core/ai/error-buffer.ts` + `installGlobalErrorCapture()` | 全局 `onerror`/`unhandledrejection` 监听 + 包装 `logError` 入最近 N 条（默认 50，带 tag/stack/时间戳）环形缓冲 |
| 引擎快照 | `frontend/src/core/ai/scene-snapshot.ts` | 复用 `detectKtx2Support` / 质量档位 / `engine.getFps` / activeMotion |
| 诊断面板 | `frontend/src/menus/settings-diagnostic.ts` + `SETTINGS.DIAGNOSTIC` | 复用 `SETTINGS_FOLDER_ROUTES` 形态：folder 项 + builder + 路由表三项追加 |
| 契约 | `app.contract` | **不改动**（AiService 为新增服务，不触碰 139 函数绑定契约） |

### 诊断数据流（只读咨询默认路径）

```
[运行时] 全局 onerror/unhandledrejection + logError ─┐
[引擎]   scene-snapshot（mesh/材质/activeMotion/FPS/GPU）├─→ error-buffer(环) + snapshot
[用户]   可选粘贴报错文本 ──────────────────────────────┘
                        │
                        ▼
              AiService.streamChat({ system: 诊断约束, context: 三源截断 })
                        │
                        ▼
              AsyncIterable<ChatChunk> ──→ 诊断面板流式渲染（仅文本建议）
                        │
            [可选·升级] 用户点「应用」→ ADR-155 NL 控场景闭集 + 显式确认（非默认）
```

---

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| 流式中断 / 超时 | 🟡 | go-adapter SSE + 浏览器 fetch streaming + 断点续收；超时不丢已收 token |
| 隐私 / key 泄漏 | 🟢 | 桌面 key 仅 Go 侧；网页仅用户自带 key；本地 Ollama 零 key |
| 长上下文成本 | 🟢 | 严格三源上限 + 截断；不 dumping 全仓库（遵循 ai-news 检索优于长上下文） |
| auto-exec 攻击面 | 🔴→🟢 | 默认只读；应用经 ADR-155 闭集 + 显式确认，禁自由函数调用 |
| 网页 CORS | 🟡 | 提示用户配置 CORS / 走本地 Ollama / 自建 relay |
| 错误缓冲内存膨胀 | 🟢 | 环形上限 50 条 + 单条 stack 截断（如 4KB） |

---

## 范围边界

- **本 ADR 只做「诊断助手」**：聊天闲聊（ADR-154）、NL 控场景（ADR-155）、角色台词（ADR-156）为兄弟用例，共享 `AiService` 与面板。
- **不自动执行**：任何副作用（改文件 / 跑命令 / mutate 场景）均不在本 ADR 默认路径内。
- **不引入新架构范式**：严格镜像 ADR-176，不另起炉灶。

---

## Phase 1 已知限制（P4）

| 限制 | 文件 | 说明 | 影响评估 |
|------|------|------|----------|
| 诊断/闲聊模式状态不持久 | `settings-diagnostic.ts:26` | `_mode` 为模块级变量，面板销毁重建（如切换设置页面再返回）后重置为 `diagnostic` | 用户每次进入需重新切换模式，不丢消息历史 |
| ensureAiConfigLoaded 异步竞争 | `settings-diagnostic.ts:37` | 模块顶层 fire-and-forget 调用，若 IndexedDB 返回慢，首次 `loadAiConfig()` 回退默认值 | 已有 `_cache` 兜底 `DEFAULT_AI_CONFIG`，仅首屏可能短暂显示默认端点 |
| TypeError 错误归并近似 | `browser-adapter.ts:127-137` | `_friendlyError` 将所有 `TypeError` 统一判为 CORS/网络问题，忽略其他 `TypeError` 成因 | 极少数场景提示可能偏差，不影响功能 |

---

## 开放问题裁定结论（2026-07-28 议会裁定）

| # | 问题 | 裁定 | 理由 |
|---|------|------|------|
| 1 | 诊断面板是否同时承载 ADR-154 聊天？ | **是，合并为单一「AI 助手」面板** | 诊断为默认模式，闲聊为切换模式，减少菜单噪音（FR-11 Q1） |
| 2 | 本地 Ollama 是否为零 key 默认端点？ | **是，默认 `http://localhost:11434/v1/chat/completions`，模型 `llama3.2`** | 零 key 零成本，降低首用门槛；端点留空时面板提示配置（FR-11 Q2） |
| 3 | 错误缓冲是否持久化到 IndexedDB？ | **Phase 0 不做，仅内存环（上限 50 条）** | 持久化列为后续增强；跨会话复盘需求弱，避免隐私面扩大（FR-11 Q3） |

### Go 侧 LLM 客户端接口契约（FR-6）

- **目录**：`internal/app/llm/client.go`（HTTP 客户端 + 流式读取）、`internal/app/llm/binding.go`（Wails binding 暴露给前端）。
- **流式函数签名**：
  ```go
  // LLMStreamChat 启动流式对话，逐 chunk 通过 Wails Event "ai:chunk" 推送
  func (c *LLMClient) LLMStreamChat(req LLMChatRequest) error

  type LLMChatRequest struct {
      Model       string        `json:"model"`
      Messages    []ChatMessage `json:"messages"`
      Temperature float64       `json:"temperature"`
      MaxTokens   int           `json:"max_tokens"`
  }
  type ChatMessage struct {
      Role    string `json:"role"`    // system | user | assistant
      Content string `json:"content"`
  }
  ```
- **API key 存储**：`config.json` 字段 `ai_api_key` + 环境变量 `MIKUAI_API_KEY` 兜底（优先级：环境变量 > config.json）。**key 仅 Go 侧持有，绝不通过 binding 暴露给 WebView（ADR-154 核心原则）**。
- **流式传输**：Wails Events 逐 token 推送事件名 `ai:chunk`（payload `{delta string}`）；前端 go-adapter 经 binding 订阅并 yield `ChatChunk`。备选：若 Events 不可行，改用 Wails 流式 binding 或 polling（.trae spec 的 Open Question 待实施时验证）。
- **安全**：Go 侧统一加 `Authorization` 头，前端不可见密钥。

### 诊断 system prompt（FR-7）

> **角色**：你是《MikuMikuAR 联邦》内置诊断助手，专门帮助开发者排查 Babylon.js / TypeScript 3D 应用运行问题。
> **输出要求**：1) 全程中文；2) 先给结论，再分点给出建议；3) 每条建议标注置信度（高 / 中 / 低）；4) 涉及代码改动时给出最小 diff 片段，不要整文件重写。
> **上下文约束**：你会收到「错误缓冲摘要」与「场景快照」两段上下文（已截断）；不要假设未提供的上下文；不要编造 API。
> **安全边界**：只给只读文本建议；绝不输出可执行命令、不要求用户自动运行脚本、不诱导关闭安全机制。
> **token 预算**：system ≤ 1KB，错误上下文 ≤ 4KB，场景快照 ≤ 2KB，历史保留最近 10 轮，单次 `max_tokens=2048`（对应 NFR-3/4）。

### 诊断面板 UI 布局规范（FR-8，ADR-093 Schema + ADR-153 无障碍）

- **分区**（自上而下，可切换）：
  - **上下文信息区**：展示错误缓冲最近 N 条（默认折叠，可展开 stack）+ 场景快照摘要；更新用 `aria-live` 提示。
  - **对话区**：消息气泡（用户 / 助手），流式渲染逐字追加；底部「发送 / 中止 / 清空」三按钮；中止调用 `AbortController.abort()`。
  - **配置区**：端点 / API key（password 输入）/ 模型 三字段 + 「连通性测试」按钮（触发一次最小请求验证，不进入对话）。
- **空状态引导**：未配置端点时显示「设置本地 Ollama 或 OpenAI 兼容端点以启用诊断」。
- **流式渲染**：首字延迟目标 < 500ms（NFR-5）；chunk 到达立即渲染，不缓冲整句。

### logError 集成方案（已落地，满足 AC-10）

- 采用「patch console.error」：`init` 早期安装 `installLoggingPatch()`，所有 `console.error`（含 `@/core/logger` 的 `logError`）自动入环；**零业务文件改动**。
- `error-buffer.ts` 不再导出 `logError`；手动入环走 `captureError`（供 `unhandledrejection` 等路径）。

---

## 实施记录

### Phase 0 — Batch A（2026-07-28 01:09–01:30）：修复 4 个 P1 缺陷
- `error-buffer`：`logError` 导出移除 → 改幂等 `installLoggingPatch` patch `console.error`（零业务文件改动）
- `index.ts`：`resolveAi()` 镜像 `resolveBackend()` 的 Tier0/1/2 + `awaitWailsBridge()` 惰性探测，消除 Android 冷启动竞态
- `init.ts`：早期安装 `installLoggingPatch` + `installGlobalErrorCapture`，disposer 纳入 `_initDisposables`（HMR 幂等）
- `scene-snapshot.ts`：新增 bridge 模式引擎快照，`scene.ts` `initScene` 注入
- `types`/adapter：`AiCapabilities` 补齐 `apiKeyConfigured`/`corsRisk`/`endpointReachable`
- 验证：tsc 0 错误；全量单测 2245 通过；`check:docs` 无 ERROR 漂移

### Phase 0 — Batch B（2026-07-28 01:41–）：修复 P2 缺陷 + 文档裁定
- `config-store.ts`：新增 IndexedDB 配置持久化（复用 `backend/idb` 的 `config` store + key `ai`），`browser-adapter` 废弃 localStorage（FR-9 / AC-5）
- `browser-adapter` / `sse.ts`：`streamChat` 改用内部 `AbortController` 转发 `signal`，generator `finally` 强制 abort 底层 fetch（FR-10 / AC-6）；`sse` `AbortError`→`done`；CORS/网络错误友好提示（FR-13 / AC-8）
- 文档：裁定 3 个开放问题；补全 Go 侧契约、system prompt、面板规范、token 预算；修正前置探测描述
- 验证：tsc 0 错误；ai 相关单测 9 项新增/适配通过

### Phase 0 — Batch C（2026-07-28）：诊断面板 UI + 菜单挂载 + i18n
- `settings-diagnostic.ts`：新建三分区面板（上下文信息 / 流式对话 / 端点配置），含「清除错误」「刷新快照」「测试连接」交互控件
- `settings-targets.ts`：追加 `SETTINGS.DIAGNOSTIC` 枚举
- `settings.ts`：导入 + 路由表 + 根菜单项（`lucide:bot` 图标）
- i18n：5 语言（en/zh-CN/ja/zh-TW/ko）各加 20 条 `ai.*` 键 + 1 条 `settings.diagnostic`
- 验证：tsc 0 错误；error-buffer 单测 24/24 通过

### Phase 0 — Batch D（2026-07-28）：Go 侧 LLM 客户端 + Wails 绑定
- `internal/app/llm/client.go`：新建 `package llm`，纯 HTTP 客户端（无 Wails 依赖），`StreamChat` 采用 callback 模式逐 token 回调，支持 `context.Context` 取消；`TestConnection` 同步连通性测试
- `internal/app/ai_binding.go`：`package app`，5 个 Wails 绑定方法：
  - `AiStreamChat(req)` — 启动 goroutine 做流式 SSE 请求，通过 `a.wailsApp.Event.Emit` 推送 `ai:chunk`/`ai:done`/`ai:error` 事件
  - `AiCancelStream()` — 取消当前流式请求（`context.WithCancel`）
  - `AiSetLLMConfig(cfg)` — 持久化 `LLMConfig`（含 apiKey）到 `config.json`
  - `AiGetLLMConfig()` — 读取端点/model（不返回 apiKey）
  - `AiTestLLMConnection()` — 最小请求验证连通性
- `app.go`：`App` 结构体新增 `llmCancel context.CancelFunc` + `llmMu sync.Mutex`；`Config` 新增 `LLMConfig *LLMConfig`
- `go-adapter.ts`：从占位升级为真实实现，订阅 `ai:*` 事件 + 调用 `AiStreamChat` binding，基于 Promise waiter 将 push 事件转换为 `AsyncIterable<ChatChunk>`
- Wails bindings 自动生成（`frontend/bindings/mikumikuar/internal/app/llm/`）
- 验证：`go build ./...` 通过；tsc --noEmit 0 错误

### Phase 1 — 集成打通与体验打磨（2026-07-28）
- **AiService 接口扩展**：`types.ts` 新增 `testConnection(): Promise<{ok, message}>` + 可选的 `refreshCapabilities?(): Promise<void>`
- **browser-adapter**：实现 `testConnection()`（最小 POST 请求，`max_tokens:1, stream:false`，复用 `_friendlyError`）
- **go-adapter**：实现 `testConnection()`（调用 `AiTestLLMConnection` binding）；移除 `as any` 强转，定义 `LLMChatRequest` 类型对齐 Go 侧 `ChatRequest` JSON tag；新增 `_capCache` + `refreshCapabilities()` 异步能力探测，调用 `AiGetLLMConfig()` 获取配置后更新 `corsRisk/provider/available`
- **面板双适配器路径**（`settings-diagnostic.ts`）：移除 `browserAiAdapter` 硬编码，改用 `resolveAi()` 异步分发；`_testConnection()` 走 `_ai.testConnection()`；配置保存根据 `_ai.kind` 分流（browser→saveAiConfig / go→AiSetLLMConfig）
- **诊断/闲聊模式切换**：面板顶部 `role="tablist"` 按钮组，诊断模式注入完整 system prompt（含错误+快照），闲聊模式仅角色+简短设定
- **CORS 风险提示**：配置区顶部黄色提示条，`corsRisk!=='none'` 时可见
- **清空对话按钮**：对话区底部新增「清空」按钮，重置 `_messages` 并恢复欢迎消息
- **错误栈展开**：每条错误可点击展开/折叠 stack 前 5 行，含键盘交互（Enter/Space，角色 `button`，tabindex）
- **历史截断**：只保留最近 10 轮（20 条 user+assistant），符合 ADR token 预算
- **无障碍**：`aria-live="polite"` 对话区、输入框 `aria-label`、按钮 `aria-label`、模式按钮 `role="tablist"/"tab"/"aria-selected"`
- **i18n 补全**：5 语言新增 `ai.mode.*` / `ai.system.chat` / `ai.config.corsWarning` / `ai.chat.clear` / `ai.errors.resolveFailed` / `ai.config.notResolved` 共 8 条/语言
- **验证**：`tsc --noEmit` 0 错误；全量 2254 测试通过；`go build ./...` 通过；`check:docs` 无 ERROR；`grep as any` 在 `ai/` 目录 0 处

### Phase 2 — 审计修复与测试覆盖（2026-07-28）
- **`AiCapabilities.provider` → `adapter` 重命名**（语义纠正：描述适配器模式而非配置服务商）：`types.ts`、`browser-adapter.ts`、`go-adapter.ts` 三处同步；tsc + 2268 tests 通过
- **P1 `_capsPromise` 永不复位修复**（`go-adapter.ts`）：`_capsPromise` 加 `try/finally` 复位，并发 dedup 保留、完成后 guard 释放——用户改 Go LLM 配置后面板不再僵死
- **P2 `parseActionFromLLM` 正则脆弱修复**（`intent-dispatcher.ts`）：三优先级策略 ①直接 `JSON.parse` 全文 ② `\`\`\`json` 代码块提取 ③ 正则回退
- **P3 `_testConnection` 并发守卫**（`settings-diagnostic.ts`）：新增 `_testing` 标志、`try/finally` 包围、所有 return 路径释放，防双击竞态
- **P3 `validateAiConfig` 全量错误收集**（`config-store.ts`）：`AiValidationResult` 新增大数组 `errors[]` + `AiValidationError` 接口；`validateAiConfig` 遍历全部规则一次返回；`AiErrorKind` 补齐 `missingModel` 类型
- **P4 `createField` blur 按字段保存**（`settings-diagnostic.ts`）：blur handler 仅保存当前字段，不再写整个 `_localConfig`
- **测试覆盖**：SSE 解析器从 3→8 tests（tool_calls 增量聚合/多索引/空响应体/JSON 回退/Ollama 格式）；`param-adapters` 新建 26 tests 覆盖全部 5 类适配器（boolean/color/enum/range/entity）；全量 2299 tests 通过
- **UX 审核与打磨**（7 项修复）：
  - 徽章 flash 修复：`_caps` 为 null 时跳过 `_updateStatusBadge` 避免 transient disconnected→missingEndpoint 跳变
  - 初始化加载状态：新增 `_setStatusBadge('initializing')`，5 语言文件加 `ai.status.initializing`
  - `_refreshingCaps` 并发守卫：`_applyProvider` try/finally guard（同 `_testing` 模式）
  - Streaming DOM 增量更新：`_finalizeStream` 改 in-place 操作（移除 `.chat-row--streaming` class + 设 textContent），免全量重建闪烁
  - apiKey 条件隐藏：新增 `_updateApiKeyVisibility`，`needsKey=false` 时隐藏整行
  - `aria-expanded` 同步：错误行展开图标初始 `false`，toggle 时同步
  - 清除聊天确认：`_clearChat` 加 `await showConfirm`，5 语言加 `ai.chat.clearConfirm`
- **i18n 补齐**：`ai.status.missingModel`、`ai.errorAdvice.missingModel`、`ai.status.initializing`、`ai.chat.clearConfirm`，覆盖 zh-CN/en/zh-TW/ja/ko
- **知识卡同步**：`settings-diagnostic.md` 补充「面板重建时 DOM 清空但模块级状态保留」不变量；`ai-service.md`/`ai-config-store.md` 同步 `adapter` 字段名
- **验证**：`tsc --noEmit` 0 错误；全量 2299 tests 通过；`check:docs` 无 ERROR
