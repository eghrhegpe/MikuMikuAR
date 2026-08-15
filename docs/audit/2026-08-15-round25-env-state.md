# 第 25 轮审核报告（测试 #1/3）— env-state 测试与 schema/默认值派生源码

> **审核日期**: 2026-08-15
> **审核员**: 子代理 round25-env-state（round-25 测试 1/3，只审分配目标）

## 审核范围

| 类型 | 文件 | 行号范围 |
|------|------|----------|
| 测试文件 | `frontend/src/__tests__/env-state.test.ts` | 1–331（33 用例，8 个 describe） |
| 被测源码 | `frontend/src/core/env-state-defaults.ts` | 1–29（`deriveDefaultEnvState`） |
| 被测源码 | `frontend/src/core/env-state-schema.ts` | 1–422（`ENV_STATE_SCHEMA` / `FieldDefaultMap` 互锁 / `EnvDispatchGroup` / `getEnvKeys` + `_groupCache`） |
| 关联生产点 | `frontend/src/core/state.ts:27`（`envState = reactive(deriveDefaultEnvState())`） | 27 |
| 关联类型派生 | `frontend/src/core/types.ts:523-546`（`EnvState` ← `EnvStateSchema` ← `SchemaToTSType`） | 523–546 |

**测试 import 的生产模块**：`../core/config`（barrel，`envState` + `EnvState` 类型，实际实现位于 `state.ts`/`types.ts`）、`../core/env-state-defaults`、`../core/env-state-schema`。

**验证执行**：`cd frontend && npm run test -- src/__tests__/env-state.test.ts` → **33/33 通过**（227ms，Vitest v4.1.9）。`npm run check` 未单独执行（任务允许跳过；本测试不依赖 tsc，且生产代码无改动）。

**与 round-12 的关系**：round-12（`docs/audit/2026-08-06-round12-env-motion-core-ai.md:116`）判定 env-state-schema（ADR-243 type/default 互锁）「✅ 通过、覆盖充分」，当时依据的是 ADR-243 落地时新增的 `env-state-defaults.test.ts`（6 用例）。**本测试是 ADR-243 技术债的清偿 + 覆盖加强**：ADR-243 落地记录（`docs/adr/adr-243-env-state-defaults-from-schema.md:114`）明确把「`env-state.test.ts` 的 `defaultEnv` 过期快照」登记为技术债，本测试第 7–8 行以 `deriveDefaultEnvState()` 动态派生替代原手写字面量快照，并将覆盖从「零散抽验」升级为「全量遍历互锁」（derive 忠实度、tuple3 克隆全字段扫描、getEnvKeys 声明组双向验证）。round-12 的「覆盖充分」结论在本测试下继续成立且被加强；但 round-12 已标记的 env-state-schema.md 文档偏差（`envBrightness`→`globalBrightness`）**仍未修**（见 P3#2）。

## 总体结论：✅ 通过

生产代码（`env-state-defaults.ts` + `env-state-schema.ts`）健康度高：ADR-243 单一事实源互锁落地彻底、无幽灵状态流、无资源泄漏、无循环依赖；测试 33/33 全绿，断言有效性出色（新增 schema key 自动纳入 5 类全量断言）。无 P1/P2 风险；3 项 P3（1 项 schema 值域盲区 + 1 项文档债务 + 1 项测试共享实例约定）+ 3 项 P4 观察。

## 亮点

