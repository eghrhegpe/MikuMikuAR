# 审核报告：settings-diagnostic 测试 + validateAiConfig/goKeyAllowsProceed 联合路径

**审核范围：**
- 测试文件：`frontend/src/__tests__/settings-diagnostic.test.ts`（47 行）
- 被测源码：`frontend/src/core/ai/config-store.ts` 的 `validateAiConfig`（192–210 行）；`frontend/src/core/ai/go-key-allows-proceed.ts`（整文件 24 行）
- 关联核实：`frontend/src/menus/diagnostic-config.ts`（26–41 行）、`frontend/src/menus/settings-diagnostic.ts`（56、309–317 行）、`frontend/src/core/ai/types.ts`、`docs/knowledge/diagnostic-config.md`、`docs/function-map.md`

**总体结论：⚠️ 有条件通过**

测试 5/5 绿（`vitest run src/__tests__/settings-diagnostic.test.ts`，25ms），`npm run check`（tsc + i18n）全绿。被测的两个核心函数本身是干净纯函数。但存在一个必须处理的 P1：本测试自称"集成测试"，实际被测的联合路径（core 版 3 参 `goKeyAllowsProceed`）在**生产代码中不存在**——生产放行门用的是 `menus/diagnostic-config.ts:26` 的同名本地单参实现，且两版判定语义分歧。测试对真实集成路径提供了虚假覆盖信心。

---

## 亮点

- **全量错误收集、一次返回**：`validateAiConfig` 收集所有错误后再统一返回 `{ok, kind, message, errors}`（config-store.ts:194–209），`kind` 取首错、`errors` 全量，调用方可同时做"判断"与"展示"，结构清晰。
- **纯函数 + undefined 防御**：`goKeyAllowsProceed` 零副作用，`validation.errors?.filter(...) ?? []`（go-key-allows-proceed.ts:20）正确处理 `errors` 缺失的单错误结果（单测 74–78 行显式守护该路径）。
- **测试边界分工注释明确**：测试文件 16–19 行注释说明纯函数边界由 `core/ai/__tests__/go-key-allows-proceed.test.ts` 覆盖、本文件只做联合路径，意图清晰；VALID 基线常量 + spread 构造，断言直指放行语义（`toBe(true/false)`），无 mock、无跳过（无 `it.skip`/`xit`）。
- **并发哨兵模式**（同文件内顺带观察）：`_hydrate` 用 `cacheSentinel` 防止回源覆盖并发保存（config-store.ts:172–177），虽不在本测试范围，属良好实践。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | `frontend/src/__tests__/settings-diagnostic.test.ts` | 20（describe）+ 4（import） | **"integration" 名不副实**：文件定位为 settings-diagnostic 测试（知识卡 `docs/knowledge/diagnostic-config.md:28` 也登记为其测试），但全仓无任何测试 import `menus/settings-diagnostic.ts` / `menus/diagnostic-config.ts`。真实生产放行门（settings-diagnostic.ts:310，diagnostic-config.ts:150/383/804）调用的是 `menus/diagnostic-config.ts:26` 的**本地单参版** `goKeyAllowsProceed`（读 `diagState` 全局），而非被测的 `core/ai/go-key-allows-proceed.ts`（3 参纯函数）。core 版在生产**零消费者**（仅 2 个测试文件引用，见 function-map.md:104/2096 双登记）。被测联合路径在生产中不存在 → 虚假覆盖信心；真实放行门反而零测试。 | 二选一：① 将测试改为驱动 menus 版（mock `diagState`）覆盖真实集成点；② 明确重命名为 core/ai 联合路径测试并同步修正知识卡 tests 登记。推荐 ① + ② 合并：重命名 + 补真实集成用例。 |
| 🟠 P2 | `core/ai/go-key-allows-proceed.ts:11-23` vs `menus/diagnostic-config.ts:26-41` | 19–22 / 37 | **同名双实现且语义分歧**：core 版按 `errors` 数组过滤非 missingKey（严格，全部非 key 错误都拦）；生产版仅判 `validation.kind === 'missingKey'`（首错判定）。可达输入 `[missingKey, missingModel]`（endpoint 有值、key 与 model 皆空，validateAiConfig 压错顺序 endpoint→key→model 使 kind='missingKey'）下：core 版 `false`、生产版 `true` → Go 模式 + key 已配置时**放行空 model 请求**（sendMessage 路径不经过 ensureTestModel 自动补模型）。 | 收敛为单一实现：以严格版（errors 全量过滤）为准，生产版改为调用 core 版（`isGo`/`keyConfigured` 由调用方从 `diagState` 提取传入）；补 `[missingKey+missingModel]` 分歧回归用例。 |
| 🟡 P3 | `frontend/src/core/ai/config-store.ts` | 193、199 | `PROVIDER_PRESETS[config.provider]` 无防御：运行期传入未知 provider 时 `preset` 为 undefined，`preset.needsKey` 抛 TypeError。加载路径有 `migrateAiConfig` 兜底（154 行），但 `validateAiConfig` 是公开 API，任意 AiConfig 可入。 | 与 migrate 一致防御：`if (!preset) return { ok:false, kind:'unknown', ... }` 或并入 errors。 |
| 🟡 P3 | `core/ai/config-store.ts:207` + `menus/diagnostic-config.ts:37` | 207 / 37 | **首错排序耦合**：`kind = errors[0]`（压错顺序 endpoint→key→model 决定 kind），生产版隐含假设"kind==='missingKey' 即无其他错误"。一旦调整校验顺序，放行语义静默改变。 | 放行判定改为显式 errors 过滤（同 core 版），消除对压错顺序的隐式依赖。 |
| 🟡 P3 | `frontend/src/__tests__/settings-diagnostic.test.ts` | 36–46 | **与纯函数单测部分重复 + 联合路径覆盖缺口**：test4 的 missingEndpoint 断言与 `config-store.test.ts:73-78` 重复，test5 的 missingModel 与 `config-store.test.ts:67-71` 重复；联合路径仅 deepseek（needsKey=true），未覆盖 ollama（needsKey=false，Go/browser + 空 key → ok 放行）、custom provider、以及关键分歧场景 `[missingKey+missingModel]`。 | 精简重复断言；补 ollama/custom 联合用例与 `[missingKey+missingModel]` 回归用例（该用例本可提前暴露 P2 分歧）。 |
| 🟢 P4 | `core/ai/go-key-allows-proceed.ts` | 3、20 | 类型用途 import 用值导入语法（`ReturnType<typeof validateAiConfig>`），isolatedModules 下会被 elide，但未来启用 `verbatimModuleSyntax` 将变成运行时导入；`'missingKey'` 魔法字符串可引用 `AI_ERROR_KINDS`（types.ts:124）。 | 改 `import type`（或直接 `import type { AiValidationResult }`）；错误种类提取常量。 |
| 🟢 P4 | `core/ai/config-store.ts` | 197、200、203 | i18n message key 硬编码字符串（`ai.validation.missingEndpoint` 等 3 处），无编译期校验，拼写漂移静默丢翻译。 | 集中到 message 常量映射表。 |
| 🟢 P4 | `docs/knowledge/diagnostic-config.md` | 28 | tests 登记把 `settings-diagnostic.test.ts` 列为 diagnostic-config 的测试，与事实不符（该测试未 import diagnostic-config）。 | 修正知识卡 tests 字段（随 P1 处置一并落地）。 |

