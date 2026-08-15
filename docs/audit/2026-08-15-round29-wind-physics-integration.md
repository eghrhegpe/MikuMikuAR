# wind-physics 集成契约 — 审核结果（round-29 / 真实 WASM 物理真实性）

## 一、审核范围

| 项 | 内容 |
|----|------|
| 测试文件 | `frontend/src/__tests__/wind-physics-integration.test.ts`（324 行，8 用例，5 个 describe，无跳过） |
| 被测源码 | `frontend/src/scene/physics/wind-physics.ts`（233 行；施力回调 `_onPhysicsSync` 84–133，订阅状态机 147–233） |
| 间接涉及 | `frontend/src/__tests__/helpers/minimal-physics-impl.ts`（257 行，WASM 初始化 + 共享构造/读取辅助）、`frontend/src/core/wind-utils.ts`（getWindVector/isWindActive，:24-45）、`frontend/src/core/mmd-adapter.ts`（getRigidBodyBundleMap :75 / getRigidBodyMap :96 / 原生施力 :210/:332） |
| 上游 API | `babylon-mmd/esm/Runtime/Optimized/wasm/spr`（真实 WASM Bullet，18 个被用导出逐一核实存在于 index.d.ts/index.js） |
| **与 round-22 / round-28 分工** | round-22 审 `wind-physics.test.ts`（126 行）= 状态机快照 + `_getBundles` 契约 + `isWindPhysicsActive` 5 态；round-28 审 `wind-physics-state.test.ts`（538 行）= init/retry/dispose 时序幂等 + 施力路径 8 用例（mock observe 触发**真实** `_onPhysicsSync` 回调，断言逐刚体调用次数与力值）；本文件 = **真实 WASM Bullet 世界**，不执行生产代码，复刻 `_onPhysicsSync` 的调用序列（bundle 逐 index 中央力 :94-99 + 单数中央力 :106-108）验证物理真实性（质量反比 / 方向独立 / 重力叠加 / 停风衰减 / 持续施风速度积累）。三层分工：round-22=契约快照，round-28=生产逻辑分支，本文件=L1.5 物理引擎行为契约。 |

**验证结果**：`npm run test -- src/__tests__/wind-physics-integration.test.ts` → 8/8 通过（135ms，vitest run 总时长 1.68s）。未跑 `npm run check`（tsc 全量），理由：本测试文件及其 helper 经 round-22/28 两轮 `npm run check` 已全绿，且本轮零代码改动；测试文件类型层面由 vitest 的 esbuild transform 通过即成立。如需 tsc 复核可单独跑 `cd frontend && npm run check`。

## 二、总体结论

⚠️ **有条件通过**

- **生产代码健康**：`wind-physics.ts` 本轮复看无新增问题——类型安全（0 处 `as any`/`@ts-ignore`）、无静默吞错、observer dispose 精确移除、魔法数值全部命名常量（round-22/28 已详审，本轮聚焦其施力调用序列与测试的对应关系）。无 P1/P2。
- **条件（P3 × 3，均为测试质量/文档口径，非阻塞）**：
  1. 本测试**零 import 生产代码**（`wind-physics.ts`/`wind-utils.ts`/`mmd-adapter.ts` 均未引用），是"复刻调用序列"而非"执行生产逻辑"——"集成契约"命名与文件头宣称（:6-7"验证 L1 和 L2 之间的衔接"）略过，易让维护者误判生产回归会在本文件变红；
  2. 8 个用例的清理序列均无 try/finally，断言失败时 WASM 对象泄漏；
  3. 2 处 `toBe(0)` 精确相等断言（:186/:214）是仅有的浮点脆点。
- 修正上述 3 项后可转 ✅。

## 三、亮点

