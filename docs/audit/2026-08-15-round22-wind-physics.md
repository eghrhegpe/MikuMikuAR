# wind-physics 模块 — 审核结果（round-22 / 测试反推源码）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/wind-physics.test.ts`（126 行，9 用例，无跳过） |
| 被测源码 | `frontend/src/scene/physics/wind-physics.ts`（233 行，主体 42–233；`_getBundles` 薄转发在 :43） |
| 间接涉及 | `frontend/src/core/mmd-adapter.ts:75-77`（`getRigidBodyBundleMap`，被 re-export 为 `_getBundles`） |
| **边界说明** | round-15 已审 `core/wind-utils.ts`（工具层）；本测试 **mock 掉 wind-utils**（:29-32），被测对象是 wind-physics **物理模块本体**（订阅编排 + 刚体施力）。施力路径的真实执行不在本文件，而在兄弟文件 `wind-physics-state.test.ts`（经 `onSyncObservable._notify()` 触发，391–524 行）与 `wind-physics-integration.test.ts`（真实 WASM 世界）——三者分工：本文件=状态机 + 契约快照，state=施力路径，integration=物理真实性。 |

**验证结果**：`npm run test -- src/__tests__/wind-physics.test.ts` → 9/9 通过（45ms）；`npm run check`（tsc + i18n）→ exit 0 全绿。

## 二、总体结论

⚠️ **有条件通过**

- **生产代码健康**：无 P1/P2。类型安全（0 处 `as any`/`@ts-ignore`）、Observer 生命周期（dispose 精确移除）、多运行时状态机、魔法数值常量化为已审亮点。
- **条件（P3，测试质量）**：本文件 4/9 用例（`_getBundles` 块）断言的是 **mock 自身的重实现**而非生产 `getRigidBodyBundleMap`，属于"自证式"测试，生产回归时无法变红；真实护栏在 `mmd-adapter.contract.test.ts:40-52`。建议低成本修正（见风险表 P3），修正后可转 ✅。

## 三、亮点

