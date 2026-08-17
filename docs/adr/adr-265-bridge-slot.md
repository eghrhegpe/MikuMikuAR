# ADR-265: 通用注入桥原语 bridge-slot

> **状态**: ✅ 已采纳（2026-10-23）
> **日期**: 2026-10-23

## 背景

耦合度审计（锐评处方③）发现：ADR-238 破环留下的三座注入桥（`core/scene-action-bridge.ts`、`core/ui-action-bridge.ts`、`core/e2e-state-bridge.ts`）各自手写了同一套机械件——Map/单槽 + identity-based 注销 token + 缺失一次性告警，约 20 行逐字重复两份、简化版重复一份。契约注释里明写"与 ui-action-bridge 对称"，即三处靠人肉约定保持镜像：改一处 token 语义要记得改另两处，漏改就是 HMR 闭包残留级别的隐性债。另有两个同构单槽（`core/ai/scene-snapshot.ts` 的 registerAiSnapshotBridge、`core/auto-save.ts` 的 _triggerAutoSaveImpl）属同类但各有测试钩子，暂不并轨。

## 决策

新增纯叶子 `core/bridge-slot.ts`，提供两种形状的原语工厂，三座桥的机械部分全部改立于其上：

- `createActionBridge<A>(label)` — 多键动作桥：`register(key, fn) → identity token`、`get(key) → A[key] | undefined`（缺失按 `[label] 'key' 未注册——调用将静默跳过` 一次性告警）、`unregister(key)`（兼容旧调用点）、`has/snapshot`（供兼容层）。
- `createSlot<T>()` — 单槽注入点：`set(v) → identity token`、`get() → T | null`、`reset()`（测试隔离）。

迁移范围：scene-action-bridge、ui-action-bridge（各减约 20 行手写件）、e2e-state-bridge（19 行改 5 行工厂调用）。**所有桥导出签名不变**，注册方/消费方约 90 个文件零改动。告警文案逐字保留，存量日志引用不断链。

## 备选方案

- **什么都不做（对照组）**：三桥机械件约 20 行×2 份重复已存在两代（ADR-238 期），不合并不会立即产生 bug；代价是每次 token/warnOnce 语义变更要人肉镜像三处（本轮迁移即实证：e2e setter 曾把 token 吃掉，正是无人对照时漏改的形状），且新注入点没有可抄的带护栏样板。收益非零但小，属"预防性收编"而非"灭火"——评审时以此净收益为准，勿按灭火规模高估。
- **DI 容器/事件总线**：杀鸡用牛刀，且引入运行时依赖与隐式注册顺序问题，违背"纯叶子零依赖"破环初衷。不选。
- **三桥合并为一个大桥**：把 core→scene 与 core→menus 两条独立方向搅成一锅，粒度反而变差（dep-metrics 台账会失去按桥归因的能力）。不选。
- **只抽多键版原语、单槽不动**：e2e 只有 19 行，收益趋零；但 identity token 契约的空白（set 覆盖后无法安全注销）恰是 scene/ui 用血泪（code_review P2）修过的坑，单槽并轨让新注入点从第一天就带上护栏。选并轨。
- **mmar-globals 动态 import 收编**：字符串耦合是 dep 图看不见的另一类问题，与本原语正交，另行立项。不在本 ADR 范围。

## 影响

- 新文件：`frontend/src/core/bridge-slot.ts`（约 90 行）+ `frontend/src/core/__tests__/bridge-slot.test.ts`（原语自证：identity、幂等、告警格式、快照语义）。
- 迁移：三桥实现瘦身，接口表（SceneActions/UiActions 的 40+ 字段文档价值）原样保留。
- 回归安全网：`scene-action-bridge.test.ts`/`ui-action-bridge.test.ts`/`dev-hooks.test.ts` 全绿；`tsc --noEmit` 全前端零错。
- 未来新增注入点一律 `createSlot/createActionBridge`，不再手搓 Map；软环（getter/setter 惰性，ADR-064 暂忍类）自此有了带护栏的标准形状。

## 护栏兑现与已知折衷（AtomCode 独立评审后核实，2026-10-23）

- **identity token 非"无消费者特性"**：真实消费 5 处——`menus/scene-menu.ts:107-109`（screenshotCurrent/screenshotBatch/saveScene 的 dispose）、`menus/motion-popup.ts:74-75`（getMotionMenu/refreshMotionRoot）。e2e 桥 setter 原先吃 token 返回 void，评审后已透传（`setE2EStateReader → () => void`，新增 `clearE2EStateReader(token?)`）。
- **`unregister(key)` footgun**：不辨注册实例，覆盖注册顺序下会删错——保留仅为兼容；真实消费者已全走 token，剩余调用方只有 `ui-action-bridge.test.ts`。计划：该测试改写 token 路径后，`unregister` 标 `@deprecated` 并在下次触碰这两座桥时删除（不设倒计时，避免为删 API 而删）。
- **warnOnce 是 per-instance Set**：HMR 双实例下"一次性"各自成立、全局不成立；且 register→unregister→再 get 不再告警。这不是回归——旧手写桥同样是模块级 Set、register 不清除，语义逐字保留。若将来需要"每实例只报一次"，用 `createActionBridge` 外层新实例天然满足，不改原语。
- **`snapshot()` 每次新建普通对象**：与迁移前 `ui-action-bridge.ts:106` 的 `Object.fromEntries` 行为逐字一致（评审担心"若旧实现有缓存则是回归"——核实旧文件，无缓存，非回归）。由 `bridge-slot.test.ts` 断言钉死，防止未来"优化"成共享引用。
- **dep 图缺 scene/ui→bridge-slot 两边**：非提交遗漏，系 `scripts/_lib/source-graph.mjs:64` 块注释剥离正则在行注释含 `scene/*` 等字样时跨语句吞掉真 import 行（存量盲区，迁移前的 `scene→types` 边同样不在图里）。见 buglog `2026-10-23-source-graph-line-comment-swallow-edges.md`；治本在并行会话的 `_lib/import-scan.mjs` 迁移（ADR-254 B9）。

## 相关文档

- ADR-238（三桥起源，本 ADR 是其补充而非取代）
- ADR-064（软环/硬环判别）
- 知识卡：scene-action-bridge / ui-action-bridge / e2e-state-bridge
- 锐评处方③（依赖耦合台账 docs/dep-metrics.md 提供 Ca/Ce 底数）