---

## 测试质量评价

- **断言有效性**：✅ 有效。`toBe(true/false)` 直接对应放行语义；test4 对 `kind` 的断言验证了首错排序（missingEndpoint 优先于 missingKey），与 config-store.test.ts:83-87 的顺序契约一致。
- **边界覆盖**：
  - provider 组合：仅 deepseek（needsKey=true）——缺 ollama（needsKey=false）联合路径与 custom（needsKey=true + 空端点）。
  - key 缺失/空/格式错：空串覆盖（`apiKey: ''`）；`undefined` 非合法类型（AiConfig 要求 string）无需覆盖；**格式错 key 不做校验**——validateAiConfig 只查非空，与单测层一致，合理。
  - timeoutMs 非法值：**非本模块职责**——validateAiConfig 不校验 timeoutMs，归一由 `normalizeTimeout` 在 load/save 路径处理，且 `config-store.test.ts:151-171` 已全覆盖（含 undefined/null/'abc'/Infinity/NaN），无需在本测试重复。
  - relayUrl 与 endpoint 互斥：**代码中不存在互斥关系**——relayUrl 仅浏览器适配器 CORS 转发用，与 endpoint 独立，validateAiConfig 不涉及，无需覆盖。
- **跳过测试**：无（全仓 grep 无 `it.skip`/`describe.skip`/`xit`）。
- **与纯函数单测重复度**：联合路径定位本身合理，但 test4/test5 与 `config-store.test.ts` 存在断言级重复（见 P3），可精简为"仅断言联合结果，不重复断言 kind"。
- **联合路径真伪（最大问题）**：本测试验证的是 `validateAiConfig → core 版 goKeyAllowsProceed` 的联合路径，而生产 settings-diagnostic 放行门走的是 `menus/diagnostic-config.ts` 本地版。**真实集成路径（含 diagState 状态耦合、单参签名、kind 判定语义）零覆盖**，与知识卡登记共同构成误导。处置优先级最高。

---

审核日期：2026-08-15
审核员：子代理 round19-settings-diagnostic