- **多运行时订阅状态机** `_subs: Map<IMmdRuntime, _WindSub>`（`wind-physics.ts:69-74`）：支持多场景/多窗口；`disposeWindPhysics(runtime?)` 按运行时精确移除 observer（:207-212）或全量清理（:214-219），不误伤其他 onSyncObservable 订阅者。
- **静默失效可观测 + 防刷屏** `_implMissingWarned`（:76-78、:188-194）：impl 缺失仅首次 logWarn，订阅成功后复位——"风参数生效但物理无反应"这类不可观测状态被显式暴露，且会话内不刷屏（对齐 mmd-adapter `_nativeMissingWarned` 先例）。
- **魔法数值全部命名常量 + 来源注释**：`WIND_FORCE_SCALE=1.0`（:50）、`MODEL_WIND_FORCE_SCALE=5.0`（:56）、`MODEL_WIND_REFERENCE_MASS=1.0`/`MODEL_WIND_MIN_SCALE=0.2`（:62-63），均注明 ADR-194/ADR-200 推导与标定依据，无裸数字。
- **升级回归降级链**（:114-131）：actor 过滤（stage 跳过）+ `applyWindForceToModelRigidBodiesNative` 返回 0 时回退旧版等力施力；缺导出在 mmd-adapter 侧各打一次 dev 告警（绝不静默失效）。
- **测试 mock 最小且形状对齐**：Vector3 mock（:5-25）仅实现 `constructor/copyFrom/scaleInPlace`，恰好覆盖生产路径（:66-67、:90、:115）所需全部 API；mmd-adapter mock 覆盖 wind-physics 实际 import 的全部 5 个符号（:33-41）；`getWindVector` mock 返回普通 `{x,y,z}` 对象与 `copyFrom` 形状兼容，合理。
- **状态机边界覆盖完整**（:94-125）：未注册→false、注册→true、全量 dispose→false、按运行时 dispose→false、impl 缺失（mockReturnValueOnce(null)）→false，5 态全覆盖。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/__tests__/wind-physics.test.ts | :5-41 + :49-92 | `_getBundles` 4 个用例是**自证式测试**：vi.mock 了 `@/core/mmd-adapter`（:33-41），`wind-physics.ts:43` 的 re-export 绑定到 mock 的 `getRigidBodyBundleMap`（`(impl) => impl.rigidBodyBundleReferenceCountMap?.keys() ?? []`），断言的是 mock 自身行为而非生产 `mmd-adapter.ts:75-77`（`impl.rigidBodyBundleReferenceCountMap.keys()`，无 `?.`/`??`）。生产若改读私有字段 `_rigidBodyBundleMap`，此 4 用例仍全绿——:4 注释"验证 _getBundles 从公开属性读取 bundle"不成立，占本文件 4/9 用例的虚假护栏，误导维护者。 | 二选一：(a) 删除此块（真实护栏已存在于 `mmd-adapter.contract.test.ts:40-52`，不 mock 直接测生产实现）；(b) 保留则改用 `vi.importActual('@/core/mmd-adapter')` 取真实 `getRigidBodyBundleMap`，使断言落到生产代码。顺带可移除 `wind-physics.ts:42-43` 的测试专用 re-export（ADR-192 双轨过渡已完成）。 |
| 🟢 P4 | frontend/src/scene/physics/wind-physics.ts | :127-129 | `applied === 0` 作为降级触发哨兵，混淆「缺 wind mass-aware 导出」与「模型无原生刚体」两情形：无原生刚体的 actor 每帧进入无意义的降级调用（mmd-adapter 侧 :350-370 同样双重检查 len）。 | 把「导出缺失」探测前置为一次性能力缓存（对齐 `_nativeMissingWarned` 模式），或仅当 wind 导出存在而 len>0 时才走降级。影响极小，可随下次触碰本模块时顺手修。 |
| 🟢 P4 | frontend/src/scene/physics/wind-physics.ts | :42-43 | `_getBundles` 仅被测试引用（grep 全 src 确认），是测试专用导出残留在生产面。 | ADR-192 双轨过渡完成（契约已由 mmd-adapter.contract.test.ts 直接测），可移除 re-export 并同步删测试引用。 |
| 🟢 P4 | frontend/src/scene/physics/wind-physics.ts | :226-233 | `isWindPhysicsActive` 返回「已订阅」而非「风开启且已订阅」——订阅建立不保证 `isWindActive()` 为真（风开关/风速阈值在 wind-utils 侧）。注释已说明 UI 用途，但命名易被误读为"风正在生效"。 | 保持现状（注释已澄清）或改名 `isWindPhysicsSubscribed` 并同步 dev-hooks.ts 引用；属文档级修正。 |
| 🟢 P4 | frontend/src/scene/physics/wind-physics.ts | :196（联动 observer-handle.ts:68） | `_trySubscribe` 未捕获 `observe()` 异常：`observable.add` 返回 null 时 observer-handle 抛错，会向上传播至 `initWindPhysics`/`retryWindPhysicsSubscription` 调用方。Babylon `Observable.add` 正常不返回 null，风险极低。 | 可选：在 `_trySubscribe` 包一层防御性 try/catch + logWarn，避免单个运行时异常打断 scene 初始化链。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics.test.ts | :94-125 | 模块级单例 `_subs` 跨用例持久，`isWindPhysicsActive` 块依赖用例顺序（前例须 dispose 干净才不互相污染）。当前顺序安全（每例 init 后必 dispose），但新增用例易踩隔离坑。 | 加 `beforeEach(() => disposeWindPhysics())` 显式复位模块状态，使用例相互独立。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics.test.ts | :5-25 | mock 的 `onSyncObservable.add` 不捕获回调，`_onPhysicsSync` 施力路径（零风力早退/1a/1b/2 路径/降级）在本文件**零覆盖**——依赖兄弟文件（state 经 `_notify` 触发）。属分工而非缺口，但本文件注释未声明此边界。 | 文件头注释补充"施力路径由 wind-physics-state/integration 覆盖"边界声明，避免后续误判覆盖缺失。 |

## 五、测试质量评价

- **有效性**：状态机 5 用例（:94-125）断言的是真实生产函数 `initWindPhysics`/`disposeWindPhysics`/`isWindPhysicsActive`（仅 mmd-adapter/wind-utils/babylon-mmd 被 mock），断言有效且触发真实 `observe()`/ObserverHandle 生命周期；`mockReturnValueOnce(null)` 精确模拟 impl 缺失分支，异常路径（:119-125）有覆盖。✅
- **合理性**：Vector3 mock 最小化、与生产 API 形状逐一对齐；mmd-adapter mock 超集覆盖 wind-physics 的 5 个导入符号；`getWindVector` mock 返回纯对象与 `copyFrom` 兼容。mock 层**唯一缺陷**是 `_getBundles` 块 mock 掉了被测试函数本身（P3，见上）。⚠️
- **边界覆盖**：零风力（`isWindActive` 恒 true、向量恒零）与关闭状态（dispose 后 isActive=false）在状态机层有覆盖；施力层零风力/多 bundle/降级由 `wind-physics-state.test.ts`（`_notify` 触发 8 处）与 `wind-physics-integration.test.ts`（真实 WASM 质量感知/重力叠加）补齐——分工合理，无缺口。✅
- **跳过**：无 `it.skip`/`describe.skip`/`xit`。✅
- **可执行性**：单文件 45ms 秒级完成；mock 不触碰真实 WASM/Babylon，无脆弱环境依赖。✅

## 六、附注

- 生产代码 `wind-physics.ts` 与 ADR-200（路径1 单数刚体施力）/ADR-201（路径2 wasm 原生导出）/ADR-192（适配层内化）逐条对齐，知识卡 `docs/knowledge/wind-physics.md` invariants 与实现一致。
- 审核日期：2026-08-15
- 审核员：子代理 round22-wind-physics
