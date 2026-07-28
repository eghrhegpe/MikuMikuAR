# ADR-155: 自然语言控场景 — 叠加于 AiService 管线之上

- **状态**: 🟢 已完成
- **日期**: 2026-07-20（初版），2026-07-28（重写），2026-07-28（终版对齐实现）
- **相关**: ADR-093（声明式菜单 Schema，动作闭集来源）、ADR-196（AiService 传输层前置）、ADR-197（统一动作注册表，本 ADR 的 catalog 由 registry 驱动）、ADR-176（双适配器模式）

---

## 背景

原 ADR-155 写于 ADR-196 之前，当时「客户端+流式+面板」尚未落地。**现已实现**：ADR-196 交付了完整 LLM 传输层 + ADR-197 统一动作注册表（41 动作全域迁移），本 ADR 的 NL 控制作为 ADR-196 的叠加层，复用诊断面板并在其上新增「控制」模式。

---

## 前置依赖

| 依赖 | ADR | 实际组件 | 状态 |
|------|-----|---------|------|
| LLM 传输层 | ADR-196 | `AiService` 接口 + go/browser 适配器 + `resolveAi()` | ✅ |
| 流式 SSE + tool_calls | ADR-196 | `sse.ts` 解析器 + `go-adapter.ts` AsyncIterable + `delta.tool_calls` 聚合 | ✅ |
| 流式渲染 | ADR-196 | `settings-diagnostic.ts` `_renderStreamingChunk()` | ✅ |
| 诊断面板 | ADR-196 | `settings-diagnostic.ts` 435 行三分区面板 | ✅ |
| 动作统一注册表 | ADR-197 | `action-registry.ts` + 5 个域 action-def 文件，共 41 动作 | ✅ |
| 参数适配器 | ADR-155 Phase 1 | `param-adapters.ts` 4 个通用适配器 | ✅ |
| 意图分发器 | ADR-155 Phase 1 | `intent-dispatcher.ts` + `action-executor.ts` | ✅ |
| Go tool_calls | ADR-155 Phase 1 | `tools.go` + `client.go` tool_calls 聚合 + `ai_binding.go` 事件推送 | ✅ |
| E2E 测试 | ADR-155 Phase 1 | `ai-control.spec.ts` 3 个测试 | ✅ |

---

## 设计决策

### 1. 复用诊断面板，加「控制」模式切换
诊断面板顶部加「诊断 / 闲聊 / 控制」tabs（`role="tablist"` + `aria-selected`），控制模式下对话下方展示「待执行操作卡」。

### 2. 意图解析：原生 tool_calls + prompt 约束双轨
- **Go 桌面端**：SSE `delta.tool_calls` 原生聚合，`finish_reason: 'tool_calls'` 时 emit `tool_call` 事件（`client.go`）
- **浏览器端**：TS 侧优先调 provider 原生 function_calling；不支持时降级为 prompt 约束 + `parseActionFromLLM()` regex 提取（`intent-dispatcher.ts`，已弃用，保留兼容）
- 前端统一通过 `executeActionById()` 执行（`action-executor.ts` 纯叶子模块）

### 3. 动作来源：ADR-197 统一注册表
`action-catalog.ts` 的 `buildToolSchemas()` 遍历注册表生成 JSON Schema 工具定义，`buildToolCatalogText()` 生成 prompt 约束文本。工具命名模式：`<domain>:<verb>-<noun>`。

### 4. 安全：用户显式确认 pending 卡
不自执行。控制模式下所有解析结果先入 pending-action 卡（含 action 名+参数），用户点「应用」才执行。destructive 动作加 `showConfirm` 二次确认。

---

## 实施记录

### Phase 1（~420 行 TS + ~80 行 Go）：核心管线 + 8 高频动作

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 1 | 工具编目 | `core/ai/action-catalog.ts` | `buildToolSchemas()` → JSON Schema; `buildToolCatalogText()` → 文本清单 |
| 2 | 参数适配器 | `core/ai/param-adapters.ts` | enum(同义词)/color(hex→元组)/range(clamp)/entity(模糊搜索) |
| 3 | 意图分发器 | `core/ai/intent-dispatcher.ts` | `parseActionFromLLM(text)` → `executeAction(id, rawParams)` |
| 4 | 动作定义 | `core/ai/action-registry-defs.ts` | 注册 8 个高频控制动作 |
| 5 | 应用层执行器 | `core/action-executor.ts` | `executeActionById()` 统一入口 |
| 6 | 控制模式 UI | `menus/settings-diagnostic.ts` | 第三个 tab + pending-action 卡 + 应用/取消 |
| 7 | Go tool schema | `internal/app/llm/tools.go` | `ToolSchema`/`ToolFunction` 结构体 |
| 8 | Go tools 透传 | `internal/app/llm/client.go` | `ChatRequest.Tools` + `delta.tool_calls` 聚合 |
| 9 | Go 事件推送 | `internal/app/ai_binding.go` | `ai:tool_call` 事件 |
| 10 | types 扩展 | `core/ai/types.ts` | `ChatRequest.tools` + `ChatChunk.tool_call` |
| 11 | go-adapter | `core/ai/go-adapter.ts` | tools 透传 + 事件订阅 |
| 12 | 薄封装 | `menus/library-actions.ts` | `loadLibraryModel`/`loadLibraryMotion` 导出 |
| 13 | i18n 5 语言 | `core/i18n/locales/*.ts` | 各 +8 key（control/controlFormat/pending/apply/cancel 等） |
| 14 | E2E 测试 | `e2e/ai-control.spec.ts` | 3 个验收测试 |

