# round18-prune-history — 审核结果

**审核范围：**
- 测试文件：`frontend/src/__tests__/prune-history.test.ts`（216 行，20 个用例）
- 被测源码：`frontend/src/menus/diagnostic-chat.ts` 的 `pruneHistory` 函数（行 319–348，历史截断）
- 关联模块：`frontend/src/core/ai/types.ts`（`ChatMessage` 联合类型，行 29–33）、`frontend/src/menus/settings-diagnostic.ts:133`（唯一生产调用点）、`frontend/src/menus/diagnostic-state.ts:23`（`messages` 状态源）
- 决策依据：ADR-196（Phase 1「历史截断：只保留最近 10 轮」）、ADR-199（P2 归档「`_pruneHistory` 固定 10 轮——无 token 预算感知」）

**总体结论：✅ 通过**（无 P1/P2 风险；测试 20/20 通过，`tsc --noEmit` 无新增错误）

---

## 亮点

- **裁剪预算防御完备**（`diagnostic-chat.ts:321`）：`Math.max(0, Math.trunc(maxPairs) || 0)` 一行同时消化负值、NaN、非整数、±0 四种畸形入参，杜绝 `slice(NaN)` 意外全量保留——测试 132–147 行对负值/NaN/非整数逐一断言。
- **工具链配对前移算法正确**（`diagnostic-chat.ts:331–340`）：从预算起点向前扫描，`tool` 强制前移、`assistant(tool_calls)` 前方紧邻 `tool` 时一并纳入，保证 assistant↔tool 配对链完整、结果不以孤立 tool 开头；配合 344–346 行的开头孤立 tool 防御循环兜底畸形输入。逻辑经手推演（多 tool 并行、超长工具链、裁剪点落在链中段、tool 开头畸形输入）与测试断言全部一致。
- **纯函数、无副作用**（`diagnostic-chat.ts:319–348`）：只读入参、返回新数组，不 mutate 消息对象、不触碰 `diagState`；`settings-diagnostic.ts:133` 发送时快照式裁剪，UI 保留完整历史，状态流清晰。测试 169–179 行专门验证「不改原数组 + 裁剪时返回新引用」。
- **system 语义明确**：仅 `messages[0]` 为 system 时保留（行 322），非首位的 system 按普通消息处理（测试 157 行覆盖），与调用方 `[systemMessage, ...diagState.messages]` 的前置构建约定一致。
- **测试断言强度高**：role 序列 `toEqual` 数组、`pruned[0]` 具体元素比对、精确 length 断言，非「仅验证长度」的弱断言；构造辅助 `msg()` 按 role 判别产出与真实 `ChatMessage` 联合类型一致的结构。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `diagnostic-chat.ts` | 319–348 | 固定 10 轮裁剪，无 token 预算感知：长对话可能超小模型 context window（Ollama 默认约 2048 token），端点侧静默截断且前端无感知。**注：ADR-199（📋 归档登记）已登记此项为 P2 已知局限，非新发现** | 按 ADR-199 缓解方向跟进：改按 token 预算裁剪，或读取模型 context 上限自适应；动工前建议另立 Phase/子 ADR |
| 🟡 P3 | `diagnostic-chat.ts` | 319 | `maxPairs = 10` 硬编码默认参数，未提取命名常量（有 ADR-196「10 轮」决策背书，但实现层无常量、注释仅「历史截断」四字） | 提取命名常量（如 `DEFAULT_MAX_PAIRS = 10`）并附 ADR-196 引用；JSDoc 补充 maxPairs 语义（对数、system 不计入、配对前移规则） |
| 🟢 P4 | `__tests__/prune-history.test.ts` | 8, 17, 19 | `msg()` 辅助 3 处 `as ChatMessage`：tool/assistant 分支类型已完全匹配、断言多余；默认分支的 as 会掩盖「user.content 可为 null」的非法构造（类型演变时测试仍能编译通过） | tool/assistant 分支去掉 as；默认分支改用显式构造或 `satisfies` 校验，避免掩盖类型漂移 |
| 🟢 P4 | `__tests__/prune-history.test.ts` | 22–216 | 罕见畸形场景未覆盖：`maxPairs=Infinity`、全 tool 输入（防御循环丢至空）、`content` 为空的 user 消息、`assistant(tool_calls)` 缺 tool 结果、数组含 `undefined` 元素 | 可按需补充 2–3 个畸形输入用例，固化防御循环行为 |
| 🟢 P4 | `diagnostic-chat.ts` | 319–348 | tool 消息计入 `pairs*2` 条数预算，与 ADR-196「20 条 user+assistant」的描述存在细节偏差（含工具链时实际保留轮数更少）——行为合理（配对完整优先）但文档与实现口径不一致 | 在 ADR-196 或知识卡补充「tool 消息占用预算」的准确口径，避免后续接手者误判为 bug |
| 🟢 P4 | `settings-diagnostic.ts` | 133 | `pruneHistory` 返回数组与 `diagState.messages` 共享消息对象引用；当前下游仅只读序列化，无实际风险 | 若未来下游出现写操作，先浅拷贝消息对象再传递 |

---

## 测试质量评价

- **覆盖度优秀（20/20 通过，`vitest run` 55ms）**：边界（空数组/单条/恰好等于限制/超限）、防御（maxPairs 负值/NaN/非整数/0）、结构完整性（system 保留、tool+assistant 成对、多 tool 并行、裁剪点落在工具链中段、超长工具链整链保留、孤立 tool 开头）、纯函数性（不改原数组、返回新引用）均已覆盖，与生产实现逐条对应。
- **无跳过测试**：无 `it.skip`/`describe.skip`/`test.todo`。
- **环境声明合理**：`// @vitest-environment node`（行 1）——纯函数测试不依赖 DOM，避开 jsdom 开销且无 `window` 污染风险（符合 ADR-219 测试卫生铁律）。
- **ChatMessage 构造与真实类型一致**：`msg()` 的 tool 分支含 `tool_call_id`、assistant 分支含 `tool_calls: ToolCall[]`（`type: 'function'` + `function.name/arguments`），与 `core/ai/types.ts:29–33` 联合类型逐字段吻合；仅 `as` 断言语用瑕疵（见风险表 P4）。
- **验证结果**：`npm run test -- src/__tests__/prune-history.test.ts` → 20 passed（1 file）；`npm run check`（tsc --noEmit）无新增错误。

---

审核日期：2026-08-15
审核员：子代理 round18-prune-history
