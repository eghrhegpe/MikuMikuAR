# wind-physics 状态机/时序 — 审核结果（round-28 / 测试反推源码）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/wind-physics-state.test.ts`（538 行，25 用例，5 个 describe，无跳过） |
| 被测源码 | `frontend/src/scene/physics/wind-physics.ts`（233 行，全文；状态机 69–233，施力回调 84–133） |
| 间接涉及（仅核对 mock 形状，未深入审） | `frontend/src/core/mmd-adapter.ts:39/75/96/210/332`、`frontend/src/core/wind-utils.ts:24/35`、`frontend/src/core/observer-handle.ts:62-71`、`frontend/src/core/config.ts`（barrel → `scene-state.ts:43` modelRegistry） |
| 消费方核对 | `scene.ts:822`（init）、`scene.ts:827`（onDispose → 全局 dispose）、`model-loader.ts:644`（模型创建后 retry）、`dev-hooks.ts:248`（isWindPhysicsActive）——与状态机设计逐一吻合 |
| **与 round-22 分工** | round-22 已审 `wind-physics.test.ts`（126 行）：`_getBundles` 契约快照 + `isWindPhysicsActive` 5 态。本文件是其在 round-22 报告中声明的兄弟文件：**状态机时序细化（init/retry/dispose 幂等、per-runtime 清理、impl 缺失告警防刷屏）+ 施力路径 8 用例（经 `_notify()` 触发真实回调）**。两文件零断言重叠：本文件不 import `isWindPhysicsActive`/`_getBundles`，round-22 不触发 `_onPhysicsSync`。三者分工：round-22=状态机快照+契约，本文件=时序+施力路径，`wind-physics-integration.test.ts`=真实 WASM 物理真实性。 |

**验证结果**：`npm run test -- src/__tests__/wind-physics-state.test.ts` → 25/25 通过（67ms）；`npm run check`（tsc + i18n）→ exit 0 全绿。

## 二、总体结论

✅ **通过**

- **生产代码健康**：无 P1/P2/P3。类型安全（0 处 `as any`/`@ts-ignore`）、Observer 生命周期（dispose 精确移除 + `_subs` 清空）、幂等守卫（init/retry/dispose 三重）、魔法数值全部命名常量。
- **测试质量**：状态机用例断言真实生产函数（仅 mock 边界模块），施力用例断言逐刚体调用次数与力值（`toBeCloseTo`），防刷屏复位语义有专门用例；beforeEach 显式复位模块状态（落实 round-22 P4 建议）。无跳过。
- 仅 4 项 P4 级观察（mock 单例句柄保真度、注释口径、测试内 `as any` 等），不构成阻塞。

## 三、亮点

