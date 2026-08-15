# library-session-store 模块 — 审核结果（round-23 / ADR-135 回归测试）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/library-session-store.test.ts`（168 行，12 用例，无跳过） |
| 被测源码 | `frontend/src/menus/library-session-store.ts`（253 行）— `reset()` :243-249；restore.status 状态机 :17,127-190（`markRestorePolling` :145-150 / `markRestoreTimeout` :156-161 / `markRestoreReady` :168-174 / `clearRestoreStatus` :177-182 / `clearStatusTimer` :185-190）；`setRestoreTimer` :107-113 / `clearRestoreTimer` :114-119 |
| 间接涉及 | `frontend/src/menus/library-browse.ts` `deferRestore` :70-130（状态机消费方：polling 入口、6s 超时、ready 收尾）、`showModelPopup` :345-374（`reset()` 唯一生产调用点）；`frontend/src/menus/library-actions.ts` `prepareModelRestore` :110-164（pending* 写入方） |
| 契约基准 | `docs/adr/adr-135-library-session-store.md`（P0.1 reset 清理 / P0.3 状态机 / P1.2 per-model 守卫）；`docs/knowledge/library-session-store.md` invariant「'idle' → 'polling' → 'ready' / 'timeout'」 |

**验证结果**：`npm run test -- src/__tests__/library-session-store.test.ts` → 12/12 通过（65ms，node 环境）；`npm run check`（tsc + i18n parity）→ exit 0 全绿。

## 二、总体结论

✅ **通过**

- **生产代码健康**：无 P1/P2。0 处 `as any`/`@ts-ignore`/`catch{}`；双 timer 句柄（`restore.timer` 轮询 + 私有 `statusTimer` ready 自回转）所有写入点先清旧后设新，无残留路径；纯数据单例零 import 依赖（无循环依赖风险）；`reset()` 语义精确——清 restore 残留态但显式保留 loading 守卫，与 ADR-135 注释契约一致。
- **测试有效**：12 用例全部断言真实 store 方法（无模块级 mock）；ready 自回转用 1999/2000ms 边界精确锁定；`setRestoreTimer` 用 `spyOn(globalThis,'clearTimeout')` 直接断言旧句柄被清理；单例隔离（beforeEach 五连重置 + afterEach 双清 + fake timer try/finally）干净。
- **P3/P4 建议（不阻断）**：ready 自回转 2000ms 与「6 秒超时」为魔法数值且超时实现在消费方；`reset()` 中一处冗余 `clearStatusTimer()`；ADR 验收标准「14 个用例」与实际 12 个存在文档漂移；测试对 reset+ready-pending-timer 交错、timeout→polling 跨态转换未直接覆盖（均有 afterEach 掩盖泄漏的盲区）。均为维护性层面，不影响当前正确性。

## 三、亮点

- **reset() 清理语义精确且被测试锁定**：`library-session-store.ts:243-249` 清 `restore.timer` + `statusTimer` + status/pending*，但**不重置 loading**（extraction Set / replaceLoading），注释明确「解压/替换可能在弹窗重置期间进行，跨弹窗重置是合理场景」；测试第 4 条（`library-session-store.test.ts:60-68`）专门断言「does NOT reset loading guards」，双向防止过度清理回归——这是 P0.1 修 bug 行为变更（原代码不清理残留态）的核心守护。
- **状态机所有写入点先清 statusTimer，无泄漏路径**：`markRestorePolling` :146 / `markRestoreTimeout` :157 / `markRestoreReady` :169 / `clearRestoreStatus` :178 四个入口全部先 `clearStatusTimer()`；ready 瞬态自回转 timer（`statusTimer` :86）与 deferRestore 轮询 timer（`restore.timer`）**双句柄分离管理**（:82-84 注释），互相不覆盖。测试 :114-125 用 `advanceTimersByTime(10000)` 证明 polling 重入后 ready 自回转已被取消（推进 10s 仍为 polling）。
- **setRestoreTimer 重设前清旧 timer**（:107-113）：配合消费方 `deferRestore` 入口 `clearRestoreTimer()`（`library-browse.ts:71`），并发 deferRestore 只保留最后一个轮询、旧 timer 不残留；测试 :144-156 直接 spy `clearTimeout` 断言 `t1` 被清理，是「清旧句柄」行为的实证（非形状断言）。
- **状态机类型化 + UI 可穷举**：`LibraryRestoreStatus` 为字面量联合（:17），`status/targetSeg/startedAt` 三字段协变契约（polling 时有值、ready/timeout 清空）在 :72-96 三组用例逐一断言，消费方 UI（「正在扫描 X…/已等待 Ys」）可安全分支。
- **纯数据单例、零依赖**：store 不 import 任何 library-* 模块（ADR-135 :169 设计目标落实），无 DOM/Babylon 引用；`// @vitest-environment node` 标注与纯数据特性匹配，规避 window 污染（ADR-219 教训）。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/menus/library-session-store.ts | :173 + :15,152-154 | **魔法数值**：ready 自回转 2000ms（:173）硬编码；「6 秒超时」注释宣称（:15「6 秒上限」、:152-154）但**实际时限在消费方**实现（`library-browse.ts:80-81` `tries > 40 × 150ms ≈ 6s`），store 与消费方对超时语义的契约仅靠注释对齐，改一侧不另一侧即静默漂移（如调 tick 间隔不改 tries 上限）。 | 提为命名常量（如 `READY_REVERT_MS = 2000`、`RESTORE_POLL_TIMEOUT_MS = 6000`）并注释交叉引用；或在 ADR-135 后续中把超时计数收敛进 store（store 已持有 startedAt，可由其计算超时而非消费方 try 计数）。 |
| 🟢 P4 | frontend/src/menus/library-session-store.ts | :245 | `reset()` 中 `clearStatusTimer()`（:245）与 `clearRestoreStatus()`（:246，内部 :178 已调 `clearStatusTimer()`）**重复调用**——首次已清空句柄，第二次为 no-op，无害冗余。 | 删 :245 一行即可（保持 reset 显式性的话可留注释说明 clearRestoreStatus 已含清 timer 语义）。 |
| 🟢 P4 | docs/adr/adr-135-library-session-store.md | :179 | 验收标准写「新增 14 个用例全绿」，实际测试文件为 **12 个用例**（4 reset + 6 状态机 + 2 timer）——文档与实现漂移（可能计划期预估）。 | 更新 ADR 验收条目为 12 或用实际用例数。 |
| 🟢 P4 | frontend/src/menus/library-session-store.ts | :168-174 | `markRestoreReady` 未校验前置状态（可从任意状态进入 ready），状态机为**开放集合**（ready→ready、timeout→ready 均允许）；当前消费方调用序列受控（仅 deferRestore 成功路径调用）风险低。 | 可选：在方法内断言/注释前置条件「应处于 polling」，或保持现状并在注释注明开放语义是有意为之。 |
| 🟢 P4 | frontend/src/__tests__/library-session-store.test.ts | :51-58 | reset 用例从 `polling` 进入，**未测 reset 在 ready 瞬态 statusTimer pending 场景**下的清理——若 `reset()` 漏清 statusTimer，afterEach 的 `clearRestoreStatus()`（:26）会掩盖泄漏，本文件测不出该回归。 | 补一条：`markRestoreReady()` → `reset()` → fake timer 推进 5s，断言 status 仍 idle。 |

