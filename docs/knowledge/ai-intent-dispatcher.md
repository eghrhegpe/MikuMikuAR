---
tier: architecture
kind: ai_intent_dispatcher
name: NL 意图解析 — LLM 文本 → 动作执行
category: core
scope:
  - frontend/src/core/ai/intent-dispatcher.ts
source_files:
  - frontend/src/core/ai/intent-dispatcher.ts
adr:
  - ADR-155
  - ADR-197
symbols:
  - ActionResult
  - executeAction
  - parseActionFromLLM
invariants:
  - parseActionFromLLM 三级回退提取 JSON（整文本→```json 代码块→正则匹配含 action+params 的对象），全失败返回 null
  - action 缺失 CONTROL_NAMESPACE（ai:control:）前缀时自动补齐；params 缺省为空对象
  - executeAction 委托 action-executor.executeActionById，本模块不直接触碰 action-registry
tests: []
use_when:
  - 自然语言控场
  - NL 意图解析
  - LLM 动作解析
  - 意图分发
  - intent dispatcher
---

# NL 意图解析 — LLM 文本 → 动作执行

## 系统概览
ADR-155 自然语言控场管线的解析层：把 LLM 的自由文本响应解析为 `{ action, params }`，再委托统一动作注册表（ADR-197）执行。三级回退提取策略容忍 LLM 用代码块或前后缀文本包裹 JSON。

## 核心职责
- `intent-dispatcher.ts` — `parseActionFromLLM()`（容错 JSON 提取 + `ai:control:` 命名空间归一）+ `executeAction()`（转发到 action-executor）

## 对外 API（节选）
- `parseActionFromLLM(text)` — 返回 `{ action, params } | null`
- `executeAction(actionId, rawParams)` — 返回 `ActionResult`（重导出自 action-executor）

## 与其他子系统关系
- 上行：NL 控场面板/管线拿到 LLM 响应后调 `parseActionFromLLM` → `executeAction`
- 下行：`action-executor.executeActionById` 执行；动作定义见 [action-registry.md](./action-registry.md)

## 不变量
- parseActionFromLLM 三级回退提取 JSON（整文本→```json 代码块→正则匹配含 action+params 的对象），全失败返回 null
- action 缺失 CONTROL_NAMESPACE（ai:control:）前缀时自动补齐；params 缺省为空对象
- executeAction 委托 action-executor.executeActionById，本模块不直接触碰 action-registry

## 验证入口
- 决策见 ADR-155；暂无专门单测（纯解析函数 `parseActionFromLLM` 为后续补测优先项）
