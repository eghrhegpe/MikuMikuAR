# 第 54 轮审核报告（测试 #2/3）— env-bridge 环境预设应用与动画取消（L2 集成）

> **审核范围**
> - 测试文件：`frontend/src/__tests__/env-bridge/presets.int.test.ts`（234 行，12 用例，ADR-204 P2 拆自 env-bridge.test.ts）
>   - `applyEnvPreset`（4 用例）：presets.int.test.ts:47-71
>   - `applyEnvPresetObject`（6 用例）：presets.int.test.ts:75-164
>   - `_presetAnimId` cancellation（2 用例）：presets.int.test.ts:168-233
> - 被测源码：`frontend/src/scene/env/env-time-of-day.ts`（401 行）
>   - `applyEnvPreset`：env-time-of-day.ts:169-175
>   - `applyEnvPresetObject`：env-time-of-day.ts:270-364
>   - `_presetAnimLoop`（动画/取消/完成/异常清理）：env-time-of-day.ts:193-267
>   - `_presetAnimId` 单调计数 + `_timeOfDayBeforePreset`：env-time-of-day.ts:166-167
>   - 常量 `PRESET_ANIM_DURATION=2000` / `SKY_UPDATE_INTERVAL=50`：env-time-of-day.ts:190-191
> - 关联生产模块（测试驱动到的真实叶子）：`_bridge/env-bridge.ts`（setEnvState:327-355 / setPresetAnimActive:44-46 / _LIGHT_SYNC_KEYS 守卫:92-95）、`_bridge/env-persist.ts`（500ms 防抖）、`_bridge/env-dispatcher.ts`、`scene/env/env-lighting.ts`（TIME_OF_DAY_PRESETS:101-150）、`render/lighting.ts`（setSkipLightAutoSave:154 / isLightingReady:303）、`core/observer-handle.ts`（observe/ObserverHandle）
> - 共享桩：`frontend/src/__tests__/env-bridge/env-mocks.ts`（396 行，10 模块工厂 + 断言句柄）

> **总体结论：✅ 通过**（无 P1/P2；P3×3 / P4×5 见风险表，其中 1 项 P3 为 round-12 继承、历轮跟踪未修）

> **与既往审核关系（注明）**
> - **round-12**（`docs/audit/2026-08-06-round12-env-motion-core-ai.md:75`）审过 env-bridge/env-time-of-day：本次确认其登记的 P3「applyEnvPresetObject/syncEnvSunAngle 未钳制 [-15,90]」**仍在**（env-time-of-day.ts:283 直接写 `envSunAngle = preset.sunAngle`，动画每帧 :226 经 syncEnvSunAngle 中间件 :389-392 同写越界值）。本测试（presets.int）正是 round-12 关注点「第二预设取消第一预设」的行为验证层。
> - **round-53**（`docs/audit/2026-08-15-round53-middleware.md`）审过 middleware/cel：其登记的 syncEnvSunAngle 未钳制 P3（round53:37）与 `azimuth ?? -45` 魔法值 P4（round53:40，env-bridge.ts:95）在本文件同源复现（env-time-of-day.ts:227/313）。cel 交互（cel 激活改 env 字段重持久化）不在本测试范围。
> - 本测试为 **L2 集成层**（ADR-204）：预设动画/取消的跨模块行为（真实 env-bridge → env-persist → env-dispatcher 链路）在此验证；**异常中断复位（fix P2/P3）与 t>=1 正常完成恢复 time-of-day 在 `scene/env-time-of-day.test.ts:184-218`（L1 风格）覆盖**——两文件职责互补，不重复。

---

## 亮点

