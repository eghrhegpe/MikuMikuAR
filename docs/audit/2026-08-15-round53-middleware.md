# 第 53 轮审核报告（测试 #2/3）— env-bridge setEnvState middleware 专项

> **审核范围**
> - 测试文件：`frontend/src/__tests__/env-bridge/middleware.int.test.ts`（168 行，12 用例，拆自 env-bridge.test.ts，ADR-204 P2）
> - 被测源码：`frontend/src/scene/env/_bridge/env-bridge.ts`（506 行，setEnvState 中间件链）
>   - 链式主流程 `setEnvState`：env-bridge.ts:327-355
>   - 中间件注册/遍历/异常隔离：env-bridge.ts:357-415（`registerEnvStateMiddleware`:387 / `_runMiddlewares`:399）
>   - pre-facade：`resolveQualityProfileMiddleware`:420-432、`resetGroundPresetOnManualEdit`:461-474
>   - post-facade：`freezeAutoDegradeOnReflectionChange`:435-445、`applyLightingPresetMiddleware`:448-456
> - 关联生产模块（测试依赖的真实叶子）：`env-time-of-day.ts:386-394`（syncEnvSunAngle 中间件）、`render/quality-profile.ts:70-76`（resolveQualityProfile）、`env-ground-presets.ts:310-341`（GROUND_PRESET_KEYS）、`_bridge/env-persist.ts:47-58`（500ms 防抖）、`_bridge/env-dispatcher.ts:40-48`（callback 异常隔离）、`core/env-state-schema.ts`（字段白名单）
>
> **总体结论：⚠️ 有条件通过**

> **与既往审核关系（注明）**
> - round-12 审 env-bridge（⚠️）：`applyEnvStateFacade` 状态直写 `state.groundReflectionQuality`（env-bridge.ts:55-57）本次确认**仍在**；`syncEnvSunAngle` 未钳制 [-15,90] 的 P3 本次确认**仍在**（env-time-of-day.ts:389-392）。
> - round-53 兄弟报告（env-persist / cel）：本报告聚焦 middleware 专项；与 env-persist 的交汇点是防抖 500ms 常量（本测试 #7 断言耦合）；cel 的 `cancelEnvPersistTimer` 逻辑在 env-bridge.ts:484-496，不在本测试范围内。

---

## 亮点

- **测试用真实叶子模块验证中间件契约，mock 只桩外部副作用**：quality-profile / env-ground-presets / env-persist / env-time-of-day / env-dispatcher 均为真实实现，仅 backend/dispatcher/lighting/config/scene 走 `env-mocks.ts` 共享桩。因此 qualityProfile 映射断言（middleware.int.test.ts:61-85、133-138）验证的是**真实 QUALITY_DIMENSIONS 注册表**（quality-profile.ts:35-51），groundPreset 四用例（:143-167）验证的是**真实 GROUND_PRESET_KEYS 白名单**，persist 断言（:121）验证真实防抖定时器。符合 ADR-204 L2 分层「桩外部、测行为」。
- **执行顺序用例设计巧妙**（middleware.int.test.ts:126-141）：一次 setEnvState 同时携带 qualityProfile（pre-facade 产物）+ lightingPresetName（post-facade 产物），借「派生子字段在 facade 派发时可见 + 灯光预设已触发」间接验证两阶段先后关系，不依赖内部调用序。
- **生产异常兜底结构清晰**：`setEnvState` 用 `try { facade + post-middleware } finally { schedulePersistEnvState() }`（env-bridge.ts:343-350）保证内存态已写即持久化调度不丢失；`_runMiddlewares` 每中间件独立 try/catch + `console.warn('[env-mw] ...')`（:409-413）；`dispatchEnvChange` 对 callback 同样隔离（env-dispatcher.ts:40-48）。三层异常防线职责分明。
- **注册去重防 HMR 重入**：`registerEnvStateMiddleware` 按 name+phase 覆盖（env-bridge.ts:388-394），注释明确「无 clearAll 导出」的取舍理由（:385-386），设计决策有记录。
- **测试卫生合规**：无 skip/only；beforeEach 重置 envState 三字段 + `vi.clearAllMocks`，afterEach `restoreAllMocks` 配对正确；断言均为行为级（映射值/调用参数/缓存值），无「测实现细节」断言；12/12 用例实跑通过（11ms，exit 0）。

---

