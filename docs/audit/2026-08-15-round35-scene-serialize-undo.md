# 第 35 轮审核（子代理 3/3）— scene-serialize-undo.test.ts（ADR-158 撤销 UX 层）

> **审核范围**
> - 测试文件：`frontend/src/__tests__/scene/scene-serialize-undo.test.ts`（144 行，6 用例）
> - 被测生产源码：`frontend/src/scene/scene-serialize.ts`
>   - `offerSceneUndo`（L1348-1371，撤销 toast 接线 + 守卫）
>   - `offerSceneUndoAndRefresh`（L1375-1384，ADR-158 P3 去重辅助）
>   - `restoreUndoSnapshot`（L1325-1345，恢复/失败判定/三点 finally）
>   - `pushUndoSnapshot`/`_undoStack`/`UNDO_LIMIT`（L1286-1302，Memento 入栈）
>   - `registerSceneAction('offerSceneUndoAndRefresh')`（L1634-1636，scene-action-bridge 桥接）
>   - 旁证：`core/toast.ts:246-253`（showInfoToast 默认 3000 vs 显式 8000）、`core/feedback.ts:53-56`（feedbackInfo）、i18n `toast.undo`/`motion.undoApplied` 键（五语言齐备）
> - **与历轮关系**：round-11（2026-08-06）审过 `scene-serialize.ts`（✅，P3 项：`getActiveFormation()!` 双调用、`force` 死参数、SaveLastScene 无超时、deserializeModels 无重入守卫）；round-30（2026-08-15）审过 `scene-serialize-resilience.test.ts`（ADR-198 分段容错，⚠️ 有条件通过）。**本测试是 ADR-158「P3: scene-serialize 撤销 UX 层补测」章节点名的新增测试**（ADR-158 原文：scene-serialize 原零直接测试），仅覆盖撤销 UX 层 offerSceneUndo / offerSceneUndoAndRefresh，与 round-30 的序列化/反序列化主体范围互补。round-11 的 P3 项（deserializeModels 重入守卫）在本文件范围内仍存在（见风险表「沿用」）。
> - **验证**：`npm run test -- src/__tests__/scene/scene-serialize-undo.test.ts` → 6/6 通过（12ms）；`npm run check` → 全绿（tsc + i18n parity，exit 0）。

**总体结论：⚠️ 有条件通过**

生产侧 `offerSceneUndo` / `offerSceneUndoAndRefresh` / `restoreUndoSnapshot` 实现正确：null-snap 守卫早退、闭包捕获快照的非 LIFO 撤销设计有文档化决策（L1284-1285）、onClick promise 链 `.then/.catch` 双保险、suppress 标志 finally 三点复位完备、0 处新增 `as any`/`@ts-ignore`。测试侧守卫与 toast 接线断言真实有效，version-99 失败路径真实命中版本守卫分支（`migrateScene` 为本地函数，不受 scene-migrate 空 mock 影响）。但有测试完备性缺口：去重辅助 `offerSceneUndoAndRefresh` 的**正向契约**（恢复成功 → reRender + undoApplied 反馈）零覆盖，且 L141 的 `setStatus` 断言是恒真的死断言（无法验证「不提示 undoApplied」），另 config god-barrel mock 偏离 frontend AGENTS.md §2.3 共享工厂铁律。故有条件通过。

---

## 亮点

