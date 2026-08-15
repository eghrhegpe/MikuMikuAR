# Round-21 审核报告 — proc-motion 状态迁移（migrateProcState / DEFAULT_PROC_STATE）

> **审核日期**: 2026-08-15
> **审核员**: 子代理 round21-proc-motion-migrate
> **本轮**: round-21 / 测试 3（共 3）

## 审核范围

- **测试文件**: `frontend/src/__tests__/proc-motion-migrate.test.ts`（92 行，6 用例）
- **被测源码**: `frontend/src/motion-algos/proc-motion-shared.ts`：
  - `DEFAULT_PROC_STATE` — 87-96 行
  - `migrateProcState` — 114-157 行（含 `_fallbackParams` 99-105、`mergeParams` 128-132、扁平分支 141-156）
  - 类型 `ProcMotionState`/`ProcMotionParams` — 36-61 行
- **入口间接层**: `frontend/src/motion-algos/procedural-motion.ts`（25 行 barrel，`export * from './proc-motion-shared'` 第 1 行）——测试 import 经此取到目标符号，路径正确
- **迁移消费端**（旁证）: `scene/scene-serialize.ts:729/1037/1154/1201`、`scene/motion/proc-motion-params.ts:168`、`scene/motion/proc-motion-controller.ts`

## 总体结论：✅ 通过

`migrateProcState` 迁移函数本身体系完整：枚举校验、per-category 深合并、两模式引用隔离、兜底默认、死字段注释（`[audit:dead-field]`）齐备；纯函数无资源/并发问题；测试 6/6 全绿（`npm run test -- src/__tests__/proc-motion-migrate.test.ts`，2.12s）。范围内**无 P1/P2**。风险集中在维护性（P3×3、P4×4），不阻塞。

### 与既往轮次的关系（核实结果）

| 轮次 | 覆盖情况 |
|------|----------|
| round-15 (2026-08-07) | `proc-motion-shared` 审为 ⚠️ 有条件通过（round15-motion-algos.md:126-128），当时已确认 `migrateProcState`「迁移逻辑完整（枚举校验 + 深合并 boneToggles + 旧扁平→新嵌套）」；⚠️ 成因是 `matchBone` P1，**非迁移函数本身**。companion 报告 round15-motion-pipeline-perception-proc.md:144 记录了 `setProcMotionState` 经 migrateProcState 兼容旧存档 |
| round-15 之后（b50c5a63 / d0485aed / 6f34e81f） | ADR-233 per-mode 落地 + 硬化：`_fallbackParams` 独立兜底、`[fix:P2#1]` 扁平分支逐类别补默认、`[fix:P3#1]` 嵌套分支深合并 + 引用隔离、死字段注释 |
| 本文件（250db540 创建、da3d41d4 分流 node 环境） | 专测文件补充全字段等价与 P3#1 回归用例；**与 procedural-motion.test.ts:488-584 既有 migrateProcState 块大量重叠**（见测试质量小节） |
| ⚠️ 遗留（超范围 FYI） | round-15 P1#1 `matchBone`（proc-motion-shared.ts:298-303）至今**未修**：首个候选不可编码时仍 `return null` 而非 `continue`。不在本次迁移函数范围内，但同文件，提请协调者关注 |

## 亮点

