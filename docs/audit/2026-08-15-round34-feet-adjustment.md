# [round-34] feet-adjustment 纯数学层 solveFootTarget — 审核结果

> 审核目标：`frontend/src/__tests__/feet-adjustment.test.ts`（187 行，15 用例）及其被测源码 `frontend/src/motion-algos/feet-adjustment-math.ts`（105 行）的 `solveFootTarget`（:46-105）。

## 头部

- **审核范围**：测试文件 `frontend/src/__tests__/feet-adjustment.test.ts`（15 用例）+ 生产源码 `frontend/src/motion-algos/feet-adjustment-math.ts:46-105`（`solveFootTarget` 数学求解）。上游引用：`frontend/src/core/types.ts:91-109`（FeetState）、`frontend/src/core/clamp.ts:14-16`（clamp01）、`frontend/src/core/scene-state.ts:51-62`（createDefaultFeetState 工厂）、引擎消费点 `frontend/src/scene/motion/feet-adjustment.ts:203-211`。
- **验证**：`cd frontend && npm run test -- src/__tests__/feet-adjustment.test.ts` → **15 passed (15)，35ms，基线全绿**。`npm run check` 未跑（纯只读审核、零代码改动，tsc 全量耗时长，按任务约定跳过并在此注明）。
- **总体结论：✅ 通过**（P1=0，P2=0，P3=3，P4=2）。纯数学层实现干净、类型安全、零 Babylon 依赖，测试断言真实有效；3 项 P3 均为边界语义/健壮性/上下游漂移，无阻断性缺陷。

### 与既往轮次关系（三层分工核实）

| 轮次 | 记录 | 本轮核实结果 |
|---|---|---|
| round-12 P1#3 | `2026-08-06-round12-env-motion-core-ai.md:26`「feet-adjustment 引擎本体零直接测试，仅 `feet-adjustment.test.ts` 测 `solveFootTarget`」 | ✅ 属实：round-12 时本文件是唯一守护；其定位正是「纯数学层」 |
| round-23 | `2026-08-15-round23-feet-adjustment-engine.md` 补测 `feet-adjustment.engine.test.ts`（29 用例，引擎接线层），并明确「footSmooth/intensity/soleHeight/reachAngle 均属纯数学 solveFootTarget，已被 feet-adjustment.test.ts 覆盖，双层分工清晰」 | ✅ 分工成立：引擎层 mock 5 个接线模块、穿透真实 solveFootTarget；数学层零 mock 直测。**小漂移**：round-23 报告称本文件「16 用例」，实测为 **15 用例**（round-23 计数偏差，非本次引入） |
| round-34（本轮） | 审核本文件 + `feet-adjustment-math.ts` solveFootTarget | 三层闭环：数学层（本轮）→ 引擎接线层（round-23）→ 落地事件/骨骼写入（round-12/23），无重复盲区 |

---

## 亮点

