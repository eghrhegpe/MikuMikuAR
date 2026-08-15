# round55-set-env-state — setEnvState 中央入口审核报告

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/env-bridge/set-env-state.int.test.ts`（142 行，13 用例，L2 集成，ADR-204 P2 拆自 env-bridge.test.ts） |
| 被测源码 | `frontend/src/scene/env/_bridge/env-bridge.ts`：`setEnvState` 中央入口（327-355）+ `migrateEnvState` 白名单收窄（305-324）+ 12 迁移器注册表（118-303）+ middleware 链（357-474）+ scene-action 注册（500-503） |
| 关联依赖 | `env-persist.ts`（schedulePersistEnvState / persistEnvState，真实未 mock）、`core/async.ts` DebouncedTimer（109-138）、`core/env-state-schema.ts` ENV_STATE_SCHEMA（34+）、`env-dispatcher.ts`（真实调度）、`core/scene-action-bridge.ts` |
| 验证 | `npm run test -- src/__tests__/env-bridge/set-env-state.int.test.ts` → **13/13 passed**（self 149ms，import 3.84s） |

**关系说明**：round-12 审 env-bridge（⚠️）、round-53 审 middleware（中间件时序耦合 P2）、round-54 审 facade/presets/gravity-sun；本测试是 setEnvState 中央入口的 L2 集成层（ADR-204 P2 拆分产物，6 个 env-bridge/*.int.test.ts 之一），与 middleware.int.test.ts（12 用例）在 applyLightingPreset 断言上有少量重叠，与 facade.int.test.ts（14 用例）在 dispatch→applySky 断言上有少量重叠——均为既有拆分保留的纵深覆盖。

## 总体结论

**⚠️ 有条件通过**

生产代码 `setEnvState` 链路（校验收窄 → 中间件链 → facade 派发 → 防抖持久化 → autoSave）实现稳健：try/finally 兜底、中间件异常隔离、`Object.hasOwn` 白名单（round-18 修过 `in` 走原型链的 bug）均已落地，0 处 `as any`/`@ts-ignore`。测试 13/13 通过且验证了真实 env-persist 链（未 mock），核心入口行为（merge、middleware 触发、skipAutoSave 契约）覆盖到位。

**条件**：① 中央入口的「合法性校验」半壁（12 迁移器 + 白名单收窄）全仓零测试覆盖，且 round-18 的 `Object.hasOwn` 修复证明该区域曾真实出过 bug，属 P2 覆盖缺口，须补 2-3 个迁移/白名单用例；② 「does NOT call updateWaterAnimSpeed」断言空洞（waterEnabled=false 时整条 water 链不触发，恒真通过），须以 waterEnabled=true 复测。

---

## 亮点

- **真实持久化链集成（未 mock env-persist）**：`set-env-state.int.test.ts:108-117` 手动触发防抖回调后经真实 `env-persist.ts` 的 `persistEnvState → resolveBackend() → backend.SetEnvState`（ADR-176 路由）验证 `mockSetEnvState` 被调——测试的不是桩链而是真实落盘路径，L2 分层名副其实。
- **skipAutoSave 契约测试**：`set-env-state.int.test.ts:124-132` 验证「skipAutoSave 只跳过 triggerAutoSave、不跳过防抖持久化」——该契约被生产注释 `env-bridge.ts:481`（cel-ground 耦合）显式引用，测试与实现注释互相锚定，是防回归的高价值用例。
- **try/finally 持久化兜底**：`env-bridge.ts:343-350` 保证 facade/middleware 抛错时 `schedulePersistEnvState` 仍执行（round-18 P2 fix），`set-env-state.int.test.ts:108-117` 的「fires SetEnvState via timer callback」间接验证了 finally 语义未回归。
- **mock 治理合规**：10 连 `vi.mock` 统一走 `env-mocks.ts` 共享桩（ADR-204 P2），backend 桩复用 `fixtures/backend.ts` 的 `makeMockBackend`；`beforeEach`/`afterEach` 配对 `clearAllMocks` + `restoreAllMocks`，spy 生命周期无泄漏。
- **生产代码类型安全**：`env-bridge.ts` 全文件 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`；`migrateEnvState` 的 `Object.hasOwn(ENV_STATE_SCHEMA, k)`（319）规避原型链 key 混入（round-18 修复点保持完好）。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | set-env-state.int.test.ts（缺口） | 全文件 | **中央入口的迁移/白名单路径零覆盖**：`migrateEnvState`（env-bridge.ts:305-324）与 12 个迁移器（118-303，groundMode→groundType、envIntensity→iblIntensity、debugMirrorEnabled→mirrorEnabled 等）为 setEnvState 的「合法性校验」本体，但全仓 grep 确认无任何测试触达（`migrateEnvState` 未导出，只能经 setEnvState 传旧字段触发）；round-18 曾在此处修过 `Object.hasOwn` vs `in` 的真实 bug，现有套件无法拦截此类回归 | 补 2-3 用例：① `setEnvState({ groundMode: 'heightmap' })` → groundType='terrain'；② `setEnvState({ envIntensity: 3 })` → iblIntensity=3 且 envIntensity 被收窄；③ `setEnvState({ bogusKey: 1 })` → envState 无 bogusKey |
| 🟡 P3 | set-env-state.int.test.ts:74-79 | 断言空洞 | `does NOT call updateWaterAnimSpeed` 用例在 `waterEnabled=false`（mock 默认）下执行，整条 water 子系统（createWater→_syncWaterUniforms）根本不触发，断言 vacuous true——即使 setEnvState 的 water 处理完全损坏也恒绿；只防「setEnvState 直接调 updateWaterAnimSpeed」这一种回归 | 用例改为先 `mockConfigEnvState.waterEnabled = true`，再断言 `mockImplCreateWater` 被调 + `mockImplUpdateWaterAnimSpeed` 不被 setEnvState 直接调用（委托路径才被真实验证） |
| 🟡 P3 | env-bridge.ts:314-322 | 静默丢弃 | 白名单收窄对未知 key 无任何告警——调用方拼写错误（如 `skyColorTopX`）或 scene-action 入口（env-bridge.ts:500-503，`Record<string, unknown>` 运行时入参）传入非法字段时静默吞掉，排障困难 | DEV 模式下对 `Object.keys(out)` 中被 schema 拒绝的 key 输出 `console.warn`（热路径外，成本可忽略） |
| 🟡 P3 | env-bridge.ts:327-355 | 无值级校验 | 「合法性校验」仅 key 白名单，不做值类型校验：`setEnvState({ sunAngle: '60' })`（经 scene-action 运行时入口可传入）会把 string 写入 envState，下游 deriveLighting/数值运算拿到脏值。TS 静态类型护住了多数调用点，但 `registerSceneAction('setEnvState', Record<string,unknown>)`（500-503）与 `core/init.ts:321` 是运行时通道 | 基于 ENV_STATE_SCHEMA 的 `type` 字段做轻量值类型断言（DEV 告警即可，不必运行时 throw） |
| 🟢 P4 | set-env-state.int.test.ts:105,110 | 测试代码 `as any` | 2 处 `(setTimeout as any).mock...` 逃生——非生产代码但违背 frontend/AGENTS.md「不要新增 any 逃生」精神 | 改 `vi.mocked(setTimeout)` 获取类型化 spy |
| 🟢 P4 | set-env-state.int.test.ts:108-117 | 定时器残留 | 手动触发防抖 callback 后，DebouncedTimer 内部真实 500ms 定时器仍挂起，在后续用例执行期间 fire，再次调用 mockSetEnvState；当前无用例断言其精确次数故未爆，属隐性跨用例污染源 | afterEach 内 `cancelEnvPersistTimer()`（或 import env-persist 的导出）清掉挂起定时器 |
| 🟢 P4 | set-env-state.int.test.ts:101-106 vs 134-141 | 用例重复 | 两个 debounce 用例断言几乎完全同构（clearTimeout 被调 + setTimeout 计数 2），仅断言写法（`.mock.calls.length` vs `toHaveBeenCalledTimes`）不同 | 合并为一个用例，保留一种断言写法 |
| 🟢 P4 | set-env-state.int.test.ts（缺口） | 边界缺失 | 无 `setEnvState({})` 空对象用例、无未知字段行为断言（与 P2 第③条重叠）、无 3 连快速调用防抖用例 | 随 P2 补测一并覆盖 |
| 🟢 P4 | set-env-state.int.test.ts（治理） | 文件组织 | 与 facade/middleware/presets/gravity-sun/time-of-day 五个同系列文件 vi.mock 列表重叠 ≥80%，self/total 比 ~4%（149ms/3.84s），命中 ADR-256（2026-08-10 取代 ADR-204 拆分阈值）的合并判据——属性能导向的潜在合并候选，非当前缺陷 | 后续按 ADR-256 评估 6 文件合并（mock 工厂已共享在 env-mocks.ts，合并仅付一次依赖图） |

---

## 测试质量评价

**优点**：
- 分层定位准确（L2 集成，`@vitest-environment node`，无 DOM 依赖，符合 ADR-255 环境分流）。
- 中央入口行为验证面完整：partial merge（64-67）、middleware 副作用触发与不触发（69-94）、skipAutoSave 双契约（119-132）、防抖两次调度（101-106/134-141）、真实持久化链（108-117）。
- 断言句柄从 `env-mocks.ts` 统一 import，与 10 连 `vi.mock` 同源，无重复内联桩。

**不足**：
- 「中央入口」之名与覆盖实况有落差：合法性校验本体（迁移器 + 白名单）0 覆盖（P2），是本文件最大缺口。
- 一处断言 vacuous（waterAnimSpeed，P3），一处用例重复（P4），2 处 `as any`（P4），定时器残留（P4）。
- 无 `it.skip`/`describe.skip`（已确认），13 用例全部真实执行。

**结论**：测试本身质量中等偏上、断言有效（除 water 一例外），但作为「中央入口」测试漏掉了校验半壁；建议按 P2 条件补齐迁移/白名单用例后升格为「通过」。

---

审核日期：2026-08-15
审核员：子代理 round55-set-env-state
