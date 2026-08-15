# env-bridge Gravity + Sun Angle 集成测试 — 审核结果（round-54 / 测试 3）

## 审核范围

- **测试文件**：`frontend/src/__tests__/env-bridge/gravity-sun.int.test.ts`（106 行，9 用例，ADR-204 P2 拆自 env-bridge.test.ts）
- **被测生产源码**：
  - `frontend/src/scene/env/env-gravity.ts`（32 行，全文件：`setGravityStrength`/`getGravityStrength`）
  - `frontend/src/scene/env/env-time-of-day.ts`（401 行，本测试覆盖段：`:42-51` setEnvSunAngle/getEnvSunAngle；关联段 `:382-394` syncEnvSunAngle 中间件）
- **测试桩**：`frontend/src/__tests__/env-bridge/env-mocks.ts`（396 行，10 连 vi.mock 共享桩）
- **运行验证**：`npm run test -- src/__tests__/env-bridge/gravity-sun.int.test.ts` → **9/9 通过（54ms）**；未跑 `npm run check`（时间成本考量，测试已含 tsc 无关断言，报告注明）

## 总体结论：⚠️ 有条件通过

生产代码（env-gravity.ts 全部 + env-time-of-day.ts 的 sun-angle 段）健康：无 `as any`/`@ts-ignore`/`@ts-expect-error`，WASM 专属 API 有 instanceof 守卫，无静默吞错、无资源泄漏、无循环依赖（env-bridge 不反向 import env-time-of-day，已 grep 核实）。测试 9/9 绿、断言方向真实（钳制/往返/autosave），但存在 4 处测试质量缺口与 1 处生产遗留 P3（round-12/53 已登记、本次确认仍在），故判有条件通过，条件为补 physics.setGravity 应用断言 + envState.sunAngle 双写断言、去除重复用例。

### 与既往轮次的关系（任务要求注明）

| 轮次 | 关系 |
|------|------|
| round-12 | 审 env-gravity ✅（`2026-08-06-round12-env-motion-core-ai.md:14,116`，当时即注明由本测试文件覆盖）；审 env-time-of-day ⚠️，登记「applyEnvPresetObject/syncEnvSunAngle 未钳制 [-15,90]」P3（:75） |
| round-53（middleware） | 专项确认 syncEnvSunAngle 未钳制 P3 **仍在**（`2026-08-15-round53-middleware.md:37`，env-time-of-day.ts:389-392）——本次复核代码仍无钳制，见风险表 #1；该中间件唯一用例在 middleware.int.test.ts，本文件不覆盖（合理分工） |
| round-53（env-persist） | 审防抖/持久化链，与本文件无直接交集；envState.sunAngle 作为「持久化源」的角色（env-time-of-day.ts:38-41 注释）经 `setEnvSunAngle` 直写，本测试未断言（见风险表 #5） |
| round-25 | env-state-schema（ADR-243）测试锁 sunAngle 默认 45——本文件 'default is 45' 用例的默认值契约由彼处兜底（见风险表 #4 佐证） |

## 亮点

- **WASM 专属 API 安全降级**：`env-gravity.ts:21-24` `mmdRuntime instanceof MmdWasmRuntime && mmdRuntime.physics` 守卫后再调 `physics.setGravity`，JS 版（无物理）不崩溃，注释写明原因；测试桩 `MmdWasmRuntimeMock`（env-mocks.ts:16-18）形状与该 instanceof 检查精确匹配，守卫路径在测试中被真实执行。
- **命名常量乘法耦合**：`env-gravity.ts:16,20` 重力向量统一由 `DEFAULT_GRAVITY`（ui-constants.ts:14，-98）派生，强度与向量比例关系单一事实源，无散落字面量。
- **autosave 参数化**：`env-gravity.ts:25-27` `skipAutoSave` 参数让批量/高频写入可跳过自动保存，职责清晰。
- **ghost-state 双写修复**：`env-time-of-day.ts:44-47` `setEnvSunAngle` 同时写模块缓存与 `envState.sunAngle`（持久化源），`[fix:ghost-state]` 注释（:38-41）完整解释成因（原只写 envState 漏写缓存 → tick 旧值覆盖用户设置）；`syncEnvSunAngle` 中间件（:386-394）反向同步构成闭环。
- **mock 治理合规**：10 连 vi.mock 全部经 `env-mocks.ts` 共享桩动态 import，backend 桩复用 `fixtures/backend.ts` 的 `makeMockBackend`（ADR-204 P2 规范），envState 用普通可变对象支持 `Object.assign` merge 语义，桩质量与 ADR-204 一致。
- **无跳过用例**：9 用例全部 `it`，无 `it.skip`/`it.todo`；beforeEach 复位序（先 set 后 clearAllMocks）使 'calls triggerAutoSave' 计数断言（:69-72）不被复位污染，正确。