- **单一事实源闭环**：`deriveDefaultEnvState`（`env-state-defaults.ts:18-29`）遍历 `ENV_STATE_SCHEMA` 按 `type` 分派克隆策略，无第二份手写默认值投影；`state.ts:27` 直接 `reactive(deriveDefaultEnvState())`，新增 env 字段只需改 schema 一处（schema 头注释 `env-state-schema.ts:1-4`）。
- **编译期互锁前移**：`FieldDefaultMap`（`env-state-schema.ts:9-16`）+ `_FieldDef`/`_AnyFieldDef`（:19-29）+ `as const satisfies Record<string, _AnyFieldDef>`（:377）——`type:'number' 但 default:'x'` 类错误在 schema 声明处即编译失败（ADR-243 激活了原「从未被应用的死类型」`_FieldDef`）。
- **tuple3 克隆语义正确且有测试锁定**：`(def.default as readonly number[]).slice()`（`env-state-defaults.ts:23`），注释说明 reactive Proxy 不代理数组、共享引用会被索引写静默写穿（:10-16）；测试 99–136 行三连验证（引用独立 / mutate 隔离 / 全字段扫描）直接守护该语义。
- **测试全量互锁而非抽样**：测试通过遍历 `ENV_STATE_SCHEMA` 动态生成断言——schema 完整性三连（:14-34）、derive 忠实度 deep-equal（:77-87）、tuple3 克隆全字段扫描（:119-135）、getEnvKeys 声明组双向验证（:205-234）——**新增 schema key 自动纳入回归**，杜绝「新增 key 忘同步测试」经典漏洞。
- **测试注释诚实且有据**：:7、:66-68、:78-80、:206-207 多处说明「反推源码不足 / 回归保护 / 替代手写自证」，把测试意图与历史坑位讲清楚（如 `iblIntensity===1` 旧自证错误 → schema 实际默认 2）。
- **运行时守卫被显式测试**：`getEnvKeys('nonexistent')` 返回空数组而非抛错（`env-state-schema.ts:405-422` 的缓存未命中→空结果路径），测试 :236-239 显式验证。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | 无 | — | — | — |
| 🟡 P3 | `frontend/src/core/env-state-schema.ts` | :9-16（`FieldDefaultMap.enum: string`）+ :24（`values`） | **enum 的 default 与 values 值域未互锁**：互锁只保证 `default` 是 string，不保证 `default ∈ values`（如 `values:['a','b'], default:'c'` 编译可通过）。derive 忠实度测试（:77-87）只保证 `派生值 == schema.default`，同样放行非法默认值。当前 148 字段人工核对均在 values 内，属潜在而非现存缺陷。 | 在 schema 完整性 describe 中追加全量断言「每个 enum 字段 `values.includes(def.default)`」（运行时兜底，新增字段自动纳入）；未来可扩展互锁类型使 enum default 收窄为 values 元素。 |
| 🟡 P3 | `docs/knowledge/env-state-schema.md` | :46、:49、:56、:24（tests: []） | **round-12 已标记的文档偏差未修**：:49 仍写「envBrightness（ADR-132）」，实际字段已迁移为 `globalBrightness`（schema.ts:73，round-12 报告 :107 已指出）；:46/:56 引用「buildDefaultEnvState()（在 state.ts）」——该函数已被 ADR-243 删除，实际为 `deriveDefaultEnvState()`（env-state-defaults.ts）；两卡 `tests: []` 过期（实际有 `env-state.test.ts`，33 用例）。文档债务会误导新增字段者走旧名查证。 | 同步修正三处：`envBrightness`→`globalBrightness`、`buildDefaultEnvState`→`deriveDefaultEnvState`（指向 env-state-defaults.ts）、tests 补 `env-state.test.ts`。 |
| 🟡 P3 | `frontend/src/__tests__/env-state.test.ts` | :8（模块级 `const defaultEnv = deriveDefaultEnvState()`） | **模块级共享单例贯穿整个测试文件**：所有 describe 共享同一 `defaultEnv`（含 tuple3 数组引用），`beforeEach` 只重置 `envState`（:251-255）不重置 `defaultEnv`。当前无测试 mutate 它（tuple3 隔离测试另调 derive 得 a/b，partial-merge 测试浅拷贝副本），但未来若某用例对 `defaultEnv` 的 tuple3 做索引写（如 `defaultEnv.skyColorTop[0]=x`），会静默污染后续用例。 | 在文件头注释约定 `defaultEnv` 只读；或需要 mutate 的用例内重新调用 `deriveDefaultEnvState()`（纯函数无成本）。 |
| 🟢 P4 | `frontend/src/__tests__/env-state.test.ts` | :286、:291 | **不必要的 `as any`**：`setColorField('iblIntensity', 0.5 as any)` / `setColorField('skyBrightness', 2 as any)`——两字段类型均为 number，`0.5`/`2` 本就合法，`as any` 属多余类型逃生（:296 的 `'gradient' as any` 是必要的——测试非法枚举值）。 | 删除 :286/:291 的 `as any`；保留 :296 并加注释说明「故意传非法枚举值」。 |
| 🟢 P4 | `frontend/src/core/env-state-schema.ts` | :395、:405-421（`_groupCache`） | **缓存返回共享数组引用**：`getEnvKeys` 对同组返回缓存数组本体，调用方 mutate 返回数组（push/sort）会污染全局缓存。当前消费者（env-impl.ts:81-84、env-clouds.ts:824、env-water.ts:786 等）均只读 `includes/some`，测试也只用 `toContain/includes`——无实际风险。测试 :199-203 反而把「同一引用」固化为契约。 | 在 `getEnvKeys` JSDoc 注明「返回数组只读，勿 mutate」；如未来出现写消费者，改返回 `keys.slice()`（牺牲缓存命中）。 |
| 🟢 P4 | `frontend/src/core/env-state-defaults.ts` | :28（`out as unknown as EnvState`） | 双断言类型逃生（非 `as any`），但 ADR-243 背书：`satisfies` 编译期防线已前移至 schema 互锁（:25-27 注释 + ADR-243:112），字段存在性/类型正确性在 schema 声明处兜底。属已知权衡，非违规。 | 无需改动；保留注释即可。 |

