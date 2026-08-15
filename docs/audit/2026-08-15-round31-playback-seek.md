# round-31 审核 — playback.seek.test.ts + seekFromEvent

> 本轮第 3 个测试之一（round31-playback-seek），锁文件制：只读生产代码，仅写本报告。

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/playback.seek.test.ts`（172 行，10 用例） |
| 被测源码 | `frontend/src/scene/motion/playback.ts:208-226`（`seekFromEvent`，233 行文件全读） |
| 相关调用链 | `core/events.ts:220-251`（pointerdown/pointermove/pointerup 三处消费）→ `scene-action-bridge.ts:92/173-198`（注册表）→ `core/audio.ts:555-594`（syncAudioPlayback 生产实现，参数签名一致） |
| 依赖模块 | `@/core/config`（barrel）→ `scene-state.ts`（mmdRuntime）/ `playback-state.ts`（isPlaying/autoLoop/seekDragging）/ `dom.ts`（dom）/ `format.ts`（formatTime）；`@/core/clamp`（clamp01）；`@/core/scene-action-bridge` |

**与历史审核的关系（按任务要求注明）：**
- 本测试是 **ADR-204 拆分产物**：`playback.test.ts`（515 行）垂直拆为 `playback.seek.test.ts`（seekFromEvent）/ `playback.ui.test.ts`（updatePlaybackUI）/ `playback.observables.test.ts`（initPlaybackObservables）三文件，原文件已删除。
- `seekFromEvent` 生产主体自 round-6 审核后基本未变；ADR-238 为其新增了 `scene-action-bridge` 注册（`playback.ts:229-233`）并把音频同步改为桥接调用（`playback.ts:225`）。
- **订正任务描述**：任务称「round-6/10 审过 playback.ts」。核实结果：playback.ts 由 **round-6**（`docs/audit/round-6-playback-procedural-perception.md`，✅ 通过，当时 205 行）与 **round-15**（`2026-08-07-round15-motion-full.md`，✅ 优）审核；**round-10 审的是 `core/audio-bus.ts`**（SFX 总线，见 round-26 报告澄清），与 playback.ts 无直接关系。
- 审核执行：`npm run test -- src/__tests__/playback.seek.test.ts` → **10/10 通过（70ms）**；playback 家族三文件 44 用例全绿；`npm run check`（tsc + i18n）→ **exit 0 通过**。

## 二、总体结论

**✅ 通过**（0 处 P1/P2；4 项 P3 观察点均为低概率/既有设计，不阻断）

## 三、亮点

- **拆分可追溯性**：文件头注释标注 ADR-204 拆分来源 + ADR-238 桥接说明（`playback.seek.test.ts:2, 65-69`），后续维护者可快速定位历史决策。
- **mock 卫生合规**：`vi.hoisted` 共享状态 + mock 工厂仅引用 hoisted 绑定（`playback.seek.test.ts:6-59`），符合 frontend/AGENTS.md §2.3 铁律；mock 形状为 `@/core/config` 超集（含 `seekDragging`/`autoLoop` 等本文件未用导出，为 playback.ts 静态导入完整性服务，`playback.ts:12` 确实导入）。
- **守卫分支全覆盖**：`seekFromEvent` 全部 3 个 return 守卫（mmdRuntime null / seekBar null / duration≤0，`playback.ts:209-215`）逐一有 no-op 断言（`playback.seek.test.ts:85-112`），clamp 上下界（0 与 120，`playback.ts:217`）有边界断言（L145-156）。
- **异常路径覆盖**：seekAnimation reject → `.catch` 无 unhandled rejection 用例（`playback.seek.test.ts:163-171`），对应生产 `.catch`（`playback.ts:221-223`）有效性被验证。
- **ADR-238 桥接测试模式**：测试侧手动 `registerSceneAction('syncAudioPlayback', …)` 注册桩（`playback.seek.test.ts:67-69`），不静态 import `core/audio`——与生产解耦方向一致，测试即文档。
- **断言精确**：`seekAnimation(30, true)`（L126）、`syncAudioPlayback(30, false, 120)`（L132）均为精确参数断言，非 `toHaveBeenCalled()` 空断言；比率计算有注释可读（L115-116）。
- **用例间不污染**：`mockDom.seekBar` 置 null 后恢复（L92-99）；`mockState` 在 `beforeEach` 重置。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | — | — | 无 | — |
| 🟡 P3 | playback.ts | 219-223 | 并发无协调：events.ts pointermove 高频触发 seekFromEvent，快速拖拽时多个 `seekAnimation` 在途，依赖 babylon-mmd runtime 的 last-write-wins 语义；测试亦未覆盖连续快速调用 | 接受（低风险，runtime 内部语义）或补「连续 3 次快速 seek 最终值正确」并发用例 |
| 🟡 P3 | playback.ts | 212 vs 200 | seek 目标时间用 `mmdRuntime.animationDuration`，UI 显示用 `_getDuration`（聚焦模型时长优先）——两处时长来源不一致；多模型/模型时长≠runtime 时长时，seek 比例与 UI 进度显示错位 | 统一时长来源，或注释说明设计意图（单模型场景下两者相等） |
| 🟡 P3 | playback.ts:217-220 + core/clamp.ts:14 | `rect.width=0` 且 `clientX===left` 时 `0/0=NaN`，`clamp01(NaN)` 无守卫（`clamp` 为 `Math.min/max` 组合，NaN 透传）→ `seekAnimation(NaN)` | `seekFromEvent` 计算后加 `Number.isFinite(ratio)` 守卫；或 clamp01 处理 NaN |
| 🟡 P3 | playback.ts:224 | `updatePlaybackUI()` 在 `seekAnimation` promise resolve 前同步执行，读到的是 seek 前 `currentTime`（若 runtime 异步更新），UI 时间文本短暂陈旧至下一帧 tick 纠正；测试仅断言 `display='flex'`（L158-161）未联动时间文本 | 接受（UI 刷新依赖 tick observable 属既有设计，round-6/15 已审）；如需精确可补状态联动断言 |
| 🟢 P4 | playback.seek.test.ts:138-142 | `expect.any(Number)` 弱断言：该场景 targetTime 恒为 30，可精确断言；且 `isPlaying=true` 组合在生产链路（events.ts pointerdown 先 `setIsPlaying(false)`，events.ts:223-226）实际不可达，属防御性契约 | 改为精确 `30` 并加注释说明防御意图 |
| 🟢 P4 | playback.seek.test.ts:54-58 | `formatTime` mock 形状与真实 `core/format.ts`（`MM:SS.CC` 带百分秒）不一致；本文件不触发 formatTime（仅 updatePlaybackUI 使用，属 playback.ui.test.ts 覆盖面） | 无实际影响；如需对齐共享超集形状可统一（frontend/AGENTS.md §2.3 精神） |
| 🟢 P4 | playback.seek.test.ts:67-69 | `registerSceneAction('syncAudioPlayback')` 注册桩未在 afterAll 注销（返回 token 未调用）；vitest isolate 下无跨文件泄漏 | 低风险接受；若改 isolate=false 需补注销 |

## 五、测试质量评价

- **有效性**：10 用例全部通过（70ms）；断言以精确参数为主（seek 目标值、syncAudioPlayback 参数、clamp 边界），非空断言；唯一弱断言处（`expect.any(Number)`）标注为 P4。
- **mock 合理性**：`vi.hoisted` + 超集形状 + ADR-238 桥接 stub，符合项目测试卫生铁律；`mockRuntime.seekAnimation` 不模拟 currentTime 副作用，故「seek→状态更新→UI/audio 联动」闭环未在测试中验证——但被测函数职责是「计算目标时间并委托」，状态写入归 runtime 层，mock 选择可接受（已在风险表 P3 注明 UI 时序观察点）。
- **边界覆盖**：守卫分支（null/0/负时长）+ clamp 上下界全覆盖；缺口为 `rect.width=0` NaN 用例与快速拖拽并发用例（均已在风险表记录）。
- **无跳过**：无 `it.skip/only/todo`；`seekDragging` 仅在 mock 超集形状中存在、无相关断言——合理，拖拽守卫属 events.ts 层（events.ts:231），非 seekFromEvent 职责。
- **运行验证**：本文件 10/10 绿；playback 家族 3 文件 44 用例全绿；`npm run check`（tsc + i18n）exit 0。

---

审核日期：2026-08-15
审核员：子代理 round31-playback-seek