### Phase 2（迁移 settings 域，13 动作 → SSE tool_calls 原生）

- `sse.ts`: `parseSseStream` 增加 `toolAccums` Map，`delta.tool_calls` 按 index 聚合 id/name/arguments
- `client.go`: `StreamEvent` 新增 `ToolName/ToolArgs/ToolId` + SSE scanner 聚合
- `action-defs/settings-actions.ts`: 13 动作注册（12 SETTINGS_ACTION + set-lang）
- `settings-actions.ts`: 移除 `SETTINGS_ACTIONS` Record，委托 `executeActionById`
- `settings-diagnostic.ts`: 发送 `tools: buildToolSchemas()`，处理原生 `tool_call` chunk

### Phase 3（迁移 scene 域，4 动作）

- `action-defs/scene-actions.ts`: 注册 screenshot:current/batch、scene:save/undo
- `scene-menu.ts`: 移除 `SCENE_ACTIONS` Record，委托 `executeActionById`

### Phase 4（迁移 motion 域，10 动作）

- `action-defs/motion-actions.ts`: 注册 lipsync/clear/retarget/model:pause/reset/pose/loop/procmotion
- `motion-popup.ts`: 替换 6 个 if/else 分支，保留导航分支

### Phase 5（迁移 env + library 域，6 动作）

- `action-defs/env-actions.ts`: 3 纹理绑定动作（particle/sky/stars）
- `action-defs/library-actions-def.ts`: 3 动作（rescan、import-file、set-formation）
- `env-menu.ts`: envOnItemClick 委托 executeActionById
- `library-browse.ts`: onItemClick 3 个动作分支委托 executeActionById

---

## 总动作清单（41 个）

| 域 | 注册文件 | 数量 | 动作 ID 示例 |
|----|---------|------|-------------|
| **控制**（ADR-155 Phase 1） | `core/ai/action-registry-defs.ts` | 8 | `ai:control:setLightIntensity`、`ai:control:loadModel` |
| **设置**（Phase 2） | `core/action-defs/settings-actions.ts` | 13 | `settings:set:clearextractcache`、`settings:set-lang` |
| **场景**（Phase 3） | `core/action-defs/scene-actions.ts` | 4 | `screenshot:current`、`scene:save` |
| **动作**（Phase 4） | `core/action-defs/motion-actions.ts` | 10 | `lipsync:toggle`、`motion:model:pause` |
| **环境**（Phase 5） | `core/action-defs/env-actions.ts` | 3 | `env:bind-particle-texture`、`env:bind-sky-texture` |
| **模型库**（Phase 5） | `core/action-defs/library-actions-def.ts` | 3 | `library:rescan`、`library:set-formation` |

---

## 首批 8 个高频动作（当前实现）

| 工具 | 参数 | 真实约束 | handler |
|------|------|---------|---------|
| `setLightIntensity` | `dirIntensity: number` | 0–1，步长 0.05 | `setLightState({ dirIntensity })` |
| `setLightColor` | `dirColor: color` | hex `#rrggbb` → `[r,g,b]` 元组 (÷255) | `setLightState({ dirColor })` |
| `setCameraMode` | `mode: enum` | `orbit/freefly/surround`（同义词：follow→freefly） | `setCameraMode(mode)` |
| `setEnvPreset` | `preset: enum` | `dawn/noon/sunset/night/overcast/neon` | `applyEnvPreset(preset)` |
| `toggleGround` | (none) | 无参 toggle | `setEnvState({ groundVisible: !current })` |
| `loadModel` | `name: entity` | 模糊搜索→库匹配→`onModelRowClick` | `loadLibraryModel(name)` |
| `loadMotion` | `name: entity` | 模糊搜索 VMD→`replaceMotion` | `loadLibraryMotion(name)` |
| `setPerformance` | `mode: enum` | `quality/balanced/performance`（同义词：high→quality, low→performance） | `setPerformanceMode(mode)` |

---

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-20 | 初版 |
| 2026-07-28 | 重写：对齐 ADR-196，追加命名约定/ARIA/E2E 规格 |
| 2026-07-28 | 终版：对齐 Phase 1–5 实现完成态，更新动作清单、实施记录、8 动作表 |
