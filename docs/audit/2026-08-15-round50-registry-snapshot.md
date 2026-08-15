# motion-modules registry 快照专项（applyModuleSnapshot + setParam 集成）— 审核结果

**总体结论：✅ 通过**

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/motion-modules-registry.snapshot.test.ts`（130 行，5 用例，全部通过）
- 被测源码：
  - `frontend/src/scene/motion/motion-modules/module-base.ts:175-193`（`createModuleBase` 内 `setParam`：pushHistory 记录 + 参数写入 + 自动启用 + bake）
  - `frontend/src/scene/motion/motion-modules/module-base.ts:204-225`（`applyModuleSnapshot`：快照应用双层循环 + 严格模式）
  - `frontend/src/scene/motion/motion-modules/registry.ts:70-77`（createModule）、`165-214`（getModuleState）、`227-253`（setModuleParam / setModuleEnabled）、`63-67`（getRegisteredModules）、`433-441`（initMotionModules）
  - 链路间接依赖：`motion-history.ts:99-124`（pushHistory，本测试 mock 替换）、`bone-override-store.ts`（releaseBones → onClearEngineSlot → clearBoneOverride 链路）、`body-posture.ts:76-94`（bake）
  - 测试支撑：`motion-modules-registry-mocks.ts`（74 行）、`motion-modules-registry-helpers.ts`（84 行）、`__tests__/mocks/state-superset.ts`

**与历史轮次的关系（重要）：**
- **round-12**（`docs/audit/2026-08-06-round12-env-motion-core-ai.md`）：审过 registry（⚠️ 有条件通过）与 module-base（⚠️ 有条件通过），测试覆盖维度标注「motion-modules-registry（conflict/create/disable/ik/init/param/snapshot 7 文件）」覆盖充分——本 snapshot 文件即该清单一员（当时已随套件拆分独立成文件，原 `motion-modules-registry.test.ts` 已不存在）。round-12 的 P2#11（setParam 自动启用直接改状态不落盘）修复落点即 `module-base.ts:185-188`，本测试测试 4/5 经 setParam→pushHistory 链路间接覆盖该路径。
- **round-47**（`docs/audit/2026-08-15-round47-side-hooks.md`）：审过 side-hooks 专项（✅ 通过），与本测试共用同一套 `motion-modules-registry-mocks.ts` / `motion-modules-registry-helpers.ts` 支撑。
- **ADR-125**（`docs/adr/adr-125-motion-undo-redo.md`，2026-07-17 实施）：本测试内容即 ADR-125 实施记录「motion-modules-registry.test.ts +5 项：applyModuleSnapshot 非空/空/部分快照 + setParam→pushHistory 集成（调用验证 + 值未变化跳过）」；`applyModuleSnapshot` 也是 undo/redo 的 `SnapshotApplier` 底层（motion-history.ts:153 `applySnapshot({})` 走空快照路径）。

---

**亮点：**
- **applyModuleSnapshot 严格模式双层循环**（module-base.ts:204-225）：第一循环应用快照内模块——`mod.setState({id, ...state})` 自生效（enabled → 重烤；disabled → 释放骨骼，注释 :213 明确不再要求调用方手动 enable/disable）；第二循环对**不在快照中**的模块 `disable()`——快照即全量状态，杜绝「快照外模块残留启用」的脏状态。该模式与 `setTargetModel`/`applyMotionModulesToModel`/`applyProcMotionModulesToModel` 同构，registry.ts:148/370/400 注释互引，链路一致性佳。
- **setParam → pushHistory 集成**（module-base.ts:175-193）：`prev = st.params[name] ?? defaults[name]` 用注册默认值兜底（首次调参 prev 不落 undefined）；`pushHistory` 在 `setModuleParam` **写入之前**调用，保证 prev 是变更前真值；值未变化跳过（ADR-125 要求）；autoEnable 走 `setModuleEnabled` 持久化（round-12 P2#11 修复点，注释 :185-187）。
- **测试精确断言 pushHistory 六参数**（snapshot.test.ts:110-117）：`toHaveBeenCalledWith('m1','body-posture','tilt', expect.any(Number), 10, expect.any(Function))`——modelId/moduleId/paramName/prev/next/buildSnapshot 全链路参数校验，非仅「被调用过」的弱断言。
- **mock 复用共享工厂**：`stateMockSuperset`（state-superset.ts:6-19）经 opts 注入同一 `modelRegistry` Map 实例（mocks:40-42），SUT 的 `modelRegistry.get` 与测试写入的是同一引用；`motion-intent` 用 `async importOriginal` spread 保留活绑定（mocks:25-28），符合 frontend/AGENTS.md 测试卫生铁律（非静态超集 spread）。
- **测试 3 严格模式断言非假绿**：先 `setModuleEnabled('m1','left-hand',true)` 置真，再应用不含 left-hand 的快照——若第二循环漏掉 disable，断言必然失败（前置状态 non-trivial）。
- **模块级状态隔离干净**：`beforeEach(resetAll)` = `shared.reset()`（全 mock mockClear + 状态复位，mocks:26-37）+ `setTargetModel(null)`（重置 registry `_currentModelId`）——本文件所用 mock 全部在 reset 范围内，无 round-47 报告的跨用例 mock.calls 累积问题。

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | module-base.ts | 204-225 | 空快照注释声称「恢复到初始状态（所有模块禁用 + **空 params**）」，但第二循环对快照外模块仅 `disable()`（置 enabled=false + 释放骨骼），**params 残留不清理**。undo 到初始态（motion-history.ts:153 走 `applySnapshot({})`）后重新启用模块将以旧参数生效，与「空 params」注释语义不符 | 实现与注释对齐：第二循环改 `inst.setState({id, enabled:false, params:{...defaults}})`（或明确清空 params）；补「非默认参数 + 空快照 → params 被重置」断言 |
| 🟡 P3 | module-base.ts | 209-212 | 快照含未知/未注册模块 id 时 `if (!mod) continue` 静默跳过，调用方无感知；`applyProcMotionModulesToModel` 有 console.warn（registry.ts:150-152），此处不对称 | 补 console.warn 与 applyMotionModulesToModel 对齐；测试补未知模块分支用例 |
| 🟢 P4 | module-base.ts | 175-181 | setParam 值未变化时仍执行 `setModuleParam` → 触发 triggerAutoSave（即使无实际变更），产生不必要持久化信号 | 值未变化时提前 return（跳过 setModuleParam + bake）或拆分支 |
| 🟢 P4 | snapshot.test.ts | 45-54 | 测试 1 对 `setBoneOverrideSpy` 只断言 `toHaveBeenCalled()`，未断言具体骨骼/合并角（`'上半身' [15,0,0]`）；bake 数值链路由 param.test.ts:209-220（改 bend 重烤 上半身）跨文件覆盖，非缺口 | 可选：补具体骨骼参数断言增强快照→bake 全链路验证 |
| 🟢 P4 | registry.ts | 415-419 | 已知 registry ↔ 模块工厂 ↔ module-base 循环依赖（注释说明 + `getBuiltinModuleDefs` 惰性求值规避 TDZ，测试先 import 工厂再 import registry 不炸） | 已知可接受，记录备查 |

---

**测试质量评价：**
- **断言有效性**：✅ 快照应用三态全覆盖（非空快照启用并写 params + bake 副作用、空快照禁用已启用模块 + clearBoneOverride 副作用、严格模式禁用快照外模块）；pushHistory 集成两态（记录：次数 + 六参数精确断言；值未变化跳过：`not.toHaveBeenCalled`）。副作用层（setBoneOverrideSpy/clearBoneOverrideSpy）与状态层（getModuleState 读取）双轨验证，非仅状态断言。
- **mock 合理性**：✅ 复用共享工厂 + stateMockSuperset 超集；motion-intent 活绑定 spread；`triggerAutoSave` 走真实 auto-save.ts（函数指针，node 环境 no-op，无需 mock——合理的最小 mock 面）；`clearBoneOverride` 经真实 bone-override-store 单例的 onClearEngineSlot 回调（bone-override-store.ts:430-431）贯通至 mock spy，链路真实。mock 形状与 SUT 消费一致（registry.ts 从 `@/core/config` barrel 取 modelRegistry，config re-export state 活绑定，mock 生效已验证）。
- **边界覆盖**：✅ 空/非空/严格模式快照 + 历史记录/跳过。缺口：未知模块分支（P3）、空快照 params 清理语义（P3）、快照内 enabled:true 的 bake 具体参数（P4，跨文件覆盖）。
- **跳过测试**：无 `.skip`/`.todo`/`.only`。
- **类型安全**：生产代码 motion-modules 目录 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`（grep 验证）；测试内 `any` 为 mock 数据构造常规做法，`createModule(...)!` 非空断言依赖 initMotionModules 已注册内置模块的前置（安全）。
- **运行验证**：`npm run test -- src/__tests__/scene/motion-modules-registry.snapshot.test.ts` → 5/5 通过（6ms，exit 0）；全套件 `npm run test -- motion-modules-registry` → 8 文件 53 用例全部通过（815ms，exit 0，含 conflict/create/disable/ik/init/param/side-hooks/snapshot）。`npm run check` 未执行（本任务仅审不修改，时间预算内全量 tsc 耗时较长），代码零改动故类型风险趋零。

---

审核日期：2026-08-15
审核员：子代理 round50-registry-snapshot
