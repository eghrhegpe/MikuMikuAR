# ADR-205: AI 工具体系全景 — 从写操作到读写闭环

- **状态**: ✅ 已完成（Phase 1+2 全部落地，2026-07-30）
- **日期**: 2026-07-29
- **相关**: ADR-155（NL 控场景，动作注册表消费者）、ADR-196（内置 AI 诊断助手，诊断 prompt 注入源）、ADR-197（统一动作注册表，动作定义规范）、ADR-203（AI 助手会话持久化，面板载体）、ADR-191（禁止神桶，模块导入规则）

---

## 背景

ADR-196 + ADR-197 + ADR-155 三阶段演进后，AI 助手已具备 41 个 tool_call 工具，覆盖灯光/相机/环境/动作/设置/场景/模型库 7 个域。但所有工具均为**写操作**（mutate 场景），LLM 无法主动查询前端状态、后端日志、错误记录——只能在 diagnostic 模式被动接收 system prompt 注入的静态快照。用户需要手动填写报错信息，体验断裂。

**核心矛盾**：LLM 能「做」但不能「看」，读写能力不对称。

---

## 现有工具清单（41 个写操作）

| 域 | 数量 | 动作 ID 范围 | 功能概述 |
|----|------|-------------|---------|
| **控制** | 8 | `ai:control:setLightIntensity` … `ai:control:setPerformance` | 灯光强度/颜色、相机模式、环境预设、地面开关、模型加载、动作加载、性能模式 |
| **设置** | 13 | `settings:set:clearextractcache` … `settings:set-lang` | 清缓存、语言切换等系统设置 |
| **场景** | 4 | `screenshot:current/batch`、`scene:save/undo` | 截图、场景保存/撤销 |
| **动作** | 19 | `lipsync:toggle`、`motion:model:pause/reset/…` | 唇同步、动作播放控制、姿态重置 |
| **环境** | 3 | `env:bind-particle-texture` … `env:bind-stars-texture` | 粒子/天空/星空纹理绑定 |
| **模型库** | 3 | `library:rescan`、`library:import-file`、`library:set-formation` | 资源扫描、导入、队形编排 |

**所有工具共性**：
- 均通过 `executeActionById()` 执行，返回 `ActionResult = { success: boolean; message: string }`
- 均需用户在 pending 卡确认后执行（控制模式）
- 均为场景侧 mutation，不涉及后端查询

---

## 缺失能力分析

### 1. 后端状态不可见

| 缺失 | 影响 |
|------|------|
| Go `slog` 日志仅写 stdout | LLM 看不到 HTTP 请求耗时、连接错误、API 调用失败详情 |
| 无 Wails binding 暴露后端状态 | LLM 无法查询 LLM 连接配置、API key 有效性、模型列表缓存 |
| 用户需手动复制报错信息 | 诊断效率低，上下文易丢失 |

### 2. 前端状态不可查

| 缺失 | 影响 |
|------|------|
| `ErrorRingBuffer` 仅在 diagnostic 模式静态注入 | chat/control 模式下 LLM 无法主动查询错误 |
| `captureSceneSnapshot()` 仅在 diagnostic 模式调用 | LLM 无法按需获取 FPS/模型数/材质数等运行时指标 |
| 无 read-only tool 注册 | LLM 无法主动「问」，只能被动「听」 |

### 3. 单向交互瓶颈

```
用户报错 → 手动填信息 → LLM 诊断 → 给建议 → 用户手动执行
                    ↑                              ↓
              （断裂点：LLM 不能自己查）      （LLM 不能自己做——需用户确认）
```

---

## 规划方案：读写闭环

### 阶段 1：只读诊断工具（前端侧）✅ 已完成

在 `action-registry` 注册 `readonly: true` 的只读工具，自动执行（跳过 pending 卡）。

| 工具 ID | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `diagnostic:getSceneSnapshot` | 无 | 文本快照（FPS/模型数/等） | 复用 `captureSceneSnapshot()` |
| `diagnostic:getFrontendErrors` | 无 | 文本格式错误摘要 | 复用 `toDiagnosticContext()` |
| `diagnostic:getFrontendState` | 无 | — | **🟡 延后实施**；当前与 getSceneSnapshot 部分重叠 |

**实现细节**：
- `ActionDef` 已新增 `readonly?: boolean` 字段（`action-registry.ts`）
- `action-executor.ts` 检测 `readonly` → 直接执行，不进 pending 队列；返回值 `data` 填入 `ActionResult.data`
- `ActionResult` 已扩展为 `{ success, message, data?: unknown }`
- `action-catalog.ts` 的 `buildToolSchemas()` 为 readonly 工具生成只读 description
- 注册文件：`action-defs/diagnostic-actions.ts`，在 `registerAllActions()` 中调用
- `settings-diagnostic.ts` tool_call 处理分支：检测 `getAction(tc.name)?.readonly` → 自动执行并追加 tool 消息，不走 pending 卡
- **system prompt 不再预注入错误/快照上下文**：统一模式（见 ADR-196 Phase 2）下 LLM 按需通过 tool_call 获取诊断信息

