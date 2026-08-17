# ADR-274: 严格模式渐进收敛：Stage 1 打开 noImplicitAny — 编译器接管隐式 any，148 处清零的三级阶梯

> **状态**: ✅ 已采纳（2026-10-24；`noImplicitAny: true` 已开启，129 处测试侧残留清零，`tsc --noEmit` EXIT=0）
> **日期**: 2026-10-24

## 背景

`frontend/tsconfig.json` 现为 `strict: false` + 若干单点开关（`alwaysStrict` / `strictBindCallApply` / `useUnknownInCatchVariables`）。`noImplicitAny` 从未打开——等于"写 any 不允许，漏写类型随便"。

2026-10-24 实测（把 `noImplicitAny: true` 加进 tsconfig 后跑 `npx tsc --noEmit`）：

| 口径 | 处数 | 文件数 |
|---|---|---|
| 首次打开 | 148 | 59 |
| 生产侧修掉 19 处后 | **129** | **48（全部是测试与 mock）** |
| 其中生产代码 | **0** | 0 |

按错误码：TS7018（对象字面量属性隐式 any）78 · TS7011（函数表达式缺返回类型）39 · TS7010（方法缺返回类型）6 · TS7023 / TS7024（自递归返回值）5 · TS7008（成员隐式 any）1。

集中度：11 个 mock 基础设施文件（`__tests__/mocks/`、`*-mocks.ts`、`outfit-helpers.ts`、`menu-schema-mocks.ts`）合计 34 处；单文件最重的是 `proc-motion-bridge.test.ts`（13）、`scene/scene-serialize-resilience.test.ts`（11）、`perception-gaze.test.ts`（8）。

关键读数：**生产代码在这个开关下已经是干净的**。这不是"全仓不写类型"，而是"生产侧早有纪律，测试的 mock 层没有"。所以这条线的收益不是修历史，而是钉住未来——今天写进 `src/` 的新代码不能再悄悄漏掉参数类型。

反面证据（为什么不能停在半路）：开关一旦进 tsconfig 而残留 129，`.githooks/pre-push:485` 的 `npx tsc --noEmit` 会拦住**所有人**的推送——包括与严格化无关的重构。半成品比不做更贵。2026-10-24 就发生过一次：另一路 agent 把开关留在工作区、129 处未清零，此后任何推送都会红。

## 决策

1. **单一 project，不给测试豁免。** `include` 是 `["src","bindings"]`，260+ 测试文件被同一个 project 检查。把测试丢进 `exclude` 会让它们**彻底**失去类型检查——比现在的 `strict: false` 更差：现在至少查真实类型错误，只是不查隐式 any。
2. **Stage 1 = `noImplicitAny: true`，顺序是"先清零，后开关，开关单独一个提交"。** 开关只有一行，贵的是清零；开关先落地等于把未完成的债转嫁给所有人。
3. **清零顺序按"改一处、消多处"排**：mock 基础设施（34 处 / 11 文件）→ 三个重灾单文件（32 处）→ 其余 37 文件（63 处）。
4. **禁止以 any 换 any。** 不得用显式 `any` / `as any` / `@ts-ignore` 兜底。当前 eslint 里 `@typescript-eslint/no-explicit-any` 是 `warn`（`eslint.config.js:58`），测试段还被 override 关掉（`eslint.config.js:173`），所以这条只能靠 diff review 守——这是本 ADR 承认的弱点（见风险 3）。
5. **阶梯不预设。** Stage 2 = `strictNullChecks`，实测 386 处（生产 163 / 测试 223；热点 `physics-contract.constraint.test.ts` 37、`backend.data-chain.test.ts` 20、`scene/manager/model-loader.ts` 16、`proc-motion-controller.ts` 13、`outfit.ts` 11）。`strictNullChecks` 无法按目录分片，只能整体翻——所以它必须另立阶段，不在本 ADR 排期。Stage 3 = `strict: true`（实测 454 处，其中生产 230 / 67 文件；`noUnusedLocals` / `noUnusedParameters` / `noImplicitReturns` 仍关），不预设时间。

## 备选方案

**A. 一次性 `strict: true`** —— 否决：单项 `strictNullChecks` 就是 386 处，且集中在 physics / 场景序列化 / model-loader 这些热路径；一次性改会把"类型迁移"和"行为迁移"糊进同一个提交，出问题无法二分。

