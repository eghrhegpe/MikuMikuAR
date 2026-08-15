# 第 30 轮审核（子代理 3/3）— scene-serialize-resilience.test.ts（ADR-198 分段容错）

> **审核范围**
> - 测试文件：`frontend/src/__tests__/scene/scene-serialize-resilience.test.ts`（529 行，15 用例）
> - 被测生产源码：`frontend/src/scene/scene-serialize.ts`
>   - `serializeModel`（L347-498，ADR-198 方向① 抽出的单模型序列化器）
>   - `serializeScene`（L501-605，分段容错主循环 L504-516）
>   - `saveSceneImmediate`（L1393-1448，方向② 序列化/写盘失败分离，L1407-1416）
>   - `deserializeScene`（L964-1256，suppress finally 复位 L1253-1255）
>   - `deserializeModels`（L615-948，procMotionModules 形状校验 L734-746、材质恢复 L911-922）
>   - `tryRestoreLastScene`（L1531-1620，env 恢复 try/finally L1604-1613）
>   - 旁证：`frontend/src/core/types.ts` L262/266（ModelInstance 已类型化 procMotion/procMotionModules）
> - **与 round-11 的关系**：round-11（2026-08-06）审过 `scene-serialize.ts`（✅ 通过，P3 项：`getActiveFormation()!` 双调用、`force` 死参数、SaveLastScene 无超时、deserializeModels 无重入守卫）。但 ADR-198 的 `serializeModel` 抽取与分段容错、方向② 失败可观测**均晚于 round-11**，round-11 的 ✅ 未覆盖本逻辑；本测试文件即 ADR-198「影响」章节点名新增的补测，填补方向① 的回归护栏。round-11 的 P3 项在本文件对应源码处仍存在（见风险表「沿用项」）。
> - **验证**：`npm run test -- src/__tests__/scene/scene-serialize-resilience.test.ts` → 15/15 通过（103ms）；`npm run check` → 全绿（tsc + boolean-naming + i18n parity，exit 0）。

**总体结论：⚠️ 有条件通过**

生产侧 ADR-198 方向①（单模型 try/catch 跳过 + logWarn 记录 + 其余落盘）与方向②（saveSceneImmediate 序列化失败 abort + toast）实现正确、无静默吞错、finally 复位完备，未发现生产缺陷（0 处新增 `as any`/`@ts-ignore`）。测试侧核心契约用例有效且真实（BOOM 注入点选在 `computeLibraryRef`——`serializeModel` 首行，精确命中 try/catch 边界），但存在测试完备性缺口：ADR-198「跳过+**记录**」的「记录」未被断言、方向② 全仓零覆盖、边界用例（首条/多条/全抛）缺失，且 mock 策略偏离 frontend AGENTS.md §2.3 共享工厂约定。故有条件通过。

---

## 亮点

- **分段容错语义实现干净**：`scene-serialize.ts:504-516` 主循环逐个 `serializeModel` 独立 try/catch，catch 内 `logWarn('scene:serialize', 'model "name" (id) serialize failed, skipped: ...')` 带模型名+id 记录后 `continue`，其余模型不受牵连——与 ADR-198「能存多少存多少」决策逐字对齐，未出现 `catch {}` 级静默吞错（记录路径存在）。
- **方向② 失败可观测落地**：`scene-serialize.ts:1407-1416` 把 `serializeScene()` 单独包一层 try/catch，整体失败时 `logWarn` + `feedbackError` + `return`（finally 的 trailing save 仍执行），与 L1433-1438 写盘失败的 `FAILED (write)` 文案区分——两类失败不再混为一谈（ADR-198 方向②）。
- **suppress 泄漏防护的双保险**：`deserializeScene` finally 复位（L1253-1255）与 `tryRestoreLastScene` env 分支 try/finally（L1604-1613）均正确；测试用「复位后可正常调度防抖」的可观察行为验证不变量（L329-336、L346-351），非空断言。
- **BOOM 注入点选择精准**：mock 的 `computeLibraryRef` 对含 `'BOOM'` 路径抛错（test L12-24），且 `@/core/path` 真实模块恰有 6 个导出（`normPath/getBaseName/getDirPath/isUnderRoot/computeLibraryRef/isStageLike`），mock 为完整超集形状——替换不会漏导出。
- **BOOM 置于中间位**（a→BOOM→c，test L217-225）：同时验证「跳过」与「继续」（throw 不中断循环），断言 `['模型甲','模型丙']` + length 2，是真实验证而非同义反复。
- **部分真实路径保留**：material-sss 未 mock（真实 `setMatSssParams/getMatSssState`，test L247-267），仅用 `mockImplementationOnce` 桥接被 mock 的 `getMatState`——测试环境不是全黑盒。
- **顺序依赖显式文档化**：round-trip 用例置于文件末尾并注释原因（deserializeScene 全局副作用，test L497-499）。
- **`as unknown as` 而非 `as any`**：生产代码 L1335/1576/1589 的跨层断言用 `unknown` 中间类型，未引入 `any` 逃生（符合硬约束）。

