# [round-23] feet-adjustment 引擎 + 补测 — 审核结果

> 审核目标：`frontend/src/__tests__/feet-adjustment.engine.test.ts`（572 行，round-12 P1 补测）及其被测源码 `frontend/src/scene/motion/feet-adjustment.ts` 引擎本体（startFeetAdjustment / _adjustFoot / IK 重解 JS+WASM 分支 / 落地事件接线 / 手动覆盖跳过）。

## 头部

- **审核范围**：测试文件 `frontend/src/__tests__/feet-adjustment.engine.test.ts`（29 用例）+ 生产源码 `frontend/src/scene/motion/feet-adjustment.ts`（470 行，引擎主体 :169-381 `_adjustFoot`、:387-459 `startFeetAdjustment`、:462-470 `stopFeetAdjustment`）。
- **验证**：`cd frontend && npm run test -- src/__tests__/feet-adjustment.engine.test.ts` → **29 passed (29)，193ms，基线全绿**。`npm run check` 未跑（纯只读审核、无代码改动，tsc 全量耗时高，按任务约定跳过）。
- **总体结论：✅ 通过**（P1=0，P2=0，P3=5，P4=2）。引擎本体健康，补测质量高，未发现阻断性缺陷。

### 与既往轮次关系

| 既往轮次 | 记录 | 本轮核实结果 |
|---|---|---|
| round-12 P1#3 | `2026-08-06-round12-env-motion-core-ai.md:26`「feet-adjustment 引擎本体零直接测试」 | ✅ 已兑现：本补测 29 用例（计划 8 用例），覆盖 start/stop、JS/WASM IK 重解、落地事件、手动覆盖跳过 |
| round-12 承诺 | 同步更新 `motion-feet-adjustment.md` 的 tests 字段 | ✅ 已落地：知识卡 tests 字段含 `feet-adjustment.test.ts` + `feet-adjustment.engine.test.ts` |
| round-15 P1-4 | `ikSolver` 类型断言无守卫（`2026-08-07-round15-motion-full.md:371`） | ✅ 已修复：`feet-adjustment.ts:361-365` `if (solver) { solver.solve(false) }` 守卫到位 |
| round-15 P2-5 | `_adjustFoot` IK 解算异常未 try-catch | 沿用为本轮 P3-3（pipeline 顶层兜底已存在，见 motion-pipeline.ts:121-127） |
| round-16 P4 | `guardNum` 死导入（`2026-08-15-round16-guards.md:61`） | ✅ 已移除：`feet-adjustment.ts:38-39` 注释确认，grep 无残留 |

---

## 亮点

