# ADR-166: 感知层 per-model 上下文真实隔离（ADR-162/163 返工）

> **状态**: 已完成（2026-07-21；实施 commit 006ffa56；独立审核：tsc 0 错误 / frontend 1821 测试 0 失败 / 88 perception 测试全绿；P1-1/2/3/4 + P2-1/2/3 + P3-1/2 + P4-1 全部落地）
> **关联**: ADR-162（per-model Phase 1，已实施但需返工）、ADR-163（冲突可视化，已实施但需返工）、ADR-164（per-model Phase 2 全员感知，已实现）、ADR-160/ADR-161、ADR-147（管线调度器）
> **来源**: 2026-07-21 ADR-162/163 实施代码深度审核（总体结论：不通过）
> **日期**: 2026-07-21

---

## 一、背景与触发

ADR-162（per-model 实例化 Phase 1）与 ADR-163（冲突可视化）已落地。2026-07-21 对其实施代码做深度审核，总体结论 **不通过**：per-model 隔离仅停留在「状态字段」层面（`PerceptionContext` 类型 + `_contexts` Map + pin/unpin API），实际运行行为未达成 per-model 独立。ADR-164（全员感知）叠加在该未真实隔离的 Phase 1 之上，使多模型污染面由 ≤5 扩大到全员。

审核识别出 3 处循环依赖（ADR-163 §4 未识别）、2 处资源配对缺陷、1 处类型违规（`as any`），以及多模型增量计算相互污染（P1）。本 ADR 是修复这些缺陷的返工依据，完成后方可将 ADR-162 标记「已完成」。

## 二、缺陷清单

### 2.1 P1（必须修复，阻断 ADR-162 验收）

| 编号 | 位置 | 问题 |
|------|------|------|
| P1-1 | perception-breathing.ts:25,27 | `_lastBreathBoneName` / `_lastBreathOffset` 仍为模块级变量。ADR-162 §三 要求「reset/lastOffset 移入 Context」未实施。`PerceptionContext.lastOffsets.breath` 字段被 `_resetContextOffsets` 维护但从未被读取，实际 reset 走 `_resetBreathingState`。模型 A 写入 `_lastBreathOffset=0.02` 后，模型 B 计算 delta 时误用 A 的值 → B 的 spine 旋转跳跃 |
| P1-2 | perception-balance.ts:30-45 | `_lastBobY` / `_lastCenterRz` / `_lastUpperRx` 等 9 个模块级变量未移入 Context。balance 的 `_lastBobY` 是 center bone position.y 增量，跨模型污染后果更严重：模型 A 写入 0.03 后，模型 B 若关闭 balanceSway 会用 0.03 错误撤销 B 自己没写过的 position.y → B 的 center bone 沉地 |
| P1-3 | perception-breathing.ts:36, perception-blinking.ts:18 | `_applyBreathing` / `_applyBlinking` 内部调 `getPerceptionState()` 读取焦点 context 而非 `ctx.state`。pinned 模型 A 实际用焦点模型 B 的 `breathFrequency` / `blinkFrequency` 运行，A 自身 `ctx.state` 完全失效 |
| P1-4 | perception.ts:41-42 ↔ perception-breathing/blinking | 循环依赖：perception.ts import breathing/blinking，后者反向 import `getPerceptionState`。阻碍 lastOffsets 移入 Context（移入后 breathing 需 import `PerceptionContext` 类型）。ES module live binding 在 Vite 下能跑，但阻碍 tree-shake |

### 2.2 P2（应修复，ADR-163 验收标准）

| 编号 | 位置 | 问题 |
|------|------|------|
| P2-1 | perception.ts:452/698/766 | claimBones 仅在 activate 时调一次，关闭 Bone Override 后感知层不重新 claim。ADR-163 §2.6 承诺「关闭 Bone Override → 感知层重新 claim 成功 → banner 消失」未兑现：observer 仍读旧的 `_perceptionOwnedBones`，gaze 头部跟随永不恢复 |
| P2-2 | motion-gaze-levels.ts:346-361 | UI 仅有 pinPerception 入口，无 unpinPerception。用户 pin 后只能删模型清理 |
| P2-3 | motion-gaze-levels.ts:412-416 | 冲突 banner 仅 `modelId === focusedModelId` 时显示。pinned 模型 A 被 Bone Override 抢占，切焦点到 B 后看不到 A 的冲突 |

### 2.3 P3/P4（清理项）

