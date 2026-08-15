# [scene-action-bridge 注销 token] — 审核结果（round-48 测试 3）

## 审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/scene-action-bridge.test.ts`（60 行，registerSceneAction identity-based 注销 token 专项） |
| 被测源码 | `frontend/src/core/scene-action-bridge.ts`（198 行，registerSceneAction L173-183 / getSceneAction L188-198） |
| 关联模块 | `frontend/src/core/ui-action-bridge.ts:68-75`（registerUiAction，契约对称参照） |
| 历史关系 | round-15（`docs/audit/2026-08-07-round15-core-state-ui-backend.md:79`）✅ 审过本桥：基于 fn 引用的注销 token 设计优秀、缺失一次性告警、零依赖纯叶子；round-33 修 ADR-248 编号错位（`2026-08-15-round33-ik-resolver-timing.md` / `-dump-bone-hierarchy.md`）——与本桥无直接关联，见下文「与 ADR-248 关系」 |
| 验证 | `npm run test -- src/__tests__/scene-action-bridge.test.ts` → 4/4 通过（183ms）；`npm run check`（i18n parity + tsc）→ 通过 |

**总体结论：✅ 通过**

生产代码健康度 9 维度全绿；测试 4 用例对注销 token 契约覆盖充分，核心 identity 用例判别力真实有效。无 P1/P2；4 项 P4 均为测试侧可读性/噪音级观察，不影响结论。

---

## 亮点

- **identity-based 注销 token（`scene-action-bridge.ts:178-182`）**：`registerSceneAction` 返回闭包 token，注销时以 `if (_sceneActions.get(key) === fn) _sceneActions.delete(key)` 引用相等守卫——只删本实例注册的闭包，不误删后续替换模块的注册。防「新注册先于 dispose → delete-by-key 误删 → 桥永久缺失 → core 侧静默跳过」的 HMR 闭包残留故障。round-15 已评审认可，本测试将其固化为契约。
- **契约对称（`scene-action-bridge.ts:173-183` vs `ui-action-bridge.ts:68-75`）**：register/get/token 三件套与 ui-action-bridge 逐行同构，注释互相引用（L171「对齐 registerUiAction 契约」），两桥可统一推理，维护成本低。
- **缺失注册一次性告警（`scene-action-bridge.ts:186, 193-196`）**：`_missingWarned` Set 去重，每个 key 只 `console.warn` 一次，防重构破坏导致静默跳过；ADR-238 §2.6 的 P2 处置落地。
- **零依赖纯叶子（`scene-action-bridge.ts:1-8`）**：仅 `import type { OverrideType }`，无运行时依赖，无循环依赖风险（ADR-238 依赖反转核心成果）。
- **测试判别力（`scene-action-bridge.test.ts:41-51` 用例 3）**：注册 `oldFn` → 覆盖注册 `newFn` → 调旧 token → 断言 `getSceneAction` 仍为 `newFn`。若实现退化为无条件 delete-by-key，该用例必红（newFn 被误删 → 返回 undefined），identity 语义被真实引用区分验证，非 mock 自证。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟢 P4 | `frontend/src/__tests__/scene-action-bridge.test.ts` | 19-23（beforeEach） | **清场注释与行为不符**：`getSceneAction(KEY)` 只读不删，注释「直接删掉测试键」是误导；实际清场靠各用例末尾 `unregister()` 自清理兜底。且 beforeEach 首次执行触发一次 `'getMotionMenu' 未注册` warn 噪音（实测 stderr 可见，round-36/39/41 已记录同类 bridge warn 噪音模式） | 删除该 no-op beforeEach，或改为真清场（注册 no-op fn 拿 token 注销 / 直接操作导出 Map 不可行则保留注释如实说明「靠用例自清理」）；warn 可用 `vi.spyOn(console, 'warn').mockImplementation` 压制 |
| 🟢 P4 | `frontend/src/__tests__/scene-action-bridge.test.ts` | 17, 21, 27, 29, 35, 36, 38, 44-47, 49-50, 55, 57-58 | 全文件 `as never` 类型逃生（约 15 处）：为用未参与生产的键 `'getMotionMenu'`（UiActions 的键，非 SceneActions 成员）绕过泛型约束。有头注释说明理由（L13-14），可接受；生产代码 0 处逃生 | 可抽 `type NeverKey = 'getMotionMenu' as never` 别名收敛；或改用真实 SceneActions 键 + 注册后必注销（每用例已自清理，污染风险实为 0） |
| 🟢 P4 | `frontend/src/__tests__/scene-action-bridge.test.ts` | 49-50 | 用例 3 清理段隐式再验证：重新注册 `newFn`（同引用）再注销，依赖 identity 匹配才删得掉——行为正确但未显式断言「新 token 可删新注册」，可读性略绕（L45 的 `registerSceneAction` 返回值未接收） | L45 接收 token（`const unregisterNew = registerSceneAction(...)`）直接用其清理，并补 `expect(getSceneAction(KEY)).toBeUndefined()` 一条显式断言 |
| 🟢 P4 | `frontend/src/core/scene-action-bridge.ts` | 178-182（语义边界） | identity-based 设计的固有边界：若同一 fn **引用**被重新注册，旧 token 再调用时 `get(key) === fn` 成立会误删新注册。实际场景（HMR 每次产生新闭包、替换模块均为新引用）不会触发，无生产风险 | 文档级观察即可，无需改动；如要彻底封死可在 token 内加代次计数，但会引入状态复杂度，不推荐 |

---

## 测试质量评价

- **断言有效性：高**。4 用例呈「注册→读取（L25-31）→注销→undefined（L33-39）→覆盖后旧 token 不误删（L41-51）→幂等重复注销（L53-59）」完整契约链。用例 3 用两个不同引用的 fn 区分注销目标，identity 语义被真实验证（判别力分析见亮点）。用例 4 验证第二次 `unregister()` 不抛错（`get(key) === fn` 为 `undefined === fn` 短路不删），覆盖了闭包 token 的幂等性。
- **边界覆盖**：注册/注销/覆盖/幂等四态齐备，对「注销 token 专项」60 行足够充分。缺口仅「同一引用重新注册后旧 token 行为」理论边界（P4，实际不发生）。无 `it.skip`/`it.only`。
- **隔离与真实度：优**。`@vitest-environment node` 选择正确（桥纯 TS 无 DOM）；直接 import 真实模块（非 mock 桩），测的是真实契约；每用例自清理保证模块级 Map 不跨用例泄漏（beforeEach 虽无效但未造成实际泄漏）。
- **缺点**：beforeEach no-op 误导注释 + warn 噪音（P4）；`as never` 逃生密集但注释充分（P4）。均不影响测试有效性。

## 与 round-15 / round-33 关系

- **round-15（✅）→ 本测试（✅）闭环**：round-15 从设计评审角度认可「基于 fn 引用的注销 token 设计优秀」；本测试从契约测试角度将其固化（覆盖注销不误删、幂等），设计评审 + 契约测试双保险，无新增缺陷。
- **round-33（ADR-248 错位）无扩散**：ADR-248 实际主题为「派生缓存依赖引用键」，round-18/33 修的错位是「日志热路径门控被误标 ADR-248」。本桥 `console.warn` 是「缺失注册一次性告警」（`_missingWarned` 去重，ADR-238 §2.6 处置），非热路径、无编号错位引用，不涉 round-33 跟踪项。

---

审核日期：2026-08-15
审核员：子代理 round48-scene-action-bridge