---

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🟠 P2 | 测试（套件级缺口） | scene-serialize-resilience.test.ts 全文 | ADR-198 方向②（`saveSceneImmediate` L1407-1416：serializeScene 整体抛错 → abort + `feedbackError`）**全仓无任何测试**（仅 init.test.ts:595 以 vi.fn 桩替）；方向① 是本文件声明范围，方向② 是 ADR 已实施的一半行为却无回归护栏。 | 补一个 saveSceneImmediate 单测：mock serializeScene 抛错 → 断言 logWarn('scene:serialize') 被调 + feedbackError 被调 + SaveLastScene 未被调 + 无未处理 rejection（此文件或独立 save 测试文件均可）。 |
| 🟡 P3 | 测试 | scene-serialize-resilience.test.ts:215-228 | ADR-198 方向①「跳过该条 + **记录**」的「记录」未断言：skip 路径走 mock 的 `logWarn`（L154），但测试从不验证 logWarn 收到 `model "模型乙" (b) serialize failed, skipped`；若生产 catch 丢 logWarn，本测试仍全绿。 | 增加 `expect(vi.mocked(logWarn)).toHaveBeenCalledWith('scene:serialize', expect.stringContaining('模型乙'))`（或 `'b'`），锁死「记录」半契约。 |
| 🟡 P3 | 测试 | scene-serialize-resilience.test.ts:214-315 | 边界用例缺失：仅 1 个 BOOM 且在中位。**首条抛错**（registry 首项即 BOOM）、**多条 BOOM**（只余 1 条落盘）、**全部抛错**（models 为 [] 且 serializeScene 不崩）均未覆盖——「全部抛错」恰是分段容错退化为空存档的关键边界。 | 补 2-3 个参数化用例（BOOM 位置/数量矩阵），断言落盘条数与顺序。 |
| 🟡 P3 | 测试 | scene-serialize-resilience.test.ts:40-70、26-35 | 偏离 frontend AGENTS.md §2.3 测试卫生铁律：`../../scene/scene` 用**内联私有 mock**（L40-70）而非共享工厂 `sceneMockSuperset`（`src/__tests__/mocks/scene-superset.ts`）；`../../core/config` god-barrel 用**静态对象 mock**（L26-35）而非 `...(await importOriginal())` 保留活绑定——已文档化的两个反模式。当前因 `envState` 在 serialize 路径只读、`modelRegistry` 以引用注入而恰好工作，但形状漂移/活绑定断裂风险会在后续改动中隐性引爆。 | 复用 `sceneMockSuperset`（必要时扩展工厂支持 `modelRegistry` 注入）；core/config mock 补 `importOriginal` spread（如 ADR-219 教训的 `core/state` 同款处理）。 |
| 🟢 P4 | 测试 | scene-serialize-resilience.test.ts:216,227 | 首个用例的 `vi.spyOn(console,'warn')` 为死代码：无任何断言，且 skip 路径走的是 mock 的 logWarn 而非 console.warn，spy 既不能拦截真实告警也不验证任何东西。 | 删除 spy（若想验证「无全局告警」则改为显式断言，否则移除）。 |
| 🟢 P4 | 测试 | scene-serialize-resilience.test.ts:278-313,407-446,503-523 | 多处 `as any` 可避免：`ModelInstance` 已类型化 `procMotion`（types.ts:262）与 `procMotionModules`（types.ts:266），`(model as any).procMotion` 等可直接走类型；`as never` 作为部分 SceneFile 夹具的万能锤（strict:false 下可用但粗）。 | 夹具改 `satisfies`/局部类型（如 `Pick<SceneFile['models'][number], ...>` 或显式 Partial 类型），仅保留必要的 `as unknown as`。 |
| 🟢 P4 | 生产 | scene-serialize.ts:511,1411 vs 983,1240 | logWarn 标签不一致：ADR-198 新代码用 `'scene:serialize'`（L511/1411），既有代码用 `'scene-serialize'`（L983/1240 等）——日志面板按 tag 过滤时两类失败分家。 | 统一为 `'scene-serialize'`（或全量迁移到 `'scene:serialize'`）。 |
| 🟢 P4 | 生产 | scene-serialize.ts:1423 | `_sSerialize + _sJson > 2` 魔法数值（2ms 阈值）未命名，且与 ADR-248 节流门控无关联。 | 提取命名常量 `PERF_WARN_THRESHOLD_MS = 2`。 |
| 🟢 P4 | 测试 | scene-serialize-resilience.test.ts:501,517 | L501 的 `mockResolvedValueOnce('roundtrip-procmod')` 从未被消费（serializeScene 不调 loadPMXFile），残留的队列化 mock 仅因是末位用例而无害。 | 删除 L501 那次桩设，只保留 L517。 |
| 🟢 P4（沿用） | 生产 | scene-serialize.ts:559 | round-11 P3 `getActiveFormation()!` 双调用仍存在（本测试 mock 返回 null 故未触发）。 | 缓存局部变量（round-11 已建议，未修）。 |
| 🟢 P4（沿用） | 生产 | scene-serialize.ts:615-948 | round-11 P3 `deserializeModels` 无重入守卫：并发两次 `deserializeScene` 会交错加载模型（异步 await 处让出）。 | round-11 已建议加序列化/代数令牌，未修。 |
| 🟢 P4（沿用） | 生产 | scene-serialize.ts:1431 | round-11 P3 SaveLastScene 无超时：Go 端挂起时本次保存永久 pending。 | round-11 已建议加超时，未修。 |

