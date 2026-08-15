# Round55 审核 — env-time-of-day（Time of Day 集成 L2）

**审核范围：**
- 测试文件：`frontend/src/__tests__/env-bridge/time-of-day.int.test.ts`（290 行，24 用例）
- 被测源码：`frontend/src/scene/env/env-time-of-day.ts`（403 行）
  - 主覆盖段：`:42-51` setEnvSunAngle/getEnvSunAngle、`:58-147` Time of Day（_timeOfDayTick/start/stop/isActive/speed）、`:150-162` syncTimeOfDayFromEnv
  - 关联段：`:382-396` syncEnvSunAngle 中间件（tick 写入与中间件反向同步构成双源闭环）、`:166-365` 预设动画（仅作 tick 暂停上下文，非本测试主覆盖）
- 测试依赖的真实叶子：`_bridge/env-bridge.ts:50-105`（applyEnvStateFacade，**真实模块**）、`_bridge/env-persist.ts:20-58`（persistEnvState/schedulePersistEnvState，真实）、`core/ui-constants.ts:18`（AUTO_LINK_THRESHOLD_DEG=0.5）
- 打桩模块（10 连 vi.mock，共享 `env-bridge/env-mocks.ts`）：mmdWasmRuntime / core/backend / math.vector / math.color / core/config / env-lighting / env-impl / env-dispatcher / render/lighting / scene

**总体结论：⚠️ 有条件通过**

- P1×0 / P2×0 / P3×4 / P4×7；测试 24/24 绿（实测 177ms 用例耗时，0 skip / 0 todo / 0 only）
- 条件：① 补 `_timeOfDayTick` else-if「procedural 派发」分支的唯一覆盖用例（风险 #1）；② 强化用例 #7 弱断言（风险 #2）；③ 继承项 P3（observe 注册段无异常兜底）排期修复（风险 #3）

---

## 与历史轮次的关系（复核基准）

| 轮次 | 结论 | 关系 |
|------|------|------|
| round-12（`2026-08-06-round12-env-motion-core-ai.md:46,75`） | env-time-of-day ⚠️ | P2「startTimeOfDay 幂等守卫在预设暂停（_timeOfDayPaused=true）期间失效 → 重复注册回调并覆盖 _unregisterTimeOfDay → 回调泄漏 + envSunAngle 每帧双倍递增」**已修复**（`env-time-of-day.ts:108-113`，守卫改以 `_unregisterTimeOfDay` 为准；提交 98bd22a2），本测试 `:108-113` 有回归用例；P3「applyEnvPresetObject/syncEnvSunAngle 未钳制 [-15,90]」**本次确认已收敛** |
| round-54（`2026-08-15-round54-gravity-sun.md` / `presets.md`） | gravity-sun ⚠️ / presets ⚠️ | syncEnvSunAngle 与 preset.sunAngle 钳制修复已在提交 `fe8a5e96 fix(audit): [round54] facade/presets/gravity-sun 审核修复闭环` 落地：`env-time-of-day.ts:284`（applyEnvPresetObject）与 `:393`（syncEnvSunAngle 中间件）均带 `[audit:round54 P3]` 注释且已钳制。本测试与 `presets.int.test.ts` 同源同桩（env-mocks.ts）、职责互补：彼文件管预设动画集成，本文件管 start/stop/speed/tick 集成；`gravity-sun.int.test.ts` 覆盖钳制/往返，本文件覆盖 tick 推进/折返 |
| ADR-204 P2（`adr-204-unit-test-layering-and-hygiene.md:98,132`） | ✅ 已完成 | env-bridge.test.ts（1471 行 / 84 用例）拆为 6 个 `env-bridge/*.int.test.ts`（≤290 行），用例守恒 84→84；本文件为其一（24 用例），mock 前导上抬为共享桩 env-mocks.ts，属 L2 集成层（`*.int.test.ts` 命名约定） |

---

## 亮点