- **真实 WASM 端到端、零 Babylon 依赖**（:1 `@vitest-environment node` + :13 声明）：经 `initSync({module})` 同步加载 SPR wasm（helper :66-69），Node 环境无 fetch/navigator.hardwareConcurrency 依赖，物理行为在**真实 Bullet 引擎**上验证，非 mock 自证。18 个被用 WASM 导出（createPhysicsWorld / rigidBodyBundleApplyCentralForce / physicsWorldStepSimulation / rigidBodyGetLinearVelocity 等）全部与 `spr/index.d.ts` 签名逐一核对存在。
- **物理数值推导准确且注释完整**：测试 2（:111-114）强风 a=(100-9.8)/1=90.2→向上、弱风 a=(5-9.8)/1=-4.8→向下，计算正确且被真实引擎验证；测试 8（:311-314）60 帧理论 v=forceY×60×(1/60)/mass=10，±20% 容差合理（区间断言非脆值）。
- **质量感知在真实引擎上验证**（测试 1:82、测试 7:279）：质量 0.5 vs 2.0（4 倍差）同力下 v ∝ 1/m 反比关系实测成立，直接支撑生产 `WIND_FORCE_SCALE=1.0`（wind-physics.ts:50）"风速 10 → 10N → 1kg 刚体加速度 10m/s²"的标定前提。
- **helper 共享工厂消重**（minimal-physics-impl.ts）：build/read 辅助集中一处，`readLinearVelocity`/`readBundleLinearVelocity` 用 try/finally 保证 out buffer 释放（:234-240/:249-256）；`PHYSICS_INFO_SIZE=144` + `PHYSICS_OFF` 偏移表（:90-111）单一定义，两测试文件薄包装共享（:39-47），消除三份独立复制（git log d08fffba"一改全改"）。
- **用例隔离与防休眠工程**：每用例独立建 world/shape/bundle 并完整成对清理（remove→destroy→deallocate→destroyShape→destroyWorld，8 用例全覆盖）；`buildBundleInfoList` 恒 disableDeactivation=1（helper :222）、单数刚体显式传 `disableDeactivation: true`（:131 等）——钉死 Bullet 休眠，避免测试时序不稳定。
- **覆盖 _onPhysicsSync 双施力容器**：describe 4"对齐 wind-physics 路径 1b"（:226）显式复刻 `wind-physics.ts:106-108` 单数刚体路径；describe 1 覆盖路径 1a bundle 逐 index 施力（:94-99 对应生产 :94-99）——与生产调用序列逐行对应。
- **无跳过、无 test.only、无共享可变状态跨用例**；beforeAll 单例初始化幂等（helper :61-64）。

## 四、风险表

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|--------|------|------|------|----------|
| 🔴 P1 | — | — | 无 | 无 |
| 🟠 P2 | — | — | 无 | 无 |
| 🟡 P3 | frontend/src/__tests__/wind-physics-integration.test.ts | :16-26（import）+ :6-13（头注释） | **生产代码零引用**：import 仅 vitest + 测试 helper + 第三方 wasm 类型；`wind-physics.ts` 的 `_onPhysicsSync` 未被真实执行（其依赖 Babylon runtime 对象，无 Babylon 环境本就无法执行）。测试实际验证的是"真实 Bullet 对中央力的牛顿响应"——这是施力逻辑的**物理前提**而非施力逻辑本身。文件头 :6-7 宣称"验证 L1 和 L2 之间的衔接"、"集成契约"命名易让维护者误判生产回归（如 scale 系数改错、漏单数路径、mass-aware 错误）会在此变红——实际那些由 wind-physics-state.test.ts 兜底。 | 文件头补充边界声明："本文件不 import/执行 wind-physics.ts 生产代码，仅复刻其调用序列在真实引擎上验证物理响应契约；生产逻辑回归由 wind-physics-state.test.ts 覆盖"。设计分工本身合理（真实集成需加载整个 MmdWasmRuntime，成本高），文档口径修正即可。 |
| 🟡 P3 | frontend/src/__tests__/wind-physics-integration.test.ts | :85-89（及 7 处同类清理） | 清理序列无 try/finally：8 用例均在断言之后手动清理（remove/destroy/deallocate/destroyShape/destroyWorld），任一 expect 抛出即跳过全部清理 → WASM 堆对象泄漏（模块单例无法卸载，泄漏累积，见 helper :80-83 注释）。当前全绿无碍，但失败用例无法留下干净现场且污染后续堆状态。 | 抽 `afterEach` 或 helper（如 `cleanup(world, body, info, shape)` 收拢 6 行清理），并在用例体包 try/finally 保证断言失败也执行；或至少把清理移入 `afterEach` 按用例注册。 |
| 🟡 P3 | frontend/src/__tests__/wind-physics-integration.test.ts | :186、:214 | `expect(vy).toBe(0)` / `expect(vz).toBe(0)` 精确相等断言：无重力无外力下 Bullet 理论输出精确 0，当前引擎下稳定通过；但属浮点物理中的脆断言——引擎升级、阻尼参数变化或引入 1e-9 级积分噪声即偶发失败，是全部 8 用例中仅有的时序敏感点。 | 改 `toBeCloseTo(0, 6)`（或 `< 1e-6`），语义不变（仍验证方向独立），消除浮点脆性。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-integration.test.ts | :126-155 | 测试 3 标题"持续施风后停风 → 刚体在重力作用下从上升转为下落"与断言不符：阶段 1 施风 30 帧 v=(20-9.8)×0.5=5.1，阶段 2 停风 30 帧 v=5.1-9.8×0.5≈0.2 **仍为正（上升）**，断言 `vyAfterStop < vyAfterWind` 只验证了"速度衰减"未验证"转为下落"（:155）。 | 二选一：(a) 停风帧数加倍至 60 帧（v=-4.7 真正转负）后断言 `vyAfterStop < 0`，标题才名副其实；(b) 标题/注释降级为"风力停止后重力使上升减速"，与断言一致。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-integration.test.ts | :137 | 阶段 1 循环 `for (let i = 0; i < 30; i++) { if (i < 30) {...} }` 中 `if (i < 30)` 恒真（i 最大 29），冗余分支。 | 删除 if，循环体直接施风。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-integration.test.ts | :73-82 | 测试 1 只断言两端质量（vy0 > vy2，:82），中间质量 1.0 的 vy1 仅断言 >0 未参与排序验证（vy0 > vy1 > vy2 未检验）。 | 追加 `expect(vy0).toBeGreaterThan(vy1)` / `expect(vy1).toBeGreaterThan(vy2)`，把 v ∝ 1/m 单调性钉完整（仍为方向断言，无脆性代价）。 |
| 🟢 P4 | frontend/src/__tests__/helpers/minimal-physics-impl.ts | :90 | `PHYSICS_INFO_SIZE = 144` 硬编码无来源注释：这是对 babylon-mmd wasm-bindgen 生成的 `RigidBodyConstructionInfo` 二进制布局（含对齐 padding）的假设，偏移表 :93-111 与 144 之间差 13 字节对齐填充未说明。当前由 physics-contract.test.ts 锁定（不会悄悄漂移），但维护者无法从注释得知 144 的推导。 | 补注释"144 = 字段区 131 字节 + 16 字节对齐 padding，源自 babylon-mmd spr wasm RigidBodyConstructionInfo 布局，勿改，改前同步 physics-contract.test.ts"；或将 144 提为从 `PHYSICS_OFF` 末字段推导。 |
| 🟢 P4 | frontend/src/__tests__/wind-physics-integration.test.ts | :54-89（及全部用例） | 8 用例样板重复：每例"createWorld → setGravity → createShape → buildInfo/bundle → createBody → add → applyForce → step → 断言 → 6 行清理"，约 20 行样板/用例。helper 已抽 build/read，但 world 创建与清理未收拢。 | 抽 `makeWorld(gravityY?)` / `cleanupAll(...)` 本地 helper 收拢样板（保持用例自包含可读性的前提下）；属风格建议，不影响正确性。 |