## 风险

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | env-bridge.ts | :461-474（resetGroundPresetOnManualEdit）× :420-432（resolveQualityProfileMiddleware） | **中间件时序耦合：派生子字段被误判为「手动编辑」**。resolveQualityProfileMiddleware 把解析结果 `Object.assign(migrated, resolved)`（:429），随后 resetGroundPresetOnManualEdit 见 `migrated.reflectionQuality !== undefined`（reflectionQuality ∈ GROUND_PRESET_KEYS，env-ground-presets.ts:328）即触发 `groundPreset='custom'`。**两条真实路径会静默脱离 ground 预设**：① 性能自动降级（performance.ts:374-381 经 setEnvStateForPerformance 写 reflectionQuality 子字段，仅包 `setAutoDegradingReflection(true)`）——freezeAutoDegradeOnReflectionChange（:439）有该标志守卫，本中间件没有，不对称；② 用户改 qualityProfile（菜单绑定，env-water-levels.ts:495）。恢复降级时快照（performance.ts:314-319）不含 groundPreset，**预设丢失不可恢复**。违反 ADR-173「middleware 之间不依赖顺序」边界（adr-173.md:90）。本测试套件零覆盖（#8 未断言 groundPreset，#9-12 不含 qualityProfile）。 | 给 resetGroundPresetOnManualEdit 增加 `isAutoDegradingReflection()` 守卫（与 freezeAutoDegrade 对齐）；更彻底的修法：在 `setEnvState` 进入中间件链前记录原始变更键集，reset 中间件只检查「原始 partial 中出现的 ground 键」，从根上消除派生写入误判、恢复顺序无关性。补回归测试：qualityProfile 变更 + groundPreset='stoneTile' 时 groundPreset 语义（预期取决于产品决策，至少要有明确断言）。 |
| 🟠 P2 | middleware.int.test.ts | :103-124 | **「middleware 异常隔离」测试名实不符，真实隔离机制零覆盖**。标题声称 pre-facade 抛错，实际测的是 facade 层异常（mockImplApplySky 抛错被 mock dispatcher 的 `catch (_) {}` 吞掉，env-mocks.ts:295）；注释也承认「不能直接修改 quality-profile 模块」而改测 facade。`_runMiddlewares` 的 per-middleware try/catch→`console.warn('[env-mw]')`（env-bridge.ts:409-413，ADR-173 核心错误处理条款，adr-173.md:66）在全套件无任何断言（全仓 grep 无 `[env-mw]` 断言、无测试 import registerEnvStateMiddleware）。测试通过依赖 mock 的吞错行为，虽与生产 dispatcher 行为等价（env-dispatcher.ts:40-48），但标题误导且核心机制裸奔。 | 直接 import `registerEnvStateMiddleware` 注册一个抛错的 pre-facade 临时中间件（name 唯一即可，注册表去重覆盖；抛错后置 no-op 标志避免污染后续用例），断言：`not.toThrow()` + `console.warn` 收到 `[env-mw]` + post-facade 仍执行 + persist 仍调度 + triggerAutoSave 仍触发。 |
| 🟡 P3 | env-time-of-day.ts × adr-173.md | :386-394 × adr-173.md:68,74 | **跨文件注册违反 ADR-173 约束且文档未同步**。ADR-173 规定「middleware 只允许在 env-bridge.ts 模块级作用域注册」且迁移清单将 syncEnvSunAngle 标注在 env-bridge.ts 内；实际注册在 env-time-of-day.ts。中间件链完整性依赖 import 图顺序（env-time-of-day 未加载则 sunAngle 反向同步缺失）。代码注释有理由（依赖 envSunAngle 模块缓存），属合理偏离但 ADR 未更新。 | 更新 ADR-173 注册约束条款（允许跨文件注册但明确依赖顺序），或在 env-bridge.ts 显式 import env-time-of-day 保证注册顺序；补一个「未加载 env-time-of-day 时 setEnvState({sunAngle}) 不抛错」的兜底不变量说明。 |
| 🟡 P3 | env-time-of-day.ts | :389-392 | **syncEnvSunAngle 无 [-15,90] 钳制**（对比 setEnvSunAngle :44-47 有钳制）。round-12 已登记 P3（round12 报告 :75），本次确认仍在：`setEnvState({sunAngle: 200})` → 模块缓存 envSunAngle=200 漂移，直到 _timeOfDayTick 折返；滑块 getEnvSunAngle() 读到越界值。本测试 #1 恰是此中间件唯一用例，未覆盖越界输入。 | 中间件内复用与 setEnvSunAngle 相同的钳制（或提取 `clampSunAngle` 公共叶）；补边界用例（-15/90/越界）。 |
| 🟡 P3 | middleware.int.test.ts × set-env-state.int.test.ts × facade.int.test.ts | :93-101 × set-env-state:86-94,96-99 × facade:198-206 | **跨文件断言重复**：#5/#6（lightingPreset 触发/不触发）与 set-env-state #86/#91 完全同断言；#7 的 `setTimeout(fn, 500)` 与 set-env-state #96 重复；#7 的 facade 异常部分与 facade.int.test.ts:198-206 重复。ADR-204 拆分后职责边界未收敛（middleware 专测链行为，入口/持久化归 set-env-state）。 | 收敛归属：#5/#6 保留在 middleware（作为 post-facade 中间件行为），从 set-env-state 删除对应用例；#7 的 persist 断言改为「finally 兜底」语义注释 + 引用 set-env-state 的防抖断言，避免双处维护 500 魔法值。 |
| 🟡 P3 | env-bridge.ts | :380-396 | **中间件注册表无测试注入/清理接口**：无 unregister/clearAll（注释说明 HMR 去重已兜底，:385-386），导致测试无法安全注册临时中间件——这正是 #7 无法直测 pre-facade 抛错的结构性原因（与上面 P2 同源）。 | 不推翻生产设计（HMR 去重足够）；在测试侧用「唯一 name + 一次性抛错标志」模式自管理，无需生产加接口。 |
| 🟢 P4 | env-bridge.ts | :95,77,35 | 魔法数值：`azimuth ?? -45`（与 schema default -45 重复字面量，schema:373）、`0.15` ibl 系数（:77，有注释）、`_prevEnvBrightness = 1`（:35）。 | `azimuth` 默认从 schema 常量导入；0.15 提取命名常量（如 `AMBIENT_IBL_FACTOR`）。 |
| 🟢 P4 | env-persist.ts × middleware.int.test.ts | env-persist:57,79 × :121 | 防抖 500ms 魔法值被测试断言硬耦合（`toHaveBeenCalledWith(expect.any(Function), 500)`），生产侧无常量导出。 | 导出 `ENV_PERSIST_DEBOUNCE_MS` 常量并让测试引用，防抖调整时测试同步改。 |
| 🟢 P4 | middleware.int.test.ts | :105,123 | warnSpy 实际为死代码：mock dispatcher 静默吞错（`catch (_) {}`）不产生 console.warn，DEV 日志是 console.info 不受 warnSpy 影响（测试输出可见）；注释「避免噪声」与事实不符。 | 删除 warnSpy（或改为断言 `console.warn` 收到 `[env-mw]`——见 P2 建议）。 |
| 🟢 P4 | middleware.int.test.ts | :40-49 + :51-53 | 每次 setEnvState 调度真实 500ms 防抖定时器（spy 透传原实现），afterEach 不取消；测试 11ms 内完成故不影响结果，定时器在文件结束后 fire 命中 mock backend（无副作用），但属未清理资源。 | afterEach 调 `cancelEnvPersistTimer()`（或 fake timers）收尾，保持资源卫生。 |