- **JS/WASM 分支断言真实且精确**：WASM 用例 `feet-adjustment.engine.test.ts:199-211` 不仅断言 resolver 调用 2 次，还断言精确参数 `('m1', 0, false)`，与源码 `feet-adjustment.ts:357` `resolver!(modelId, ikSolverIndex!, false)` 逐字吻合；JS 用例断言 `ikSolver.solve` 次数与写骨结果（:153-162）。两个分支均非空转。
- **数学与事件逻辑穿透真实实现**：`solveFootTarget` 与 `detectFootLanding` **未被 mock**（:9-15 仅 mock 5 个接线模块），maxAngle 钳制（:409-419）、centerY 自然脚高（:470-480）、_findHip 全量搜索/回退（:482-541）、落地上升沿与 120ms 去抖时序（:253-313）全部穿透真实纯函数验证——补测与既有 `feet-adjustment.test.ts`（16 用例，覆盖 footSmooth/intensity/soleHeight/reachAngle/NaN）形成「纯数学层 + 引擎接线层」双层守护，无重复盲区。
- **性能.now 注入时序测试规范**：上升沿/去抖用例（:256-313）用 `vi.spyOn(performance, 'now').mockReturnValue` 精确控制帧时间戳，`try/finally` 还原（:277/:310），无 mock 泄漏；断言严格区分「首帧落地→连续贴地不重复→空中 skip→新上升沿」四阶段。
- **降级路径系统性反推补齐**：无 IK 骨（:333）、ikSolver 缺失（:348）、resolver 缺失（:431）、ikSolverIndex 缺失（:421）、enabled=false（:365）、intensity<=0（:376）六类降级全部「不崩溃 + 行为正确」双断言，远超 round-12 计划范围。
- **mock 卫生合规**：`vi.hoisted()` 集中定义 + 工厂仅引用 hoisted 绑定（:17-39），符合 frontend AGENTS.md 测试卫生铁律；mock 模块名与源码 import 精确一一对应（env-impl/bone-override/registry/perception-shared/logger），pipeline 用真实单例。
- **源码状态流清晰**：`_adjustFoot` 每帧路径顺序可读（取骨→地面→找髋→解算→debug→覆盖检查→落地检测→写骨→重解→脏标记→缓存），落地事件置于覆盖检查之后（:265-266 注释明示设计意图）；stop 完整释放（:462-470 注销+清缓存+重置时间戳）。
- **NaN 防护已带回归测试**：`hasModParams` 的 `Number.isFinite` 双条件守卫（:240-247，[fix P2]）有专门用例（:397-407）验证 NaN/缺失字段不误判手动覆盖；debug 日志 `f()` 兜底（:214）有 NaN 显示 `?` 用例（:558-570）。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟡 P3 | `frontend/src/scene/motion/feet-adjustment.ts` | :248-250, :261-263（提前 return）vs :293-305（缓存更新） | **手动覆盖期间 grounded 缓存不更新**：`hasModParams`/`foundOverride` 提前 return 跳过了 `lPrevGrounded/lFootYPrev/lLastLandTime` 更新。后果二选一：(a) 覆盖前已贴地 → 覆盖结束恢复贴地时 prevGrounded 仍为 true → **漏触发落地事件**；(b) 覆盖前离地 → 覆盖结束脚仍高于地面但 < 阈值即 grounded=true（maxAngle 逐帧下拉中）→ **触发 impactSpeed=0 的虚假落地事件**（footYPrev 为覆盖前陈旧值）。注释「不污染 grounded 缓存」是有意取舍，但语义不对称。 | 覆盖检查命中时显式写 `prevGrounded=false`（或保持更新缓存但把 grounded 置 false），使恢复贴地产生干净上升沿；补一个「覆盖→释放」过渡用例固化行为。 |
| 🟡 P3 | `frontend/src/scene/motion/feet-adjustment.ts` | :87-96（BONE_THIGH_L/R）vs `proc-motion-shared.ts:237-254`（BONE_THIGH_L_CANDIDATES/R） | **大腿骨候选列表重复且已漂移**：两处各自维护（本文件含 `左大腿/左腿`，proc-motion-shared 含 `左太もも/L_Thigh`），新增别名只改一处即静默失配。 | 复用 `proc-motion-shared` 的候选常量（差异项合并后统一一处），或至少加注释互链防止漂移。 |
| 🟡 P3 | `frontend/src/scene/motion/feet-adjustment.ts` | :416-430 | **centerY 一次性缓存**：仅首次解析骨骼名时捕获（`lName===''` 分支），模型持续抬高（骑乘/缩放/浮空平台）时 `modelGroundY=centerY-legLength` 基准陈旧 → 跳阈值 `footY-modelGroundY` 被抬高值拉大，可能误判「跳跃」跳过贴地。测试「模型抬高」按捕获时值断言，属设计意图，但未覆盖运行中抬高。 | 每帧（或低频节流）刷新 `cache.centerY`，与骨骼名解析解耦；或文档明示该限制。 |
| 🟡 P3 | `frontend/src/scene/motion/feet-adjustment.ts` | :333-365（IK 重解区） | **IK 解算异常未 try-catch**（沿 round-15 P2-5 记录）：`solver.solve`/`resolver()` 抛错会中断本模型本帧后续逻辑（R 脚处理、`_markAsDirty`、`lTargetY` 更新），仅靠 pipeline 顶层兜底（motion-pipeline.ts:121-127）。补测未注入 IK 异常路径。 | 在重解区包 try/catch + logWarn 降级（仿 `_runFrameHooks` 的 round-12 修复模式），并补异常注入用例。 |
| 🟡 P3 | `frontend/src/__tests__/feet-adjustment.engine.test.ts` | :159-161, :199-211 | **getOverride/getModuleState 用例未验证实参**：bone override 用例用 `mockReturnValue({enabled:true})` 恒真返回，未验证候选骨名遍历（`cands` 循环）与 `modelId` 透传；手动覆盖用例未断言查询的 moduleId 为 `'left-foot'/'right-foot'`。mock 与真实签名一致（bone-override.ts:465, registry.ts:165），风险低，但候选遍历逻辑实际未守护。 | 改用 `mockImplementation` 记录调用实参，断言候选名集与 moduleId；或至少断言 `getOverride` 被调用了候选数量次。 |
| 🟢 P4 | `frontend/src/scene/motion/feet-adjustment.ts` | :146（`depth < 6`）、:198（`1e-3`） | 魔法数值未命名：`_findHip` 父链深度上限 6、腿长下限 1e-3。 | 提取具名常量（如 `HIP_PARENT_CHAIN_MAX_DEPTH = 6`）。 |
| 🟢 P4 | `frontend/src/__tests__/feet-adjustment.engine.test.ts` | :121-128（顶层 beforeEach） | **顶层 beforeEach 不重置 `feetDebug.value`**：NaN describe 的 beforeEach（:553-556）才重置，且 NaN describe 位于文件末尾——依赖用例顺序，未来重排/新增用例会串扰（debug 分支 `_feetDbgFrame++ % 60` 首帧必打日志）。 | 顶层 beforeEach 统一 `feetDebug.value = false`。 |