- **时序行为真实验证而非调用计数**：`_onPhysicsSync` 8 用例（`wind-physics-state.test.ts:385-536`）经 mock observe 的 `_notify` 机制（:193-196）触发**真实生产回调**，逐刚体断言 `applyCentralForce` 调用次数（bundleA×3 / bundleB×2 / 单数×1）与力值 `(3,0,4)`、`×5=(15,0,20)`（`toBeCloseTo`，:399-424），能验证"订阅→施力→数值正确"的完整链路，非自证式。
- **防刷屏复位语义专门验证**（:358-382）："impl 缺失仅 logWarn 一次"（:359-367）与"订阅成功后复位、后续真实失败可再次告警"（:369-382）成对覆盖，恰好钉死 `wind-physics.ts:78/188-194` 的 `_implMissingWarned` 状态机，这是最容易悄悄失效的静默防护。
- **per-runtime 清理语义完整**（:329-355）：per-runtime dispose 后其余 runtime 保持订阅（经 retry 守卫间接验证，:341-343）、被清理 runtime 可重新订阅（:346-355）——精确对应 `disposeWindPhysics(runtime?)`（`wind-physics.ts:205-220`）的双模式契约与 scene.ts 应用级 dispose 用法。
- **测试卫生到位**：beforeEach 显式 `disposeWindPhysics()` 复位模块级 `_subs`（:197，落实 round-22 P4 建议）；可变 mock 状态（`wasmInstance=null` :500-515、`modelRegistry` 注入 :518-535）均 try/finally 还原；全部 mock 工厂只引用 `vi.hoisted` 绑定（:14-120），无 TDZ 隐患。
- **mock 形状与生产逐一核对一致**：mmd-adapter 5 符号签名（含 `applyWindForceToModelRigidBodiesNative` 5 参、返回 number）与 `mmd-adapter.ts:210/332` 一致；`modelRegistry` mock 的 `Map<kind, mmdModel>` 形状与 `scene-state.ts:43` + `types.ts:188`（`ModelInstance.kind/mmdModel?`）一致；`observe` 返回可 dispose 句柄与 `observer-handle.ts:62-71` 一致。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | — | — | 无 | 无 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-state.test.ts | :193-196 | mock observe 用**共享单例** `mocks.observerHandle` 作为所有订阅的返回值，且 `_notify` 只捕获最后一次回调。多 runtime 场景（:329-344）只能验证"dispose 被调用 1 次 + retry 守卫不新增"，无法区分 rt1/rt2 各自的句柄，也无法断言"rt1 dispose 后其回调不再触发"。若生产未来在 `_trySubscribe` 改查 `observer.isDisposed`，此用例会失真。 | 按订阅次数返回独立句柄对象（`observe.mockImplementation` 内 `{ dispose: vi.fn() }` 数组），`_notify` 维护回调列表逐个触发；断言升级为"per-runtime dispose 后对应回调不再被触发"。当前不影响结论，属保真度增强。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-state.test.ts | :467-485 | 降级用例注释"模拟 wind mass-aware 导出缺失（缺导出/无 bundle）"把「缺导出」「无 bundle」「ptr 无效」三种 0 返回值混为一谈——与生产 `wind-physics.ts:127-129` 的 `applied === 0` 哨兵口径一致（round-22 已对生产侧提 P4），但测试侧注释可更精确。 | 注释改为"模拟 wasm 导出返回 0（缺导出/无原生刚体/ptr 无效，生产侧三者同哨兵）"，或按三种情形各建一条 `mockReturnValueOnce` 用例显式区分。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-state.test.ts | :172 | 测试内 1 处 `as any`（`new (MmdWasmRuntime as any)()`）绕过 mock 类构造类型。仅出现在测试文件，不违反生产"0 处 as any"红线，且 :177 的 JS 运行时走 `as unknown as` 无 any。 | 可加一行注释说明"mock 类无构造参数，as any 仅为类型逃生"；不影响功能。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-state.test.ts | :358-382 | 防刷屏用例间存在隐式顺序依赖：用例 1 把 `_implMissingWarned` 置 true，用例 2 依赖自己的 rt1 成功订阅来复位（:371-374 已有注释"隔离前序测试残留"）——当前断言对两种初值均稳健，但新增用例若插入两者之间可能踩坑。 | 可选：在 `beforeEach` 中无法触达模块私有标志；可在用例 2 前追加"确保复位"的显式成功订阅（已做）。属文档级提示，无需改动。 |

## 五、测试质量评价

- **有效性**：状态机 17 用例（init 4 + retry 5 + dispose 6 + 告警 2）全部断言真实生产函数 `initWindPhysics`/`retryWindPhysicsSubscription`/`disposeWindPhysics`，仅 mock 边界（mmd-adapter/wind-utils/babylon-mmd/observer-handle/logger/config），断言有效且触发真实 `_trySubscribe`/`_subs` 生命周期；幂等（:231-238）、全局重试（:275-287）、未注册 runtime 容错（:289-294）、空 dispose（:319-321）等边界均实测。✅
- **合理性**：文件头（:7）明确声明"全部 mock……不依赖真实 WASM"，且 mock 形状经与 6 个生产模块源码逐一核对一致（见亮点第 5 条）。被 mock 掩盖的真实行为——wind-utils 方向×速度合成、mmd-adapter 原生桥守卫（缺导出/ptr/len 检查）、observer-handle 真实 remove——分别由 wind-utils（round-15）、mmd-adapter（round-26 + contract.test.ts）、observer-handle（round-17）各自覆盖，`wind-physics-integration.test.ts` 兜底端到端真实性，分工合理无盲区。唯一保真度折损是共享句柄单例（P4，见上）。⚠️→✅
- **边界覆盖**：重试上限——本模块设计上无重试计数/定时器（重试为显式外部调用，`wind-physics.ts` 内无 setTimeout/循环重试），故"耗尽"语义退化为"持续缺失不刷屏 + 订阅成功复位"，两态均被用例钉死；中途销毁——per-runtime dispose（:329-355）+ dispose 后重订阅（:308-317）覆盖；重复订阅——幂等 init、retry 已订阅守卫、全局重试不重复三处覆盖。施力层覆盖零风力早退/空 bundle/actor 过滤/wasmInstance 缺失/降级/空 mmdModel 共 8 分支。✅
- **跳过**：无 `it.skip`/`describe.skip`/`xit`/`todo`。✅
- **可执行性**：单文件 67ms；不触碰真实 WASM/Babylon，无脆弱环境依赖；`npm run check`（tsc）全绿，测试文件类型安全通过 CI。✅

## 六、附注

- 生产代码 `wind-physics.ts` 与知识卡 `docs/knowledge/wind-physics.md` invariants（幂等 init、retry 补齐、per-runtime dispose、单数 getRigidBodyMap + wasm 原生导出、bundle 容器恒空幽灵路径）逐条一致；与 ADR-104（显式 retry 替代 monkey-patch）、ADR-192/194/200/201 对齐。
- 审核日期：2026-08-15
- 审核员：子代理 round28-wind-physics-state