- **零依赖纯函数，分层极干净**：`feet-adjustment-math.ts` 仅 import `@/core/types`（type-only）与 `@/core/clamp`（ADR-191 合规叶导入，无神桶），无 Babylon/scene/env 运行时依赖（:1-6 注释明示设计意图）；引擎在 `feet-adjustment.ts:203-211` 直调，职责边界清晰。
- **NaN 守卫防骨骼污染**：:51-59 对 5 个位置类输入（footY/groundY/centerY/hipToFootDist/legLength）统一 `Number.isFinite` 守卫，skip 时 targetY 回传 footY 且引擎 skip 分支置 `cache.lTargetY=null`（引擎 :318-324）——跳过后 prevTargetY 归零，避免陈旧平滑基准污染落地帧，两层配合严密。
- **相对阈值语义正确且带回归测试**：`modelGroundY = max(groundY, centerY - legLength)`（:64）承接 ADR-085「相对地面高度判定」修复，测试 :115-133 两条高地形用例（坡顶落回不误判抬脚 / 真正抬起仍跳过）双向锁定，非 happy-path 单测。
- **reach 穿地缺陷已修复且被测试钉死**：:75 门控 `footY >= groundY`（脚已穿地时不下沉），测试 :135-165 一正一反（穿地不上推 reach / 恰贴地仍可下沉）回归保护，边界语义完整。
- **测试断言全部指向真实数学结果**：15 用例均以 `toBeCloseTo` 断言具体数值，注释逐行给出期望公式（如 :65 `0.2 + (0 - 0.2) * 0.5 = 0.1`），非空转断言；`@vitest-environment node` + 零 mock + 直引叶模块，符合测试卫生铁律。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟡 P3 | `frontend/src/motion-algos/feet-adjustment-math.ts` | :89（`desiredY > footY` 平滑门控） | **平滑分支边界破坏防穿插不变量**：上推立即贴合条件是 `desiredY > footY`，当 `desiredY == footY`（脚恰在目标高度）落入下拉平滑分支。若 `prevTargetY < desiredY`（如脚贴地、地形抬升到与脚等高，或脚从低处地面平移上坡），`targetY = prevTargetY + (desiredY - prevTargetY) * a` 会产出低于地面的目标（例：footY=0.3, desiredY=0.3, prevTargetY=0, a=0.5 → targetY=0.15），脚被压入地下数帧后自愈收敛。引擎侧无此问题的常规路径（跳跃后 prevTargetY 已被置 null），但「贴地脚 + 地形恰好同步抬升」场景理论可达。 | 门控改 `desiredY >= footY` 走立即贴合；或下拉分支对结果钳制 `targetY = Math.max(targetY, desiredY)`（footY ≥ desiredY 时目标不得低于 desiredY）；补一条 `desiredY == footY && prevTargetY < desiredY` 用例固化。 |
| 🟡 P3 | `frontend/src/motion-algos/feet-adjustment-math.ts` | :51-59 | **NaN 守卫只覆盖位置输入，未覆盖 feet.\* 参数**：`soleHeight`/`footSmooth` NaN 会沿 `desiredY`/平滑链把 NaN 写进 targetY（引擎 :328 直接 `_vTarget.set(..., res.targetY, ...)` 写骨，无二次守卫）；`jumpThreshold` NaN 使 `footY - modelGroundY > NaN` 恒 false，**跳跃跳过被静默禁用**（空中脚被拉回地面）。UI 滑块有界（0.1~2 等）降低触发概率，但 `FeetState` 经 scene-serialize 持久化恢复（JSON null→NaN 路径）可注入。 | 守卫扩至 `feet.jumpThreshold/soleHeight/footSmooth`（reachAngle/maxAngle NaN 仅静默跳过钳制，危害低可豁免）；或对 targetY 输出前 `Number.isFinite` 兜底；补 feet 参数 NaN 用例。 |
| 🟡 P3 | `frontend/src/core/scene-state.ts:56`（上游，影响被测语义）+ `frontend/src/__tests__/feet-adjustment.test.ts:12` | **生产默认值漂移**：`createDefaultFeetState()` 实际 `jumpThreshold: 9999`（scene-state.test.ts:48 已锁定该值），而 ADR-085 §状态管理 文档默认 0.5（范围 0.1~2）、本测试夹具 `defaultFeet` 也用 0.5。后果：(a) 夹具与生产默认不一致，测试保护的「0.5 阈值语义」与出厂行为脱节；(b) 用户启用贴地后跳跃跳过几乎永不触发（`footY - modelGroundY > 9999` 恒 false），跳跃动画脚会被拽回地面，与 ADR-085 设计语义（默认 0.5）冲突；(c) `frontend/src/menus/` 全目录零 feet 引用——ADR-085 计划中的 `motion-feet-levels.ts` 菜单/`motion:feet` 入口不存在，阈值不可 UI 调节。 | 三选一：工厂改回 0.5 并同步 scene-state.test.ts；或确认 9999 为有意设计（WASM IK 修复 commit ce02492d 引入）→ 更新 ADR-085 默认值文档 + 测试夹具对齐；无论哪种，夹具应从工厂派生而非硬编码 0.5。 |
| 🟢 P4 | `frontend/src/motion-algos/feet-adjustment-math.ts` | :74-75, :81 | 魔法数值：`1e-4`（退化腿长门控）与引擎 `feet-adjustment.ts:198` 的 `1e-3`（腿长下限兜底）同一语义却量级不一致；`Math.PI / 180` 两处重复。 | 提取具名常量（`DEG2RAD`、`LEG_LENGTH_MIN_EPS`）并统一两文件阈值，加互链注释防漂移。 |
| 🟢 P4 | `frontend/src/__tests__/feet-adjustment.test.ts` | 全文件 | **centerY/modelGroundY 分支零覆盖**：:64 `Math.max(groundY, centerY - legLength)` 是 ADR-085 相对阈值语义的另一半（模型自然脚高），但全部夹具 `centerY - legLength == groundY`（默认 centerY=1, legLength=1, groundY=0），max() 恒解析为 groundY，`centerY - legLength > groundY` 分支从未执行（引擎级 round-23 仅测 centerY 缓存，未测该数学分支）。极值参数（intensity=0 / maxAngle=0 / footSmooth=0/1）亦未测。 | 补「模型抬高」用例：`centerY=3, legLength=1, footY=2.2, groundY=0`（自然脚高 2，脚高 2.2 < 阈值 0.5 相对自然脚高 → 不跳过、下拉贴地）；补极值参数用例。 |

---

## 测试质量评价

- **有效性（强）**：15 用例全部通过（Vitest 实测 35ms），断言指向可复核的数学数值（`toBeCloseTo` + 注释给出期望公式），跳过/贴地/下沉各分支的 skip、targetY、grounded 三字段组合断言（如 :37-39、:120-123、:148-149），无「只测不崩」空转。
- **边界覆盖（优）**：跳跃阈值等值边界（:108-113）、相对阈值双向（高地形坡顶/真抬起，:115-133）、reach 穿地缺陷回归 + 恰贴地边界（:135-165）、NaN 双守卫（:167-178）、legLength=0 除零防护（:180-186）——正反用例成对，非 happy-path。
- **无跳过**：全文件无 `it.skip`/`describe.skip`/`xit`/`todo`（grep 确认，唯一 `.skip` 命中均为 `expect(r.skip)` 断言）。
- **mock 卫生（优）**：零 mock、零 Babylon 依赖，`@vitest-environment node`；类型仅 `import type`；直引叶模块 `../motion-algos/feet-adjustment-math`（不经过引擎 barrel），夹具 `defaultFeet`/`input` 结构完整覆盖 `SolveFootInput` 全字段。
- **盲区（轻微）**：① centerY/modelGroundY 分支零覆盖（P4-2）；② feet.\* 参数 NaN 未测（P3-2 同源）；③ `desiredY == footY` 平滑边界未测（P3-1 同源）；④ intensity=0 / maxAngle=0 / footSmooth=0/1 极值未测；⑤ 上推立即贴合仅测了 `prevTargetY=null` 路径，非 null prevTargetY 下的立即贴合（:91）未直测（代码路径平凡，风险低）。以上均不影响本轮通过结论。

---

**审核日期**：2026-08-15
**审核员**：子代理 round34-feet-adjustment