### 阶段 2：后端状态绑定（Go 侧）

| 组件 | 说明 |
|------|------|
| `LogRing` | Go 侧环形缓冲（容量 200），存储最近 200 条 slog 记录 |
| `SlogRingHandler` | 自定义 slog handler，写入 LogRing + 原 stderr 双写 |
| `AiGetBackendLogs` binding | 返回最近 N 条日志（按 level 过滤） |
| `AiGetBackendState` binding | 返回 `{ llmConnected, llmProvider, model, apiEndpoint, configValid }` |

注册为前端 readonly 工具：

| 工具 ID | 参数 | 返回 |
|---------|------|------|
| `diagnostic:getBackendLogs` | `{ level?: 'info'\|'warn'\|'error', limit?: number }` | `Array<{ time, level, msg, attrs? }>` |
| `diagnostic:getBackendState` | 无 | `{ llmConnected, llmProvider, model, apiEndpoint, configValid }` |

### 阶段 3：闭环交互模式

```
用户："为什么场景卡了？"
  → LLM 调 diagnostic:getSceneSnapshot → 发现 FPS=12
  → LLM 调 diagnostic:getFrontendErrors → 发现 Texture load timeout ×3
  → LLM 调 diagnostic:getBackendLogs → 发现 KTX2 decompress failed
  → LLM 自动诊断："纹理加载超时导致，建议降低纹理质量或预加载"
  → 用户确认 → LLM 调 ai:control:setPerformance(mode:"balanced")
```

**UX 变化**：
- 统一模式下，readonly 工具自动执行，用户无需确认
- 工具结果以 tool 消息回填到对话历史，LLM 可引用结果继续推理
- system prompt 预注入消除（ADR-196 Phase 2 模式合并）：统一 mode 下不再预填错误/快照上下文，LLM 按需通过 readonly tool 查询——减少首轮 token 消耗，且诊断信息始终最新

---

## ActionDef 扩展契约

```typescript
interface ActionDef {
  id: string;
  label: string;          // i18n key
  domain: string;
  icon: string;
  params: ParamDef[];
  execute: (params) => Promise<ActionResult>;
  destructive?: boolean;
  readonly?: boolean;     // 新增：true 时自动执行，不进 pending
}

interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;         // 新增：readonly 工具返回结构化数据
}
```

---

## 影响范围

| 文件 | 变更 | 状态 |
|------|------|------|
| `core/action-registry.ts` | ActionDef 加 `readonly` 字段 | ✅ 已完成 |
| `core/action-executor.ts` | 检测 `readonly` → 跳过 pending | ✅ 已完成 |
| `core/ai/action-catalog.ts` | readonly 工具 prompt 标记 | ✅ 已完成 |
| `core/ai/types.ts` | ActionResult 加 `data` | ✅ 已完成 |
| `menus/settings-diagnostic.ts` | readonly 结果自动执行 + tool 消息回填 | ✅ 已完成 |
| `core/action-defs/diagnostic-actions.ts` | 新建，注册 2 个 readonly 工具 | ✅ 已完成 |
| `core/action-registry-defs.ts` | 导入 `registerDiagnosticActions` | ✅ 已完成 |
| `internal/app/ai_binding.go` | 新增 AiGetBackendLogs / AiGetBackendState | ✅ 已完成（log_ring.go 实现） |
| `internal/app/llm/client.go` | 日志双写到 LogRing | ✅ 已完成（slog → DualWriter → LogRing，app.go:161） |
| `core/action-defs/diagnostic-actions.ts` | getBackendLogs / getBackendState 工具 | ✅ 已完成 |
| `diagnostic:getFrontendState` | 聚合 envState + sceneState | 🟡 延后 |

---

## 假设与边界

- 假设 LogRing 容量 200 条足够覆盖典型诊断窗口（~10 分钟操作日志）
- readonly 工具不走 pending 确认——用户显式信任 LLM 读取状态（不修改任何东西）
- 后端 LogRing 不落盘，重启清空——诊断是实时场景，不需要历史回溯
- 不影响现有 41 个写操作工具的行为

---

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-29 | 初版：基于 ADR-196/197/155 现状分析 + 用户反馈，规划读写闭环 |
| 2026-07-29 | Phase 1 实施完成：`readonly` 字段 + `ActionResult.data` + 2 个前端诊断工具注册 + `settings-diagnostic.ts` readonly 自动执行；同步 ADR-196 Phase 2 模式合并消除 system prompt 预注入 |
| 2026-07-29 | Phase 2 实施完成：Go 后端 `AiGetBackendLogs` / `AiGetBackendState` 已实现（log_ring.go:124-152）；`slog` 经 `DualWriter` 双写到 LogRing（app.go:161）；TS 侧 `diagnostic:getBackendLogs` / `diagnostic:getBackendState` 注册（diagnostic-actions.ts:54-88）；Wails 绑定已生成；契约测试 17/17 通过 |
