# 审核报告：config-store 持久化路径（save/load/merge/cache 语义）

**审核范围：**
- 测试文件：`frontend/src/core/__tests__/config-store.test.ts`（118 行，9 用例）
- 被测源码：`frontend/src/core/ai/config-store.ts` 的**持久化路径**：
  - `loadAiConfig`（95–101）、`saveAiConfig`（120–135）、`ensureAiConfigLoaded`（138–143）、`_hydrate`（169–189）、`migrateAiConfig`（152–167）、`normalizeEndpoint`（105–115）、`normalizeTimeout`（146–149，属 migrate/load 迁移路径）、常量与 `DEFAULT_AI_CONFIG`（22–87）
  - 关联核实：`backend/idb.ts`（62–82）、`browser-adapter.ts:29-59`（缓存返回值消费方）、`diagnostic-config.ts:228-256`（save 消费者）、`diagnostic-state.ts:48`、`vitest.config.ts`、`setup-wails.ts:81-95`、`docs/knowledge/ai-config-store.md`
- **与 round-19 边界**：round-19（`2026-08-15-round19-settings-diagnostic.md`）审 `validateAiConfig`（config-store.ts:192–210）+ `goKeyAllowsProceed` 联合路径，并顺带点名了 `_hydrate` 的 cacheSentinel（其报告 19 行）。本轮只审**持久化/缓存/合并/迁移**路径，与 round-19 的校验函数**零重叠**；round-19 报告引用的 `config-store.test.ts:151-171`（normalizeTimeout 覆盖）实指 `core/ai/__tests__/config-store.test.ts`（208 行文件），本轮文件与之存在 normalizeTimeout 纯函数重复用例（见 P3-1）。

**总体结论：⚠️ 有条件通过**

测试 9/9 绿（`npm run test -- src/core/__tests__/config-store.test.ts`，153ms，Vitest 4.1.9）。被测的缓存+回源+合并+迁移核心路径设计扎实：cacheSentinel 哨兵对 hydrate/保存交错全场景安全，同步读+异步回源正确履行 ADR-196 的同步 `capabilities()` 契约，异常路径（idb 失败回退、save rethrow 被消费者接住）闭环。无 P1/P2。4 条 P3：merge 核心语义与竞态/save 失败分支缺显式测试、migrate 未防御 endpoint 非字符串、normalizeTimeout 双文件重复。`npm run check`（tsc 全量）未跑——单文件测试已验证，按任务约定跳过并在本报告注明。

---

## 亮点