## 五、测试质量评价

- **有效性**：状态机流转**真实验证**而非形状断言——ready 自回转用 `advanceTimersByTime(1999)` 仍 ready、`+1ms` 即 idle 的精确边界（:104-108）锁定 2s 契约；polling 取消 ready timer 用推进 10s 仍为 polling（:119-121）证明 timer 确实被取消；`setRestoreTimer` 用 `spyOn(globalThis,'clearTimeout')` 断言**具体句柄** `t1` 被清理（:152）——全部走真实 store 代码路径，无自证式断言。✅
- **mock 合理性**：仅两处轻量干预——`vi.spyOn(globalThis,'clearTimeout')`（:144，try/finally 恢复）与 `vi.useFakeTimers()`（:99 等，try/finally 恢复）——均作用于真实 store 实例，无模块级 mock、无 window 污染，符合 ADR-219 测试卫生铁律。✅
- **单例跨用例隔离**：文件头注释（:9）明示「跨用例共享单例」，beforeEach 五连重置（reset + clearExtracting + setReplaceLoading(false) + clearRestoreTimer + clearRestoreStatus，:15-21）+ afterEach 双清（:24-27）配套，且 fake timer 用例全部 try/finally 恢复——隔离设计完整。⚠️ 唯一盲区见 P4-5：afterEach 会掩盖 reset 漏清 statusTimer 的泄漏。✅（设计正确，仅提示补测）
- **边界覆盖**：ready 自回转精确边界（1999/2000）、polling→timeout 清 seg/startedAt（:80-87）、polling→ready 清 seg/startedAt（:89-96）、polling 重入取消 ready timer（:114-125）、clearRestoreStatus 取消 ready timer（:127-139）、loading 守卫不被 reset（:60-68）——覆盖充分。缺口：① reset+ready-pending-timer 交错；② timeout→polling / ready→timeout 跨态转换；③ `markRestoreTimeout` 取消 pending ready timer 未直接断言（与 polling-cancel 同模式，风险低）；④ `startedAt` 仅断言 `typeof number`（:77），未验证与 `Date.now()` 的近似关系。均为 P4 级。⚠️
- **跳过**：无 `it.skip`/`describe.skip`/`xit`/`.only`，12 用例全量执行。✅
- **可执行性**：单文件 65ms、node 环境、无脆弱依赖，`npm run check` 全绿。✅

## 六、附注

- 状态机与消费方合围验证：store 单测锁状态机契约，`deferRestore`（library-browse.ts:70-130）的 6s 超时、ready 收尾、校验失败清状态（:112,118）等**集成行为**不在本测试文件内，由既有 library 链路行为兜底；评审时如需完整回归保护可评估补 deferRestore 集成用例（当前非阻断）。
- `library-actions.test.ts` 亦引用 store 的 loading 守卫 API（isExtracting/clearExtracting/setReplaceLoading），与本文件（restore 侧）无断言重叠，分工清晰。
- 审核日期：2026-08-15
- 审核员：子代理 round23-library-session-store