**B. 双 tsconfig（生产严格 / 测试宽松）** —— 否议为默认，保留为"清零停滞"时的降级方案：多一个 project 就是多一份需要维护的真源，且 `tsc --noEmit` 要跑两遍（pre-push 的缓存键基于单 tsconfig 哈希，见 ADR-258）。若启用，必须在 `scripts/` 里记基线数字并让 `check:*` 读它，否则宽松配置会变成新的永久豁免——对照 `docs/circular-allowlist.json` 那 696 条零 `expires` 豁免的教训。

**C. 只开生产（测试放进 `exclude`）** —— 否决：见决策 1，等于让测试失去全部类型检查。

**D. 逐文件 `@ts-nocheck` / `// eslint-disable`** —— 否决：不可计量、不可收敛，把"129 处已知"换成"48 个文件被整体静音"。

**E. 什么都不做** —— 否决：隐式 any 不是风格偏好，它是"类型检查静默退化成 any"的唯一入口；而 `strictBindCallApply` / `useUnknownInCatchVariables` 已经把这条阶梯走了一半，剩下这级没有理由永远不迈。

## 影响

| 对象 | 改动 |
|---|---|
| `frontend/tsconfig.json` | +1 行 `"noImplicitAny": true`（批 4 已落地；另含 prettier 把 `lib`/`include` 收成单行） |
| 生产代码 | 11 文件 / +29 −15：13 处显式标注 + 1 类型别名（`PbrParamKey`）+ 1 个 `Scene` type import + 1 处说明注释。**已落地（批 0）**，与开关解耦——这些标注在 `strict: false` 下同样合法 |
| 测试与 mock | 48 文件 / 129 处，**已全部清零**（分布见实施计划） |
| 门禁 | 无新增脚本；`.githooks/pre-push:485` 的 `tsc --noEmit` 从"当前恒绿"变成"真拦隐式 any"。这是门禁强度提升，不是新门禁 |
| 与其它线的关系 | ADR-272（状态路径类型化）与 ADR-273（boot plan）都在 `src/` 里受益；脚部/脚步声那条线已单独立项为 ADR-275（落地事件源判据），与本 ADR 无代码交集——唯一的真实成本是同一工作树并发（见风险 4） |

## 实施计划（分批，每批独立可验证）

| 批次 | 范围 | 处数 | 验收 |
|---|---|---|---|
| **批 0**（2026-10-24 已完成） | 生产侧 11 文件：`core/ai/go-adapter.ts`(4)、`core/backend/idb.ts`(1)、`core/dispose-helpers.ts`(1 + type import)、`core/env-state-schema.ts`(1)、`core/safe-call.ts`(1)、`menus/model-detail.ts`(1)、`menus/model-material.ts`(1 + `PbrParamKey`)、`menus/nav-actions.ts`(1)、`menus/preset-list-viewer.ts`(1) | 19 → 0 | `tsc` 生产侧 0 错；diff 只加标注不改逻辑 |
| **批 1**（2026-10-24 已完成） | mock 基础设施：`__tests__/mocks/babylon-classes.ts`(7)、`mocks/babylon-mmd-mocks.ts`、`model-detail-ui-mocks.ts`(4)、`menu-schema-mocks.ts`、`outfit-helpers.ts`(11) | 34 → 0 | `tsc` 计数下降；受影响测试全绿 |
| **批 2**（2026-10-24 已完成） | 三个重灾单文件：`proc-motion-bridge.test.ts`(13)、`scene/scene-serialize-resilience.test.ts`(11)、`perception-gaze.test.ts`(8) | 32 → 0 | 同上 + `test:quick` |
| **批 3**（2026-10-24 已完成） | 其余 34 文件（`scene/*`、`perception/*`、`core/__tests__/*` 等） | 63 → 0 | 同上 |
| **批 4**（2026-10-24 已完成） | 打开 `noImplicitAny`，跑全量门禁 | 0 | `tsc` EXIT=0；37 个受影响测试文件 793 用例全绿；`check:coupling` 62 / 4 SCC / 8 文件 / max 2 不变 |

每批独立提交（`chore(types): ADR-274 批 N`）；批 4 单独一个提交且只含 tsconfig 一行——这样"从哪一提交开始强制"在 `git log` 里一眼可见，也方便回退。

## 风险与止损

