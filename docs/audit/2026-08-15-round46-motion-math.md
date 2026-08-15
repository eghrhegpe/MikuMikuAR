# [motion-math 数学层] — 审核结果（round-46 / motion-math）

**审核范围：**
- 测试文件：`frontend/src/__tests__/scene/motion-math.test.ts`（59 行，9 用例，ADR-116 P3 时间驱动纯数学补测）
- 被测源码：`frontend/src/scene/motion/motion-modules/motion-math.ts`（43 行，零依赖纯函数模块）
  - `computeSwayYaw` L12-19（振幅/衰减/频率正弦 yaw）
  - `computePedalPhase` L27-31（踏板相位，360° 自然循环 + 负值归一化）
  - `computeFootPitch` L39-42（单足俯仰，左右反相，幅度 20°）

**总体结论：⚠️ 有条件通过**

测试本身质量良好（9/9 全绿、断言全部有效、无跳过、4ms 完成）；条件为：`computeSwayYaw` 目前**无生产调用方**（ADR-116 P3 规划的 `sway-motion.ts` 未落地，registry.ts 实际仅注册 body-posture / hand×2 / foot×2 / riding-model 六个模块），而文件头 JSDoc（motion-math.ts:2）声称「由 sway/riding 的每帧钩子调用」与现状不符——测试锁定的是一条尚未接线的公式，需接线或修正注释/ADR 状态。

**验证记录：** `npm run test -- src/__tests__/scene/motion-math.test.ts` → 1 file / 9 tests 全通过（4ms）；`npm run check`（tsc --noEmit + check:lint）→ 通过（5.3s）。

---

**亮点：**
- **纯函数层与引擎彻底解耦，可测性设计正确**：motion-math.ts 全文件零 import、零状态、零资源，注释明示「只做数值计算，不触碰引擎/状态，由帧钩子调用」（motion-math.ts:1-2）——数学与渲染解耦，4ms 跑完的 node 环境单测即是该设计的直接收益。
- **单用例锁定多参数参与，测试设计巧妙**：`computeSwayYaw` 的 quarter 周期用例（motion-math.test.ts:19-25）构造 `t = 0.25/freq` 使相位恰为 π/2，一个断言同时验证 amplitude、decay、frequency 三参数都真实参与计算，而非仅测默认值。
- **断言期望值全部手动验证正确**：pedalPhase 的 `0.5·0.5·360=90`、`2·0.5·360 % 360 = 0`（整圈回零）、`-90+360=270`（负值归一化，motion-math.test.ts:40-47）；footPitch 的 `sin(π/2)·20=20`、`sin(3π/2)·20=-20`（反相，motion-math.test.ts:51-54）——注释中的数学推导与实现一致，无「断言锁错值」风险。
- **类型安全零逃生**：生产代码 0 处 `as any` / `@ts-ignore`，三函数参数均为显式 `number` / `boolean`（motion-math.ts:12-17, 27, 39）；无 try/catch 吞错（纯函数无异常路径）、无资源需释放、无状态故并发天然安全。
- **无跳过测试**：全文无 `it.skip` / `it.todo` / `describe.skip`，9 用例全部实际执行。

---

**风险：**

