# round-36 审核 — playback.observables.test.ts + initPlaybackObservables

> 本轮第 1 个测试之一（round36-playback-observables），锁文件制：只读生产代码，仅写本报告。

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/playback.observables.test.ts`（415 行，25 用例，`@vitest-environment node`） |
| 被测源码 | `frontend/src/scene/motion/playback.ts:56-180`（`initPlaybackObservables`；233 行文件全读，`updatePlaybackUI`/`seekFromEvent` 顺带复核） |
| 测试 mock 的生产模块 | `@/core/config`（barrel：mmdRuntime / isPlaying / setIsPlaying / autoLoop / seekDragging / dom / formatTime）、`@/core/scene-action-bridge`（registerSceneAction/getSceneAction，真实导入）、`./perception-shared`（feetDebug，真实导入） |
| 共享 fixture | `frontend/src/__tests__/playback-helpers.ts`（`mockRuntime` / `tickObs` / `playObs` / `pauseObs` / `mockManager` / `makeObsMock`）；`@/core/observer-handle.ts`（`observe` → `ObserverHandle`，真实导入） |
| 执行验证 | `npm run test -- src/__tests__/playback.observables.test.ts` → **25/25 通过（389ms）**；playback 家族三文件 44 用例全绿（本次实测）；`npm run check`（tsc + i18n）按任务许可跳过（纯 mock 隔离测试 + 生产文件零改动，类型风险极低） |

**与历史审核的关系（按任务要求注明）：**
- 本测试是 **ADR-204 拆分产物**：原 `playback.test.ts`（515 行）垂直拆为 `playback.seek.test.ts`（seekFromEvent）/ `playback.ui.test.ts`（updatePlaybackUI）/ `playback.observables.test.ts`（initPlaybackObservables），原文件已删（round-31/35 报告 & ADR-204 确认）。
- playback.ts 生产主体由 **round-6**（`docs/audit/round-6-playback-procedural-perception.md`，✅ 通过，当时 205 行）与 **round-15**（✅ 优）审核；**round-31**（`2026-08-15-round31-playback-seek.md`）审 `seekFromEvent`，**round-35**（`2026-08-15-round35-playback-ui.md`）审 `updatePlaybackUI`——三族共享同一生产文件、同一 mock 超集形状与 helpers fixture。
- 本轮新增发现（前两轮未触及）：**tick/play/pause 三个 observable 回调的编排**（round-6 后基本未变的主体）与 **auto-loop 异步链**（round-20 P2 fix 的 `_disposed` 守卫 + `const loop = autoLoop` 快照）。round-35 报告的 P3 观察（DOM 守卫不一致 L197-204、时长来源不一致 L200 vs L212）本轮复核依然成立，不重复展开，见风险表尾部交叉引用。

## 二、总体结论

**⚠️ 有条件通过**（生产代码 0 处 P1/P2；**测试侧 1 处 P2**：test 11「mid-seek 取消 auto-loop」为**假阳性**——断言在 waitFor 同步首查时提前通过，与生产快照语义相反；另 3 项 P3 测试缺口/名实不符；5 项 P4）

> 条件：修正 test 11（详见风险表 P2）——或按生产快照语义改断言（playAnimation 应被调用），或按测试标题语义改生产（快照改实时读取），二者必居其一；当前状态测试通过但契约文档与实现相反，会给后续维护者错误信心。

## 三、亮点

- **dispose 资源清理设计 + 双保险测试**：`initPlaybackObservables` 返回的 dispose 闭包（`playback.ts:153-179`）置 `_disposed`/清 `_manager`/清 `_loopPending`，三个 handle 逐个 try/catch 清理（单个失败不阻断后续）；测试侧「dispose 移除全部回调」（`test:392-402`）、「remove 抛错不炸」（`test:404-409`）、「重复 dispose 幂等」（`test:411-414`）三层验证，与 ObserverHandle 幂等 dispose（`observer-handle.ts:43-49`）契约吻合。
- **异常路径全覆盖 + 精确消息断言**：`updateProcMotion`/`seekAnimation`/`playAnimation` 三条 promise 链的 `.catch` 均有对应测试（`playback.ts:77-79, 138-146` ↔ `test:163-173, 291-306, 308-325`），断言精确到 `console.error` 的完整消息文本（含 `err` 对象恒等）——非空断言。
- **ADR-238 桥接测试模式**：音频查询/相机 VMD 均经 `registerSceneAction` 测试侧手动注册桩（`test:73-74`），不静态 import `core/audio`/`scene/camera`——与生产解耦方向一致（`playback.ts:229-233`），测试即文档；test 21（`test:357-371`）用「注册→注销→触发→验证跳过→恢复注册」四步正确验证了 `getSceneAction` 未注册时的 `?? false` 降级分支，是全场唯一的真·未注册分支验证。
- **ADR-248 帧节流合同验证**：`updatePlaybackUI` 未就绪告警经 `feetDebug` 门控 + `% 60` 帧节流（`playback.ts:192`），测试精确断言 60 帧内仅告警 1 次（`test:375-388`）；与 round-35 的「默认关闭不刷告警」用例互补，无重复。
- **mock 卫生合规**：`vi.hoisted` 共享状态 + mock 工厂仅引用 hoisted 绑定（`test:6-64`），符合 frontend/AGENTS.md §2.3 铁律；`@/core/config` mock 为超集形状（含本文件未用的 `seekDragging` 等，服务 playback.ts 静态导入完整性）；`mockRuntime`/observable 桩复用 `playback-helpers.ts`（ADR-204 fixtures 方向）。
- **生产代码零类型逃生**：`initPlaybackObservables` 全函数无 `as any`/`@ts-ignore`（全文件唯一 `e as MouseEvent | PointerEvent`（`playback.ts:233`）是 scene-action-bridge unknown 载荷的必要收窄，round-35 已确认）。
- **状态流清晰 + 并发防护**：`_loopPending` 单标志 + fire-time 快照 `const loop = autoLoop`（`playback.ts:109`）防止 async 间隙状态漂移；init 时复位 `_loopPending`（`playback.ts:65`）防止旧实例残留污染新实例；模型注入（`playback.ts:4-5`）避免 ES 循环引用。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | playback.observables.test.ts | 229-246 | **假阳性**：test 11「cancels auto-loop when autoLoop becomes false mid-seek」断言 `playAnimation.not.toHaveBeenCalled()`。但 `vi.waitFor` 先**同步**执行一次回调（实测 `node_modules/vitest/dist/chunks/test.DNmyFkvJ.js:3402` `if (checkCallback() === true) return;`），此时 seekAnimation 的 `.then` 微任务尚未运行，`playAnimation` 自然未被调用 → 断言立即通过。实际微任务执行后 `playAnimation` **会被调用**：生产用 `const loop = autoLoop` 快照（`playback.ts:109`），loop 在 fire 时已冻结为 true，中途翻转 autoLoop 不取消循环。即：断言验证的是与生产相反的行为，且因 waitFor 时序「恰好通过」。测试标题/注释文档化的契约（mid-seek 取消）与实现（快照提交）矛盾 | 二选一：(a) 若快照语义正确——断言改为「`await vi.waitFor(() => expect(playAnimation).toHaveBeenCalledOnce())`」验证循环仍继续，并把标题改为「快照语义：mid-seek 翻转 autoLoop 不取消循环」；(b) 若确实要 mid-seek 取消——生产 `.then` 内改读实时 `autoLoop`（去快照），并补 isPlaying 终态断言。无论哪种，先 `await` 一个宏任务（如 `await new Promise(r => setTimeout(r))`）再断言，杜绝同步首查假阳性 |
| 🟡 P3 | playback.observables.test.ts | 191-227 | test 9 与 test 10 **字面重复**（setup/断言完全一致，仅标题与注释不同）；且两者均未在 fire 前预置 `_loopPending=true`，故「`if (!_loopPending) setIsPlaying(false)` 跳过」分支（`playback.ts:91-93`）从未被真实验证——test 9 标题「loopPending 时跳过 setIsPlaying(false)」名不符实（round-6 审计已点过名实脱节，补了 isPlaying 断言但仍未构造前置条件） | 删其一；另加「连续两次同步 fire pause」用例：第一次 fire 置 `_loopPending=true` 后（seek 未 resolve），第二次 fire 应跳过 `setIsPlaying(false)`——用 isPlaying 中间态断言该分支 |
| 🟡 P3 | playback.observables.test.ts | 267-272 | test 14「tickHandler skips animateCameraVmd when scene action not registered」名不符实：`animateCameraVmd` 在 `test:74` 已注册，用例从未注销，断言仅「不抛 + updateUI 一次」，未验证未注册分支；`?.()` 可选链分支（`playback.ts:74`）实际 0 覆盖（对照 test 21 对 isAudioPlaying 的真·注销四步法） | 仿照 test 21：注册→注销→fire→断言 animateCameraVmd 未调用→恢复注册 |
| 🟡 P3 | playback.observables.test.ts | —（缺口） | **round-20 P2 fix 无直接测试**：`_disposed` 守卫（`playback.ts:116-118, 131-133`，防止 dispose 后旧异步链污染新实例）是注释标注的重要 bug 修复，但全文件无「auto-loop 进行中 dispose → 链中止」用例 | 补：fire pause 触发 loop → 同步 dispose() → await 宏任务 → 断言 playAnimation 未调用、isPlaying 保持 false、updateUI 未再调用 |
| 🟡 P3 | playback.ts | 67-80 | tick 处理器同步段（`beatDetector.update()` / `updatePlaybackUI()` / `getSceneAction('animateCameraVmd')?.()`）整体无 try/catch：任一同步 throw 会逃逸到 babylon-mmd 帧回调，炸掉整帧渲染——`updatePlaybackUI` 有内部守卫（L189-195，注释明示防炸帧意图），但 `beatDetector.update()`（L71，外部 detector 代码）无任何保护，设计意图只兑现了一半 | 处理器主体包一层 try/catch（或至少对 `beatDetector.update` 单独 try/catch），并补「beatDetector.update 抛错 → 其余步骤仍执行」测试 |
| 🟢 P4 | playback.ts | 77-79 | `updateProcMotion().catch(console.error)` 位于每帧热路径：若 proc-motion 持续失败，console.error 每秒刷 30~60 次，未按 ADR-248 精神节流（该条仅约束 warn/info，error 属次要，但同属热路径刷屏） | 沿用 `feetDebug` 门控 + `% 60` 节流，或连续失败计数器降频 |
| 🟢 P4 | playback.ts | 64 vs 116 | 模块级 `_disposed` 在 init 时复位（L64）会解除 round-20 守卫的「终态」假设：dispose→re-init（HMR 路径，scene.ts:490→461）后旧实例在途链可穿过 `_disposed` 检查。实际风险趋零（_doInitScene 在 init 前有多个 await，微任务先排空，旧链 resolve 时 `_disposed` 仍为 true） | 接受；或把 `_disposed` 收进闭包实例（每个 init 独立状态），消除跨实例共享脆弱性 |
| 🟢 P4 | playback.ts | 74 | 魔法数值 `30`（帧率换算 `currentTime * 30`）未命名常量；`0.1` 阈值已命名（L39 ✓） | `const VMD_FPS = 30;` 命名化 |
| 🟢 P4 | playback.ts | 103 | `runtime &&` 冗余检查（runtime 为必填参数，注释 L123 已自认） | 接受（防御性，可删） |
| 🟢 P4 | playback-helpers.ts | 6-34 + test:404-409 | `makeObsMock` 的 `handlers/observers` 内部数组仅在 remove 时收缩、beforeEach 不重置：「remove 抛错」用例（test 24）后残留 1 个 stale handler，当前因测试顺序（其后仅 dispose 类用例、不 fire）不产生误断言，但后续新增 fire 用例会双触发（stale + new 两个闭包共享同一批 vi.fn → 计数翻倍） | beforeEach 增 `mockReset` 时重建数组，或 `makeObsMock` 提供 `_reset()`；至少加注释警示顺序耦合 |
| 🟢 P4 | playback.observables.test.ts | 83-113 | `mockRuntime.currentTime` 不在 beforeEach 复位（仅 mockState 字段复位），依赖各用例显式 set；test 2 置 10 后 test 3-8 继承该值——当前无断言受影响，但属跨用例隐式耦合 | beforeEach 补 `mockRuntime.currentTime = 0` |
| 🟢 P4 | playback.observables.test.ts | 375-388 | ADR-248 用例依赖模块级 `_uiWarnFrame` 从 0 起算（`playback.ts:192` 计数器跨用例不重置）：当前仅本用例触发告警分支故安全，但任何前置用例若以 `mmdRuntime=null` + `feetDebug=true` 调 updatePlaybackUI，计数偏移导致「恰 1 次」断言误红/漏红 | 用例内先以 `feetDebug=false` 预热 N 帧对齐计数器，或注释声明该耦合 |
| 🟢 P4 | 交叉引用 | — | round-35 已记且复核成立：DOM 守卫只查 playbackBar/seekBar 却解引用四个元素（`playback.ts:197-204`）；round-31/35 已记：时长来源不一致（`playback.ts:200` `_getDuration` vs `:212` `animationDuration`）；round-31 已记：seek 并发无协调、rect.width=0 NaN 透传 | 见 `2026-08-15-round31-playback-seek.md` / `2026-08-15-round35-playback-ui.md`，本轮不重复展开 |

## 五、测试质量评价

- **有效性**：25/25 通过（389ms），多数断言精确（`seekAnimation(0, true)` 参数、`console.error` 完整消息、`animateCameraVmd(300)` 换算值、`toHaveBeenCalledOnce` 计数）。**唯一假阳性是 test 11**（P2，见风险表）：`vi.waitFor` 同步首查 + `not.toHaveBeenCalled()` 组合使断言在微任务链执行前提前通过，验证的是与生产相反的行为——这是本文件最大的质量缺陷，需修复。
- **mock 合理性**：`vi.hoisted` + 超集形状 + helpers fixture 复用 + scene-action-bridge 手动注册桩，完全符合 frontend/AGENTS.md §2.3 与 ADR-204；`feetDebug` 与 `scene-action-bridge` 为真实导入（非 mock），测的是真实门控/桥接合同——加分项。瑕疵：`makeObsMock` 数组不重置（P4）、`mockRuntime.currentTime` 不复位（P4）、test 21 触发 scene-action-bridge 一次性缺注册 warn 污染 stderr（预期行为，可 mock console.warn 压制）。
- **边界覆盖**：守卫/降级/异常/dispose 幂等覆盖优秀（test 23-25 三连）；缺口集中在：① loopPending 前置分支（test 9/10 重复且未构造前置条件）；② animateCameraVmd 未注册分支（test 14 名不符实）；③ `_disposed` 守卫（round-20 fix）无直接用例；④ tick 内同步 throw（beatDetector.update 抛错）。均已在风险表登记。
- **无跳过**：全文件通读核实，无 `it.skip/only/todo/describe.skip`。
- **运行验证**：本文件 25/25 绿；playback 家族 3 文件 44 用例全绿（本次实测）；`npm run check` 未跑（任务许可 + 生产文件零改动，round-35 同策略）。

---

审核日期：2026-08-15
审核员：子代理 round36-playback-observables
