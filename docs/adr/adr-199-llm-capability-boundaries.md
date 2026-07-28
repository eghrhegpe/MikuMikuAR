# ADR-199: LLM 能力边界与缓解策略（归档）

> **状态**: 📋 归档登记（缺陷与缓解方向盘点，未强制排期）
> **日期**: 2026-07-28
> **相关**: ADR-196（AiService 传输层）、ADR-155（NL 控场景）、ADR-156（台词生成）、ADR-197（动作注册表）、`docs/ai-new/ai-news-2026-07-27.md`（安全护栏情报）

---

## 背景

LLM 战线（ADR-154/155/156/196/197）已落地：传输层双适配器 + SSE 流式 + tool_calls + 41 动作注册表 + 台词生成。经一轮代码盘问，**传输层工程质量过硬**（AbortSignal 转发、超时清理、tool_call 聚合、CORS 友好提示均规范）。

但真正的瓶颈**不在架构，在 LLM 模型本身**——它们是模型这个组件的物理属性，改架构消不掉，只能「让约束显性化」。本 ADR 客观登记 7 条瓶颈及缓解方向，作为后续接手 LLM 功能的决策真相源，避免误把「模型的锅」当「代码 bug」排查。

> 本 ADR 为**盘点归档**，不强制排期；各条缓解按需求驱动，动工时另立 Phase 或子 ADR。

---

## 瓶颈清单（按严重度）

### 🔴 P1 — 模型能力决定功能天花板（架构无法根治）

**1. 控制模式强依赖 tool_calls / 稳定 JSON —— 弱模型直接失效**

意图解析双轨（`sse.ts` `finish_reason='tool_calls'` 优选 + `intent-dispatcher.ts` `parseActionFromLLM` 文本抠 JSON 回退）。而默认零 key 路径推本地 Ollama 小模型（`browser-adapter.ts` 明写「小模型零成本」）：
- 7B 以下小模型大概率不支持 function_calling，或极不稳定 → 走不了优选轨；
- 回退轨要求结构严整 JSON，小模型常吐 markdown 解释 / 参数名幻觉 / schema 漂移 → 三级正则也抠不出 → 用户见「不支持的操作」。

这是模型能力硬伤，非代码缺陷。**缓解**：面板明确提示「控制模式建议用支持 function-calling 的模型（GPT-4o-mini / DeepSeek / Qwen2.5+）」，避免放任小模型踩坑。

**2. 参数幻觉无 schema 校验兜底**

`intent-dispatcher.ts` 直接 `parsed.params ?? {}` 透传 `executeActionById`。`param-adapters` 能救 enum 同义词 / range clamp，但**参数名错位**（如 `dirIntensity` 幻觉为 `intensity`）救不了。**缓解**：执行前按 action 的 JSON Schema 校验参数名/类型，非法则回退提示而非静默执行。

### 🟠 P2 — 工程约束在真实用量下绊倒

**3. 30s 硬超时对慢模型/长回复偏紧**

`browser-adapter.ts` 写死 `setTimeout(ac.abort(), 30000)`。本地 Ollama 冷启动加载模型（10–60s）或大 context 长回复会被中途掐断。**缓解**：超时可配；或首 token 与总时长分别计时（首 token 慢=冷启动，容忍更长）。

**4. `_pruneHistory` 固定 10 轮 —— 无 token 预算感知**

历史裁剪按「轮数」而非「token 数」。长对话可能超小模型 context window（Ollama 默认约 2048 token），端点侧静默截断或报错，前端无感知。**缓解**：改按 token 预算裁剪；或读取模型 context 上限做自适应。

**5. go-adapter 事件流无背压 + 依赖全局事件**

`go-adapter.ts` 用全局 `events.on('ai:chunk')` 灌 `queue[]`，无上限；模型狂吐 + 渲染慢时 queue 无限涨。且并发双流时全局事件会串扰（当前 UI 已防并发，属隐式耦合）。**缓解**：queue 设上限 + 背压；或流带 streamId 隔离。

### 🟡 P3 — 体验瓶颈

**6. tool_call 与 text 混流丢文本**：`sse.ts` 遇 `finish_reason='tool_calls'` 即 `return`。若模型「边说话边调工具」，已 yield 的文本在控制模式被忽略。**缓解**：控制模式保留 tool_call 前的文本作为「AI 说明」展示。

**7. 无 token / 成本可见性**：远程 API 按 token 计费，面板无 usage 显示。**缓解**：解析响应 `usage` 字段，面板展示本次 token / 累计。

---

## 核心判断

| 层 | 结论 |
|----|------|
| 传输层（sse / adapter / tool_call 聚合） | ✅ 工程过硬，非瓶颈来源 |
| **模型能力**（P1-1/2） | 🔴 结构性矛盾：零成本本地小模型 ↔ 需 function-calling/稳定 JSON |
| **context window**（P2-4） | 🟠 轮数裁剪 vs token 预算错配 |
| **超时刚性**（P2-3） | 🟠 30s 对本地慢模型偏紧 |

没有一条能靠改架构消除——它们是 LLM 组件的物理属性。可做的是**让约束显性化**：模型能力分级提示、token 预算感知裁剪、可配超时。

## 推荐优先级（若动工）

1. **P1-1 模型能力提示**（最低成本、最高收益）——面板加一句分级建议，避免用户用小模型踩「不支持」的坑。
2. **P2-3 可配超时**——小改动，解本地 Ollama 冷启动被掐断。
3. **P2-4 token 预算裁剪 / P1-2 参数校验**——中等工程，随控制模式深化再做。

## 修订记录

| 日期 | 修订 |
|------|------|
| 2026-07-28 | 初版：盘点 7 条 LLM 瓶颈 + 缓解方向，纯归档 |