## 五、测试质量评价

- **有效性**：8 用例断言全部针对真实 WASM 引擎输出（`rigidBodyGetLinearVelocity`/`rigidBodyBundleGetLinearVelocity` 读取真实刚体速度，helper :229-257），非 mock 自证；质量反比（:82/:279）、方向独立（X 轴/斜向，:184-187/:213-215）、重力叠加强/弱风分向（:112-114）、停风后重力衰减（:155）、持续施风 60 帧理论速度 ±20%（:313-314）5 类物理规律在真实 Bullet 上实测，数值推导全部准确。✅
- **合理性**：mock 为零（仅 WASM 初始化），不依赖 Babylon/MmdRuntime，符合文件头 :13 声明；helper 布局常量（144/偏移表）经 physics-contract.test.ts 契约锁定不会漂移；与生产 `_onPhysicsSync` 的调用序列（bundle 逐 index / 单数 applyCentralForce）逐行对应（:66/:102/:138/:177/:207/:238/:270/:306 ↔ wind-physics.ts:97/:107）。⚠️（生产逻辑本身未执行，见 P3-1）
- **边界覆盖**：bundle 容器（describe 1）+ 单数容器（describe 4）双路径、质量 0.5/1.0/2.0 三档差异、强/弱风 vs 重力、X 轴/斜向方向独立、停风衰减、持续施风——覆盖 `_onPhysicsSync` 路径 1a/1b 的物理响应面；路径 2（mass-aware 原生导出，wind-physics.ts:114-131）需要真实 mmdModel/wasmInstance，无 Babylon 环境无法执行，由 wind-physics-state.test.ts mock 覆盖，分工合理无盲区。✅
- **跳过**：无 `it.skip`/`describe.skip`/`xit`/`todo`。✅
- **稳定性**：固定 dt 1/60、max_sub_steps=1、无随机性、断言以符号/区间型为主；`disableDeactivation` 全开防休眠（helper :222 + 显式传参）。仅 2 处 `toBe(0)` 精确相等为时序敏感点（P3-3）。⚠️
- **性能**：8 用例 135ms 秒级完成；WASM 单例一次初始化，无重复加载。✅

## 六、附注

- 生产代码 `wind-physics.ts` 与 round-22/28 审计结论一致（无 P1/P2/P3 生产风险）；本文件补足的是"施力逻辑的物理前提在真实 Bullet 中成立"这一 L1.5 层，三层测试（round-22 契约快照 / round-28 生产逻辑 / round-29 物理真实性）各司其职，无重叠无盲区。
- 审核日期：2026-08-15
- 审核员：子代理 round29-wind-physics-integration