## 测试质量评价

- **断言有效性：优**。5 类全量遍历断言（schema 覆盖/无多余/数量一致 :14-34、derive 值忠实度 deep-equal :77-87、tuple3 克隆全字段扫描 :119-135、getEnvKeys 声明组全量包含 :205-219、单组精确归属双向 :221-234）均从 `ENV_STATE_SCHEMA` 动态生成——**新增 key 自动纳入测试**是本次审核最看重的特性；「默认值类型与范围」抽验（:41-69）虽不自动扩展，但 derive 忠实度全量断言已兜底「派生值==schema default」，抽验仅作语义精化，分工合理。
- **边界覆盖：优**。非法组名运行时守卫（:236-239，double-assert 模拟）、`optional-string` 走 else 分支 → undefined（:89-92）、非法枚举值写入（:296）、绕 `setEnvState` 直写 reactive `envState` 的字段隔离（:250-330，含快速连续写 3 类 :276-315）、partial merge 保留其他字段（:142-154，与生产 `setEnvState` 的 `Object.assign` merge 语义一致，见 env-bridge.ts:335）。
- **无跳过/独占**：grep 确认 0 处 `.skip`/`.todo`/`xit`/`.only`。
- **与生产的对应性**：partial merge 测试模拟的是 `setEnvState` 的 `Object.assign(envState, partial)` merge 语义而非直接测 `setEnvState` 本身（后者属 env-bridge 测试范围，round-12 已审）——作为「默认值对象可被 partial 覆盖且不丢字段」的守卫合理，名称如实。
- **轻微瑕疵**：2 处不必要 `as any`（P4#1）；模块级 `defaultEnv` 共享单例缺少只读约定（P3#3）；enum default 值域未验证（P3#1，见风险表）。

## 结论

生产源码与测试均健康，ADR-243 单一事实源闭环（schema 互锁 → 自动派生 → reactive envState）被 33 个全量互锁用例牢固守护，无 P1/P2。建议优先跟进 P3#1（enum 值域断言，一行测试即补）与 P3#2（round-12 遗留文档债务）。

---

**审核日期**: 2026-08-15
**审核员**: 子代理 round25-env-state