| 编号 | 级别 | 位置 | 问题 |
|------|------|------|------|
| P3-1 | 🟡 | scene-serialize.ts:928-934 | `const pAny = data.perception as any` 违反 AGENTS.md「生产代码 0 处新增 as any」；tier 字段在 SceneFile 已声明但迁移返回类型未含 |
| P3-2 | 🟡 | menu-schema.ts:9,87,133 | 仍用 `getPerceptionState()` 读焦点 context，无法编辑 pinned 模型参数（ADR-162 §三 要求 `getPerceptionState()[key] → 指定 modelId` 未实施） |
| P3-3 | 🟡 | perception.ts:681-701 | pinPerception 注释「≤5 上限已移除」，但 ADR-162 §6 验收仍写「pin 第 6 个 warn 并拒绝」，文档与代码不一致（被 ADR-164 推翻） |
| P3-4 | 🟡 | perception.ts:711-715 | unpinPerception 焦点分支未释放骨骼（仅非焦点分支调 `_releasePerceptionBones`），职责边界不清 |
| P3-5 | 🟡 | perception.ts:763-767 | enableAllPerception 仅 `!ctx.isActive` 时 claim；ctx 已 active 但 ownedBones 已被抢占时不重 claim |
| P4-1 | 🟢 | registry.ts:294-303 | `getBuiltinModuleDefs` 未含 perception.*，且无注释说明「感知层走 store.claimBones 直接调用，不经 registry」 |
| P4-2 | 🟢 | perception.ts:208 | `_releasePerceptionBones` 中 `_perceptionOwnedBones.delete` 在循环外，若循环内 releaseOwnedBones 抛错则 map 残留空 Map |
| P4-3 | 🟢 | perception.test.ts:874-879 | 测试「pin 上限已移除，可 pin 超 5 个」与 ADR-162 §6 原验收相反，应同步更新文档 |
| P4-4 | 🟢 | perception-shared.ts:89-94 | 对象池容量 `_v3Pool=16` / `_mPool=16` / `_qPool=32` 注释「单帧最大消费 28」。全员感知（ADR-164）下 N 模型池被循环覆写，污染已外泄引用 |

## 三、修复方案

### 3.1 消除对焦点 context 的隐式依赖（P1-3）
- `_applyBreathing(ctx, model, time, dt)` / `_applyBlinking(ctx, ...)` / `_applyBalanceSway(ctx, ...)` 改为接收 `ctx: PerceptionContext`，内部一律读 `ctx.state.*`
- breathing/blinking/balance/expression 工厂函数不再 import `getPerceptionState`

### 3.2 lastOffsets 移入 PerceptionContext（P1-1 / P1-2）
- `PerceptionContext.lastOffsets` 已有 `breath` / `balance` / `emotion` 字段，改为真实读写：
  - breathing：`ctx.lastOffsets.breath` 存 offset；`_lastBreathBoneName` → `ctx.lastOffsets.breathBoneName`
  - balance：`ctx.lastOffsets.balance: BalanceSwayState` 存 `_lastBobY` / `_lastCenterRz` / `_lastUpperRx` …
  - expression：emotion morph name → `ctx.lastOffsets.emotion`
- 删除全部模块级 `_last*` 变量；确认 `_resetContextOffsets(ctx)` 在切焦点 / reset 时调用

### 3.3 打破循环依赖（P1-4）
- `PerceptionContext` 类型与轻量读写接口收口到 `perception-shared.ts`；breathing/blinking 只 import 类型与 `ctx` 参数，不反向 import `perception.ts`
- 若需「当前 ctx」，统一通过参数传入；移入 Context 后循环自然解除，恢复 tree-shake

### 3.4 关闭 Bone Override 后重新 claim（P2-1）
- 监听 `bone-override-store` 的 release 事件，或每 N 帧对未拥有的骨骼调 `claimBones` 重新认领（新增 `_reclaimPerceptionBones(modelId)`）
- observer 内对 `headClaimed` 缺失且 store 中 `owner === null` 的骨骼触发 reclaim
- reclaim 成功后 banner 消失，满足 ADR-163 §2.6

### 3.5 UI 与序列化（P2-2 / P2-3 / P3）
- motion-gaze-levels.ts：加 `unpinPerception` 按钮；冲突 banner 显示「当前编辑模型」冲突（不限焦点）
  - 补记（2026-07-21，commit b6f683d）：初版仅泛化 `updatePerceptionConflictBanner(el, modelId)` 函数，调用点 `buildGazeTrackingLevel` 仍只传 `focusedModelId` → pinned 模型冲突实际不可见。新增 `renderPerceptionConflictBanners(container)` 对「焦点 + 全部 pinned」去重后逐模型渲染子 banner，多模型时加 modelId 前缀区分归属；补测试锁定聚合行为。P2-3 至此真正闭环。