---

## 测试质量评价

- **有效性（强）**：29 用例全部通过（`npm run test` 实测 193ms），断言指向真实可观测结果——写骨 Y 值（world.y）、IK 重解调用（次数 + 精确参数）、落地事件（字段值 + 时序 + 去抖窗）、降级路径（不崩溃 + 不误写）。JS/WASM 双分支均有**正反用例**（重解触发 / 缺失跳过），不是只测 happy path。
- **mock 合理性（优）**：5 个模块 mock 与源码 import 一一对应，工厂仅引用 hoisted 绑定（符合卫生铁律）；`solveFootTarget`/`detectFootLanding`/`matchBone`/`MotionPipeline` 用真实实现，保证接线测试不 mock 掉被测逻辑本身。`FakeBone` 子集实现（:41-64）最小且忠实（getWorldTranslationToRef/setWorldTranslation/ikSolver/linkedBone）。
- **边界覆盖（优）**：无 IK 骨、ikSolver 缺失、resolver 缺失、ikSolverIndex 缺失、enabled=false、intensity<=0、地形地面、NaN params、NaN groundY、maxAngle 钳制（含真实腿长估算）、centerY 抬高、_findHip 三种搜索路径（链式/全量/回退）、getGroundHeightAt X/Z 透传、stop 后失效——合计 16 个边界用例，远超 round-12 计划的 8 个。
- **无跳过**：全文件无 `it.skip`/`describe.skip`/`xit`。
- **盲区（轻微）**：(1) IK 重解抛异常路径无注入测试（P3-3 同源）；(2) 引擎级未覆盖 footSmooth 下拉多帧软化 / intensity 部分混合 / soleHeight / reachAngle——但均属纯数学 `solveFootTarget`，已被 `feet-adjustment.test.ts` 16 用例覆盖，双层分工清晰，不算缺口；(3) 手动覆盖→释放过渡的落地事件语义未测试（P3-1 同源）。

---

**审核日期**：2026-08-15
**审核员**：子代理 round23-feet-adjustment-engine