- **cacheSentinel 哨兵彻底解决 hydrate/保存竞态**（config-store.ts:172–177）：`_hydrate` 在 `await idbGet` 前快照 `_cache` 引用，await 返回后若 `_cache` 已被 `saveAiConfig` 等修改则放弃本次回源结果。推演全部交错：① 单 hydrate + save 交错（save 先改 `_cache` → hydrate 放弃）② 双 hydrate 并发（先完成者写 `_cache` 非 null，后完成者哨兵失效放弃）③ hydrate 结果为默认值时同逻辑——无覆盖窗口，且 JS 单线程保证「await 返回→哨兵检查」原子。
- **同步读 + 异步回源严格履行 ADR-196 契约**（config-store.ts:3、95–101）：`capabilities()` 是同步签名，`loadAiConfig` 未加载时回退 `DEFAULT_AI_CONFIG` 并 `void _hydrate()` 触发后台回源，不阻塞调用方；`ensureAiConfigLoaded`（138–143）提供主动预加载消除回退窗口，`_cache` 命中直接短路。
- **save 先内存后落盘 + 失败可观测**（117–135）：同步写 `_cache`（即时生效）再 `await idbSet`；失败 DEV warn + **rethrow**，注释明确「调用方可选 await 捕获或忽略」。消费者闭环验证：`diagnostic-config.ts:230-256` 的 saveChain 串行化 + catch 吞错恢复 + rethrow 供 UI 反馈，与模块契约一致。
- **迁移一次完成、零魔法数值**（152–167）：`migrateAiConfig` 基于 `DEFAULT_AI_CONFIG` spread 补缺省 → 无/非法 provider 按 endpoint 推断 → `normalizeTimeout` 归一（MIN=5000 / MAX=300000 / DEFAULT=30000 命名常量，146–149 对 `unknown` 用 `typeof + Number.isFinite` 防御，覆盖 undefined/'abc'/NaN/Infinity）。
- **测试隔离手法正确**：`@vitest-environment node` 分流（vitest.config.ts:38-44 建议）+ `vi.resetModules()` + 动态 import 重置模块级 `_cache`，时序断言对 microtask 顺序不敏感（test 1 无论 hydrate 先/后完成结果一致，哨兵保证）；idb 失败回退用例（56–64）有效验证「静默回退默认、不抛错」。
- **类型安全达标**：config-store.ts 全文件 grep `as any`/`@ts-ignore`/`@ts-expect-error` 零命中；`as AiConfigProvider[]`（155）为合法收窄断言。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | `core/ai/config-store.ts` | 120–135 + 152–167 | **migrate/save 未防御 endpoint 非字符串**：`saveAiConfig({endpoint: null})`（strict:false 下 TS 不拦截）→ `if (merged.endpoint)` falsy 跳过归一 → `_cache.endpoint=null` 落盘；下次 hydrate 经 migrate 后 `_cache.endpoint` 保持 null（migrate 仅当进入 provider 推断分支才 `base.endpoint.includes` 抛 TypeError），`loadAiConfig()` 返回 endpoint=null → `browser-adapter.ts:31` `cfg.endpoint.trim()` 与 `validateAiConfig`（round-19 范围）直接 TypeError 崩。属持久化层「脏数据入缓存」缺口，round-19 未覆盖（其 P3 是 provider 未知，非 endpoint 类型）。 | migrate/save 对 endpoint 加 `typeof !== 'string'` 防御（非字符串回落 DEFAULT_AI_CONFIG.endpoint），或 `normalizeEndpoint` 入口防御非字符串；补一条「endpoint: null 回源」回归用例。 |
| 🟡 P3 | `core/__tests__/config-store.test.ts` | 18–38 | **merge 核心语义未真正验证**：test 1 是「空缓存 + 全量 partial」（endpoint/apiKey/model 三字段），未覆盖「已有缓存 + 部分字段 partial」——即 `{..._cache, ...partial}` 保留旧字段的合并行为；`idbSet` 调用断言仅验证落盘形状，未验证缓存合并。 | 补用例：先 `saveAiConfig({model:'a'})` 再 `saveAiConfig({apiKey:'k'})`，断言 `loadAiConfig()` 同时含 'a' 与 'k'（merge 保留语义）。 |
| 🟡 P3 | `core/__tests__/config-store.test.ts` | 18–64 | **save 失败分支与 hydrate 竞态无显式测试**：`saveAiConfig` 的 rethrow 契约（126–133）、cacheSentinel 生效路径（175–178）均未被直接构造——test 1 的竞态是「顺带覆盖」而非「主动验证」。 | ① `vi.mocked(idbSet).mockRejectedValue(...)` 断言 save 抛错且内存缓存已更新；② 手动控制 `idbGet` promise 时序（先 save 后 resolve），断言 hydrate 不覆盖新缓存。 |
| 🟡 P3 | `core/__tests__/config-store.test.ts` | 67–117 vs `core/ai/__tests__/config-store.test.ts:151-171` | **normalizeTimeout 纯函数用例双文件重复**：本轮文件 69–90（合法值/clamp 上下限/非法回落）与 208 行文件的 151–171 断言级重复（差异仅 60000 合法值 vs null/Infinity），与 AGENTS.md「双份测试删 8 文件」清理精神相悖；归一逻辑改动需双文件同步，易漂移。 | 纯函数归一收敛到单文件；本轮文件保留带迁移路径的两个用例（92–117，属持久化范围），删重复的 69–90 或改引共享断言。 |
| 🟢 P4 | `core/__tests__/config-store.test.ts` | 40–54 | `ensureAiConfigLoaded` 迁移用例只断言 endpoint/apiKey/model，未断言 migrate 同时补的 `timeoutMs`（30s）与 `relayUrl`（默认 relay）——补缺省覆盖不全。 | 补 `cfg.timeoutMs`/`cfg.relayUrl` 断言（migrate 152–167 的 spread 补缺省语义）。 |
| 🟢 P4 | `core/ai/config-store.ts` | 95–101、120–135 | `loadAiConfig`/`saveAiConfig` 返回 `_cache` 与 `DEFAULT_AI_CONFIG` 的**共享可变引用**：外部就地 mutate 会绕过 saveAiConfig 造成内存/磁盘不一致（幽灵路径）。已核实当前全部消费者安全——`diagnostic-config.ts:76`、`diagnostic-state.ts:48` 均 `{...loadAiConfig()}` spread 拷贝，`browser-adapter.ts` 只读字段。 | 防御性建议：返回浅拷贝，或注释声明「返回值只读视图，修改须走 saveAiConfig」。 |
| 🟢 P4 | `core/ai/config-store.ts` | 110、114、159 | `'/chat/completions'` 魔法字符串 3 处（normalizeEndpoint 判断/拼接 + migrate replace），拼写漂移会静默破坏端点归一。 | 提取命名常量（如 `CHAT_COMPLETIONS_SUFFIX`）。 |
| 🟢 P4 | `core/__tests__/config-store.test.ts` | 6–9 | 内联 idb mock（仅 2 导出）未复用 `makeIdbMock` 共享工厂；`setup-wails.ts:90-91` 注释明确允许 config-store 例外（spy 断言需要），且 config-store 仅 import idbGet/idbSet，形状足够，隔离风险低。 | 维持现状即可；若未来补更多导出使用，改走 `makeIdbMock` 保持形状超集一致。 |