---

## 测试质量评价

**有效性（核心契约）**：✅ 主用例（单 BOOM 跳过 + 其余落盘）是真实验证——BOOM 注入在 `serializeModel` 首行调用点，命中 try/catch 边界；registry 为真实 Map（插入序确定），断言 `['模型甲','模型丙']` 同时验证了「跳过」「保序」「继续循环」三层语义，非同义反复。空场景/全正常两例界定语义边界。suppress 泄漏两例以「复位后防抖可调度」的可观察日志验证不变量，比直接断言内部标志更有价值。

**mock 合理性**：整体是「重依赖统一空 mock、关键路径局部真实」的务实策略，方向正确；但两处偏离项目测试卫生铁律（内联 scene mock 未复用共享工厂、core/config 静态化未保留活绑定），当前恰好工作、后续有隐性风险（P3）。`@/core/path` mock 为真实模块导出完整超集，是本文件 mock 中唯一完全合规者。

**边界覆盖**：⚠️ 不足。任务点名的「多个 BOOM / 首条抛错 / 全部抛错 / 记录日志」四项中**零覆盖**；方向②（整体抛错 → abort）全仓零覆盖（P2）。BOOM 中位是唯一覆盖的容错场景。

**类型卫生**：测试内 `as any` 多处可避免（ModelInstance 已类型化目标字段），`as never` 用作夹具万能锤——不违反生产硬约束但违反「新代码避免 any 逃生」精神（P4）。

**跳过测试 / 遗留状态**：无 `it.skip`/`it.todo`；`afterEach(vi.restoreAllMocks)` 防 spy 泄漏；material-sss 的 `disposeModelSssState` 若断言失败则不会执行（无 try/finally），存在轻微跨用例污染窗口（P4，未单列）。

---

**审核日期**：2026-08-15
**审核员**：子代理 round30-scene-serialize-resilience