| 严重度 | 文件 | 位置 | 观察 | 改进建议 |
|------|------|------|------|------|
| 🔴 P1 | — | — | 无 | — |
| 🟠 P2 | `frontend/src/scene/motion/motion-modules/motion-math.ts` | L12-19（+ L2 注释） | `computeSwayYaw` 无任何生产调用方（全仓 grep 仅定义与测试两处命中）。ADR-116 P3 规划的 `sway-motion.ts` / `finger-pose.ts` 均未落地（motion-modules 目录无此二文件，registry.ts 仅注册 6 模块）；riding-model.ts:171/177 只调用 `computePedalPhase`/`computeFootPitch`。文件头 JSDoc「由 sway/riding 的每帧钩子调用」与实际不符，会误导后续维护者以为 sway 模块已存在。测试锁定未接线公式：公式改动会挂测试，但无调用方时行为回归不会被业务发现 | ① 落地 sway-motion 模块并接线；② 或按 `docs/audit/deadcode-baseline` 流程评估删除；③ 至少修正文件头注释与 ADR-116 P3 实施状态，避免文档误导 |
| 🟡 P3 | `frontend/src/scene/motion/motion-modules/motion-math.ts` | L18 | `decay` 未钳制到 [0,1]：JSDoc 声明「0=满幅，1=静止」，但 `decay=1.5` 时 `(1-decay)=-0.5` 导致幅度**翻转并负向放大**（-0.5·amp），与「衰减到静止」语义不符 | 入口 `decay = clamp(decay, 0, 1)`（复用 `@/core/clamp` 叶导入，符合 ADR-191），或在调用方保证后于 JSDoc 注明前置条件 |
| 🟡 P3 | `frontend/src/__tests__/scene/motion-math.test.ts` | L10-58 | 边界覆盖缺口：computeSwayYaw 未测负 t / 负 amplitude / decay>1 / frequency=0；computeFootPitch 未测 45°（一般相位）、180°、270°、负相位；computePedalPhase 未测 pedalSpeed=0。当前 9 例对「参数参与性」充分（每函数每参数至少 1 例验证），但对防御性边界不足 | 补 2-3 例关键边界（decay>1 钳制、frequency=0、footPitch 45° 一般相位），无需追求全边界 |
| 🟡 P3 | `frontend/src/__tests__/scene/motion-math.test.ts` | 全文件 | 集成路径仍未闭合：`computePedalPhase`/`computeFootPitch` 的真实调用点 riding-model.ts:171-177（autoPedal 帧钩子内）无集成测试——round-12 已指出 riding-model 整模块零直接测试，本补测只覆盖被调用的纯函数，未覆盖「钩子注册 → 每帧取参 → 写足骨」组装层 | 由 riding-model 专项补测（或本文件追加帧钩子集成例）闭合，与 round-12 遗留项合并处理 |
| 🟢 P4 | `frontend/src/scene/motion/motion-modules/motion-math.ts` | L42 | 魔法数值：俯仰幅度 `* 20` 硬编码，未命名常量、与 riding-model 无参数关联（幅度不可配置）；同文件其余常量（2π、360、180）均为数学/度制换算语义清晰 | 提为具名常量（如 `FOOT_PITCH_AMP_DEG = 20`），或参数化以便未来暴露为模块参数 |

---

**测试质量评价：**

- **断言有效性：✅ 强**。9 例期望值全部手工复算正确，与源码公式逐项对应；测试内注释（motion-math.test.ts:23/41/46）与实现一致，无「注释与断言打架」现象。
- **参数参与性：✅ 完整**。computeSwayYaw 的 amp/decay/freq 由 quarter 周期用例一次锁定，另有 decay=1→0、freq 翻倍→周期减半独立验证（motion-math.test.ts:15-32）；pedalSpeed 由 pedalPhase 用例验证（0.5Hz·0.5s=90°）；isLeftFoot 由 footPitch 反相用例验证——**每个函数每个参数都有至少一个用例证明其真实参与**，符合测试文件头声明的目标「frequency/decay/pedalSpeed 真正参与计算」。
- **边界覆盖：🟡 中等**。t=0（×2）、负值归一化、整圈回零、decay=1 静止、phase=0 零输出均有；缺口见风险表 P3#2。
- **跳过测试：无**。
- **59 行充分性：对「P3 纯数学补测」定位充分（9 例/3 函数/4ms）**。属「参数参与验证」级别的覆盖，非「全边界防御」级别；结合纯函数公式简单、调用方 riding 侧有 round-12 遗留集成缺口，判定 59 行作为补测可接受，不建议为凑行数扩测。
- **测试卫生**：`@vitest-environment node` 显式声明（无引擎依赖），不触碰 `window`（符合 ADR-219 铁律），无 mock 污染。

**与 round-12 审核的关系（任务要求注明）：**
- round-12（`docs/audit/2026-08-06-round12-env-motion-core-ai.md`）审的是 motion-modules 的**帧钩子生命周期层**：foot/hand 共享 `_footFrameHooks`/`_handFrameHooks` 按 modelId 键控导致左右侧互斥（P1，foot-modules.ts:26 / module-base.ts:227-233）、riding-model 整模块零测试、unregisterModule 资源泄漏。本测试（motion-math.test.ts）是**数学公式层补测**，与 round-12 正交互补：round-12 锁「钩子有没有注册/互斥/清理」，本测试锁「钩子算出的数对不对」——两文件无重叠。
- **覆盖充分性缺口（沿袭 round-12）**：riding-model 的 autoPedal 帧钩子（riding-model.ts:154-186）整体组装路径仍无直接测试，本补测仅覆盖其调用的两个纯函数；sway-motion 模块未落地导致 `computeSwayYaw` 测试处于「锁定未来公式」状态（见 P2）。

---

审核日期：2026-08-15
审核员：子代理 round46-motion-math
