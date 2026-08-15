# round51-utils-async — 审核结果

> 审核轮次：第 51 轮 · 测试 2/3（仅审本目标，不涉及锁外文件）

**审核范围：**

| 角色 | 文件 | 范围 |
|------|------|------|
| 测试文件 | `frontend/src/__tests__/utils.async.test.ts` | 全文件 416 行 / 40 用例（ADR-101 P1-a：error & async helpers，含 8 个 async.ts 导出 + logWarn/logError） |
| 被测源码 | `frontend/src/core/async.ts` | 全文件 167 行：`swallowError`(12-14) / `fireAndForget`(17-19) / `delay`(22-24) / `waitForFrame`(27-30) / `makeLazyLoader`(43-67) / `LoadingGuard`(77-103) / `DebouncedTimer`(109-138) / `Abortable`(144-167) |
| 关联源码 | `frontend/src/core/logger.ts` | 99-122（logWarn/logError，被本测试文件连带覆盖） |

**历史关系说明：**
- **round-15**（`2026-08-07-round15-core-tools-config-i18n.md`）已审过 `core/async.ts` ✅，标注点：`makeLazyLoader` 并发守卫正确（`_loading` 在 then/catch 中均置 null，失败可重试）、`LoadingGuard` Set/Boolean 双模式清晰、`DebouncedTimer`/`Abortable` 均有 dispose、`fireAndForget` 经 `swallowError` 兜底不静默吞错。**上述 4 个点在本测试文件中均有测试守护**（详见「亮点」）。
- **round-16** 审的是 `core/guards.ts`（`guardNum`），与 async.ts 无交叉，不赘述。
- **round-31** 审的是 `utils.math.test.ts`（clamp.ts/math-geometry.ts），与本目标不同模块；但其树立的测试卫生标准「唯一 owner、无跨文件重复覆盖」在本目标处被违反（见风险表 P3-1）。
- 本测试文件为 `utils.async.test.ts` 的首次专门审核（此前 round-15 仅顺带审源码，未审测试）。

**总体结论：⚠️ 有条件通过**

生产代码健康：8 个导出全部被测试覆盖，零 `as any`/`@ts-ignore`（仅 `makeLazyLoader` 的 `_cached!` 一处，由 `_resolved` 不变量保证安全）、零依赖叶（仅引 `./logger`，ADR-191 合规）、无循环依赖、无魔法数值（仅 `'__default__'` 魔法字符串，P4）。测试 40/40 全绿（Vitest 4.1.9，68ms），断言全部指向真实行为（console 输出、时序、并发共享、状态机），无 mock 自证、无跳过用例。有条件通过的理由：**2 个 P3 均属测试组织/卫生问题**——① 本文件与 `utils.lifecycle.test.ts` 在 LoadingGuard/DebouncedTimer/Abortable/makeLazyLoader 四个类上存在约 25 个重复用例（ADP-101 P1-a 测试越界覆盖了 P2 范围，违反 round-31 树立的「唯一 owner」标准，且与项目 P1-1「删 61 重复用例」的先例相悖）；② 本文件 logWarn/logError 6 用例与 `logger.test.ts`（round-18 已审）重复。二者均为可合并的维护债，非正确性缺陷。另 5 个 P4（fireAndForget 同步抛错未测、`'__default__'` 魔法字符串、Abortable dispose/abort 语义矛盾、waitForFrame 环境依赖未注明、delay 负值/NaN 未测）。

---

## ✅ 亮点