## 风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🟡 P3 | env-time-of-day.ts | :389-392 | **syncEnvSunAngle 无 [-15,90] 钳制（round-12 P3 遗留，round-53 确认仍在，本次复核代码无变化）**：`setEnvState({sunAngle: 200})` → 中间件直写模块缓存 envSunAngle=200 越界漂移，直到 _timeOfDayTick 折返；滑块 getEnvSunAngle() 读到越界值。本测试文件恰是 sun-angle 应用面，但未覆盖该中间件。 | 中间件内复用与 setEnvSunAngle 相同的钳制（提取 `clampSunAngle` 公共叶或命名常量，见 #6），并在 middleware.int.test.ts 补越界输入用例（round-53 已提同一建议，待办）。 |
| 🟡 P3 | gravity-sun.int.test.ts | :64-67（用例 4） | **重复用例虚胖计数**：'roundtrips state correctly' 与用例 2（:50-55）断言完全重复（同为 setGravityStrength(0.5)→toBeCloseTo(0.5)），9 用例实为 8 个独立断言，头部注释「Gravity（5）」名不副实。 | 删除用例 4，或将其改造为覆盖当前空白路径（skipAutoSave=true 不触发 autosave，见 #7）。 |
| 🟡 P3 | gravity-sun.int.test.ts | 全文件（Gravity describe） | **重力「应用」链路零断言**：`env-gravity.ts:22-24` 的 `physics.setGravity` 调用与向量值（`DEFAULT_GRAVITY × strength`）从未断言——mock 已备好 `physics.setGravity: vi.fn()` 句柄（env-mocks.ts:17）却闲置；`MockVector3` 具 x/y/z 属性（babylon-classes.ts:326-334）断言可行。L2 集成定位名不副实：本文件实为「缓存/钳制」级断言，真正的 gravity→WASM 同步（模块头注释「职责: 重力向量」）无人守卫。 | 追加 1 例：`setGravityStrength(0.5)` 后断言 `physics.setGravity` 被调用 1 次且参数 `y === -49`（-98×0.5），锁定 DEFAULT_GRAVITY 乘法耦合与 WASM 同步链路。 |
| 🟡 P3 | gravity-sun.int.test.ts | :46-48、:82-84 | **'default' 两用例被 beforeEach 复位掩盖**：Gravity beforeEach `setGravityStrength(1.0)`（:41）、Sun beforeEach `setEnvSunAngle(45)`（:79）先行写值，模块级默认值即使被改（如 `let envSunAngle = 45` → 60）测试仍绿——断言名义「默认」实为「复位值」。 | 默认值契约已有 env-state-schema 测试（ADR-243）独立兜底（round-25 验证），风险可控；建议在用例处加注释说明「锁复位值而非模块初始态」，避免后人误信。 |
| 🟡 P3 | gravity-sun.int.test.ts | :86-91（Sun Angle describe） | **envState.sunAngle 双写零断言**：`env-time-of-day.ts:46` 写 `envState.sunAngle` 是 ghost-state 修复核心（持久化源同步），但测试只断言缓存侧；若该行被误删（回到 round-12 的漂移 bug），9 用例全绿。断言句柄现成（env-mocks.ts:161 `mockConfigEnvState` 即 SUT 同一 envState 引用）。 | 补 1 例：`setEnvSunAngle(30)` 后断言 `mockConfigEnvState.sunAngle === 30`，锁死双写闭环。 |
| 🟢 P4 | env-gravity.ts / env-time-of-day.ts | env-gravity.ts:19 / env-time-of-day.ts:45、:70-75 | **魔法数值散落三处**：重力钳制 `[0,2]` 内联（env-gravity.ts:19）；太阳角钳制 `[-15,90]` 在 `setEnvSunAngle`（:45）与 `_timeOfDayTick` 折返（:70-75）重复硬编码。此类散落正是 #1 中间件漏钳制的结构性诱因（改范围需三处协同，漏一处即漂移）。 | 提取 `GRAVITY_MIN/MAX`、`SUN_ANGLE_MIN/MAX` 命名常量至 ui-constants，setEnvSunAngle/_timeOfDayTick/syncEnvSunAngle 三处共用（与 #1 合并处理）。 |
| 🟢 P4 | env-gravity.ts | :25-27 | `skipAutoSave=true` 分支（不触发 autosave）零覆盖。 | 补 1 例：`setGravityStrength(0.8, true)` 后 `expect(mockConfigTriggerAutoSave).not.toHaveBeenCalled()`。 |
| 🟢 P4 | env-mocks.ts | :118、:156-160 | 测试桩 `envState` 为 `Record<string, any>`、`EnvState: class {}` 空类——测试代码内 any 逃生（非生产代码，ADR-204 桩容忍范围内）。 | 维持现状即可；如 envState 桩与 schema 漂移，可考虑 Partial 化，非必须。 |

## 测试质量评价

- **断言有效性**：钳制断言（:57-62 重力 [0,2]、:93-98 太阳角 [-15,90]、:100-105 边界值接受）全部直击生产 clamp 逻辑，边界值 -15/90 双端点显式锁定（不被继续钳制），方向正确、非假绿；roundtrip 断言用 `toBeCloseTo`（浮点安全）与 `toBe`（整数安全）分型使用，合理。
- **mock 合理性**：10 连 vi.mock 全走共享 `env-mocks.ts`（ADR-204 P2 上抬的 581 行前导），backend 桩复用 fixtures 工厂；`MmdWasmRuntimeMock` 形状精确匹配生产 instanceof 守卫，`configModule.envState` 用普通可变对象支撑双写语义——桩与 SUT 依赖形状对齐，无自嗨桩。
- **边界覆盖**：太阳角上下越界（-30/100）+ 双端点（-15/90）四值覆盖完整；重力下越界/上越界两值覆盖。缺口见风险表 #3/#5/#7（physics 应用、双写、skipAutoSave）。
- **无跳过、无 todo**，beforeEach 复位与 clearAllMocks 时序正确（先复位后清计数，autosave 计数断言干净）。
- **106 行充分性**：对「缓存/钳制契约」定位充分（9 例/54ms），但对「L2 集成」定位不足——真正的集成点（physics.setGravity 应用、envState 双写）恰是盲区，且含 1 个重复用例。建议删除重复 + 补 3 条断言（#3/#5/#7，共 ~12 行）后可达「充分」；与 round-53 middleware 补越界用例建议合并为一次小改动。

## 结尾

- **审核日期**：2026-08-15
- **审核员**：子代理 round54-gravity-sun