- **取消语义测试设计巧妙（presets.int.test.ts:185-212）**：连续两次 applyEnvPresetObject 后 `mockClear` + `advanceTimersByTime(3000)`，断言 `setSkipLightAutoSave(false)` **恰好一次**——从行为面验证「旧动画被新动画取代、只有最新动画的完成回调生效」，不依赖内部调用序，且对两定时器先后触发顺序免疫（旧循环 myId 失配即自释放，:194-196）。
- **生产取消机制健壮（env-time-of-day.ts:166, 281-282, 193-197）**：`_presetAnimId` 单调递增 + 每循环捕获 `myId`，失配即 `handle.dispose()` 返回——快速连点 N 次预设只留最新循环，无 observer 泄漏、无双完成回调（对应审计手册「并发安全·模拟快速点击 3 次」）。
- **三条退出路径清理完整**：取消（:194-196）、完成 t>=1（:251-266）、异常 catch（:342-361）均执行 handle.dispose + setPresetAnimActive(false) + setSkipLightAutoSave(false)；ObserverHandle 幂等 dispose（observer-handle.ts:43-49）使双释放安全。异常路径镜像完成路径恢复 time-of-day 暂停态（:351-360，round-18 修复延续）。
- **`t >= 0.999` 终值强制写入（:202）**：动画末端强制再写一帧 sky/light，保证结束态精确落在预设目标值（lerp t=1），避免 50ms 节流导致的末帧残差。
- **类型复用零重复（:179）**：`Parameters<typeof applyEnvPresetObject>[0]` 派生 PresetAnimCtx.preset 类型，预设形状单一来源；生产代码 0 处 `as any`/`@ts-ignore`（断言均为合法窄化）。
- **L2 分层合规（ADR-204）**：10 连 `vi.mock` 统一走 `env-mocks.ts` 共享工厂；env-bridge/env-persist/env-dispatcher 为**真实实现**，动画期间真实 500ms 防抖 persist 链实际执行（断言 `setSkipLightAutoSave(false)` 触发即证明真实完成链路跑通）；mock 预设数据（env-mocks.ts:37-63）与真实 TIME_OF_DAY_PRESETS（env-lighting.ts:101-150）数值逐一对应，deriveLighting 桩签名与真实实现一致。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | env-time-of-day.ts | :283（× :226、:386-394） | **envSunAngle 越界不变量仍开放（round-12 继承）**：applyEnvPresetObject 直接 `envSunAngle = preset.sunAngle` 未钳制 [-15,90]，动画每帧 setEnvState({sunAngle: preset.sunAngle}) 经 syncEnvSunAngle 中间件同步同值。内置预设全在界内（-6~75），但函数文档声明「支持用户自定义预设」，越界输入使 getEnvSunAngle()/滑块读到越界值，破坏「envSunAngle 始终钳制」不变量（对比 setEnvSunAngle :44-47 有钳制，行为不一致）。本文件 0 覆盖越界输入。 | 提取 `clampSunAngle` 公共叶（复用 setEnvSunAngle 的 Math.max(-15, Math.min(90, deg))），applyEnvPresetObject 写入与 syncEnvSunAngle 中间件共用；补 -15/90/越界用例。 |
| 🟡 P3 | env-time-of-day.ts | :281-338 | **observe() 注册段无异常兜底**：`setSkipLightAutoSave(true)`（:325）在注册前执行，若 `observe()` 抛错（observer-handle.ts:68 对 `add()` 返回 null 的防御性断言），则 skip 标志永久 true（自动保存被跳过）、`_timeOfDayPaused` 泄漏——现有 try/catch 只包循环回调（:340-361），不包注册段。实际触发概率极低（Babylon Observable.add 常态不返回 null），但审计手册「第 X 行抛异常时清理是否执行」此路不通。 | 调序：先 `observe()` 拿到 handle 再置 `setSkipLightAutoSave(true)`；或将注册段整体包 try/catch 复刻异常清理。 |
| 🟡 P3 | presets.int.test.ts | :47-71（applyEnvPreset describe） | **真实定时器泄漏跨 describe**：applyEnvPreset('noon') 启动 2000ms 真实动画（env-mocks.ts:366-378 的 scene mock `add` 每 16ms 自续），用例结束后继续存活并驱动**真实** setEnvState → 真实 500ms 防抖 persist（输出 30+ 行 `[env-persist] setEnvState() called:` DEV 日志，env-bridge.ts:328-333），与 describe 2/3 的 fake timers 不对称；虽无实证失败（总时长 200ms ≪ 2000ms，实际不构成断言竞争），属测试隔离缺口。 | describe 1 的 beforeEach 同样 `vi.useFakeTimers()`，断言后 advanceTimersByTime 推进至完成；或 afterEach 显式取消（对齐 describe 2/3）。 |
| 🟢 P4 | env-time-of-day.ts | :251-266 × :342-361 | 完成/异常两条清理路径重复 ~10 行（setSkipLightAutoSave(false) + time-of-day 恢复 + setPresetAnimActive(false) + cancelEnvPersistTimer + _timeOfDayBeforePreset=null），未来改一处漏一处。 | 提取 `_finishPresetAnim()` 私有助手，两分支共用。 |
| 🟢 P4 | env-time-of-day.ts | :227、:313 × env-lighting.ts:34,53 | `azimuth ?? -45` 硬编码默认与 env-lighting 的 `DEFAULT_AZIMUTH_DEG` 重复字面量（round-53 已在 env-bridge.ts:95 登记同源 P4）。 | 导入 `DEFAULT_AZIMUTH_DEG` 复用。 |
| 🟢 P4 | presets.int.test.ts | :149、:209 | 断言回调 `(call: any[]) => call[0] === false` 用 any 逃生（frontend/AGENTS.md 2.2 硬规则「不新增 any 逃生」）；strict:false 下 `mock.calls.filter(c => c[0] === false)` 即可由 TS 推断。 | 删除 any 标注或显式元组类型。 |
| 🟢 P4 | presets.int.test.ts | :154-163、:214-233 | 「calls setLightState during animation / at completion」断言过弱：动画每帧（16ms）都调 setLightState（isLightingReady mock 恒 true），`toHaveBeenCalled()` 首帧即满足，「completion」专有行为未区分（完成期语义已由 setSkipLightAutoSave(false) 用例承担）。 | 二选一：删除冗余用例，或断言完成帧写入的插值终值等于 targetLight。 |
| 🟢 P4 | presets.int.test.ts | 覆盖缺口 | 未覆盖：azimuth 缺省 -45 分支（:313）、skyColorMid 缺失兜底（:301-307）、sunAngle 越界；`_timeOfDayBeforePreset=true` 的完成/异常恢复路径**本文件零覆盖**（由 env-time-of-day.test.ts:184-218 跨文件补齐，非缺口）。 | 补一行 azimuth 缺省用例（断言 mockDeriveLighting 第三参 -45）；越界用例见 P3。 |

