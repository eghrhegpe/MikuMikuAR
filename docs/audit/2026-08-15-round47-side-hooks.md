# motion-modules 共享帧钩子管理器（左右侧独立注册）— 审核结果

**总体结论：✅ 通过**

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/motion-modules-registry.side-hooks.test.ts`（200 行，6 用例，全部通过）
- 被测源码：
  - `frontend/src/scene/motion/motion-modules/module-base.ts:78-94`（帧钩子 actionId 记录）、`236-257`（createFrameHookManager）、`281-295`（createEnsureActive）
  - `frontend/src/scene/motion/motion-modules/foot-modules.ts:62,104-155`（每侧独立 `_footFrameHooks` + ensureActive）
  - `frontend/src/scene/motion/motion-modules/hand-modules.ts:101,164-236,314-316`（每侧独立 `_handFrameHooks` + ensureActive）
  - `frontend/src/scene/motion/motion-modules/registry.ts:70-77`（createModule）、`433-441`（initMotionModules）
  - `frontend/src/scene/motion/bone-override.ts:735-762`（FRAME_HOOK_ORDER / registerBoneOverrideFrameHook）
  - 测试支撑：`motion-modules-registry-mocks.ts`、`motion-modules-registry-helpers.ts`

**与 round-12 P1 的关系（修复验证）：**
本测试即 round-12 P1#1/#2「共享帧钩子互斥」的回归测试。round-12 报告（`docs/audit/2026-08-06-round12-env-motion-core-ai.md:24-25,32`）定位：左右脚/左右手共享同一 `_footFrameHooks`/`_handFrameHooks`（按 modelId 键控），`createEnsureActive` 的 `has(modelId)` 幂等检查无法区分左右侧，后启用一侧位置偏移帧钩子永不注册（旋转仍生效 → 位置偏移静默失效）。**修复落点与描述一致**：hook manager 已移入 `createFootModuleFactory`/`createHandModuleFactory` 闭包内，每侧各持一个独立实例（foot-modules.ts:62 / hand-modules.ts:101），`has(modelId)` 只在单侧作用域内判幂等，左右互不误判；`onDisable` 对称调用 `_xxxFrameHooks.unregister(mid)` 精准清理。验证：测试 6/6 通过，`npm run check` 通过（exit 0）。

---

**亮点：**
- 修复落点正确且带注释溯源：每侧独立 `createFrameHookManager()` 置于工厂闭包（foot-modules.ts:62、hand-modules.ts:101），注释明确记录 round-12 P1 成因与修复意图（foot-modules.ts:59-61、hand-modules.ts:98-100），后续维护者不会「优化」回共享模式。
- `createEnsureActive` 顺序固化（module-base.ts:286-294）：先 `bake(modelId)` 按当前参数重烤静态覆盖、再幂等注册帧钩子；`hadHook` 提前读取避免重复注册，根治 91dbe42a 同源 bug（has 前置导致静态参数冻结、滑块失效）。
- 注册/注销闭环（资源释放维度）：ensureActive 注册（foot-modules.ts:107-148 / hand-modules.ts:167-235）与 onDisable 注销（foot-modules.ts:153-155 / hand-modules.ts:314-316）对称，disable 精准移除该侧该模型的钩子条目。
- 测试断言直达回归点：`hookRegistrations()` 读取 mock 的 `registerBoneOverrideFrameHook.mock.calls`，按第 3 参 moduleId 定位左右侧钩子（test:63-68）——修复前该断言必然失败（`has('m1')` 误判导致右侧无注册记录）。
- 行为级验证不止于注册存在性：test 1 调用钩子断言各写对侧足 IK 骨骼（`左足IK`/`右足IK`，test:74-79）；test 3/4 断言 IK 重解路径被调用 2 次（JS `ikSolver.solve` / WASM `wasmIkResolver`，每侧各一次）——若单侧钩子缺失，调用次数必然 <2。
- actionId 残留清理回归（test 6）：验证 proc→VMD 切换后 `getModuleActionId` 清除（module-base.ts:83-89），覆盖 audit-P1 残留，与帧钩子作用域形成完整链路。

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | side-hooks.test.ts | :41-48,157-181 | `registerBoneOverrideFrameHook` 的 mock 不在 `shared.reset()` 清理范围，`mock.calls` 跨用例累积；且 SUT 模块级闭包状态（`_footFrameHooks`/`_handFrameHooks`/`_armIkCache`/`_moduleActionId`/`_initialized`）在用例间持久——beforeEach 只重置 mock 与 `setTargetModel(null)`（`_currentModelId` 恒为 null，模块从不卸载）。test 5 实际断言的是 test 1 注册的右钩子闭包（工厂闭包唯一故语义等价），用例间存在顺序耦合；若测试重排或删改，可能因陈旧状态误通过/误报 | `resetAll` 中显式 `mockClear` 帧钩子注册 mock；或在 hookRegistrations 中记录调用前 `calls.length` 基线只取当前用例增量；更彻底的做法是为 SUT 提供测试钩子重置模块级状态（如 `__resetModuleState`），保证每用例干净起点 |
| 🟡 P3 | side-hooks.test.ts | :82-99 | test 2（左右手同时启用）只断言注册存在，未调用钩子验证行为；全文件未断言「同侧重复 enable 只注册一次」（注册数精确为 1/侧），未覆盖多模型（第二 modelId 的 per-model 键控隔离），也未覆盖「先右后左」的逆序启用 | test 2 补一次钩子调用断言写对侧手臂骨骼；补同侧重复 enable/setParam 用例（断言每侧 `mock.calls` 计数 == 1）；补双模型用例验证 per-model 键控 |
| 🟡 P3 | side-hooks.test.ts | :157-181 | test 5「禁用一侧不影响另一侧」验证偏浅：mock 的 `registerBoneOverrideFrameHook` 返回 `() => {}` 空注销函数，`unregister` 无观测副作用，无法验证左侧钩子确实从帧钩子列表移除；且 `_footPosWritten` 集合跨用例残留（test 1 已写入 'm1'），归零清理守卫路径（foot-modules.ts:132-140）在本文件从未被新鲜触发 | mock 记录 unregister 调用次数或在 hookRegistrations 中按 moduleId 断言移除；补一个「footPos 从非零拖回 0」用例，新鲜验证 `_footPosWritten` 守卫与重建旋转槽路径 |
| 🟢 P4 | helpers:14-43 | `makeModelWithBones` 用半角 `左足IK`/`左腕IK`（恰为 `BONE_LEG_IK_L_CANDIDATES`/`BONE_ARM_IK_L_CANDIDATES` 首候选，匹配真实路径）；但生产注释强调 MMD 标准名为全角「左足ＩＫ」，mock 未覆盖全角候选与 matchBone 的 Shift-JIS 编码分支（proc-motion-shared.ts:298-304） | 可加一个全角骨名模型用例覆盖 matchBone 全角分支（非阻塞，增强真实模型保真度） |

---

**测试质量评价：**

- **断言有效性**：核心回归断言（左右侧钩子均注册，test 1:67-68）直接命中 round-12 P1 根因——修复前 `has('m1')` 误判使右侧无注册记录，断言必然失败；行为级断言（各写对侧骨骼、IK 重解 2 次）进一步防止「注册了但不工作」的假绿。整体有效。
- **mock 合理性**：`motion-modules-registry-mocks.ts` 遵循共享单例 + 延迟调用工厂模式（规避 vi.hoisted 跨文件限制）；`motion-intent` 采用 `async importOriginal` spread 保留活绑定（符合 frontend/AGENTS.md 测试卫生铁律）；bone 名与候选列表首项一致，`_resolveIkBone` 走真实匹配而非 fallback 巧合。WASM/JS 双路径经 `shared.wasmRuntime` 动态切换，mock 设计合理。
- **边界覆盖**：覆盖了后启用侧（test 1/2）、禁用一侧不影响另一侧（test 5）、JS/WASM IK 重解路径（test 3/4）、proc→VMD actionId 残留清理（test 6）。缺口：同侧重复启用的精确注册计数、多模型隔离、逆序启用、归零清理守卫路径（见 P3）。
- **跳过测试**：无 `.skip`/`.todo`/`.only`。
- **类型安全**：生产代码 0 处新增 `as any`/`@ts-ignore`（grep 验证 motion-modules 目录零命中）；测试内 `any` 断言为测试代码常规做法，`leftHook![0]` 非空断言前均有 `toBeTruthy` 守卫，安全。
- **运行验证**：`npm run test -- src/__tests__/scene/motion-modules-registry.side-hooks.test.ts` → 6/6 通过（16ms）；`npm run check` → 通过（exit 0，含 i18n/boolean 命名检查）。

---

审核日期：2026-08-15
审核员：子代理 round47-side-hooks