- **枚举校验防静默丢参** — `proc-motion-shared.ts:118-120`：`mode` 用 `PROC_MOTION_MODES.includes(...)` 校验而非裸 `?? 'off'`，脏存档任意字符串不会穿透到 UI 断言层（`[fix:P3]` 注释完整记录动机）。
- **per-category 深合并，防部分覆盖静默关类别** — `proc-motion-shared.ts:126-132`：`boneToggles: { ..._fallbackParams.boneToggles, ...(p?.boneToggles ?? {}) }`，缺键补默认 true；`[fix:P3#1]` 注释点明修复前其余类别变 `undefined` 的缺陷。扁平分支 `:146` 与新结构分支对称（`[fix:P2#1]`）。
- **两模式引用隔离** — `proc-motion-shared.ts:153-154`（扁平）与 `mergeParams` 内每次新建 `boneToggles` 对象（嵌套），`idle`/`autodance` 不共享引用、互不污染；`_fallbackParams.boneToggles` 从不出借给调用方。测试用 `toBe`（引用恒等）断言，非 `toEqual` 糊弄。
- **兜底默认不依赖 DEFAULT_PROC_STATE** — `proc-motion-shared.ts:98-105`：`_fallbackParams` 独立于 `DEFAULT_PROC_STATE`，测试 mock 为 `{}` 时迁移不崩（scene-serialize 系测试依赖此设计）。
- **类型安全** — 全文件 0 处 `as any`/`@ts-ignore`/`@ts-expect-error`/空 `catch{}`（grep 核实）；`raw: unknown` + 窄化断言收口序列化输入，`r.mode!` 非空断言前有 includes 守卫（round-15 已确认合理）。
- **死字段显式标注** — `proc-motion-shared.ts:41/50-53`：`vpdApplyEnabled`/`bpmQuantizeEnabled` 标注 `[audit:dead-field]` 及清理前置条件，防误判为缺口。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | proc-motion-shared.ts | 128-132（mergeParams）vs 142-143（扁平分支） | **NaN 防御不对称**：扁平分支 intensity/speed 过 `guardNum`，嵌套分支 `mergeParams` 直接 `...p` 透传，`params.idle.intensity = NaN` 可进入渲染数学（guardNum 正是为此引入，见 c32e0c67）。JSON 无法序列化 NaN（串化为 null）故实际可达性低，但防御深度不一致，且现有 NaN 测试只覆盖扁平路径 | mergeParams 内对 `p.intensity`/`p.speed` 也过 `guardNum`，与扁平分支对称；补一条嵌套 NaN 用例 |
| 🟡 P3 | proc-motion-shared.ts | 79-85 vs 99-105 | `_defaultParams` 与 `_fallbackParams` 双份相同字面量（intensity 0.5 / speed 1.0 / vpdApplyEnabled false / interpOverride 'auto'）。改默认值时若只改一处，迁移默认与 DEFAULT_PROC_STATE 漂移（现有测试恰以 DEFAULT_PROC_STATE 为基准断言，能兜住但属隐式护栏） | `_fallbackParams` 基于 `_defaultParams` 派生（`{ ..._defaultParams, boneToggles: { ..._defaultBoneToggles } }`，两者均不依赖 DEFAULT_PROC_STATE，保留 mock 抗性），消除重复源 |
| 🟡 P3 | proc-motion-migrate.test.ts vs procedural-motion.test.ts | 用例 5/6（:66-91）vs :530-563 | **测试重复**：本文件 P3#1 回归用例与 procedural-motion.test.ts 既有 migrateProcState 块近乎逐字重复（per-category 补默认、引用独立）。同一行为变更需双文件同步，存在漂移风险；与 frontend/AGENTS.md 测试卫生（防重复形状）理念相悖 | 二选一：保留专测文件、裁剪旧文件重复块（旧块只剩 null/NaN/未知 mode 等补充用例），或反向合并；避免两份同义断言并存 |
| 🟢 P4 | proc-motion-shared.ts | 148（扁平）、128-132（嵌套） | `interpOverride` 无枚举校验：脏值（如 `'bogus'`）透传。消费端 `proc-motion-autodance.ts:122-126` if/else 链兜底不崩，脏值静默落默认分支 | 与 mode 同法校验四个合法值，失败回落 `'auto'`；或接受现状并在注释说明消费端兜底（当前无注释） |
| 🟢 P4 | proc-motion-migrate.test.ts | 52-56（用例 3）、36-50（用例 2） | 用例 3 标题「undefined / 空对象」但仅测 undefined（`{}` 在 procedural-motion.test.ts:500 有覆盖，标题与实际不符）；用例 2 未断言 `mode`（传入 'autodance' 未验证保留） | 补 `migrateProcState({})` 到本用例；用例 2 加 `expect(s.mode).toBe('autodance')` |
| 🟢 P4 | 消费端（旁证） | proc-motion-params.ts:67、menus/model-detail.ts:101 | `{ ...DEFAULT_PROC_STATE }` 浅拷贝共享 `params` 引用（模块级常量可被穿透污染）。当前写路径均整体替换（`_writeProcState` 重建 params），无原地写 params 的调用方，故安全，但属易碎模式 | 消费端统一走 `_defaultParamsFor(mode)` 式深拷贝，或为 DEFAULT_PROC_STATE 增加只读约定注释 |
| 🟢 P4 | 全仓测试 | — | 无 `migrateProcState` 幂等性用例（`migrate(migrate(x)) === migrate(x)`，嵌套结构实际幂等但未固化） | 专测文件补一条：对已迁移结果再迁移，断言逐字段不变 |

## 测试质量评价

**优点**：
- 断言有效：全字段等价（用例 1 覆盖 mode/顶层开关/两模式 intensity/speed/boneToggles/interpOverride/vpdApplyEnabled）+ 引用恒等用 `toBe`（用例 1/6）+ 默认值断言直接引用 `DEFAULT_PROC_STATE`（用例 3/4，防硬编码漂移）。
- 边界覆盖面：旧扁平全字段（1）、新嵌套保留差异（2）、undefined（3）、部分字段缺 boneToggles（4）、嵌套部分覆盖逐类别补默认（5）、嵌套两模式引用独立（6）——迁移映射的两大风险点（静默丢类别、共享引用污染）均有专门回归用例。
- 用例注释带缺陷来源（`P3#1 回归`），可追溯修复历史。

**缺口**：
1. 用例 3 标题/实测不符（未测 `{}`）；用例 2 未断言 mode 保留（见 P4 行）。
2. 未知 mode、NaN、`{}` 空对象在本文件缺失——但在 `procedural-motion.test.ts:491-583` 已覆盖，总体覆盖完整，仅属文件内自洽性瑕疵。
3. 嵌套分支 NaN 无用例（与 P3 第 1 行呼应）；幂等性无用例（P4 末行）。
4. 无 `it.skip`/`it.todo`/`test.skip`（grep 核实），无跳过测试。

**运行验证**：`cd frontend && npm run test -- src/__tests__/proc-motion-migrate.test.ts` → 6/6 passed（2.12s），基线全绿，符合预期。`npm run check`（tsc 全量）未运行——迁移函数为纯类型代码且本轮无修改，耗时权衡下跳过，特此注明。

## 审核范围外备注

- round-15 P1#1 `matchBone`（proc-motion-shared.ts:298-303）仍未修复（`return null` → 应为 `continue`），与本次迁移函数无关但同文件，建议协调者安排修复轮次。
- 生产代码与测试文件均未修改（锁文件制合规），仅写入本报告。

---
**审核日期**: 2026-08-15
**审核员**: 子代理 round21-proc-motion-migrate