- **round-15 关键点全部有测试守护**：`makeLazyLoader` 并发守卫四重验证——手工 resolver 钉死「3 个并发调用共享同一 Promise、loader 只调一次」（`utils.async.test.ts:184-198`）、失败后锁清除可重试（`:200-214`）、并发失败者全部看到 rejection（`:216-224`）、`undefined` 也是有效缓存值（`:226-234`，验证 `_resolved` 标志而非 null 判断的设计）；`LoadingGuard` 双模式（`:238-254` 默认 key/Boolean、`:265-274` 多 key Set 模式）；`DebouncedTimer`/`Abortable` 的 dispose 语义（`:340-348`、`:390-395`）；`fireAndForget`→`swallowError` 不静默吞错（`:66-72` 断言 `console.warn` 真实输出 `'[swallow]'` 标签）。
- **顶层 afterEach 恢复钩子**（`:12-15`）：`vi.restoreAllMocks()` + `vi.useRealTimers()` 统一兜底，正是 round-18 在 `logger.test.ts:7-10` 标注的 P3「逐用例 mockRestore 依赖断言成功执行」的推荐修正形态——本文件无该隐患（`waitForFrame` 用例内 `rafSpy.mockRestore()` 属冗余但无害）。
- **真实时序语义验证**：`delay` 用 `advanceTimersByTimeAsync`（async 变体，逐 timer 冲刷微任务）钉死「99ms 未触发 / 100ms 触发」（`:110-128`），再以真实 timer 的 `delay(0)` 互补验证返回值 `undefined`（`:130-134`）；`waitForFrame` 手工捕获 rAF 回调，先断言未 resolve、触发回调后才 resolve（`:137-161`），是真异步语义而非镜像断言。
- **DebouncedTimer 抛错状态一致性钉死**（`:350-363`）：验证「`_timer` 先置 null 再执行 fn」的实现细节——fn 抛错后 `isPending` 已清、可再次 schedule。该用例锁定了 `async.ts:115-118` 的清理顺序，防止未来重构破坏。
- **生产代码零类型压制 + 零依赖叶纪律**：`async.ts` 仅 1 处非空断言 `_cached!`（`:49`），由 `_resolved` 不变量（仅在与 `_cached` 赋值同一同步块内置 true）保证安全，非逃生舱；import 链仅 `./logger`（`:6`），无 god barrel，符合 ADR-191。
- **dispose 语义统一**：`DebouncedTimer.dispose()` = `cancel()`（`:135-137`）、`Abortable.dispose()` = abort 不重置（`:164-166`），均幂等，符合项目 Disposable 约定。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|----------|
| 🟡 P3 | `frontend/src/__tests__/utils.async.test.ts` | LoadingGuard(237-292)/DebouncedTimer(294-364)/Abortable(366-415)/makeLazyLoader(163-235) 四 describe | **与 `utils.lifecycle.test.ts` 大范围重复覆盖**：本文件头部标注「ADR-101 P1-a」，但实际越界覆盖了 P2 范围（LoadingGuard 7 用例 vs lifecycle 11、DebouncedTimer 6 vs 5、Abortable 6 vs 7、makeLazyLoader 6 vs 7，约 25 个语义重复用例）。违反 round-31 树立的「唯一 owner 无跨文件重复覆盖」卫生标准，且与 vitest.config.ts:77 记载的 P1-1「删 8 文件 61 重复用例」先例相悖；两文件已在细节上开始分叉（本文件测 `undefined` 缓存值/`fn` 抛错状态，lifecycle 测 `null`/`0` 假值缓存/多失败重试/abort-after-dispose），未来行为变更需双文件同步，漂移风险上升 | 合并两文件为单一 owner（保留并集用例：async 独有 undefined 缓存值、DebouncedTimer 抛错状态；lifecycle 独有 null/0 假值缓存、多次失败重试、abort-after-dispose），或按 ADR-101 的 P1-a/P2 边界拆分各自职责；此为测试组织变更，需主模型分配权限 |
| 🟡 P3 | `frontend/src/__tests__/utils.async.test.ts` | logWarn describe(17-47) / logError describe(49-63) | **与 `logger.test.ts`（round-18 已审）重复覆盖**：本文件 6 个 logWarn/logError 用例与 `src/core/__tests__/logger.test.ts` 6 用例语义重复（后者还有 logInfo 3 例）。附带发现：round-18 标注的「logError 带 err 用例缺失」缺口恰由本文件 `:50-56` 补齐——合并时须保留此用例 | 将 logWarn/logError 用例并入 `logger.test.ts`（补齐 logError+err 用例后删重），本文件收窄回纯 async 工具范围；同步更新 ADR-101 测试归属说明 |
| 🟢 P4 | `frontend/src/core/async.ts` | 17-19 | **`fireAndForget` 同步抛错路径未测**：测试仅覆盖 async fn rejection（`:88-95`）；若调用方传入同步抛错的 fn（JS 中 `() => Promise<void>` 签名允许），`swallowError(fn())` 会在调用处同步传播异常，违背 docstring「启动异步操作但不等待」的承诺 | 补同步抛错用例钉死现状（或改为 try/catch 包裹后 logWarn），二选一即可 |
| 🟢 P4 | `frontend/src/core/async.ts` | 81/90/95 | **魔法字符串 `'__default__'` 重复 3 次**：默认 key 硬编码于 `tryEnter`/`leave`/`isLoading` 三处，属未定义常量的硬编码字符串 | 提取为模块级 `const DEFAULT_KEY = '__default__'`（或 `Symbol` 不可行时保持字符串常量） |
| 🟢 P4 | `frontend/src/core/async.ts` | 158-165 | **`dispose()` 后 `abort()` 仍重置复用，与 docstring 矛盾**：dispose 注释称「对象不再使用」，但 `abort()`（`:158-161`）无 disposed 守卫，dispose 后再 abort 会生成新 controller 使对象复活；该行为已被 `utils.lifecycle.test.ts:193-199` 钉死（本文件未测此路径） | 二选一：docstring 改为「dispose = abort 不重置，非终态」；或加 `_disposed` 守卫使 dispose 后 abort 为 no-op，并同步两份测试 |
| 🟢 P4 | `frontend/src/__tests__/utils.async.test.ts` | 137-161 | **`waitForFrame` 测试隐式依赖 happy-dom 的 rAF，未显式声明**：本文件无 `@vitest-environment` 注释，靠默认 happy-dom 提供 `globalThis.requestAnimationFrame` 供 `vi.spyOn`；若未来环境分流（ADR-255 同款）改默认环境，该用例会因 spy 目标不存在而失败，且失败方式不直观 | 在 `waitForFrame` describe 注释注明「依赖 happy-dom rAF」；或测试内先 `if (typeof requestAnimationFrame === 'undefined')` 打桩再 spy，使文件可迁 node 环境 |
| 🟢 P4 | `frontend/src/__tests__/utils.async.test.ts` | 109-135 | **`delay` 负值/NaN 未测**：`delay(-100)`/`delay(NaN)` 实现按 `setTimeout` 语义当 0 立即 resolve，该退化输入未钉死 | 补 1-2 个用例锁定「非正数 → 立即 resolve」，与 round-31 的 NaN 防护意识对齐 |