---

## 测试质量评价

**分层与 mock 策略（优）**：符合 ADR-204 L2 集成层规范——mock 面收敛于 `env-mocks.ts` 共享工厂（10 连 `vi.mock` 统一 `await import('./env-mocks')`，vitest 按文件隔离模块图）；被测关键契约全部落在真实叶子上：`setSkipLightAutoSave(false)` 断言驱动的是真实 env-bridge setEnvState → 真实 env-persist 防抖 → mock backend 的完整链路；`mockDeriveLighting` 桩签名与真实 `deriveLighting(sky, sunAngle, azimuthDeg)` 一致（env-lighting.ts:58-59），`toHaveBeenCalledWith([0.9,0.45,0.2], 15, 90)` 为精确参数断言。

**断言有效性**：核心用例（取消恰好一次完成、dirDirection 跳过/触发 deriveLighting、envSunAngle 同步）均为行为级断言，不测实现细节；`toHaveBeenLastCalledWith(false)` + `falseCalls.length === 1` 双断言互相印证取消不产生双完成。弱断言集中在两处 setLightState 冒烟用例（P4）。

**覆盖图谱**：12 用例覆盖 applyEnvPreset 名解析（有效/无效/空串/副作用）、applyEnvPresetObject 返回值/角度同步/deriveLighting 双分支/skip 标志生命周期、以及 round-12 关注的核心——**第二预设取消第一预设**。异常复位与 time-of-day 恢复由 `env-time-of-day.test.ts:184-218` 互补覆盖，两文件分工合理（本文件管跨模块集成行为，彼文件管模块内状态复位）。

**稳定性与卫生**：12/12 实跑通过（测试体 200ms，exit 0）；无 skip/only/todo；`vi.clearAllMocks` + fake/real timers 配对基本正确；`Object.assign(mockConfigEnvState, ...)` 的 beforeEach 重置防跨用例串扰。改进点：describe 1 真实定时器泄漏（P3）、输出 30+ 行 `[env-persist]` DEV 日志噪声（与 P3 同源，加 console.info spy 或统一 fake timers 可消）。

---

> 审核日期：2026-08-15
> 审核员：子代理 round54-presets