- **L2 集成验证真实链路**：`applyEnvStateFacade`/`setEnvState`/`persistEnvState` 均为真实实现，仅外部副作用（backend/dispatcher/lighting/config/scene/babylon）打桩。用例「calls _applyEnvStateFacade when angle diff >= AUTO_LINK_THRESHOLD_DEG」(`time-of-day.int.test.ts:240-249`) 断言 `mockImplApplySky` 被调、`mockImplApplyGround`/`mockImplApplyFog` **不**被调——验证的是真实 `applyEnvStateFacade` 的 partial 语义（`env-bridge.ts:50-60`：partial 键集 `sunAngle` ∈ skyKeys 仅派发 sky，F1 优化不触发全量重建）。
- **round-12 P2 回归锁死**：幂等守卫（`env-time-of-day.ts:108-113`）→ `:108-113` 用例验证重复 start 不重复注册；`stopTimeOfDay` 释放路径（`:122-134`）→ `:123-129` 用例用 `mockImplementationOnce` 注入真实 unregister 句柄并断言被调用——启停资源生命周期双向验证。
- **持久化断言符合 ADR-176 异步语义**：`:131-140` 用例先 flush microtask 再断言 `mockSetEnvState`，注释明示 fire-and-forget `persistEnvState` 的 Promise 链，避免 flaky；stop 的 `cancelEnvPersistTimer`（`env-persist.ts:42-44`）+ 立即 `persistEnvState` 双路径语义真实。
- **tick 推进断言使用真实 dt**：`:206` 从 `mockSceneInstance.deltaTime / 1000` 取 dt（=1s）并 `toBeCloseTo(prevAngle + speed*dt)`，验证的不是固定增量而是 `scene.deltaTime` 缩放逻辑（`env-time-of-day.ts:68`）。
- **状态流闭环设计**：双源同步（`:38-47` setEnvSunAngle 同写模块缓存 + envState.sunAngle 持久化源）+ syncEnvSunAngle 反向中间件（`:387-396`，round-54 后已带钳制）构成闭环；`startTimeOfDay` 重启时重置 `_lastSkySunAngle`/`_lastAutoLinkSunAngle`（`:116-117`）避免陈旧 diff 尖峰触发一次性全量重建。
- **测试卫生**：10 连 `vi.mock` 工厂经 `await import('./env-mocks')` 动态取桩（符合 frontend/AGENTS.md「vi.mock 工厂禁静态引用 hoisted 绑定」纪律）；envState 等状态按测试文件隔离模块图不串扰（env-mocks.ts:6 注释）。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | time-of-day.int.test.ts | :263-274 | **else-if「procedural 派发」分支零唯一覆盖**：用例名「skyMode=procedural 且 angle diff ≥ 0.4」，但 speed=0.5 → diff=0.5 ≥ AUTO_LINK_THRESHOLD_DEG(0.5)，先命中 `_timeOfDayTick` 的 if 分支（`env-time-of-day.ts:79-90`，经真实 applyEnvStateFacade 调 applySky）；else-if 的 procedural 直派发（`:91-100`，dispatchEnvChange 同步 envState.sunAngle）从未被唯一命中——断言经任一分支都成立，无法区分 | 补 `speed=0.45` + `skyMode='procedural'` 用例（0.4 ≤ diff < 0.5 唯一走 else-if），断言 dispatchEnvChange 派发且 `mockConfigEnvState.sunAngle` 被同步（锁死 `:97` 的 ghost-path 修复） |
| 🟡 P3 | time-of-day.int.test.ts | :251-261 | **用例名实不符（弱断言）**：名称声称「_applyEnvStateFacade 未被调用」，实际只断言 `mockImplApplyGround` 未被调用。若 auto-link 阈值被误改（如降到 0.4），applySky 会被调用而测试仍绿；该断言只能兜住「全量重建」回归，兜不住「阈值」回归 | 补 `expect(mockImplApplySky).not.toHaveBeenCalled()`（skyMode='color' 下两分支均不派发，可安全断言），或断言 `mockConfigEnvState.sunAngle` 未被 tick 更新 |
| 🟡 P3 | env-time-of-day.ts | :326 × :340 | **observe() 注册段无异常兜底（继承 round-54:42，本次确认仍在）**：`setSkipLightAutoSave(true)`（:326）在 `observe()` 注册前执行，若 observe 抛错（observer-handle.ts:68 对 add() 返回 null 的防御断言），skip 标志永久 true（自动保存被跳过）+ `_timeOfDayPaused` 泄漏；现有 try/catch 只包循环回调（:340-361）不包注册段 | 调序：先 `observe()` 拿到 handle 再置 skip 标志；或将注册段整体包 try/catch 复刻异常清理 |
| 🟡 P3 | env-time-of-day.ts × adr-173.md | :387-396 × adr-173.md:68,74 | **syncEnvSunAngle 跨文件注册违反 ADR-173 约束（继承 round-53:36，本次确认仍在）**：ADR-173 规定 middleware 只允许在 env-bridge.ts 模块级注册，实际注册在 env-time-of-day.ts；中间件链完整性依赖 import 图顺序（env-time-of-day 未加载则 sunAngle 反向同步缺失）。代码注释有理由（依赖 envSunAngle 模块缓存），属合理偏离但 ADR 未同步 | 更新 ADR-173 注册约束条款（允许跨文件注册但明确依赖顺序），或 env-bridge.ts 显式 import 保证注册顺序 |
| 🟢 P4 | time-of-day.int.test.ts | :132 | `vi.spyOn(globalThis, 'setTimeout')` 无 mockImplementation 也无 restore（beforeEach 仅 clearAllMocks）：对断言无贡献（await 复用同一通过调用的 spy），属噪音且遗留全局替换 | 删除该 spy（微任务 flush 无需 spy），或补 `vi.restoreAllMocks()` |
| 🟢 P4 | time-of-day.int.test.ts | :264 × :277 | 直接变异共享桩 `mockConfigEnvState.skyMode`（procedural → color）且无 afterEach 恢复，靠文件内顺序由 :277 回写——顺序敏感，未来增删用例易漏 | 用例内 `const prev = mockConfigEnvState.skyMode` 后置恢复，或 afterEach 统一复位 |
| 🟢 P4 | env-time-of-day.ts | :91 | `>= 0.4` 魔法数值内联（sky 派发阈值），与命名常量 AUTO_LINK_THRESHOLD_DEG=0.5（:13 import）并存，测试文件也硬编码 0.4/0.5 两处（:240/:263/:276）；两阈值语义差异无注释解释 | 提取 `SKY_DISPATCH_THRESHOLD_DEG = 0.4` 至 ui-constants 与 AUTO_LINK_THRESHOLD_DEG 并列，测试引用常量 |
| 🟢 P4 | env-time-of-day.ts | :45 / :70-75 / :284 / :393 | 太阳角钳制 [-15,90] 现已 4 处一致实现（round-54 修复闭环后全部钳制 ✅），但字面量散落 4 处，改范围需协同（继承 round-54:43） | 提取 SUN_ANGLE_MIN/MAX 命名常量，四处共用 |
| 🟢 P4 | env-time-of-day.ts | :227 / :313 | `azimuth ?? -45` 与 env-lighting `DEFAULT_AZIMUTH_DEG` 重复字面量（继承 round-53:40 / round-54:45） | 导入 DEFAULT_AZIMUTH_DEG 复用 |
| 🟢 P4 | env-time-of-day.ts | :251-266 × :342-361 | 完成/异常两条清理路径重复 ~10 行（setSkipLightAutoSave(false) + time-of-day 恢复 + setPresetAnimActive(false) + cancelEnvPersistTimer + _timeOfDayBeforePreset=null），未来改一处漏一处（继承 round-54:44） | 提取 `_finishPresetAnim()` 私有助手两分支共用 |
| 🟢 P4 | time-of-day.int.test.ts | 覆盖缺口 | round-12 P2 修复的**原始 bug 场景**（预设动画期间 _timeOfDayPaused=true 时 start 不重复注册）零覆盖：幂等用例（:108-113）只测非暂停态；_timeOfDayPaused 非导出，无法直接模拟 | 在 presets.int.test.ts 补「动画运行期间 startTimeOfDay 不重复注册」断言（经 applyEnvPresetObject 进入暂停态），或导出测试钩子 |