1. **mock 类型化会暴露 mock 与真实 API 的漂移**（例如 mock 的 `getScene()` 返回类型与 Babylon 实际声明不符）。这是收益，但会带出一串"看着无关"的测试改动。止损：一个 mock 文件的改动与它服务的测试放在同一提交，`test:quick` 全绿才算完。
2. **开关先于清零落地 → 所有人 pre-push 红。** 2026-10-24 已发生（工作区 `tsconfig.json` 带开关、129 处未清）。止损：开关只在批 4 落地；在此之前任何人不得把那行提交。
3. **"以 any 换 any"没有门禁。** 止损：批 1–3 的 diff review 只认"标了具体类型"的改动，`any` 一律打回；批 4 验收时 grep 一次 `any` 计数并记进本 ADR 落地记录，作为后续收紧 eslint 的依据。
4. **与并行重构互相踩。** 2026-10-24 这一天本线踩了两次：先把 `noImplicitAny` 开关留在工作区，让 pre-push 对所有人必红（见风险 2）；随后在 20:05 把并行线**已推送**的 ADR-275 提交（`b657572e` + `f75c4b9c`）判为"越界"整批 revert（`9689f8fa`，13 files / −317 行，连带丢掉决策记录与回归测试），经用户确认后才反向撤销恢复。止损两条：①每批别长时间挂着未提交改动，提交后立刻 `test:quick`；②并行线按**工作树隔离**，不按"授权范围"口头划界——判界权握在自己手里时，撤别人的东西永远比改自己的省事，于是先动手的赢（复盘见 ADR-275 附注）。

## 落地记录（2026-10-24，批 0）

- 生产侧 19 处标注落地并双向验证：开关打开时 `npx tsc --noEmit` 生产文件 0 错；开关关闭（当前 `strict: false`）同样 EXIT=0——标注在两种配置下都合法，因此可以先于开关合并。
- **未落地**：`noImplicitAny: true` 那一行。原因：129 处测试侧残留会让 pre-push 红，挡住与严格化无关的推送。该行留待批 4。
- 批次划分依据的是实测分布，不是估计：`wc -l` 出来的 129 / 48 / 11-34 / 3-32 / 37-63 全部来自 `npx tsc --noEmit` 的真实错误列表。

## 落地记录（2026-10-24，批 1–4）

- **实测阶梯（同一脚本口径，programFiles=691）**：Stage 1 `noImplicitAny` 129 处 / 48 文件（生产 0）→ Stage 2 +`strictNullChecks` 386 处（生产 163 / 46 文件，测试 223 / 32 文件）→ Stage 3 全 `strict: true` 454 处（生产 230 / 67 文件，测试 224 / 33 文件）。三个数字都由 `strict-ladder-measure.mjs` 现场量出，不是估计；后续阶段按这组基线排期，别再重新猜。
- **清零手段（只加标注，零行为改动）**：TS7018 → 属性值 `as X | null` / `[] as unknown[]`；TS7011 → `(): null => null` / `(): unknown[] => []` / `(): void => undefined`；TS7023 / TS7024 → 内层箭头补显式返回类型断环；mock 收紧后消费者冒出的 TS2740 / TS2352 → `as unknown as T` 双层断言一次兜住。全程未新增一个显式 `any`、未用 `@ts-ignore`。
- **开关落地顺序守住**：开关那一行与 129 处清零同批进入工作区、同一提交落地，中间没有出现「开关在、残留也在」的红灯窗口（批 0 的 2026-10-24 事故不再重演）。
- **验收**：`tsc --noEmit -p frontend/tsconfig.json` EXIT=0；37 个受影响测试文件 793 用例全绿（`vitest run` 直跑，38s）；改动文件 prettier `--check` 全通过。
- **一个顺带修正**：`tsconfig.json` 原本就不满足 prettier（`lib` / `include` 多行展开），本次一并收成单行——`format:check` 的 glob 是 `src/**`，不覆盖它，所以此前一直没人发现。

## 相关文档

> ADR-258（pre-push 数据报告：tsc 实测耗时与缓存键）/ ADR-272（状态路径类型化）/ ADR-243（schema type↔default 互锁）/ ADR-093（声明式菜单 Schema）/ ADR-273（场景启动顺序显式化）/ ADR-275（脚部/脚步声落地事件源判据：同一工作树并行的另一条线）