---

## 测试质量评价

**总体：良好（40/40 通过，68ms，Vitest 4.1.9）。** 生产模块 8 个导出（`async.ts:12/17/22/27/43/77/109/144`）全部有测试覆盖，无遗漏导出。

- **断言有效性 — ✅ 优秀**：无镜像实现伪断言、无 mock 自证。`swallowError`/`fireAndForget` 用 `vi.spyOn(console.warn)` 验证真实日志输出（含 `'[swallow]'` 标签与参数形态，`:71`）；`makeLazyLoader` 用手工 resolver 悬置 Promise 验证「并发共享同一 Promise」这一核心不变量（`:184-198`）；`delay` 用 fake timer 精确到毫秒验证时序（`:110-128`）；`waitForFrame` 验证「回调触发前不 resolve、触发后 resolve」（`:137-161`）。全部断言指向真实行为。
- **边界覆盖 — ✅ 强，且与 round-15 逐点对应**：并发（共享/失败 rejection）、失败重试（单次/多次由 lifecycle 文件补）、假值缓存（undefined/null/0 三文件互补）、dispose 幂等语义、`LoadingGuard` 全状态机（enter/leave/isLoading/clear/不存在 key）、`DebouncedTimer` 重调度/取消/fn 抛错状态一致性。
- **缺口 — ⬜ 5 处（均 P4，不阻断）**：① `fireAndForget` 同步抛错路径；② `delay` 负值/NaN；③ `Abortable` abort-after-dispose（本文件未测，lifecycle 文件已测——合并后自然补齐）；④ `LoadingGuard` 空字符串 key 与默认 key 碰撞未测；⑤ `swallowError` 接收字符串 rejection（非 Error）未测。
- **重复覆盖 — ❌ 2 处（P3，见风险表）**：与 `utils.lifecycle.test.ts`（4 类 × ~25 用例）及 `logger.test.ts`（6 用例）重复，违反项目「唯一 owner」卫生标准，建议合并。
- **跳过测试 — 无**：`grep` 确认零 `it.skip`/`describe.skip`/`xit`/`.only`。
- **环境与卫生 — ✅**：顶层 `afterEach` 恢复 mocks + real timers（`:12-15`），规避 round-18 标注的 spy 泄漏模式；无 window 篡改（ADR-219 合规）；import 走具体叶（`../core/async`、`../core/logger`），无 god barrel。
- **验证记录**：`cd frontend && npm run test -- src/__tests__/utils.async.test.ts` → 40/40 passed（68ms）。`npm run check`（全量 tsc）按任务约定跳过——被测两文件为小体积零依赖叶，round-16 已记录全量 tsc 存在 4 处无关文件既有错误，单文件测试已验证。

---

## 附：审核过程记录

- 审核手册已读（`docs/audit-playbook.md`，9 维度 + 报告模板）。
- 测试文件已读（416 行），import 链：`../core/async`（8 符号）+ `../core/logger`（logWarn/logError）+ vitest。
- 生产源码已读（async.ts 167 行、logger.ts 122 行），消费者核查：`grep` 命中 211 处——`swallowError` ~15 生产模块（scene.ts:584-689、model-loader.ts:526-817、settings-appearance.ts、plaza-*、init.ts 等）、`makeLazyLoader` 4 处（backend/index.ts、ai/index.ts、go-adapter.ts、diagnostic-actions.ts）、`LoadingGuard` 4 处（outfit.ts:565-568、library-core.ts:66、outfit-ui.ts:56）、`DebouncedTimer` 4 处（env-persist.ts、motion-cloth-levels.ts、diagnostic-*）、`waitForFrame` 2 处（motion-pose-levels.ts:304-306、scene-menu.ts:418）——确认是 ADR-101/191 收敛的高复用叶模块，测试守护价值高。
- 与 `utils.lifecycle.test.ts`（297 行 / 28 用例，ADR-101 P2）与 `logger.test.ts`（48 行 / 6 用例，round-18 已审）交叉比对，确认重复覆盖范围。

---

审核日期：2026-08-15
审核员：子代理 round51-utils-async
