# [ik-resolver-timing] — 审核结果（round-33 测试 2：ADR-202 §六 IK 重解双调用路径时序）

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/ik-resolver-timing.test.ts`（361 行，9 用例）
- 被测生产源码（grep 定位）：
  - `frontend/src/scene/motion/bone-override.ts` — `_guardedResolve`(:106-131)、`_resetIkResolveGuard`(:98-103)、`_solvePosSlotIkWasm`(:661-724)、`setWasmIkResolver`(:931-942)/`getWasmIkResolver`(:948-951)、帧回调(:967-1042)、`startBoneOverride`(:953-1059)、`_applyWasmOverride`(:845-871)、`computeOverride`(:268-282)
  - `frontend/src/scene/motion/feet-adjustment.ts` — `_adjustFoot`(:169-381)、foundOverride skip 链(:233-263)、WASM resolver 分支(:335-358)、`startFeetAdjustment`(:387-459)
  - 编排容器：`frontend/src/scene/motion/motion-pipeline.ts` — `runFrame`(:114-129)、(stage, order) 排序(:88-101)
  - 共享支撑：`frontend/src/scene/motion/perception-shared.ts` — `feetDebug`(:481-484)、`isWasmRuntime`(:216-218)
  - 数学决策：`frontend/src/motion-algos/feet-adjustment-math.ts` — `solveFootTarget`(:46-105，skip 判定 :64-67)

**与既往轮次关系：** round-7/8 审过 bone-override（帧钩子显式定序治理 R1/R2）、round-12/23 审过 feet-adjustment（引擎级 WASM 路径、落地事件）；本测试是对 ADR-202 §六「两处方案C 迁方案A 后，bone-override 与 feet-adjustment 双 resolver 调用路径的互斥编排」的**跨模块时序验证**——验证的是编排层的互斥保证（POS slot 有覆盖 → feet-adjustment skip），而非单模块内部逻辑（后者已被既往轮次覆盖）。

**总体结论：⚠️ 有条件通过**

互斥编排从源码可证成立，测试 9/9 全绿、判别力经逐帧推演确认（场景A 若删掉 foundOverride 检查会因 2 次调用而失败）、无类型逃生、资源生命周期完备。唯一实质项为 **ADR-248 编号错位**（round-18 已标 P2 且部分修复，本测试标题/注释为新扩散点，与同轮 dump-bone-hierarchy 审计发现一致），属已知跟踪项；另有 P3×1（测试顺序耦合，实际数学上稳健）、P4×4。处置 ADR-248 遗留项 + 建议测试补充后转 ✅。

---

**亮点：**

- **互斥不变量由编排结构保证，源码可证**：bone-override order=0 仅对「启用且带 pos 的 IK 目标骨 slot」调 resolver（`bone-override.ts:678-681` 条件 + :714 调用）；feet-adjustment order=5 在触碰 resolver 之前先做 foundOverride 检查（`feet-adjustment.ts:251-263`，遍历 `BONE_LEG_IK_L/R_CANDIDATES` 查 `getOverride(cand).enabled`）。一旦 bone-override 触发，slot 必然落在候选名下 → feet 必 skip。两侧同用同一候选表 + 同 stage 按 order 排序（`motion-pipeline.ts:88-101`），**同链不双调由构造保证，非碰运气**（对应测试头注释 :3-5 的断言意图）。
- **守护单点收敛 + 双重节流**：所有 resolver 调用点（bone-override 内部 :714、feet-adjustment 经 `getWasmIkResolver()` :357、`applyBoneOverrideIK` :365）都经 `setWasmIkResolver` 包装的 `_guardedResolve`（`bone-override.ts:931-942`）；帧首 `_resetIkResolveGuard`（:972，位于所有提前 return 之前）覆盖整个 bone-override stage（含 order=5 的 feet-adjustment）；帧内 1 条 + 2s 时间窗口双节流（:112-131，常量 `_IK_RESOLVE_WARN_INTERVAL_MS=2000` 已命名）。互斥万一被破坏时有运行时断言兜底，且 feetDebug 关闭时守护 no-op 零热路径成本。
- **场景A 判别力经逐帧推演确认（测试有效性核心）**：POS 覆盖经 `computeOverride` 加法写入（`bone-override.ts:273` → `_applyWasmOverride` :845-871）把足 Y 1.8→0；feet-adjustment order=5 读到的已是覆盖后的 Y=0，`solveFootTarget` 判 `0-0 > 0.5` 为假 → **skip=false**，唯一拦截是 foundOverride——若删掉该检查，用例会得到 2 次 resolver 调用而失败。即该用例真实验证互斥，不是"脚在空中恰好也 skip"的假阳性场景。
- **原生优先回退链被显式测试**：用例3（带原生 ikSolver 的骨骼 → `solver.solve(false)` 被调、WASM resolver 0 次）↔ 生产优先分支（`bone-override.ts:688-701` 先走 solver，:703-722 才回退 `_wasmIkResolver`），与 ADR-202 §六「原生优先，WASM 导出为回退」设计一致。
- **测试基建真实、mock 克制**：NullEngine + Scene 真实例（非 mock），经真实 `MotionPipeline.runFrame` 驱动整帧编排；被测两模块本身未 mock，编排真实执行；`@/core/state` 用 `async importActual` spread（ADR-219 活绑定安全），`env-impl` 不 importActual 且注释说明理由（barrel 触发 Scene 构造）；守护用例 mock `performance.now` 使 2s 时间窗口断言确定性。
- **资源生命周期完备**：afterEach 内 stopBoneOverride/stopFeetAdjustment/setWasmIkResolver(null)/feetDebug 恢复/scene+engine dispose（test:113-120）；所有 console spy 均在 finally 中 restore（test:176-178 / 218-220 / 333-334 / 359）；每帧路径零分配（`_applyWasmOverride` 用池复用，feet-adjustment 复用模块级 Vector3）。

---

**风险：（如果有）**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | `ik-resolver-timing.test.ts` :155,181,198 + `bone-override.ts` :653,657,859 | 测试标题/describe/生产注释标 `[ADR-248]`，但官方 `docs/adr/adr-248-derived-cache-reference-key.md` 主题是「派生缓存依赖引用键」，与日志门控无关——该决策无正式 ADR 记录，溯源断裂 | round-18 logger 审计已标 P2 且部分修复（`logger.ts`/`debug-log-panel.ts` 已改为勿引用 ADR-248），本测试文件为新扩散点，与同轮 `2026-08-15-round33-dump-bone-hierarchy.md` 发现一致；日志门控**实现本身正确**（feetDebug 门控 + %60 节流已落地），纯引用卫生问题 | 随 round-18 遗留项统一处置：补立正式 ADR 号，或本测试标题/describe 改注 `[ADR-202 §六]`（真实决策依据），生产注释 `bone-override.ts:653/657/859` 同步 |
| 🟡 P3 | `ik-resolver-timing.test.ts`（跨用例） | 模块级节流计数器 `_overrideApplyDbgFrame`/`_ikWasmDbgFrame`（`bone-override.ts:655,659`）、`_feetDbgFrame`（`feet-adjustment.ts:213`）跨用例不重置，用例间隐式顺序耦合 | 经数学推演：120 帧窗口（=2×60 周期）内 OVERRIDE-APPLY 日志**无论计数器起始偏移恒为 2 条**，当前断言 ≥1/≤2 稳健成立；脆弱性仅在未来新增"feetDebug 开启 + 多帧"用例置于用例4 之前、且新增断言依赖计数对齐时显现——现无失败风险 | 低成本加固：beforeEach/afterEach 重置这些计数器（或导出 reset 钩子），消除隐式顺序依赖 |
| 🟢 P4 | `feet-adjustment.ts` | :253-260 | foundOverride 检查用 `getOverride`（内部 `_slotToEntry` → `toEulerAngles()` 分配，`bone-override.ts:449-462`），每帧每侧 6 候选 ×2 侧 = 12 次查询；无覆盖时 Map miss 零分配、有覆盖时恰为 skip 分支（分配实际可忽略），但与骨架提供的零分配 `getOverrideType`（`bone-override.ts:482-485`，注释明言"适合渲染循环每帧高频调用"）不一致 | 改用 `getOverrideType(cand) !== null` 判定，消除有覆盖场景下的分配，与热路径约定对齐 |
| 🟢 P4 | `ik-resolver-timing.test.ts` | :124 | 场景A 注释失准：称「左足IK 在 Y=1.8 → skip=true」，实际 POS 覆盖先把足 Y 拉至 0（`computeOverride` 加法），feet-adjustment 读到 skip=false，唯一拦截是 foundOverride——注释描述的是覆盖前状态，与真实机制不符 | 虽不影响判别力，但会误导维护者误判场景构造意图；修正注释：点明「override 已把足拉至贴地，feet-adjustment 必须靠 foundOverride 跳过」才是互斥验证点 |
| 🟢 P4 | `bone-override.ts` | :861 | 魔法数值 `0.01`（`slot.pos.length() > 0.01` 判定"有实际位置偏移"）未命名 | 提取命名常量（如 `POS_SLOT_EPSILON = 0.01`），与 round-30 同类建议一致 |
| 🟢 P4 | 测试覆盖建议 | — | 缺「双链同帧各自合法求解」用例：L 有 POS 覆盖 + R 贴地 → 一帧 2 次 resolver 调用是**合法设计**（互斥按链粒度，非全局粒度） | 新增用例断言 `resolverCalls.length === 2` 且守护不 warn，文档化"跨链双调合法"，防止未来把守护误"修"成跨链误报 |

---

**测试质量评价：**

- **断言有效性**：互斥通过「单帧 resolver 调用次数」断言（场景A 精确 `===1` + 互斥不变量用例逐帧 `≤1`）真实验证，且经源码逐帧推演确认场景A 具备判别力（删 foundOverride 即失败），非宽泛或"恰好成立"的断言；场景B/C 覆盖无覆盖分支（贴地调/空中不调），用例3 验证原生优先链，守护用例验证节流行为与次数——断言直接、可归因。
- **mock 合理性**：NullEngine + Scene 真实例（真实 Babylon 引擎 + 真实管线驱动）；骨骼为手写最小 mock（无 `updateWorldMatrix` → `isWasmRuntime` 正确判 WASM 分支），resolver 用 spy 计数；`@/core/state`、`motion-modules/registry` 用 `importActual` spread 保活绑定（ADR-219 卫生），`env-impl` 独立 mock 且有理由注释；被测两模块未 mock，编排真实执行。
- **边界覆盖**：有覆盖/无覆盖、脚贴地/脚空中、单链/双链、连续 10 帧不变量、守护开/关、原生回退链、日志节流开/关、120 帧长跑——覆盖全面；缺口仅为 P4 建议的双链合法 2 次用例。
- **跳过测试**：grep 确认无 `it.skip`/`describe.skip`/`xit`/`todo`。
- **运行验证**：`cd frontend && npm run test -- src/__tests__/scene/ik-resolver-timing.test.ts` → **9/9 通过（267ms）**，与项目基线一致。`npm run check` 未执行（全量 tsc 耗时较长，本测试与被审源码均无类型逃生、改动面为零，风险可忽略；如需可另行补跑）。

---

审核日期：2026-08-15
审核员：子代理 round33-ik-resolver-timing