---

## 测试质量评价

- **运行验证**：`cd frontend && npm run test -- src/__tests__/env-bridge/time-of-day.int.test.ts` → 24/24 通过（5.93s 含 transform，用例 177ms），无 skip/todo/only；`npm run check` 未跑（本测试为只读审核、无代码改动，tsc 基线不涉）。
- **断言有效性**：tick 推进（:203-212）用真实 `scene.deltaTime/1000` 的 dt 且 toBeCloseTo 容差；wrap 上/下行（:214-230）用精确边界值（-15/90）断言，与源码折返赋值（:70-75）逐字对应；启停（:81-129）验证 isActive 标志 + unregister 句柄真实调用 + 幂等不重复注册；persist（:131-140）微任务 flush 后断言 SetEnvState，符合 ADR-176 异步语义。
- **mock 合理性**：10 连 vi.mock 全走 env-mocks.ts 共享桩（ADR-204 P2 上抬设施），backend 桩经 fixtures/backend `makeMockBackend`（:106-111）；断言句柄与 SUT 经 mock 工厂解耦、vitest 按文件隔离模块图——符合 L2「桩外部、测行为」分层（ADR-204:53）。
- **边界覆盖**：speed 0（:174-177）/ 负 speed（:223-230 下行 wrap）/ 阈值上沿 0.5（:240）/ 下沿 0.4（:251）/ 双 skyMode（procedural :264、color :277）/ 非活跃 tick no-op（:191-201）。
- **缺口**（见风险表）：else-if procedural 派发分支无唯一覆盖（#1）；#7 弱断言（#2）；syncTimeOfDayFromEnv（:150-162）不在本文件 24 用例范围——属合理分工，建议由 init 编排侧测试覆盖；预设暂停态幂等场景依赖 presets.int 互补（#11）。

---

审核日期：2026-08-15
审核员：子代理 round55-time-of-day