- menu-schema.ts：`getPerceptionState()` → `getPerceptionStateFor(modelId)`
- scene-serialize.ts:928：消除 `as any`（迁移返回类型补 `tier` 字段）
- ADR-162 §6 / §7 同步：删除「≤5 上限」验收，Phase 2 引用改 ADR-164

### 3.6 对象池（P4-4）
- 落实 ADR-164 §3.6 方案 B：per-context 独立池，或扩容到覆盖 high 档（20 × 28 = 560），避免覆写污染

## 四、改动范围

| 文件 | 改动 | 风险 |
|------|------|------|
| perception-breathing.ts | 去 `getPerceptionState`；lastOffset 移入 ctx | 🔴 高 |
| perception-blinking.ts | 同上 | 🔴 高 |
| perception-balance.ts | 同上（9 变量） | 🔴 高 |
| perception-expression.ts | emotion 状态移入 ctx | 🟠 中 |
| perception.ts | 函数签名改传 ctx；加 `_reclaimPerceptionBones`；unpin/enableAll 职责修正 | 🔴 高 |
| perception-shared.ts | 类型/接口收口；对象池 per-context | 🟠 中 |
| motion-gaze-levels.ts | unpin 按钮 + banner 不限焦点 | 🟡 低 |
| menu-schema.ts | `getPerceptionStateFor(modelId)` | 🟠 中 |
| scene-serialize.ts | 去 `as any` | 🟢 低 |
| registry.ts | 加感知层豁免注释 | 🟢 低 |
| 测试 | perception.test.ts 调整 + 新增隔离测试 | 🟠 中 |

## 五、风险评估

| 风险 | 级别 | 缓解 |
|------|------|------|
| 改 breathing/blink/balance 签名波及所有调用点 | 🔴 高 | 先改签名 + 编译驱动，单测覆盖 delta 计算 |
| 循环依赖打破后 tree-shake 变化致 bundle 差异 | 🟡 低 | 构建比对 |
| 重新 claim 每 N 帧引入开销 | 🟡 低 | 仅对 ownedBones 缺失的模型触发，非每帧全量 |
| 对象池扩容内存增长 | 🟠 中 | per-context 按需分配 |

## 六、验收标准

| 标准 | 验证方法 |
|------|---------|
| pinned 模型用自身 `ctx.state`（breath/blinkFrequency）运行，不继承焦点 | 单测 + 实测 |
| 切换焦点无 1 帧旋转跳跃（lastOffsets 按 ctx 隔离） | 多模型实测 |
| 关闭 Bone Override 后 gaze 头部恢复 + banner 消失 | 实测 |
| `0` 新增 `as any`；`0` 感知层内部循环依赖 | grep + 构建 |
| 对象池 per-context 或覆盖全员档 | 代码审查 |
| 现有 1821 测试 + perception 测试全绿 | `npm run test` |

## 七、状态机

| ADR | 当前状态 | 本 ADR 完成后 |
|-----|---------|--------------|
| ADR-162 | 已实施但需返工 | 标记「已完成」（P1 修复后） |
| ADR-163 | 已实施但需返工 | 视冲突可视化是否完整再标记 |
| **ADR-166（本）** | 规划（待实施） | — |

## 八、与 ADR-162/163/164 的关系

- ADR-162 提供 `PerceptionContext` 容器与 pin 机制 → 本 ADR 补全「容器内状态真实隔离」
- ADR-163 提供 claimBones + banner → 本 ADR 补全「释放后重新 claim」
- ADR-164 全员感知依赖本 ADR 的真实隔离，否则污染面随模型数放大

---

## 附：审核过程覆盖度

| 审核步骤 | 结论 |
|----------|------|
| 导入图谱 | ✓ 识别 3 处循环依赖（ADR-163 §4 未识别 internal cycle） |
| 状态读写 | ✓ `_contexts` / `_focusedContextId` / `_perceptionOwnedBones` 写入点已穷举，无幽灵路径 |
| 序列化兼容 | ✓ `migratePerceptionData` 双格式处理正确；`as any` 为新引入类型违规 |
| 资源配对 | ✓ claimBones / releaseOwnedBones 配对完整，但「焦点分支 unpin」「关闭 Bone Override 后重 claim」两处缺陷 |
| 心理模拟 | ✓ 6 场景走查，识别 ADR-163 §2.6 承诺未实施 |