---

## 测试质量评价

- **断言有效性**：✅ 有效。`toHaveBeenCalledWith('config','ai',saved)`（37 行）验证了 store/key/对象形状三段契约；`toEqual(DEFAULT_AI_CONFIG)`（25、63）验证回退默认；`toBe(DEFAULT_TIMEOUT_MS)`/`toBe(MIN_TIMEOUT_MS)`（102、116）验证迁移归一——迁移用例通过「hydrate → loadAiConfig」真实走通 migrate 而非直接调函数，断言直指持久化语义。**但** merge 保留语义（见 P3-2）与 save 失败 rethrow（见 P3-3）两大契约缺口。
- **mock 合理性**：✅ 合理。文件级 `vi.mock('../backend/idb')` 覆盖 setup 全局 mock（setup-wails.ts:92-95），工厂只引用 hoisted 绑定（无 TDZ 违规）；`vi.resetModules()` + 动态 import 正确隔离模块级 `_cache` 状态，每用例重新播种 `mockResolvedValue/mockRejectedValue`；默认实现 `Promise.resolve(undefined)` 与 208 行文件的 `async () => null` 形状差异（undefined vs null）均被 migrate/DEFAULT 兜底，无行为分歧。`@vitest-environment node` 分流合理（无 DOM 依赖）。
- **边界覆盖**：首次加载回退默认 ✅（25 行）、已有缓存命中 ✅（36 行）、idb 回源+补缺省 ✅（49–53）、idb 失败静默回退 ✅（62–63）、旧配置迁移（无 timeoutMs/非法 timeoutMs）✅（92–117）、normalizeTimeout 全分支 ✅（69–90）。缺口：merge 部分覆盖、save 失败 rethrow、hydrate 竞态显式构造（P3-2/3）、migrate provider 推断分支（stored.provider 非法，152–163，测试仅走 DEFAULT provider 合法路径）、endpoint 非字符串防御（P3-1）。
- **跳过测试**：无（全文件无 `it.skip`/`describe.skip`/`xit`）。
- **与 round-19 的关系**：本文件测试的 `normalizeTimeout` 迁移路径（92–117）在 round-19 报告中以「config-store.test.ts:151-171 已全覆盖」引用——该引用实指 208 行文件，且其只测纯函数未测迁移；本文件的迁移用例是对 round-19 引用盲区的补齐，方向正确，但引入纯函数重复（P3-4）。

---

审核日期：2026-08-15
审核员：子代理 round20-config-store