---

## 测试质量评价

**分层与 mock 策略（优）**：符合 ADR-204 L2 集成层规范——mock 面收敛于 `env-mocks.ts` 共享工厂（10 连 vi.mock 统一走 `await import('./env-mocks')`，vitest 按文件隔离模块图不串扰），backend 桩复用 `fixtures/backend.ts:makeMockBackend`；被测关键契约（qualityProfile 映射、GROUND_PRESET_KEYS、防抖调度、sunAngle 缓存）全部落在真实叶子模块上，断言有效性高。

**覆盖图谱**：12 用例覆盖 4 个生产中间件中 3 个的行为面（syncEnvSunAngle #1、resolveQualityProfile #2-4+8、applyLightingPreset #5-6、resetGroundPreset #9-12），freezeAutoDegradeOnReflectionChange **零覆盖**（需 setPerformanceMode/isAutoDegradingReflection mock，本文件未 mock performance 模块——可作为后续补充）。边界缺口：#7 名实不符（见 P2）；#4 弱断言（仅查 reflectionQuality，未查 cloud/particle——因中间件三字段同注同不注，弱断言可接受）；qualityProfile×groundPreset 交互未覆盖（见 P2）。

**稳定性与卫生**：12/12 实跑通过、无 flaky 迹象；`vi.clearAllMocks` + `restoreAllMocks` 配对正确；共享 mockConfigEnvState 跨用例串扰由「beforeEach 重置 + 用例内自删子字段」管理，无残留依赖。pending 定时器未收尾（P4）。

---

> 审核日期：2026-08-15
> 审核员：子代理 round53-middleware