- **闭包捕获快照的非 LIFO 撤销设计**：`scene-serialize.ts:1284-1285` 明确文档化「每个撤销 toast 捕获自己压栈时的快照字符串（闭包持有），多个 toast 并存时各自恢复正确的历史态（非全局 LIFO 误恢复）」——`offerSceneUndo`（L1359）点击时直接恢复闭包持有的 snap，与全局 Ctrl+Z 的 pop/restore 路径互不干扰，是经过深思的状态流设计而非偶然实现。
- **null-snap 守卫早退**：`scene-serialize.ts:1349-1351` 对 `!snap` 直接 return，`offerSceneUndoAndRefresh`（L1380）以一行委托收敛 9 个调用点的重复 onRestored 尾巴（ADR-158 P3 语义逐字对齐）。
- **suppress 泄漏三点复位**：`restoreUndoSnapshot` 的 finally（L1341-1344）覆盖 malformed return / success / catch 三条出口统一 `setSuppressAutoSave(false)`，注释显式声明，与 round-30 审过的 `deserializeScene`/`tryRestoreLastScene` 同款防护模式。
- **onClick 异步双保险**：`scene-serialize.ts:1359-1365` `void restoreUndoSnapshot(snap).then(ok→onRestored).catch(logWarn)`——restore 内部已全量 try/catch，外层再挂 catch 兜底，无未处理 rejection。
- **测试对 toast 接线形状断言真实**：`scene-serialize-undo.test.ts:92-99` 通过 mock 捕获 `showInfoToast` 的 message/duration/actions 三个字段并逐项断言（含 8000ms 显式时长与 `toast.undo` 动作键），非空断言，能真实验证接线。
- **version-99 机制真实可达**：`migrateScene` 是 scene-serialize 本地函数（L1524），不受测试空 mock 的 `scene-migrate` 模块影响；`restoreUndoSnapshot` 的版本守卫分支（L1331-1333）在测试中真实执行（warn 被 spy 静音，但分支确实走到），断言「恢复失败 → 回调不触发」验证的是真实失败路径而非空转。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | 测试 | scene-serialize-undo.test.ts:118-143 | `offerSceneUndoAndRefresh` 去重辅助的**正向契约零覆盖**：6 例中 4 例走 version-99 恒失败路径，无任何一例验证「恢复成功 → onRestored → reRender + feedbackInfo('motion.undoApplied')」这条 ADR-158 P3 收敛尾巴的核心链路；去重辅助只测了守卫与失败侧，成功侧一旦回归（如 onRestored 不触发）测试仍全绿。 | 构造 version:1 最小合法快照 + 轻量替换 `deserializeScene`（或对 restore 成功分支做桩），补 1 例成功路径：点击撤销 → reRender 被调 + toastState 出现 `motion.undoApplied` 第二条 info toast。 |
| 🟡 P3 | 测试 | scene-serialize-undo.test.ts:141 | **死断言**：`expect(cfgState.setStatus).not.toHaveBeenCalled()` 恒真——生产 `feedbackInfo` 走 `showInfoToast` + `./status-bar` 的 setStatus（feedback.ts:25），与本测试 mock 的 `core/config.setStatus` 无任何调用关系，失败路径下该 mock 根本不可达；若回归让 onRestored 在失败时误触发，此断言仍绿，无法守卫注释宣称的「不提示 undoApplied」。 | 改断言 `toastState.calls` 长度在点击后仍为 1（undoApplied 若触发会 push 第二条 info toast），或直接 spy `feedbackInfo`。 |
| 🟡 P3 | 生产 | scene-serialize.ts:1358-1365 | **撤销失败零用户反馈**：用户点击「撤销」且恢复失败时仅 `console.warn`，无错误 toast / 状态栏提示（playbook「反馈缺失」）；对比 `tryRestoreLastScene` 已有 `feedbackError('scene.serialize.restoreFailed')`（L1586）可复用，同模块内模式不一致。 | onClick 失败分支（ok=false）补 `feedbackError('scene.serialize.restoreFailed')` 或统一失败反馈入口；该改动不影响本测试（测试未断言失败时无 error toast）。 |
| 🟡 P3 | 测试 | scene-serialize-undo.test.ts:35-42 | `core/config` god-barrel 用**静态对象 mock** 而非 `...(await importOriginal())` 保留活绑定——frontend AGENTS.md §2.3 明确禁止（round-30 对 resilience 测试同款 P3）；当前因 `envState`/`modelRegistry` 只读注入恰好工作，config 导出形状变化会在后续改动中隐性引爆。 | 参照 ADR-219 core/state 同款处理，改 importOriginal spread 模式（或复用共享 mock 工厂）。 |
| 🟢 P4 | 测试 | scene-serialize-undo.test.ts:71 | 注释漂移：`'../../core/utils'（debounce 在模块求值期使用）`——scene-serialize 实际 `import { debounce } from '../core/debounce'`（独立模块），全文件不 import core/utils，注释理由已过时。 | 更新注释为 `'../core/debounce'`。 |
| 🟢 P4 | 生产 | scene-serialize.ts:1369 | 魔法数值 8000（撤销 toast 显式时长）未命名，且与 `model-preset.ts:213` 的 8000 重复（showInfoToast 默认 3000，两处均显式覆盖为 8s）。 | 提取命名常量（如 `UNDO_TOAST_MS = 8000`）统一引用。 |
| 🟢 P4 | 生产 | scene-serialize.ts:1358-1365 | 撤销动作无防重入：快速双击 toast 动作按钮会触发两次 `restoreUndoSnapshot` + 两次 `onRestored`（reRender 两次 + undoApplied 双 toast）；`_undoStack` 侧因闭包快照设计本身无并发保护。 | 动作回调加一次性标志（如 `let done = false` 守卫）或依赖 toast 自动消失（弱防御）。 |
| 🟢 P4（沿用） | 生产 | scene-serialize.ts:1325-1345 | round-11 P3 `restoreUndoSnapshot`/`deserializeScene` 无重入守卫仍存在：快速并发两个撤销 toast 会在 async await 处交错 deserializeScene（round-30 已重新列出，未修）；本测试亦未覆盖快速多次 undo 场景。 | round-11 已建议序列化/代数令牌，未修，沿用。 |

---

## 测试质量评价

**有效性（核心契约）**：✅ 守卫与接线部分真实——null-snap 两例直接验证早退；toast 接线例对 message/duration(8000)/动作 label 逐字段断言，经 mock 捕获而非空断言；version-99 失败例走的是真实版本守卫分支（`migrateScene` 为本地函数不受空 mock 影响，已核实），`onRestored` 不触发的负向断言有效。

**mock 合理性**：✅ 总体「重依赖统一空 mock、关键路径真实」策略务实（空 mock 模块均仅在未触发函数体内使用，模块求值期仅执行 registerSceneAction + debounce 构造，已核实无缺导出）。但两处偏差：config god-barrel 静态化未保留活绑定（P3，违反 §2.3 铁律）；mock 提供 `computeLibraryRef`/`resolveLibraryRef` 为多余导出（生产自 `@/core/path`、`@/core/library-path` 导入，无害但易误导）。

**边界覆盖**：⚠️ 不足。覆盖了 null-snap、有效 snap 接线、恢复失败（版本不支持）三态；**缺失**：① 恢复成功 → 回调触发的正向链路（P2）；② 快速多次 undo 并发（P4 沿用）；③ toast 动作双击防重入（P4）。无 `it.skip`/`it.todo`。

**断言有效性**：⚠️ 一处死断言（L141 `cfgState.setStatus`，恒真不可达，P3）；失败例的 `console.warn` spy 无断言仅作静音（功能性、可接受）。其余断言均可达有效。

**类型卫生**：测试与生产均 0 处新增 `as any`/`@ts-ignore`；生产 L1331/L1335 用 `as number`/`as unknown as` 跨层断言（round-30 同款评估：非 any 逃生），L1635 桥接边界 `snap as string` 与 bridge 类型签名一致，合规。

---

**审核日期**：2026-08-15
**审核员**：子代理 round35-scene-serialize-undo
